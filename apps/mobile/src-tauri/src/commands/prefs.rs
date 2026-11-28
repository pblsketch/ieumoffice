use crate::error::MobileResult;
use crate::storage::{MobileAppPrefs, MobileAppPrefsPatch, MobileDocFormat, MobileFileService};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn mobile_get_app_prefs(
    state: State<'_, Arc<MobileFileService>>,
) -> MobileResult<MobileAppPrefs> {
    state.get_app_prefs()
}

#[tauri::command]
pub fn mobile_set_app_prefs(
    state: State<'_, Arc<MobileFileService>>,
    lang: Option<String>,
    theme: Option<String>,
    hwp_default_format: Option<MobileDocFormat>,
    ai_enabled: Option<bool>,
) -> MobileResult<MobileAppPrefs> {
    state.set_app_prefs(MobileAppPrefsPatch {
        lang,
        theme,
        hwp_default_format,
        ai_enabled,
    })
}
