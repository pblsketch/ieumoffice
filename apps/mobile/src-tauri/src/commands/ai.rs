use crate::ai::{
    MobileAiService, MobileAiSettingsPatch, MobileAiSettingsSnapshot, MobileAiStreamRequest,
    MobileChatGptStatus, ModelPatch, ProviderKeyPatch, ValidateKeyResult,
};
use crate::error::MobileResult;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
pub struct AiOkResult {
    pub ok: bool,
}

#[tauri::command]
pub fn mobile_get_ai_settings(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileAiSettingsSnapshot> {
    state.settings.get_snapshot(state.chatgpt.is_visible())
}

#[tauri::command]
pub fn mobile_set_ai_settings(
    state: State<'_, Arc<MobileAiService>>,
    selected_provider: Option<String>,
    model_patch: Option<ModelPatch>,
    provider_key_patch: Option<ProviderKeyPatch>,
    subscription_notice_version: Option<u32>,
) -> MobileResult<MobileAiSettingsSnapshot> {
    state.settings.set_settings(
        MobileAiSettingsPatch {
            selected_provider,
            model_patch,
            provider_key_patch,
            subscription_notice_version,
        },
        state.chatgpt.is_visible(),
    )
}

#[tauri::command]
pub async fn mobile_ai_validate_key(
    state: State<'_, Arc<MobileAiService>>,
    provider: String,
    api_key: String,
    free_only: Option<bool>,
) -> MobileResult<ValidateKeyResult> {
    let result = state
        .settings
        .validate_key(&provider, &api_key, free_only, None)
        .await?;
    let _ = state
        .settings
        .record_validated_models(&provider, result.models.clone());
    Ok(result)
}

#[tauri::command]
pub async fn mobile_ai_stream_start(
    app: AppHandle,
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
    system: String,
    messages: Vec<serde_json::Value>,
    tools: Option<Vec<serde_json::Value>>,
    max_tokens: Option<u32>,
) -> MobileResult<AiOkResult> {
    let request = MobileAiStreamRequest {
        request_id,
        system,
        messages,
        tools: tools.unwrap_or_default(),
        max_tokens,
    };
    state
        .streams
        .run_stream(request, |event| {
            let _ = app.emit("mobile:ai-stream-chunk", event);
        })
        .await?;
    Ok(AiOkResult { ok: true })
}

#[tauri::command]
pub fn mobile_ai_stream_cancel(
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
) -> MobileResult<AiOkResult> {
    state.streams.cancel(&request_id);
    Ok(AiOkResult { ok: true })
}

#[tauri::command]
pub fn mobile_chatgpt_status(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileChatGptStatus> {
    state.chatgpt.status()
}

#[tauri::command]
pub async fn mobile_chatgpt_sign_in(
    state: State<'_, Arc<MobileAiService>>,
    reconsent: Option<bool>,
) -> MobileResult<String> {
    state.chatgpt.start_sign_in(reconsent.unwrap_or(false)).await
}

#[tauri::command]
pub async fn mobile_chatgpt_complete_callback(
    state: State<'_, Arc<MobileAiService>>,
    url: String,
) -> MobileResult<MobileChatGptStatus> {
    state.chatgpt.complete_callback(&url).await
}

#[tauri::command]
pub async fn mobile_chatgpt_sign_out(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<AiOkResult> {
    state.chatgpt.sign_out().await?;
    Ok(AiOkResult { ok: true })
}
