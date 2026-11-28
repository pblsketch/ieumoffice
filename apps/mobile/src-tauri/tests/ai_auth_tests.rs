use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ieumoffice_mobile_lib::ai::{
    ChatGptService, MobileAiSettingsPatch, MobileAiSettingsStore, ModelPatch, ProviderKeyPatch,
    ResponsesInputMessage, enforce_https_url, is_chatgpt_visible,
    requires_reauthentication_on_refresh, verify_rs256_id_token,
};
use ieumoffice_mobile_lib::error::MobileErrorCode;
use ieumoffice_mobile_lib::secrets::SealedVault;
use rsa::RsaPrivateKey;
use rsa::pkcs1v15::SigningKey;
use rsa::signature::{RandomizedSigner, SignatureEncoding};
use rsa::traits::PublicKeyParts;
use sha2::Sha256;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri_plugin_ieum_mobile::auth::HostAuthBridge;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn sign_jwt(priv_key: &RsaPrivateKey, kid: &str, payload: &serde_json::Value) -> String {
    let header = serde_json::json!({ "alg": "RS256", "typ": "JWT", "kid": kid });
    let h_b64 = URL_SAFE_NO_PAD.encode(header.to_string().as_bytes());
    let p_b64 = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
    let signing_input = format!("{h_b64}.{p_b64}");
    let signing_key = SigningKey::<Sha256>::new(priv_key.clone());
    let mut rng = rand::thread_rng();
    let sig = signing_key.sign_with_rng(&mut rng, signing_input.as_bytes());
    let s_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
    format!("{signing_input}.{s_b64}")
}

fn jwks_for_key(priv_key: &RsaPrivateKey, kid: &str) -> serde_json::Value {
    let pub_key = priv_key.to_public_key();
    let n = URL_SAFE_NO_PAD.encode(pub_key.n().to_bytes_be());
    let e = URL_SAFE_NO_PAD.encode(pub_key.e().to_bytes_be());
    serde_json::json!({
        "keys": [{ "kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig", "n": n, "e": e }]
    })
}

async fn spawn_http_mock<F>(handler: F) -> String
where
    F: Fn(String, String) -> (u16, Vec<(String, String)>, String) + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handler = Arc::new(handler);
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            let h = handler.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 16384];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    return;
                }
                let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                let mut lines = raw.lines();
                let req_line = lines.next().unwrap_or("");
                let path = req_line.split_whitespace().nth(1).unwrap_or("/").to_string();
                let body = raw
                    .split_once("\r\n\r\n")
                    .map(|(_, b)| b.to_string())
                    .unwrap_or_default();
                let (status, headers, resp_body) = h(path, body);
                let mut head = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n",
                    resp_body.len()
                );
                for (k, v) in headers {
                    head.push_str(&format!("{k}: {v}\r\n"));
                }
                head.push_str("\r\n");
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.write_all(resp_body.as_bytes()).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    format!("http://{addr}")
}

#[test]
fn release_build_excludes_loopback_and_hides_chatgpt_when_client_id_unset() {
    // Default build must not enable dev-chatgpt-loopback feature
    assert!(!cfg!(feature = "dev-chatgpt-loopback"));
    assert!(!is_chatgpt_visible(None));
    assert!(!is_chatgpt_visible(Some("   ")));
    assert!(is_chatgpt_visible(Some("app_official_client_id")));

    let tmp = tempfile::tempdir().unwrap();
    let auth = Arc::new(HostAuthBridge::default());
    let vault = Arc::new(SealedVault::new(tmp.path().to_path_buf(), auth.clone()));
    let chatgpt = ChatGptService::new(vault, auth);
    let status = chatgpt.status().unwrap();
    assert_eq!(status.state, "hidden");
}

#[test]
fn sealed_vault_hides_keys_and_enforces_openrouter_free_only_vs_byok() {
    let tmp = tempfile::tempdir().unwrap();
    let auth = Arc::new(HostAuthBridge::default());
    let vault = Arc::new(SealedVault::new(tmp.path().to_path_buf(), auth));
    let store = MobileAiSettingsStore::new(tmp.path().to_path_buf(), vault);

    let secret_key = "sk-or-v1-super-secret-value-12345";
    let snap = store
        .set_settings(
            MobileAiSettingsPatch {
                selected_provider: Some("openrouter".into()),
                provider_key_patch: Some(ProviderKeyPatch {
                    provider: "openrouter".into(),
                    api_key: Some(secret_key.into()),
                    free_only: Some(true),
                }),
                subscription_notice_version: Some(2),
                ..Default::default()
            },
            false,
        )
        .unwrap();

    // Raw key must NEVER appear in snapshot JSON or plaintext disk files
    let snap_json = serde_json::to_string(&snap).unwrap();
    assert!(!snap_json.contains(secret_key));
    assert_eq!(snap.subscription_notice_version, 2);
    assert!(snap.configured_providers["openrouter"].has_key);
    assert_eq!(snap.configured_providers["openrouter"].free_only, Some(true));
    let meta_disk = std::fs::read_to_string(tmp.path().join("ai-settings.json")).unwrap();
    assert!(!meta_disk.contains(secret_key));
    let sealed_disk = std::fs::read(tmp.path().join("secrets/provider-api-keys.sealed")).unwrap();
    assert!(!String::from_utf8_lossy(&sealed_disk).contains(secret_key));

    // freeOnly: true rejects paid OpenRouter model
    let err = store
        .set_settings(
            MobileAiSettingsPatch {
                model_patch: Some(ModelPatch {
                    provider: "openrouter".into(),
                    model: "openai/gpt-5".into(),
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.code, MobileErrorCode::InvalidArgument);

    // freeOnly: true accepts :free model
    let ok_snap = store
        .set_settings(
            MobileAiSettingsPatch {
                model_patch: Some(ModelPatch {
                    provider: "openrouter".into(),
                    model: "google/gemma-3-27b-it:free".into(),
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap();
    assert_eq!(
        ok_snap.model_by_provider["openrouter"],
        "google/gemma-3-27b-it:free"
    );

    // Switch to BYOK (freeOnly: false) -> paid model now accepted
    let byok = store
        .set_settings(
            MobileAiSettingsPatch {
                provider_key_patch: Some(ProviderKeyPatch {
                    provider: "openrouter".into(),
                    api_key: Some(secret_key.into()),
                    free_only: Some(false),
                }),
                model_patch: Some(ModelPatch {
                    provider: "openrouter".into(),
                    model: "anthropic/claude-sonnet-5".into(),
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap();
    assert_eq!(byok.model_by_provider["openrouter"], "anthropic/claude-sonnet-5");

    // custom / http endpoints rejected
    let custom_err = store
        .set_settings(
            MobileAiSettingsPatch {
                selected_provider: Some("custom".into()),
                ..Default::default()
            },
            false,
        )
        .unwrap_err();
    assert_eq!(custom_err.code, MobileErrorCode::InvalidArgument);
    assert_eq!(
        enforce_https_url("http://192.168.1.50:11434/v1", false)
            .unwrap_err()
            .code,
        MobileErrorCode::InvalidArgument
    );
}

#[tokio::test]
async fn chatgpt_oauth_pkce_jwks_checkpoint_models_sse_and_401_boundary() {
    let mut rng = rand::thread_rng();
    let priv_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
    let jwks = jwks_for_key(&priv_key, "k1");

    let jwks_outage = Arc::new(AtomicBool::new(false));
    let api_return_401 = Arc::new(AtomicBool::new(false));
    let refresh_fail_invalid_grant = Arc::new(AtomicBool::new(false));
    let refresh_calls = Arc::new(AtomicUsize::new(0));
    let revoke_calls = Arc::new(AtomicUsize::new(0));
    let seen_nonce = Arc::new(std::sync::Mutex::new(String::new()));

    let base_holder = Arc::new(std::sync::Mutex::new(String::new()));

    let jwks_clone = jwks.clone();
    let priv_clone = priv_key.clone();
    let outage_c = jwks_outage.clone();
    let api401_c = api_return_401.clone();
    let refresh_fail_c = refresh_fail_invalid_grant.clone();
    let refresh_calls_c = refresh_calls.clone();
    let revoke_calls_c = revoke_calls.clone();
    let nonce_c = seen_nonce.clone();
    let base_c = base_holder.clone();

    let server_base = spawn_http_mock(move |path, body| {
        let issuer = base_c.lock().unwrap().clone();
        if path == "/.well-known/openid-configuration" {
            let doc = serde_json::json!({
                "issuer": issuer,
                "authorization_endpoint": format!("{issuer}/authorize"),
                "token_endpoint": format!("{issuer}/oauth/token"),
                "jwks_uri": format!("{issuer}/jwks.json"),
                "revocation_endpoint": format!("{issuer}/oauth/revoke"),
            });
            return (200, vec![("Content-Type".into(), "application/json".into())], doc.to_string());
        }
        if path == "/jwks.json" {
            if outage_c.load(Ordering::SeqCst) {
                return (503, vec![], "jwks down".into());
            }
            return (
                200,
                vec![("Content-Type".into(), "application/json".into())],
                jwks_clone.to_string(),
            );
        }
        if path == "/oauth/token" {
            let is_refresh = body.contains("grant_type=refresh_token");
            if is_refresh {
                refresh_calls_c.fetch_add(1, Ordering::SeqCst);
                if refresh_fail_c.load(Ordering::SeqCst) {
                    return (
                        400,
                        vec![("Content-Type".into(), "application/json".into())],
                        r#"{"error":"invalid_grant"}"#.into(),
                    );
                }
            }
            let now = now_secs();
            let nonce_val = nonce_c.lock().unwrap().clone();
            let id_payload = serde_json::json!({
                "iss": issuer,
                "sub": "user-sub-001",
                "aud": "client_test_mobile",
                "iat": now,
                "exp": now + 3600,
                "nonce": nonce_val,
                "email": "tester@example.com",
            });
            let id_token = sign_jwt(&priv_clone, "k1", &id_payload);
            // First token expires immediately (10s <= 60s window) so refresh triggers on next request
            let expires_in = if is_refresh { 3600 } else { 10 };
            let resp = serde_json::json!({
                "token_type": "Bearer",
                "access_token": if is_refresh { "at-refreshed-2" } else { "at-initial-1" },
                "refresh_token": if is_refresh { "rt-rotated-2" } else { "rt-initial-1" },
                "expires_in": expires_in,
                "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
                "id_token": id_token,
            });
            return (200, vec![("Content-Type".into(), "application/json".into())], resp.to_string());
        }
        if path == "/oauth/revoke" {
            assert!(body.contains("token_type_hint=refresh_token"));
            revoke_calls_c.fetch_add(1, Ordering::SeqCst);
            return (200, vec![], String::new());
        }
        if path == "/v1/models" {
            if api401_c.load(Ordering::SeqCst) {
                return (
                    401,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"error":{"code":"subscription_sharing_invalid_user","message":"secret echoed text"}}"#.into(),
                );
            }
            let body = serde_json::json!({
                "models": [
                    { "slug": "gpt-6.1-terra", "display_name": "GPT-6.1 Terra", "visibility": "list" },
                    { "slug": "internal-hidden", "display_name": "Hidden", "visibility": "hide" }
                ]
            });
            return (200, vec![("Content-Type".into(), "application/json".into())], body.to_string());
        }
        if path == "/v1/responses" {
            // Direct route returning valid SSE WITHOUT a Content-Type header!
            let sse = concat!(
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello \"}\n\n",
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"mobile!\"}\n\n",
                "data: {\"type\":\"response.completed\"}\n\n"
            );
            return (200, vec![], sse.to_string());
        }
        (404, vec![], "not found".into())
    })
    .await;
    *base_holder.lock().unwrap() = server_base.clone();

    let tmp = tempfile::tempdir().unwrap();
    let auth = Arc::new(HostAuthBridge::default());
    let vault = Arc::new(SealedVault::new(tmp.path().to_path_buf(), auth.clone()));
    let svc = Arc::new(ChatGptService::new_for_test(
        vault,
        auth.clone(),
        server_base.clone(),
        format!("{server_base}/v1"),
        Some("client_test_mobile".into()),
    ));

    // Start sign-in -> extract state and nonce from launched URL
    let auth_url = svc.start_sign_in(false).await.unwrap();
    let parsed = url::Url::parse(&auth_url).unwrap();
    let state = parsed
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    let nonce = parsed
        .query_pairs()
        .find(|(k, _)| k == "nonce")
        .unwrap()
        .1
        .into_owned();
    *seen_nonce.lock().unwrap() = nonce.clone();

    let status = svc
        .complete_callback(&format!(
            "https://ieumoffice.com/mobile/auth/callback?code=abc123&state={state}"
        ))
        .await
        .unwrap();
    assert_eq!(status.state, "ready");
    assert_eq!(status.account.as_deref(), Some("tester@example.com"));

    // Email is NOT written in plaintext anywhere on disk
    let sealed_conn = std::fs::read(tmp.path().join("secrets/chatgpt-connection.sealed")).unwrap();
    assert!(!String::from_utf8_lossy(&sealed_conn).contains("tester@example.com"));

    // Simulate JWKS outage during token refresh -> pendingRefresh checkpoint preserved, session NOT wiped!
    jwks_outage.store(true, Ordering::SeqCst);
    let outage_err = svc.ensure_valid_access_token().await.unwrap_err();
    assert_eq!(outage_err.code, MobileErrorCode::NetworkError);
    assert_eq!(
        outage_err.detail.as_deref(),
        Some("identity_verification_unavailable")
    );
    assert_eq!(svc.status().unwrap().state, "ready");
    assert_eq!(refresh_calls.load(Ordering::SeqCst), 1);

    // JWKS recovers -> resumes verification from encrypted checkpoint WITHOUT calling /oauth/token again!
    jwks_outage.store(false, Ordering::SeqCst);
    let (r1, r2) = tokio::join!(
        svc.ensure_valid_access_token(),
        svc.ensure_valid_access_token()
    );
    assert_eq!(r1.unwrap(), "at-refreshed-2");
    assert_eq!(r2.unwrap(), "at-refreshed-2");
    assert_eq!(refresh_calls.load(Ordering::SeqCst), 1);

    // /v1/models parses models[] where visibility == "list"
    let models = svc.list_models().await.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].slug, "gpt-6.1-terra");

    // /v1/responses streams SSE even without Content-Type header and verifies response.completed
    let mut chunks = Vec::new();
    let full = svc
        .stream_responses(
            "gpt-6.1-terra",
            Some("Be helpful"),
            &[ResponsesInputMessage {
                role: "user".into(),
                content: "Hi".into(),
            }],
            |delta| chunks.push(delta.to_string()),
        )
        .await
        .unwrap();
    assert_eq!(full, "Hello mobile!");
    assert_eq!(chunks, vec!["Hello ", "mobile!"]);

    // API HTTP 401 / subscription_sharing_invalid_user does NOT wipe stored OAuth session!
    api_return_401.store(true, Ordering::SeqCst);
    let err401 = svc.list_models().await.unwrap_err();
    assert_eq!(err401.code, MobileErrorCode::AuthDenied);
    assert_eq!(svc.status().unwrap().state, "ready");
    assert!(!err401.detail.unwrap_or_default().contains("secret echoed text"));

    // Verify helper for refresh-token reauth codes
    assert!(requires_reauthentication_on_refresh("invalid_grant"));
    assert!(requires_reauthentication_on_refresh("refresh_token_reused"));
    assert!(!requires_reauthentication_on_refresh("subscription_sharing_invalid_user"));

    // Invalid ID token signature rejected
    let bad_tok = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ4In0.AAAA";
    assert_eq!(
        verify_rs256_id_token(bad_tok, &jwks, &server_base, "client_test_mobile", None, now_secs())
            .unwrap_err()
            .code,
        MobileErrorCode::AuthDenied
    );

    // Sign out revokes refresh_token and removes local credentials
    svc.sign_out().await.unwrap();
    assert_eq!(revoke_calls.load(Ordering::SeqCst), 1);
    assert_eq!(svc.status().unwrap().state, "signed-out");
}
