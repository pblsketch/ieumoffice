//! Commands for the AI tool settings and the AI result store
//! (see `crate::ai::tool_settings` and `crate::ai::results`).

use crate::ai::{
    MobileAiResultImage, MobileAiResultPut, MobileAiResultsSize, MobileAiService,
    MobileAiToolSettings, MobileAiToolSettingsPatch,
};
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use std::sync::Arc;
use tauri::State;

/// Runs file work off the async runtime threads.
async fn blocking<T, F>(work: F) -> MobileResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> MobileResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| MobileError::new(MobileErrorCode::InternalError, "mobile.ai.resultTask"))?
}

#[tauri::command]
pub fn mobile_ai_get_tool_settings(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileAiToolSettings> {
    state.tool_settings.get()
}

#[tauri::command]
pub fn mobile_ai_set_tool_settings(
    state: State<'_, Arc<MobileAiService>>,
    internet_tools: Option<bool>,
    image_generation: Option<bool>,
    image_provider: Option<String>,
    image_model: Option<String>,
) -> MobileResult<MobileAiToolSettings> {
    state.tool_settings.set(MobileAiToolSettingsPatch {
        internet_tools,
        image_generation,
        image_provider,
        image_model,
    })
}

#[tauri::command]
pub async fn mobile_ai_results_size(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileAiResultsSize> {
    let store = state.results.clone();
    blocking(move || store.size()).await
}

#[tauri::command]
pub async fn mobile_ai_results_clear(
    state: State<'_, Arc<MobileAiService>>,
) -> MobileResult<MobileAiResultsSize> {
    let store = state.results.clone();
    blocking(move || store.clear()).await
}

#[tauri::command]
pub async fn mobile_ai_results_put_image(
    state: State<'_, Arc<MobileAiService>>,
    data_base64: String,
    mime: String,
) -> MobileResult<MobileAiResultPut> {
    let store = state.results.clone();
    blocking(move || store.put_image(&data_base64, &mime)).await
}

#[tauri::command]
pub async fn mobile_ai_results_read_image(
    state: State<'_, Arc<MobileAiService>>,
    address: String,
) -> MobileResult<MobileAiResultImage> {
    let store = state.results.clone();
    blocking(move || store.read_image(&address)).await
}
