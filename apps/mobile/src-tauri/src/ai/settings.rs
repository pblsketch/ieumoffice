use crate::ai::http::{build_safe_http_client, enforce_https_url, extract_safe_error_code};
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::secrets::SealedVault;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

const VAULT_SLOT_API_KEYS: &str = "provider-api-keys";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredProviderSummary {
    pub has_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_only: Option<bool>,
    pub models: Vec<String>,
}

/// Safe settings snapshot returned to WebView — NEVER contains raw API keys or tokens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiSettingsSnapshot {
    pub selected_provider: String,
    pub model_by_provider: BTreeMap<String, String>,
    pub configured_providers: BTreeMap<String, ConfiguredProviderSummary>,
    pub chatgpt_visible: bool,
    pub subscription_notice_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPatch {
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyPatch {
    pub provider: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub free_only: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiSettingsPatch {
    #[serde(default)]
    pub selected_provider: Option<String>,
    #[serde(default)]
    pub model_patch: Option<ModelPatch>,
    #[serde(default)]
    pub provider_key_patch: Option<ProviderKeyPatch>,
    #[serde(default)]
    pub subscription_notice_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateKeyResult {
    pub ok: bool,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredProviderMeta {
    #[serde(default)]
    free_only: Option<bool>,
    #[serde(default)]
    models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredCustomEndpoint {
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAiMeta {
    selected_provider: String,
    model_by_provider: BTreeMap<String, String>,
    providers: BTreeMap<String, StoredProviderMeta>,
    subscription_notice_version: u32,
    #[serde(default)]
    custom_endpoint: Option<StoredCustomEndpoint>,
}

impl Default for StoredAiMeta {
    fn default() -> Self {
        Self {
            selected_provider: "auto".to_string(),
            model_by_provider: BTreeMap::new(),
            providers: BTreeMap::new(),
            subscription_notice_version: 0,
            custom_endpoint: None,
        }
    }
}

/// Self-hosted server settings returned to the webview — never the key itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiCustomEndpoint {
    pub base_url: Option<String>,
    pub has_key: bool,
    pub model: Option<String>,
    pub models: Vec<String>,
}

/// Saves the self-hosted server. `api_key`: `None` keeps the stored key (dropped when
/// the host or port changes), empty removes it. `model`: `None` keeps, empty removes.
/// `models`: the list read from the server through the relay, `None` keeps it
/// (cleared when the host or port changes).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiCustomEndpointPatch {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub models: Option<Vec<String>>,
}

const CUSTOM_PROVIDER: &str = "custom";
const CUSTOM_BASE_URL_MAX: usize = 2048;

/// Validates a self-hosted server base URL: https only, a host, no embedded
/// credentials, no relay placeholder, at most 2048 characters. Any host is allowed
/// (a home server is fine when it speaks https). Returns the URL without a fragment.
pub fn validate_custom_base_url(raw: &str) -> MobileResult<String> {
    let invalid = || {
        MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.ai.customInvalidUrl",
            "base URL must be a valid https URL",
        )
    };
    let candidate = raw.trim();
    if candidate.is_empty() || candidate.len() > CUSTOM_BASE_URL_MAX {
        return Err(invalid());
    }
    let mut url = url::Url::parse(candidate).map_err(|_| invalid())?;
    if url.scheme() != "https" {
        return Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.ai.customHttpsOnly",
            "the self-hosted server must use https",
        ));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(invalid());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.ai.customCredentials",
            "put the key in the key field, not in the URL",
        ));
    }
    if url.as_str().contains("__sealed__") {
        return Err(invalid());
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

fn custom_origin_of(base_url: &str) -> Option<(String, u16)> {
    let url = url::Url::parse(base_url).ok()?;
    Some((
        url.host_str()?.to_ascii_lowercase(),
        url.port_or_known_default()?,
    ))
}

fn custom_not_configured() -> MobileError {
    MobileError::with_detail(
        MobileErrorCode::InvalidArgument,
        "mobile.ai.customNotConfigured",
        "save the self-hosted server base URL first",
    )
}

fn custom_endpoint_view(
    meta: &StoredAiMeta,
    keys: &BTreeMap<String, String>,
) -> MobileAiCustomEndpoint {
    MobileAiCustomEndpoint {
        base_url: meta.custom_endpoint.as_ref().map(|c| c.base_url.clone()),
        has_key: keys
            .get(CUSTOM_PROVIDER)
            .is_some_and(|k| !k.trim().is_empty()),
        model: meta.model_by_provider.get(CUSTOM_PROVIDER).cloned(),
        models: meta
            .providers
            .get(CUSTOM_PROVIDER)
            .map(|p| p.models.clone())
            .unwrap_or_default(),
    }
}

pub fn is_supported_mobile_cloud_provider(provider: &str) -> bool {
    matches!(
        provider,
        "openai"
            | "anthropic"
            | "gemini"
            | "openrouter"
            | "deepseek"
            | "xai"
            | "mistral"
            | "kimi"
            | "glm"
            | "qwen"
            | "upstage"
            | "exaone"
    )
}

pub fn provider_models_url(provider: &str) -> MobileResult<&'static str> {
    match provider {
        "openai" => Ok("https://api.openai.com/v1/models"),
        "anthropic" => Ok("https://api.anthropic.com/v1/models"),
        "gemini" => Ok("https://generativelanguage.googleapis.com/v1beta/models"),
        "openrouter" => Ok("https://openrouter.ai/api/v1/models"),
        "deepseek" => Ok("https://api.deepseek.com/v1/models"),
        "xai" => Ok("https://api.x.ai/v1/models"),
        "mistral" => Ok("https://api.mistral.ai/v1/models"),
        _ => Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.ai.unsupportedProvider",
            "provider is not supported on mobile",
        )),
    }
}

pub struct MobileAiSettingsStore {
    meta_path: PathBuf,
    vault: Arc<SealedVault>,
}

impl MobileAiSettingsStore {
    pub fn new(app_data_dir: PathBuf, vault: Arc<SealedVault>) -> Self {
        Self {
            meta_path: app_data_dir.join("ai-settings.json"),
            vault,
        }
    }

    fn load_meta(&self) -> MobileResult<StoredAiMeta> {
        if !self.meta_path.exists() {
            return Ok(StoredAiMeta::default());
        }
        let text = fs::read_to_string(&self.meta_path).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.ai.metaRead", e.to_string())
        })?;
        serde_json::from_str(&text).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.ai.metaParse", e.to_string())
        })
    }

    fn save_meta(&self, meta: &StoredAiMeta) -> MobileResult<()> {
        if let Some(parent) = self.meta_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                MobileError::with_detail(MobileErrorCode::InternalError, "mobile.ai.metaDir", e.to_string())
            })?;
        }
        let tmp = self.meta_path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(meta).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.ai.metaEncode", e.to_string())
        })?;
        fs::write(&tmp, json).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.ai.metaWrite", e.to_string())
        })?;
        fs::rename(&tmp, &self.meta_path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.ai.metaRename", e.to_string())
        })?;
        Ok(())
    }

    fn load_keys(&self) -> MobileResult<BTreeMap<String, String>> {
        Ok(self.vault.read_sealed(VAULT_SLOT_API_KEYS)?.unwrap_or_default())
    }

    fn save_keys(&self, keys: &BTreeMap<String, String>) -> MobileResult<()> {
        self.vault.write_sealed(VAULT_SLOT_API_KEYS, keys)
    }

    pub fn get_api_key(&self, provider: &str) -> MobileResult<Option<String>> {
        let keys = self.load_keys()?;
        Ok(keys.get(provider).cloned())
    }

    pub fn is_openrouter_free_only(&self) -> MobileResult<bool> {
        let meta = self.load_meta()?;
        Ok(meta
            .providers
            .get("openrouter")
            .and_then(|p| p.free_only)
            .unwrap_or(false))
    }

    pub fn get_snapshot(&self, chatgpt_visible: bool) -> MobileResult<MobileAiSettingsSnapshot> {
        let meta = self.load_meta()?;
        let keys = self.load_keys()?;
        let mut configured = BTreeMap::new();
        for (provider, pmeta) in &meta.providers {
            // The self-hosted server is configured by its base URL alone (added below).
            if provider == CUSTOM_PROVIDER {
                continue;
            }
            let has_key = keys
                .get(provider)
                .map(|k| !k.trim().is_empty())
                .unwrap_or(false);
            if has_key || !pmeta.models.is_empty() || pmeta.free_only.is_some() {
                configured.insert(
                    provider.clone(),
                    ConfiguredProviderSummary {
                        has_key,
                        free_only: pmeta.free_only,
                        models: pmeta.models.clone(),
                    },
                );
            }
        }
        for (provider, key) in &keys {
            if provider != CUSTOM_PROVIDER
                && !key.trim().is_empty()
                && !configured.contains_key(provider)
            {
                configured.insert(
                    provider.clone(),
                    ConfiguredProviderSummary {
                        has_key: true,
                        free_only: None,
                        models: Vec::new(),
                    },
                );
            }
        }
        if meta.custom_endpoint.is_some() {
            configured.insert(
                CUSTOM_PROVIDER.to_string(),
                ConfiguredProviderSummary {
                    has_key: keys
                        .get(CUSTOM_PROVIDER)
                        .is_some_and(|k| !k.trim().is_empty()),
                    free_only: None,
                    models: meta
                        .providers
                        .get(CUSTOM_PROVIDER)
                        .map(|p| p.models.clone())
                        .unwrap_or_default(),
                },
            );
        }
        Ok(MobileAiSettingsSnapshot {
            selected_provider: meta.selected_provider,
            model_by_provider: meta.model_by_provider,
            configured_providers: configured,
            chatgpt_visible,
            subscription_notice_version: meta.subscription_notice_version,
        })
    }

    pub fn set_settings(
        &self,
        patch: MobileAiSettingsPatch,
        chatgpt_visible: bool,
    ) -> MobileResult<MobileAiSettingsSnapshot> {
        let mut meta = self.load_meta()?;
        let mut keys = self.load_keys()?;
        let mut keys_dirty = false;

        if let Some(selected) = patch.selected_provider {
            if selected == "claude-code" || selected == "codex" {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.unsupportedProvider",
                    "provider is not available on mobile",
                ));
            }
            if selected == CUSTOM_PROVIDER && meta.custom_endpoint.is_none() {
                return Err(custom_not_configured());
            }
            if selected != "auto"
                && selected != "chatgpt"
                && selected != CUSTOM_PROVIDER
                && !is_supported_mobile_cloud_provider(&selected)
            {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.unsupportedProvider",
                    "unknown mobile AI provider",
                ));
            }
            meta.selected_provider = selected;
        }

        if let Some(key_patch) = patch.provider_key_patch {
            if key_patch.provider == CUSTOM_PROVIDER {
                // One place owns the custom key so the "new host drops the old key" rule holds.
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.useCustomEndpoint",
                    "set the self-hosted server key with the custom endpoint command",
                ));
            }
            if !is_supported_mobile_cloud_provider(&key_patch.provider) {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.unsupportedProvider",
                    "unsupported key provider on mobile",
                ));
            }
            let entry = meta
                .providers
                .entry(key_patch.provider.clone())
                .or_insert_with(|| StoredProviderMeta {
                    free_only: None,
                    models: Vec::new(),
                });
            let removing_key = match &key_patch.api_key {
                Some(raw) => raw.trim().is_empty(),
                None => true,
            };
            if key_patch.provider == "openrouter" {
                if removing_key {
                    entry.free_only = None;
                } else if let Some(free_only) = key_patch.free_only {
                    entry.free_only = Some(free_only);
                }
                if entry.free_only == Some(true)
                    && let Some(existing_model) = meta.model_by_provider.get("openrouter")
                    && !existing_model.ends_with(":free")
                {
                    meta.model_by_provider.remove("openrouter");
                }
            }
            match key_patch.api_key {
                Some(raw) if !raw.trim().is_empty() => {
                    keys.insert(key_patch.provider.clone(), raw.trim().to_string());
                    keys_dirty = true;
                }
                _ => {
                    keys.remove(&key_patch.provider);
                    keys_dirty = true;
                }
            }
        }

        if let Some(model_patch) = patch.model_patch {
            if model_patch.provider == CUSTOM_PROVIDER && meta.custom_endpoint.is_none() {
                return Err(custom_not_configured());
            }
            let model = model_patch.model.trim().to_string();
            if model.is_empty() {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.emptyModel",
                    "model id must not be empty",
                ));
            }
            if model_patch.provider == "openrouter" {
                let free_only = meta
                    .providers
                    .get("openrouter")
                    .and_then(|p| p.free_only)
                    .unwrap_or(false);
                if free_only && !model.ends_with(":free") {
                    return Err(MobileError::with_detail(
                        MobileErrorCode::InvalidArgument,
                        "mobile.ai.openrouterFreeOnly",
                        "OpenRouter free-only connection permits only :free models",
                    ));
                }
            }
            meta.model_by_provider.insert(model_patch.provider, model);
        }

        if let Some(notice_version) = patch.subscription_notice_version {
            meta.subscription_notice_version = notice_version;
        }

        if keys_dirty {
            self.save_keys(&keys)?;
        }
        self.save_meta(&meta)?;
        self.get_snapshot(chatgpt_visible)
    }

    pub fn record_validated_models(&self, provider: &str, models: Vec<String>) -> MobileResult<()> {
        let mut meta = self.load_meta()?;
        let entry = meta
            .providers
            .entry(provider.to_string())
            .or_insert_with(|| StoredProviderMeta {
                free_only: None,
                models: Vec::new(),
            });
        entry.models = models;
        self.save_meta(&meta)
    }

    /// Host (lower-case) and port of the saved self-hosted server, for the relay allowlist.
    pub fn custom_origin(&self) -> MobileResult<Option<(String, u16)>> {
        Ok(self
            .load_meta()?
            .custom_endpoint
            .and_then(|c| custom_origin_of(&c.base_url)))
    }

    pub fn get_custom_endpoint(&self) -> MobileResult<MobileAiCustomEndpoint> {
        let meta = self.load_meta()?;
        let keys = self.load_keys()?;
        Ok(custom_endpoint_view(&meta, &keys))
    }

    pub fn set_custom_endpoint(
        &self,
        patch: MobileAiCustomEndpointPatch,
    ) -> MobileResult<MobileAiCustomEndpoint> {
        let base_url = validate_custom_base_url(&patch.base_url)?;
        let mut meta = self.load_meta()?;
        let mut keys = self.load_keys()?;
        let previous_origin = meta
            .custom_endpoint
            .as_ref()
            .and_then(|c| custom_origin_of(&c.base_url));
        let moved = previous_origin.is_some() && previous_origin != custom_origin_of(&base_url);
        let mut keys_dirty = false;

        match patch.api_key.as_deref().map(str::trim) {
            Some("") => keys_dirty |= keys.remove(CUSTOM_PROVIDER).is_some(),
            Some(key) => {
                keys.insert(CUSTOM_PROVIDER.to_string(), key.to_string());
                keys_dirty = true;
            }
            // A key saved for one server is never sent to another one.
            None if moved => keys_dirty |= keys.remove(CUSTOM_PROVIDER).is_some(),
            None => {}
        }
        match patch.model.as_deref().map(str::trim) {
            Some("") => {
                meta.model_by_provider.remove(CUSTOM_PROVIDER);
            }
            Some(model) => {
                meta.model_by_provider
                    .insert(CUSTOM_PROVIDER.to_string(), model.to_string());
            }
            None => {}
        }
        match patch.models {
            Some(models) => {
                meta.providers.insert(
                    CUSTOM_PROVIDER.to_string(),
                    StoredProviderMeta {
                        free_only: None,
                        models,
                    },
                );
            }
            None if moved => {
                meta.providers.remove(CUSTOM_PROVIDER);
            }
            None => {}
        }
        meta.custom_endpoint = Some(StoredCustomEndpoint { base_url });

        if keys_dirty {
            self.save_keys(&keys)?;
        }
        self.save_meta(&meta)?;
        Ok(custom_endpoint_view(&meta, &keys))
    }

    /// Forgets the self-hosted server (URL, key, model, model list); unselects it.
    pub fn clear_custom_endpoint(&self) -> MobileResult<MobileAiCustomEndpoint> {
        let mut meta = self.load_meta()?;
        let mut keys = self.load_keys()?;
        meta.custom_endpoint = None;
        meta.model_by_provider.remove(CUSTOM_PROVIDER);
        meta.providers.remove(CUSTOM_PROVIDER);
        if meta.selected_provider == CUSTOM_PROVIDER {
            meta.selected_provider = "auto".to_string();
        }
        if keys.remove(CUSTOM_PROVIDER).is_some() {
            self.save_keys(&keys)?;
        }
        self.save_meta(&meta)?;
        Ok(custom_endpoint_view(&meta, &keys))
    }

    pub async fn validate_key(
        &self,
        provider: &str,
        api_key: &str,
        free_only: Option<bool>,
        endpoint_override: Option<(&str, bool)>,
    ) -> MobileResult<ValidateKeyResult> {
        // The self-hosted server's models are listed by the webview through the relay.
        if provider == CUSTOM_PROVIDER || !is_supported_mobile_cloud_provider(provider) {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.ai.unsupportedProvider",
                "provider is not supported on mobile",
            ));
        }
        if api_key.trim().is_empty() {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.ai.emptyKey",
                "API key must not be empty",
            ));
        }
        let (raw_url, allow_loopback) = match endpoint_override {
            Some((u, lb)) => (u, lb),
            None => (provider_models_url(provider)?, false),
        };
        let url = enforce_https_url(raw_url, allow_loopback)?;
        let client = build_safe_http_client(20)?;
        let mut req = client.get(url.as_str()).header("accept", "application/json");
        if provider == "gemini" {
            req = req.header("x-goog-api-key", api_key.trim());
        } else if provider == "anthropic" {
            req = req
                .header("x-api-key", api_key.trim())
                .header("anthropic-version", "2023-06-01");
        } else {
            req = req.bearer_auth(api_key.trim());
        }

        let resp = req.send().await.map_err(|_| {
            MobileError::new(MobileErrorCode::NetworkError, "mobile.ai.networkError")
        })?;
        let status = resp.status().as_u16();
        if status == 401 || status == 403 {
            return Err(MobileError::new(
                MobileErrorCode::AuthDenied,
                "mobile.ai.invalidKey",
            ));
        }
        if status == 429 {
            return Err(MobileError::new(
                MobileErrorCode::RateLimited,
                "mobile.ai.rateLimited",
            ));
        }
        let body: serde_json::Value = resp.json().await.map_err(|_| {
            MobileError::new(MobileErrorCode::NetworkError, "mobile.ai.invalidModelResponse")
        })?;
        if !(200..300).contains(&status) {
            let code = extract_safe_error_code(&body).unwrap_or_else(|| format!("http_{status}"));
            return Err(MobileError::with_detail(
                MobileErrorCode::NetworkError,
                "mobile.ai.validateFailed",
                code,
            ));
        }

        let mut models = Vec::new();
        if let Some(arr) = body.get("data").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                    models.push(id.to_string());
                }
            }
        } else if let Some(arr) = body.get("models").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(name) = item
                    .get("name")
                    .or_else(|| item.get("slug"))
                    .and_then(|v| v.as_str())
                {
                    let clean = name.strip_prefix("models/").unwrap_or(name);
                    models.push(clean.to_string());
                }
            }
        }

        if provider == "openrouter" && free_only == Some(true) {
            models.retain(|m| m.ends_with(":free"));
        }
        Ok(ValidateKeyResult { ok: true, models })
    }
}
