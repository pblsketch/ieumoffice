//! Commands for search requests and public address requests (see `crate::ai::web`).
//!
//! Listen on `mobile:ai-web-event` before starting. Pre-network refusals
//! reject the call with a `MobileError` and emit nothing. Otherwise the events
//! are `head` → `chunk`* → `end` | `error`, and the call resolves `{ ok: true }`
//! after `end` or rejects with the same code as `error`. One cancel command
//! serves both kinds; request ids must be unique.

use super::AiOkResult;
use crate::ai::{MobileAiSearchRequest, MobileAiService, MobileAiWebFetchRequest, WEB_EVENT_NAME};
use crate::error::MobileResult;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn mobile_ai_search_start(
    app: AppHandle,
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
    url: String,
    method: String,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
) -> MobileResult<AiOkResult> {
    let web = state.web.clone();
    web.run_search(
        MobileAiSearchRequest {
            request_id,
            url,
            method,
            headers: headers.unwrap_or_default(),
            body,
        },
        |event| {
            let _ = app.emit(WEB_EVENT_NAME, event);
        },
    )
    .await?;
    Ok(AiOkResult { ok: true })
}

#[tauri::command]
pub async fn mobile_ai_web_fetch_start(
    app: AppHandle,
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
) -> MobileResult<AiOkResult> {
    let web = state.web.clone();
    web.run_fetch(
        MobileAiWebFetchRequest {
            request_id,
            url,
            method,
            headers: headers.unwrap_or_default(),
        },
        |event| {
            let _ = app.emit(WEB_EVENT_NAME, event);
        },
    )
    .await?;
    Ok(AiOkResult { ok: true })
}

#[tauri::command]
pub fn mobile_ai_web_cancel(
    state: State<'_, Arc<MobileAiService>>,
    request_id: String,
) -> MobileResult<AiOkResult> {
    state.web.cancel(&request_id);
    Ok(AiOkResult { ok: true })
}
