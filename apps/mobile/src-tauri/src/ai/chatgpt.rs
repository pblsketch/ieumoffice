use crate::ai::http::{build_safe_http_client, enforce_https_url, extract_safe_error_code};
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::secrets::SealedVault;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use rand::RngCore;
use rsa::BigUint;
use rsa::RsaPublicKey;
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::signature::Verifier;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_ieum_mobile::auth::NativeAuthBridge;
use url::Url;

pub const CHATGPT_ISSUER_PROD: &str = "https://auth.openai.com";
pub const CHATGPT_API_BASE_PROD: &str = "https://api.openai.com/v1";
pub const CHATGPT_RESOURCE: &str = "https://api.openai.com/v1";
pub const CHATGPT_MOBILE_REDIRECT_URI: &str = "https://ieumoffice.com/mobile/auth/callback";
pub const CHATGPT_SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const CHATGPT_SHARING_SCOPE: &str = "chatgpt.tokens.use.direct";
const VAULT_SLOT_CHATGPT: &str = "chatgpt-connection";
const MAX_STREAM_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const STREAM_TIMEOUT_SECS: u64 = 180;

/// Build-time official OpenAI mobile client ID; absent in unsigned/unapproved release builds.
pub fn compiled_chatgpt_client_id() -> Option<&'static str> {
    option_env!("IEUM_MOBILE_CHATGPT_CLIENT_ID")
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

/// Returns true only when an official client ID is configured or the dev loopback feature is explicitly enabled.
pub fn is_chatgpt_visible(client_id_override: Option<&str>) -> bool {
    let has_override = client_id_override
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some();
    has_override || compiled_chatgpt_client_id().is_some() || cfg!(feature = "dev-chatgpt-loopback")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptLoginFailure {
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileChatGptStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_failure: Option<ChatGptLoginFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptModelInfo {
    pub slug: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponsesInputMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OidcDiscoveryDoc {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    #[serde(default)]
    revocation_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingRefreshCheckpoint {
    access_token: String,
    refresh_token: String,
    expires_at_secs: u64,
    earliest_refresh_at_secs: Option<u64>,
    scopes: Vec<String>,
    id_token: String,
    received_at_secs: u64,
}

/// Sealed ChatGPT session stored on disk — never stores email (email lives in memory only).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredChatGptSession {
    client_id: String,
    subject: String,
    scopes: Vec<String>,
    access_token: String,
    refresh_token: String,
    expires_at_secs: u64,
    earliest_refresh_at_secs: Option<u64>,
    pending_refresh: Option<PendingRefreshCheckpoint>,
}

#[derive(Debug, Clone)]
struct ActivePkceAttempt {
    client_id: String,
    redirect_uri: String,
    verifier: String,
    state: String,
    nonce: String,
}

#[derive(Debug, Clone, Deserialize)]
struct JwkKey {
    kty: String,
    #[serde(default)]
    kid: Option<String>,
    #[serde(default)]
    n: Option<String>,
    #[serde(default)]
    e: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct JwksDoc {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Clone)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub email: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn generate_pkce_pair() -> (String, String) {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let verifier = URL_SAFE_NO_PAD.encode(raw);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn random_token() -> String {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}

/// Only refresh-token grant invalidation errors should wipe stored OAuth credentials.
/// API HTTP 401 or subscription_sharing_invalid_user must NOT silently wipe stored credentials.
pub fn requires_reauthentication_on_refresh(code: &str) -> bool {
    matches!(
        code,
        "invalid_grant"
            | "invalid_refresh_token"
            | "token_expired"
            | "refresh_token_expired"
            | "refresh_token_invalidated"
            | "refresh_token_reused"
    )
}

/// Verifies RS256 ID token signature and OIDC claims against JWKS.
pub fn verify_rs256_id_token(
    id_token: &str,
    jwks_json: &serde_json::Value,
    expected_issuer: &str,
    expected_client_id: &str,
    expected_nonce: Option<&str>,
    reference_now_secs: u64,
) -> MobileResult<VerifiedIdentity> {
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }
    let header_bytes = URL_SAFE_NO_PAD.decode(parts[0]).map_err(|_| {
        MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
    })?;
    let payload_bytes = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| {
        MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
    })?;
    let sig_bytes = URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| {
        MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
    })?;

    let header: serde_json::Value = serde_json::from_slice(&header_bytes).map_err(|_| {
        MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
    })?;
    if header.get("alg").and_then(|v| v.as_str()) != Some("RS256") {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }
    let kid = header.get("kid").and_then(|v| v.as_str());

    let jwks: JwksDoc = serde_json::from_value(jwks_json.clone()).map_err(|_| {
        MobileError::with_detail(
            MobileErrorCode::NetworkError,
            "mobile.chatgpt.jwksUnavailable",
            "identity_verification_unavailable",
        )
    })?;
    let candidate_keys: Vec<&JwkKey> = jwks
        .keys
        .iter()
        .filter(|k| k.kty == "RSA" && (kid.is_none() || k.kid.as_deref() == kid))
        .collect();
    if candidate_keys.is_empty() {
        return Err(MobileError::with_detail(
            MobileErrorCode::NetworkError,
            "mobile.chatgpt.jwksUnavailable",
            "identity_verification_unavailable",
        ));
    }

    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let signature = Signature::try_from(sig_bytes.as_slice()).map_err(|_| {
        MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
    })?;

    let mut verified_sig = false;
    for key in candidate_keys {
        let (Some(n_b64), Some(e_b64)) = (&key.n, &key.e) else {
            continue;
        };
        let (Ok(n_bytes), Ok(e_bytes)) = (URL_SAFE_NO_PAD.decode(n_b64), URL_SAFE_NO_PAD.decode(e_b64))
        else {
            continue;
        };
        let n = BigUint::from_bytes_be(&n_bytes);
        let e = BigUint::from_bytes_be(&e_bytes);
        if let Ok(pub_key) = RsaPublicKey::new(n, e) {
            let verifying_key = VerifyingKey::<Sha256>::new(pub_key);
            if verifying_key.verify(signing_input.as_bytes(), &signature).is_ok() {
                verified_sig = true;
                break;
            }
        }
    }
    if !verified_sig {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }

    let payload: serde_json::Value = serde_json::from_slice(&payload_bytes).map_err(|_| {
        MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
    })?;

    let iss = payload.get("iss").and_then(|v| v.as_str()).unwrap_or("");
    if iss != expected_issuer {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }

    let aud_ok = match payload.get("aud") {
        Some(serde_json::Value::String(s)) => s == expected_client_id,
        Some(serde_json::Value::Array(arr)) => {
            let contains = arr.iter().any(|v| v.as_str() == Some(expected_client_id));
            let azp_ok = arr.len() <= 1
                || payload.get("azp").and_then(|v| v.as_str()) == Some(expected_client_id);
            contains && azp_ok
        }
        _ => false,
    };
    if !aud_ok {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }
    if let Some(azp) = payload.get("azp").and_then(|v| v.as_str())
        && azp != expected_client_id
    {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }

    let exp = payload.get("exp").and_then(|v| v.as_u64()).unwrap_or(0);
    let iat = payload.get("iat").and_then(|v| v.as_u64()).unwrap_or(0);
    if exp == 0 || iat == 0 || reference_now_secs > exp.saturating_add(5) {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }

    if let Some(nonce) = expected_nonce
        && payload.get("nonce").and_then(|v| v.as_str()) != Some(nonce)
    {
        return Err(MobileError::with_detail(
            MobileErrorCode::AuthDenied,
            "mobile.chatgpt.invalidIdToken",
            "invalid_id_token",
        ));
    }

    let subject = payload
        .get("sub")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            MobileError::with_detail(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken", "invalid_id_token")
        })?
        .to_string();
    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    Ok(VerifiedIdentity { subject, email })
}

/// Manages ChatGPT Direct Connection OAuth, single-flight token refresh with encrypted pendingRefresh checkpoint,
/// model discovery (`models[]` where `visibility == "list"`), and `/v1/responses` SSE streaming.
pub struct ChatGptService {
    vault: Arc<SealedVault>,
    auth_bridge: Arc<dyn NativeAuthBridge>,
    issuer_base: String,
    api_base: String,
    client_id_override: Option<String>,
    allow_test_loopback: bool,
    pending_pkce: Mutex<Option<ActivePkceAttempt>>,
    memory_email: Mutex<Option<String>>,
    last_failure: Mutex<Option<ChatGptLoginFailure>>,
    refresh_lock: tokio::sync::Mutex<()>,
}

impl ChatGptService {
    pub fn new(vault: Arc<SealedVault>, auth_bridge: Arc<dyn NativeAuthBridge>) -> Self {
        Self {
            vault,
            auth_bridge,
            issuer_base: CHATGPT_ISSUER_PROD.to_string(),
            api_base: CHATGPT_API_BASE_PROD.to_string(),
            client_id_override: None,
            allow_test_loopback: false,
            pending_pkce: Mutex::new(None),
            memory_email: Mutex::new(None),
            last_failure: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Test constructor allowing local mock OIDC/API servers while keeping all security invariants active.
    pub fn new_for_test(
        vault: Arc<SealedVault>,
        auth_bridge: Arc<dyn NativeAuthBridge>,
        issuer_base: String,
        api_base: String,
        client_id_override: Option<String>,
    ) -> Self {
        Self {
            vault,
            auth_bridge,
            issuer_base,
            api_base,
            client_id_override,
            allow_test_loopback: true,
            pending_pkce: Mutex::new(None),
            memory_email: Mutex::new(None),
            last_failure: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub fn is_visible(&self) -> bool {
        is_chatgpt_visible(self.client_id_override.as_deref())
    }

    fn effective_client_id(&self) -> MobileResult<String> {
        if let Some(v) = self
            .client_id_override
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            return Ok(v.to_string());
        }
        compiled_chatgpt_client_id()
            .map(ToString::to_string)
            .ok_or_else(|| {
                MobileError::with_detail(
                    MobileErrorCode::AuthNotConfigured,
                    "mobile.chatgpt.notConfigured",
                    "IEUM_MOBILE_CHATGPT_CLIENT_ID is not configured",
                )
            })
    }

    async fn discover(&self) -> MobileResult<OidcDiscoveryDoc> {
        let issuer_url = enforce_https_url(&self.issuer_base, self.allow_test_loopback)?;
        let expected_origin = issuer_url.origin();
        let disc_url = format!("{}/.well-known/openid-configuration", self.issuer_base.trim_end_matches('/'));
        let client = build_safe_http_client(15)?;
        let resp = client.get(&disc_url).send().await.map_err(|_| {
            MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.discoveryFailed",
                "discovery_failed",
            )
        })?;
        if !resp.status().is_success() {
            return Err(MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.discoveryFailed",
                "discovery_failed",
            ));
        }
        let doc: OidcDiscoveryDoc = resp.json().await.map_err(|_| {
            MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.discoveryFailed",
                "discovery_failed",
            )
        })?;
        if doc.issuer != self.issuer_base {
            return Err(MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.discoveryOriginMismatch",
                "discovery_failed",
            ));
        }
        for ep in [
            Some(doc.authorization_endpoint.as_str()),
            Some(doc.token_endpoint.as_str()),
            Some(doc.jwks_uri.as_str()),
            doc.revocation_endpoint.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            let parsed = enforce_https_url(ep, self.allow_test_loopback)?;
            if parsed.origin() != expected_origin {
                return Err(MobileError::with_detail(
                    MobileErrorCode::AuthDenied,
                    "mobile.chatgpt.discoveryOriginMismatch",
                    "discovery_failed",
                ));
            }
        }
        Ok(doc)
    }

    async fn fetch_jwks(&self, jwks_uri: &str) -> MobileResult<serde_json::Value> {
        let _ = enforce_https_url(jwks_uri, self.allow_test_loopback)?;
        let client = build_safe_http_client(15)?;
        let resp = client.get(jwks_uri).send().await.map_err(|_| {
            MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.jwksUnavailable",
                "identity_verification_unavailable",
            )
        })?;
        if resp.status().as_u16() != 200 {
            return Err(MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.jwksUnavailable",
                "identity_verification_unavailable",
            ));
        }
        let val: serde_json::Value = resp.json().await.map_err(|_| {
            MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.jwksUnavailable",
                "identity_verification_unavailable",
            )
        })?;
        if !val.get("keys").map(|k| k.is_array()).unwrap_or(false) {
            return Err(MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.jwksUnavailable",
                "identity_verification_unavailable",
            ));
        }
        Ok(val)
    }

    pub fn status(&self) -> MobileResult<MobileChatGptStatus> {
        if !self.is_visible() {
            return Ok(MobileChatGptStatus {
                state: "hidden".to_string(),
                account: None,
                sharing: None,
                login_failure: None,
            });
        }
        let stored: Option<StoredChatGptSession> = self.vault.read_sealed(VAULT_SLOT_CHATGPT)?;
        let email = self.memory_email.lock().unwrap().clone();
        let failure = self.last_failure.lock().unwrap().clone();
        match stored {
            Some(sess) => {
                let sharing = sess.scopes.iter().any(|s| s == CHATGPT_SHARING_SCOPE);
                Ok(MobileChatGptStatus {
                    state: "ready".to_string(),
                    account: email,
                    sharing: Some(sharing),
                    login_failure: failure,
                })
            }
            None => Ok(MobileChatGptStatus {
                state: "signed-out".to_string(),
                account: None,
                sharing: Some(false),
                login_failure: failure,
            }),
        }
    }

    pub async fn start_sign_in(&self, reconsent: bool) -> MobileResult<String> {
        let client_id = self.effective_client_id()?;
        let disc = self.discover().await?;
        let (verifier, challenge) = generate_pkce_pair();
        let state = random_token();
        let nonce = random_token();
        let redirect_uri = CHATGPT_MOBILE_REDIRECT_URI.to_string();

        let mut url = Url::parse(&disc.authorization_endpoint).map_err(|_| {
            MobileError::new(MobileErrorCode::InternalError, "mobile.chatgpt.authUrlFailed")
        })?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("client_id", &client_id);
            pairs.append_pair("response_type", "code");
            pairs.append_pair("redirect_uri", &redirect_uri);
            pairs.append_pair("scope", CHATGPT_SCOPES);
            pairs.append_pair("resource", CHATGPT_RESOURCE);
            pairs.append_pair("state", &state);
            pairs.append_pair("nonce", &nonce);
            pairs.append_pair("code_challenge_method", "S256");
            pairs.append_pair("code_challenge", &challenge);
            if reconsent {
                pairs.append_pair("prompt", "consent");
            }
        }
        let auth_url = url.to_string();
        *self.pending_pkce.lock().unwrap() = Some(ActivePkceAttempt {
            client_id,
            redirect_uri,
            verifier,
            state,
            nonce,
        });
        *self.last_failure.lock().unwrap() = None;
        self.auth_bridge
            .launch_auth_browser(&auth_url, "https")
            .map_err(|e| {
                MobileError::with_detail(
                    MobileErrorCode::InternalError,
                    "mobile.chatgpt.browserLaunchFailed",
                    e,
                )
            })?;
        Ok(auth_url)
    }

    pub async fn complete_callback(&self, callback_url: &str) -> MobileResult<MobileChatGptStatus> {
        let attempt = self.pending_pkce.lock().unwrap().take().ok_or_else(|| {
            MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.noPendingAuth",
                "no pending sign-in attempt",
            )
        })?;
        let parsed = Url::parse(callback_url).map_err(|_| {
            MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.chatgpt.invalidCallback",
                "malformed callback URL",
            )
        })?;
        let mut state_val = None;
        let mut code_val = None;
        let mut error_val = None;
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "state" => state_val = Some(v.into_owned()),
                "code" => code_val = Some(v.into_owned()),
                "error" => error_val = Some(v.into_owned()),
                _ => {}
            }
        }
        if state_val.as_deref() != Some(attempt.state.as_str()) {
            return Err(MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.stateMismatch",
                "OAuth state mismatch",
            ));
        }
        if let Some(err) = error_val {
            *self.last_failure.lock().unwrap() = Some(ChatGptLoginFailure {
                reason: "denied".to_string(),
                step: Some("callback".to_string()),
                http_status: None,
                oauth_error: Some(err.clone()),
            });
            return Err(MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.authDenied",
                err,
            ));
        }
        let code = code_val.ok_or_else(|| {
            MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.missingCode",
                "missing authorization code",
            )
        })?;

        let disc = self.discover().await?;
        let client = build_safe_http_client(30)?;
        let resp = client
            .post(&disc.token_endpoint)
            .header("accept", "application/json")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", attempt.client_id.as_str()),
                ("code", code.as_str()),
                ("code_verifier", attempt.verifier.as_str()),
                ("redirect_uri", attempt.redirect_uri.as_str()),
                ("resource", CHATGPT_RESOURCE),
            ])
            .send()
            .await
            .map_err(|_| MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.tokenNetwork"))?;
        let status_code = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.map_err(|_| {
            MobileError::new(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidTokenResponse")
        })?;
        if !(200..300).contains(&status_code) {
            let err_code = extract_safe_error_code(&body).unwrap_or_else(|| "token_error".into());
            *self.last_failure.lock().unwrap() = Some(ChatGptLoginFailure {
                reason: "denied".to_string(),
                step: Some("token".to_string()),
                http_status: Some(status_code),
                oauth_error: Some(err_code.clone()),
            });
            return Err(MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.tokenExchangeFailed",
                err_code,
            ));
        }

        let scope_str = body.get("scope").and_then(|v| v.as_str()).unwrap_or("");
        let scopes: Vec<String> = scope_str.split_whitespace().map(ToString::to_string).collect();
        if !scopes.iter().any(|s| s == CHATGPT_SHARING_SCOPE) {
            *self.last_failure.lock().unwrap() = Some(ChatGptLoginFailure {
                reason: "no-plan".to_string(),
                step: Some("scope".to_string()),
                http_status: None,
                oauth_error: None,
            });
            return Err(MobileError::new(
                MobileErrorCode::AuthNoPlan,
                "mobile.chatgpt.noPlanPermission",
            ));
        }
        let access_token = body
            .get("access_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| MobileError::new(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidTokenResponse"))?
            .to_string();
        let refresh_token = body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| MobileError::new(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidTokenResponse"))?
            .to_string();
        let id_token = body
            .get("id_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| MobileError::new(MobileErrorCode::AuthDenied, "mobile.chatgpt.invalidIdToken"))?;
        let expires_in = body.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(0);
        if expires_in == 0 {
            return Err(MobileError::new(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.invalidTokenResponse",
            ));
        }
        let earliest_refresh_at_secs = body.get("earliest_refresh_at").and_then(|v| v.as_u64());

        let jwks = self.fetch_jwks(&disc.jwks_uri).await?;
        let identity = verify_rs256_id_token(
            id_token,
            &jwks,
            &disc.issuer,
            &attempt.client_id,
            Some(&attempt.nonce),
            now_secs(),
        )?;

        let stored = StoredChatGptSession {
            client_id: attempt.client_id,
            subject: identity.subject,
            scopes,
            access_token,
            refresh_token,
            expires_at_secs: now_secs().saturating_add(expires_in),
            earliest_refresh_at_secs,
            pending_refresh: None,
        };
        self.vault.write_sealed(VAULT_SLOT_CHATGPT, &stored)?;
        *self.memory_email.lock().unwrap() = identity.email;
        *self.last_failure.lock().unwrap() = None;
        self.status()
    }

    /// Ensures a fresh access token using single-flight locking and an encrypted `pendingRefresh` checkpoint
    /// persisted BEFORE JWKS verification so a JWKS outage or cancellation never drops rotated refresh tokens.
    pub async fn ensure_valid_access_token(&self) -> MobileResult<String> {
        let _guard = self.refresh_lock.lock().await;
        let mut stored: StoredChatGptSession = self
            .vault
            .read_sealed(VAULT_SLOT_CHATGPT)?
            .ok_or_else(|| MobileError::new(MobileErrorCode::SignedOut, "mobile.chatgpt.signedOut"))?;
        if !stored.scopes.iter().any(|s| s == CHATGPT_SHARING_SCOPE) {
            return Err(MobileError::new(
                MobileErrorCode::AuthNoPlan,
                "mobile.chatgpt.noPlanPermission",
            ));
        }

        let now = now_secs();
        let needs_refresh = stored.pending_refresh.is_some()
            || stored.expires_at_secs <= now.saturating_add(60);

        if !needs_refresh {
            return Ok(stored.access_token);
        }

        if stored.pending_refresh.is_none()
            && let Some(earliest) = stored.earliest_refresh_at_secs
            && earliest > now
        {
            if stored.expires_at_secs > now {
                return Ok(stored.access_token);
            }
            return Err(MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.refreshNotReady",
                "refresh_not_ready",
            ));
        }

        let disc = self.discover().await?;

        // Step 1: If no pending rotation checkpoint exists, exchange refresh_token under a 60s timeout.
        if stored.pending_refresh.is_none() {
            let client = build_safe_http_client(60)?;
            let resp = client
                .post(&disc.token_endpoint)
                .header("accept", "application/json")
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", stored.client_id.as_str()),
                    ("refresh_token", stored.refresh_token.as_str()),
                    ("resource", CHATGPT_RESOURCE),
                ])
                .send()
                .await
                .map_err(|_| MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.refreshNetwork"))?;
            let status_code = resp.status().as_u16();
            let body: serde_json::Value = resp.json().await.map_err(|_| {
                MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.invalidTokenResponse")
            })?;
            if !(200..300).contains(&status_code) {
                let code = extract_safe_error_code(&body).unwrap_or_else(|| format!("http_{status_code}"));
                if requires_reauthentication_on_refresh(&code) {
                    let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                    *self.memory_email.lock().unwrap() = None;
                    return Err(MobileError::with_detail(
                        MobileErrorCode::SignedOut,
                        "mobile.chatgpt.reauthRequired",
                        code,
                    ));
                }
                return Err(MobileError::with_detail(
                    MobileErrorCode::NetworkError,
                    "mobile.chatgpt.refreshFailed",
                    code,
                ));
            }

            let new_access = body
                .get("access_token")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                    *self.memory_email.lock().unwrap() = None;
                    MobileError::with_detail(
                        MobileErrorCode::SignedOut,
                        "mobile.chatgpt.invalidTokenResponse",
                        "invalid_token_response",
                    )
                })?
                .to_string();
            let new_refresh = body
                .get("refresh_token")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                    *self.memory_email.lock().unwrap() = None;
                    MobileError::with_detail(
                        MobileErrorCode::SignedOut,
                        "mobile.chatgpt.invalidTokenResponse",
                        "invalid_token_response",
                    )
                })?
                .to_string();
            let expires_in = body
                .get("expires_in")
                .and_then(|v| v.as_u64())
                .filter(|&v| v > 0)
                .ok_or_else(|| {
                    let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                    *self.memory_email.lock().unwrap() = None;
                    MobileError::with_detail(
                        MobileErrorCode::SignedOut,
                        "mobile.chatgpt.invalidTokenResponse",
                        "invalid_token_response",
                    )
                })?;
            let scopes = body
                .get("scope")
                .and_then(|v| v.as_str())
                .map(|s| s.split_whitespace().map(ToString::to_string).collect())
                .unwrap_or_else(|| stored.scopes.clone());
            let earliest_refresh_at_secs = body.get("earliest_refresh_at").and_then(|v| v.as_u64());
            let received_at = now_secs();

            if let Some(id_tok) = body.get("id_token").and_then(|v| v.as_str()) {
                if id_tok.is_empty() {
                    let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                    *self.memory_email.lock().unwrap() = None;
                    return Err(MobileError::with_detail(
                        MobileErrorCode::SignedOut,
                        "mobile.chatgpt.invalidIdToken",
                        "invalid_id_token",
                    ));
                }
                // Persist rotated tokens as encrypted pendingRefresh checkpoint BEFORE JWKS lookup!
                stored.pending_refresh = Some(PendingRefreshCheckpoint {
                    access_token: new_access,
                    refresh_token: new_refresh,
                    expires_at_secs: received_at.saturating_add(expires_in),
                    earliest_refresh_at_secs,
                    scopes,
                    id_token: id_tok.to_string(),
                    received_at_secs: received_at,
                });
                self.vault.write_sealed(VAULT_SLOT_CHATGPT, &stored)?;
            } else {
                stored.access_token = new_access.clone();
                stored.refresh_token = new_refresh;
                stored.expires_at_secs = received_at.saturating_add(expires_in);
                stored.earliest_refresh_at_secs = earliest_refresh_at_secs;
                stored.scopes = scopes;
                self.vault.write_sealed(VAULT_SLOT_CHATGPT, &stored)?;
                return Ok(new_access);
            }
        }

        // Step 2: Complete JWKS verification for pending_refresh checkpoint.
        if let Some(pending) = stored.pending_refresh.clone() {
            let jwks = self.fetch_jwks(&disc.jwks_uri).await?;
            let verified = match verify_rs256_id_token(
                &pending.id_token,
                &jwks,
                &disc.issuer,
                &stored.client_id,
                None,
                pending.received_at_secs,
            ) {
                Ok(id) => id,
                Err(err) => {
                    if err.detail.as_deref() == Some("identity_verification_unavailable") {
                        // Preserve encrypted checkpoint on JWKS outage!
                        return Err(err);
                    }
                    let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                    *self.memory_email.lock().unwrap() = None;
                    return Err(MobileError::with_detail(
                        MobileErrorCode::SignedOut,
                        "mobile.chatgpt.invalidIdToken",
                        "invalid_id_token",
                    ));
                }
            };
            if verified.subject != stored.subject {
                let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
                *self.memory_email.lock().unwrap() = None;
                return Err(MobileError::with_detail(
                    MobileErrorCode::SignedOut,
                    "mobile.chatgpt.accountMismatch",
                    "account_mismatch",
                ));
            }
            stored.access_token = pending.access_token.clone();
            stored.refresh_token = pending.refresh_token;
            stored.expires_at_secs = pending.expires_at_secs;
            stored.earliest_refresh_at_secs = pending.earliest_refresh_at_secs;
            stored.scopes = pending.scopes;
            stored.pending_refresh = None;
            self.vault.write_sealed(VAULT_SLOT_CHATGPT, &stored)?;
            *self.memory_email.lock().unwrap() = verified.email;
            return Ok(pending.access_token);
        }

        Ok(stored.access_token)
    }

    /// Lists models from ChatGPT direct `/v1/models` (`{ models: [{ slug, display_name, visibility }] }`).
    pub async fn list_models(&self) -> MobileResult<Vec<ChatGptModelInfo>> {
        let token = self.ensure_valid_access_token().await?;
        let url = format!("{}/models", self.api_base.trim_end_matches('/'));
        let _ = enforce_https_url(&url, self.allow_test_loopback)?;
        let client = build_safe_http_client(30)?;
        let resp = client
            .get(&url)
            .bearer_auth(&token)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|_| MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.modelsNetwork"))?;
        let status = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.map_err(|_| {
            MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.invalidModelCatalog")
        })?;
        if !(200..300).contains(&status) {
            return Err(Self::map_api_error(status, &body));
        }
        let arr = body
            .get("models")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.invalidModelCatalog")
            })?;
        let mut out = Vec::new();
        for entry in arr {
            if entry.get("visibility").and_then(|v| v.as_str()) != Some("list") {
                continue;
            }
            if let (Some(slug), Some(display_name)) = (
                entry.get("slug").and_then(|v| v.as_str()),
                entry.get("display_name").and_then(|v| v.as_str()),
            ) && !slug.trim().is_empty()
                && !display_name.trim().is_empty()
            {
                out.push(ChatGptModelInfo {
                    slug: slug.to_string(),
                    display_name: display_name.to_string(),
                });
            }
        }
        Ok(out)
    }

    /// Runs token refresh inside an uncancelled spawned task so dropping/cancelling the caller
    /// cannot abort persistence of rotated refresh tokens into `pendingRefresh`.
    pub async fn ensure_valid_access_token_shielded(self: &Arc<Self>) -> MobileResult<String> {
        let this = Arc::clone(self);
        tokio::spawn(async move { this.ensure_valid_access_token().await })
            .await
            .map_err(|e| {
                MobileError::with_detail(
                    MobileErrorCode::InternalError,
                    "mobile.chatgpt.refreshTaskFailed",
                    e.to_string(),
                )
            })?
    }

    /// Streams `POST /v1/responses` on the direct ChatGPT plan route (acquires token then streams).
    pub async fn stream_responses<F>(
        &self,
        model: &str,
        instructions: Option<&str>,
        input: &[ResponsesInputMessage],
        on_delta: F,
    ) -> MobileResult<String>
    where
        F: FnMut(&str),
    {
        let token = self.ensure_valid_access_token().await?;
        self.stream_responses_with_token(&token, model, instructions, input, on_delta)
            .await
    }

    /// Streams `POST /v1/responses` using a pre-validated access token so token refresh
    /// can be shielded from stream cancellation.
    pub async fn stream_responses_with_token<F>(
        &self,
        token: &str,
        model: &str,
        instructions: Option<&str>,
        input: &[ResponsesInputMessage],
        mut on_delta: F,
    ) -> MobileResult<String>
    where
        F: FnMut(&str),
    {
        if model.trim().is_empty() || input.is_empty() {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.chatgpt.invalidRequest",
                "model and message input array are required",
            ));
        }
        for msg in input {
            if !matches!(msg.role.as_str(), "user" | "assistant" | "developer") {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.chatgpt.invalidRole",
                    "input message roles must be user, assistant, or developer",
                ));
            }
        }

        let url = format!("{}/responses", self.api_base.trim_end_matches('/'));
        let _ = enforce_https_url(&url, self.allow_test_loopback)?;

        let mut payload = serde_json::json!({
            "model": model,
            "input": input,
            "store": false,
            "stream": true,
        });
        if let Some(inst) = instructions
            && !inst.is_empty()
        {
            payload["instructions"] = serde_json::Value::String(inst.to_string());
        }

        let client = build_safe_http_client(STREAM_TIMEOUT_SECS)?;
        let resp = client
            .post(&url)
            .bearer_auth(&token)
            .header("accept", "text/event-stream")
            .header("content-type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|_| MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.networkError"))?;

        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
            let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            // Notice: API 401 or subscription_sharing_invalid_user NEVER wipes stored credentials!
            return Err(Self::map_api_error(status, &body));
        }

        // Direct route may return valid SSE without a Content-Type header; reject only if a different type is sent.
        if let Some(ct) = resp.headers().get("content-type").and_then(|v| v.to_str().ok()) {
            let base = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
            if !base.is_empty() && base != "text/event-stream" {
                return Err(MobileError::with_detail(
                    MobileErrorCode::NetworkError,
                    "mobile.chatgpt.invalidStream",
                    "invalid_stream",
                ));
            }
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut full_text = String::new();
        let mut completed = false;

        let read_fut = async {
            while let Some(chunk_res) = stream.next().await {
                let chunk = chunk_res.map_err(|_| {
                    MobileError::with_detail(
                        MobileErrorCode::NetworkError,
                        "mobile.chatgpt.streamInterrupted",
                        "stream_interrupted",
                    )
                })?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim_end_matches('\r').to_string();
                    buffer.drain(..=pos);
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }
                    let event: serde_json::Value = serde_json::from_str(data).map_err(|_| {
                        MobileError::with_detail(
                            MobileErrorCode::NetworkError,
                            "mobile.chatgpt.invalidStream",
                            "invalid_stream",
                        )
                    })?;
                    match event.get("type").and_then(|v| v.as_str()) {
                        Some("response.output_text.delta") => {
                            if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                                full_text.push_str(delta);
                                if full_text.len() > MAX_STREAM_OUTPUT_BYTES {
                                    return Err(MobileError::with_detail(
                                        MobileErrorCode::FileTooLarge,
                                        "mobile.chatgpt.responseTooLarge",
                                        "response_too_large",
                                    ));
                                }
                                on_delta(delta);
                            }
                        }
                        Some("response.failed") => {
                            let detail = event.get("response").unwrap_or(&event);
                            return Err(Self::map_api_error(status, detail));
                        }
                        Some("error") => {
                            return Err(Self::map_api_error(status, &event));
                        }
                        Some("response.incomplete") => {
                            return Err(MobileError::with_detail(
                                MobileErrorCode::NetworkError,
                                "mobile.chatgpt.responseIncomplete",
                                "response_incomplete",
                            ));
                        }
                        Some("response.completed") => {
                            completed = true;
                            return Ok(());
                        }
                        _ => {}
                    }
                }
            }
            Ok(())
        };

        tokio::time::timeout(Duration::from_secs(STREAM_TIMEOUT_SECS), read_fut)
            .await
            .map_err(|_| MobileError::new(MobileErrorCode::AuthTimeout, "mobile.chatgpt.streamTimeout"))??;

        if !completed {
            return Err(MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.chatgpt.streamInterrupted",
                "stream_interrupted",
            ));
        }
        Ok(full_text)
    }

    fn map_api_error(status: u16, body: &serde_json::Value) -> MobileError {
        let code = extract_safe_error_code(body).unwrap_or_else(|| format!("http_{status}"));
        if code == "subscription_sharing_usage_limit_exceeded" || status == 429 {
            return MobileError::with_detail(
                MobileErrorCode::RateLimited,
                "mobile.chatgpt.usageLimit",
                code,
            );
        }
        if matches!(
            code.as_str(),
            "subscription_sharing_user_not_eligible" | "subscription_sharing_v2_user_not_eligible"
        ) {
            return MobileError::with_detail(
                MobileErrorCode::AuthNoPlan,
                "mobile.chatgpt.notEligible",
                code,
            );
        }
        if status == 401
            || matches!(
                code.as_str(),
                "subscription_sharing_invalid_user" | "subscription_sharing_v2_invalid_user"
            )
        {
            return MobileError::with_detail(
                MobileErrorCode::AuthDenied,
                "mobile.chatgpt.reconnectPrompt",
                code,
            );
        }
        if status == 400 || status == 422 {
            // Never echo raw server validation messages that could contain user document text.
            return MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.chatgpt.invalidRequest",
                code,
            );
        }
        MobileError::with_detail(MobileErrorCode::NetworkError, "mobile.chatgpt.apiError", code)
    }

    /// Revokes ONLY the refresh_token (max 1 retry on 5xx/network) and always clears local credentials.
    pub async fn sign_out(&self) -> MobileResult<()> {
        let stored: Option<StoredChatGptSession> = self.vault.read_sealed(VAULT_SLOT_CHATGPT)?;
        let _ = self.vault.delete_sealed(VAULT_SLOT_CHATGPT);
        *self.memory_email.lock().unwrap() = None;
        *self.pending_pkce.lock().unwrap() = None;
        *self.last_failure.lock().unwrap() = None;

        let Some(sess) = stored else {
            return Ok(());
        };
        let token = sess
            .pending_refresh
            .as_ref()
            .map(|p| p.refresh_token.as_str())
            .unwrap_or(sess.refresh_token.as_str());
        if let Ok(disc) = self.discover().await
            && let Some(revoke_ep) = disc.revocation_endpoint
            && let Ok(client) = build_safe_http_client(10)
        {
            for attempt in 0..2 {
                let res = client
                    .post(&revoke_ep)
                    .form(&[
                        ("token", token),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", sess.client_id.as_str()),
                    ])
                    .send()
                    .await;
                match res {
                    Ok(r) if r.status().as_u16() == 200 => break,
                    Ok(r) if r.status().as_u16() >= 500 && attempt == 0 => {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    Err(_) if attempt == 0 => {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    _ => break,
                }
            }
        }
        Ok(())
    }
}

/// Development-only Android loopback listener (`127.0.0.1/auth/callback`) strictly excluded from release builds.
#[cfg(feature = "dev-chatgpt-loopback")]
pub mod dev_loopback {
    use sha2::{Digest, Sha256};
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

    pub const LOOPBACK_CALLBACK_PATH: &str = "/auth/callback";

    pub fn loopback_complete_html() -> (String, String) {
        let script = r#"history.replaceState(null, "", "/auth/complete");"#;
        let hash = B64.encode(Sha256::digest(script.as_bytes()));
        let csp = format!(
            "default-src 'none'; script-src 'sha256-{hash}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
        );
        let html = format!(
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Return to PosidOffice</title><h1>Return to PosidOffice</h1><p>You can close this tab.</p><script>{script}</script></html>"
        );
        (csp, html)
    }
}
