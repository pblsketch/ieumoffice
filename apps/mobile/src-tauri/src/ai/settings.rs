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
struct StoredAiMeta {
    selected_provider: String,
    model_by_provider: BTreeMap<String, String>,
    providers: BTreeMap<String, StoredProviderMeta>,
    subscription_notice_version: u32,
}

impl Default for StoredAiMeta {
    fn default() -> Self {
        Self {
            selected_provider: "auto".to_string(),
            model_by_provider: BTreeMap::new(),
            providers: BTreeMap::new(),
            subscription_notice_version: 0,
        }
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

pub fn provider_chat_url(provider: &str) -> MobileResult<&'static str> {
    match provider {
        "openai" => Ok("https://api.openai.com/v1/chat/completions"),
        "anthropic" => Ok("https://api.anthropic.com/v1/messages"),
        "gemini" => Ok("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
        "openrouter" => Ok("https://openrouter.ai/api/v1/chat/completions"),
        "deepseek" => Ok("https://api.deepseek.com/v1/chat/completions"),
        "xai" => Ok("https://api.x.ai/v1/chat/completions"),
        "mistral" => Ok("https://api.mistral.ai/v1/chat/completions"),
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
            if !key.trim().is_empty() && !configured.contains_key(provider) {
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
            if selected == "custom" || selected == "claude-code" || selected == "codex" {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.unsupportedProvider",
                    "provider is not available on mobile",
                ));
            }
            if selected != "auto"
                && selected != "chatgpt"
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
            if key_patch.provider == "custom"
                || !is_supported_mobile_cloud_provider(&key_patch.provider)
            {
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
            if model_patch.provider == "custom" {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.unsupportedProvider",
                    "custom HTTP endpoints are excluded on mobile",
                ));
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

    pub async fn validate_key(
        &self,
        provider: &str,
        api_key: &str,
        free_only: Option<bool>,
        endpoint_override: Option<(&str, bool)>,
    ) -> MobileResult<ValidateKeyResult> {
        if provider == "custom" || !is_supported_mobile_cloud_provider(provider) {
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
