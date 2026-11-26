pub(crate) mod cancel;
pub mod chatgpt;
pub mod http;
pub mod relay;
pub mod results;
#[cfg(test)]
mod relay_tests;
pub mod settings;
pub mod stream;
pub mod tool_settings;
#[cfg(test)]
mod tools_tests;
pub mod web;
#[cfg(test)]
mod web_tests;

pub use chatgpt::{
    CHATGPT_MOBILE_REDIRECT_URI, ChatGptLoginFailure, ChatGptModelInfo, ChatGptService,
    MobileChatGptStatus, ResponsesInputMessage, compiled_chatgpt_client_id, generate_pkce_pair,
    is_chatgpt_visible, requires_reauthentication_on_refresh, verify_rs256_id_token,
};
pub use http::{build_safe_http_client, enforce_https_url, extract_safe_error_code};
pub use relay::{
    MobileAiRelay, MobileAiRelayEvent, MobileAiRelayEventKind, MobileAiRelayRequest,
    RELAY_EVENT_NAME, provider_relay_hosts,
};
pub use settings::{
    ConfiguredProviderSummary, MobileAiCustomEndpoint, MobileAiCustomEndpointPatch,
    MobileAiSettingsPatch, MobileAiSettingsSnapshot, MobileAiSettingsStore, ModelPatch,
    ProviderKeyPatch, ValidateKeyResult, validate_custom_base_url,
};
pub use results::{
    MobileAiResultImage, MobileAiResultPut, MobileAiResultStore, MobileAiResultsSize,
};
pub use stream::{MobileAiStreamEvent, MobileAiStreamManager, MobileAiStreamRequest};
pub use tool_settings::{
    MobileAiToolSettings, MobileAiToolSettingsPatch, MobileAiToolSettingsStore,
};
pub use web::{
    MobileAiSearchRequest, MobileAiWeb, MobileAiWebEvent, MobileAiWebEventKind,
    MobileAiWebFetchRequest, WEB_EVENT_NAME,
};

use crate::secrets::SealedVault;
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_ieum_mobile::auth::NativeAuthBridge;

/// Shared AI and authentication backend state registered in Tauri.
pub struct MobileAiService {
    pub settings: Arc<MobileAiSettingsStore>,
    pub chatgpt: Arc<ChatGptService>,
    pub streams: Arc<MobileAiStreamManager>,
    /// Sealed relay for key-provider requests (T7).
    pub relay: Arc<MobileAiRelay>,
    /// Search and public address requests for the AI web tools (T7).
    pub web: Arc<MobileAiWeb>,
    /// Internet tools and image generation switches (T7).
    pub tool_settings: Arc<MobileAiToolSettingsStore>,
    /// The `ai-results/` folder (T7).
    pub results: Arc<MobileAiResultStore>,
}

impl MobileAiService {
    pub fn new(app_data_dir: PathBuf, auth_bridge: Arc<dyn NativeAuthBridge>) -> Self {
        let vault = Arc::new(SealedVault::new(app_data_dir.clone(), auth_bridge.clone()));
        let settings = Arc::new(MobileAiSettingsStore::new(app_data_dir.clone(), vault.clone()));
        let tool_settings = Arc::new(MobileAiToolSettingsStore::new(
            app_data_dir.clone(),
            settings.clone(),
        ));
        let results = Arc::new(MobileAiResultStore::new(app_data_dir));
        let chatgpt = Arc::new(ChatGptService::new(vault, auth_bridge));
        let streams = Arc::new(MobileAiStreamManager::new(settings.clone(), chatgpt.clone()));
        let relay = Arc::new(MobileAiRelay::new(settings.clone()));
        Self {
            settings,
            chatgpt,
            streams,
            relay,
            web: Arc::new(MobileAiWeb::new()),
            tool_settings,
            results,
        }
    }
}
