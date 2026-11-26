//! AI tool settings: the internet tools switch and image generation.
//!
//! Stored in `ai-tool-settings.json` next to the AI settings meta
//! (`ai-settings.json`), never in the sealed vault: nothing here is secret.
//!
//! - `internetTools` (default on) lets the AI use web search, image search,
//!   reading addresses and fetching pictures.
//! - `imageGeneration` (default off) can be turned on only when an image
//!   provider is chosen (`openai` or `gemini`, the providers that answer in
//!   base64 and share the chat key), its key is in the vault and an image
//!   model is chosen. OpenRouter is never an image provider.
//! - Changing the image provider drops the chosen model unless the same patch
//!   names one (a model belongs to its provider).
//! - When the switch is on and its conditions stop holding (the key is
//!   removed, the provider or model is cleared), it is switched off and saved
//!   that way, so adding the key again does not silently turn paid image
//!   generation back on. The provider and model choice is kept.

use crate::ai::settings::MobileAiSettingsStore;
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const FILE_NAME: &str = "ai-tool-settings.json";
/// Providers that may generate images on mobile, in display order.
pub const IMAGE_PROVIDERS: &[&str] = &["gemini", "openai"];
const IMAGE_MODEL_MAX: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredToolSettings {
    #[serde(default = "default_true")]
    internet_tools: bool,
    #[serde(default)]
    image_generation: bool,
    #[serde(default)]
    image_provider: Option<String>,
    #[serde(default)]
    image_model: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for StoredToolSettings {
    fn default() -> Self {
        Self {
            internet_tools: true,
            image_generation: false,
            image_provider: None,
            image_model: None,
        }
    }
}

/// Tool settings returned to the webview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiToolSettings {
    pub internet_tools: bool,
    /// Effective value: true only while provider, key and model are all in place.
    pub image_generation: bool,
    pub image_provider: Option<String>,
    pub image_model: Option<String>,
    /// Image providers whose key is in the vault (`gemini`, `openai`).
    pub image_providers_ready: Vec<String>,
}

/// A change; absent fields are kept. `image_provider` / `image_model`: an
/// empty string clears the value.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiToolSettingsPatch {
    #[serde(default)]
    pub internet_tools: Option<bool>,
    #[serde(default)]
    pub image_generation: Option<bool>,
    #[serde(default)]
    pub image_provider: Option<String>,
    #[serde(default)]
    pub image_model: Option<String>,
}

fn refuse(key: &str) -> MobileError {
    MobileError::new(MobileErrorCode::InvalidArgument, key)
}

fn internal(key: &str, detail: impl Into<String>) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InternalError, key, detail)
}

fn clean_model(raw: &str) -> MobileResult<Option<String>> {
    let model = raw.trim();
    if model.is_empty() {
        return Ok(None);
    }
    if model.chars().count() > IMAGE_MODEL_MAX
        || model.chars().any(char::is_control)
        || model.contains("__sealed__")
    {
        return Err(refuse("mobile.ai.imageModelInvalid"));
    }
    Ok(Some(model.to_string()))
}

pub struct MobileAiToolSettingsStore {
    path: PathBuf,
    settings: Arc<MobileAiSettingsStore>,
    lock: Mutex<()>,
}

impl MobileAiToolSettingsStore {
    pub fn new(app_data_dir: PathBuf, settings: Arc<MobileAiSettingsStore>) -> Self {
        Self {
            path: app_data_dir.join(FILE_NAME),
            settings,
            lock: Mutex::new(()),
        }
    }

    fn load(&self) -> MobileResult<StoredToolSettings> {
        if !self.path.exists() {
            return Ok(StoredToolSettings::default());
        }
        let text = fs::read_to_string(&self.path)
            .map_err(|e| internal("mobile.ai.toolSettingsRead", e.to_string()))?;
        serde_json::from_str(&text)
            .map_err(|e| internal("mobile.ai.toolSettingsParse", e.to_string()))
    }

    fn save(&self, stored: &StoredToolSettings) -> MobileResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| internal("mobile.ai.toolSettingsWrite", e.to_string()))?;
        }
        let json = serde_json::to_string_pretty(stored)
            .map_err(|e| internal("mobile.ai.toolSettingsWrite", e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json)
            .map_err(|e| internal("mobile.ai.toolSettingsWrite", e.to_string()))?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            internal("mobile.ai.toolSettingsWrite", e.to_string())
        })
    }

    fn has_key(&self, provider: &str) -> MobileResult<bool> {
        Ok(self
            .settings
            .get_api_key(provider)?
            .is_some_and(|k| !k.trim().is_empty()))
    }

    fn ready_providers(&self) -> MobileResult<Vec<String>> {
        let mut out = Vec::new();
        for provider in IMAGE_PROVIDERS {
            if self.has_key(provider)? {
                out.push((*provider).to_string());
            }
        }
        Ok(out)
    }

    /// Why image generation cannot be on with these values (`None` when it can).
    fn blocker(&self, stored: &StoredToolSettings) -> MobileResult<Option<&'static str>> {
        let Some(provider) = stored.image_provider.as_deref() else {
            return Ok(Some("mobile.ai.imageProviderMissing"));
        };
        if !IMAGE_PROVIDERS.contains(&provider) {
            return Ok(Some("mobile.ai.imageProviderNotAllowed"));
        }
        if !self.has_key(provider)? {
            return Ok(Some("mobile.ai.imageProviderNoKey"));
        }
        if stored.image_model.is_none() {
            return Ok(Some("mobile.ai.imageModelMissing"));
        }
        Ok(None)
    }

    fn view(&self, stored: &StoredToolSettings) -> MobileResult<MobileAiToolSettings> {
        Ok(MobileAiToolSettings {
            internet_tools: stored.internet_tools,
            image_generation: stored.image_generation,
            image_provider: stored.image_provider.clone(),
            image_model: stored.image_model.clone(),
            image_providers_ready: self.ready_providers()?,
        })
    }

    /// Reads the settings; image generation whose conditions no longer hold is
    /// reported off and saved off.
    pub fn get(&self) -> MobileResult<MobileAiToolSettings> {
        let _guard = self.lock.lock().unwrap();
        let mut stored = self.load()?;
        if stored.image_generation && self.blocker(&stored)?.is_some() {
            stored.image_generation = false;
            // Reported off even if saving fails; the next read checks again.
            let _ = self.save(&stored);
        }
        self.view(&stored)
    }

    pub fn set(&self, patch: MobileAiToolSettingsPatch) -> MobileResult<MobileAiToolSettings> {
        let _guard = self.lock.lock().unwrap();
        let mut stored = self.load()?;
        if let Some(on) = patch.internet_tools {
            stored.internet_tools = on;
        }
        if let Some(raw) = patch.image_provider.as_deref() {
            let provider = if raw.is_empty() {
                None
            } else if IMAGE_PROVIDERS.contains(&raw) {
                Some(raw.to_string())
            } else {
                return Err(refuse("mobile.ai.imageProviderNotAllowed"));
            };
            if provider != stored.image_provider {
                stored.image_model = None;
            }
            stored.image_provider = provider;
        }
        if let Some(raw) = patch.image_model.as_deref() {
            stored.image_model = clean_model(raw)?;
        }
        match patch.image_generation {
            Some(true) => {
                if let Some(reason) = self.blocker(&stored)? {
                    return Err(refuse(reason));
                }
                stored.image_generation = true;
            }
            Some(false) => stored.image_generation = false,
            None => {
                if stored.image_generation && self.blocker(&stored)?.is_some() {
                    stored.image_generation = false;
                }
            }
        }
        self.save(&stored)?;
        self.view(&stored)
    }
}
