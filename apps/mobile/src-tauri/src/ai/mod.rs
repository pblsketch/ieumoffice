pub mod chatgpt;
pub mod http;
pub mod settings;
pub mod stream;

pub use chatgpt::{
    CHATGPT_MOBILE_REDIRECT_URI, ChatGptLoginFailure, ChatGptModelInfo, ChatGptService,
    MobileChatGptStatus, ResponsesInputMessage, compiled_chatgpt_client_id, generate_pkce_pair,
    is_chatgpt_visible, requires_reauthentication_on_refresh, verify_rs256_id_token,
};
pub use http::{build_safe_http_client, enforce_https_url, extract_safe_error_code};
pub use settings::{
    ConfiguredProviderSummary, MobileAiSettingsPatch, MobileAiSettingsSnapshot,
    MobileAiSettingsStore, ModelPatch, ProviderKeyPatch, ValidateKeyResult,
};
pub use stream::{MobileAiStreamEvent, MobileAiStreamManager, MobileAiStreamRequest};

use crate::secrets::SealedVault;
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_ieum_mobile::auth::NativeAuthBridge;

/// Shared AI and authentication backend state registered in Tauri.
pub struct MobileAiService {
    pub settings: Arc<MobileAiSettingsStore>,
    pub chatgpt: Arc<ChatGptService>,
    pub streams: Arc<MobileAiStreamManager>,
}

impl MobileAiService {
    pub fn new(app_data_dir: PathBuf, auth_bridge: Arc<dyn NativeAuthBridge>) -> Self {
        let vault = Arc::new(SealedVault::new(app_data_dir.clone(), auth_bridge.clone()));
        let settings = Arc::new(MobileAiSettingsStore::new(app_data_dir, vault.clone()));
        let chatgpt = Arc::new(ChatGptService::new(vault, auth_bridge));
        let streams = Arc::new(MobileAiStreamManager::new(settings.clone(), chatgpt.clone()));
        Self {
            settings,
            chatgpt,
            streams,
        }
    }
}
