use crate::error::MobileResult;
use crate::storage::{
    MobileAppPrefs, MobileAppPrefsPatch, MobileDocFormat, MobileFileService, MobileHomePrefsPatch,
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn mobile_get_app_prefs(
    state: State<'_, Arc<MobileFileService>>,
) -> MobileResult<MobileAppPrefs> {
    state.get_app_prefs()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn mobile_set_app_prefs(
    state: State<'_, Arc<MobileFileService>>,
    lang: Option<String>,
    theme: Option<String>,
    hwp_default_format: Option<MobileDocFormat>,
    ai_enabled: Option<bool>,
    editors_off: Option<Vec<String>>,
    home_kinds_hidden: Option<Vec<String>>,
    home_kinds_order: Option<Vec<String>>,
    keep_screen_on_while_reading: Option<bool>,
    first_run_done: Option<bool>,
    tips_seen: Option<Vec<String>>,
    last_seen_version: Option<String>,
) -> MobileResult<MobileAppPrefs> {
    state.set_app_prefs_with_home(
        MobileAppPrefsPatch {
            lang,
            theme,
            hwp_default_format,
            ai_enabled,
        },
        MobileHomePrefsPatch {
            editors_off,
            home_kinds_hidden,
            home_kinds_order,
            keep_screen_on_while_reading,
            first_run_done,
            tips_seen,
            last_seen_version,
        },
    )
}
