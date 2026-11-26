//! Commands for the sealed relay and the self-hosted (`custom`) server settings.
//!
//! Relay contract (see `crate::ai::relay`): listen on `mobile:ai-relay-event`
//! before calling `mobile_ai_relay_start`. Refusals reject the call with a
//! `MobileError` and emit nothing. Once the request is on the network the
//! events are `head` → `chunk`* → `end` | `error`, and the call resolves
//! `{ ok: true }` after `end` or rejects with the same code as `error`.

use super::AiOkResult;
use crate::ai::{
    MobileAiCustomEndpoint, MobileAiCustomEndpointPatch, MobileAiRelayRequest, MobileAiService,
    RELAY_EVENT_NAME,
};
use crate::error::MobileResult;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn mobile_ai_relay_start(
    app: AppHandle,
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
    url: String,
    method: String,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
) -> MobileResult<AiOkResult> {
    let relay = state.relay.clone();
    relay
        .run(
            MobileAiRelayRequest {
                request_id,
                url,
                method,
                headers: headers.unwrap_or_default(),
                body,
            },
            |event| {
                let _ = app.emit(RELAY_EVENT_NAME, event);
            },
        )
        .await?;
    Ok(AiOkResult { ok: true })
}

#[tauri::command]
pub fn mobile_ai_relay_cancel(
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
) -> MobileResult<AiOkResult> {
    state.relay.cancel(&request_id);
    Ok(AiOkResult { ok: true })
}

#[tauri::command]
pub fn mobile_ai_get_custom_endpoint(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileAiCustomEndpoint> {
    state.settings.get_custom_endpoint()
}

#[tauri::command]
pub fn mobile_ai_set_custom_endpoint(
    state: State<'_, Arc<MobileAiService>>,
    base_url: String,
    api_key: Option<String>,
    model: Option<String>,
    models: Option<Vec<String>>,
) -> MobileResult<MobileAiCustomEndpoint> {
    state
        .settings
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url,
            api_key,
            model,
            models,
        })
}

#[tauri::command]
pub fn mobile_ai_clear_custom_endpoint(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileAiCustomEndpoint> {
    state.settings.clear_custom_endpoint()
}
