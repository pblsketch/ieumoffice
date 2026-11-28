pub mod ai;
pub mod commands;
pub mod error;
pub mod hwp;
pub mod secrets;
pub mod storage;

use crate::ai::MobileAiService;
use crate::storage::MobileFileService;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_ieum_mobile::{resolve_auth_bridge, resolve_file_bridge};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_ieum_mobile::init_file())
        .plugin(tauri_plugin_ieum_mobile::init_auth())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("ieumoffice-mobile"));
            let file_bridge = resolve_file_bridge(app.handle());
            let auth_bridge = resolve_auth_bridge(app.handle());
            let file_service = Arc::new(
                MobileFileService::new(app_data_dir.clone(), file_bridge)
                    .map_err(|e| std::io::Error::other(e.to_string()))?,
            );
            let ai_service = Arc::new(MobileAiService::new(app_data_dir, auth_bridge));
            app.manage(file_service);
            app.manage(ai_service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::files::mobile_create_untitled_session,
            commands::files::mobile_pick_open_file,
            commands::files::mobile_open_recent_doc,
            commands::files::mobile_consume_pending_open_intent,
            commands::files::mobile_read_file_bytes,
            commands::files::mobile_hwp_new_tabs,
            commands::files::mobile_save_file_bytes,
            commands::files::mobile_save_as_file_bytes,
            commands::files::mobile_share_file,
            commands::files::mobile_list_recent_docs,
            commands::files::mobile_remove_recent_doc,
            commands::files::mobile_recovery_write,
            commands::files::mobile_recovery_list,
            commands::files::mobile_recovery_read,
            commands::files::mobile_recovery_discard,
            commands::files::mobile_hwp_backup_list,
            commands::files::mobile_hwp_backup_restore,
            commands::files::mobile_hwp_backup_delete,
            commands::prefs::mobile_get_app_prefs,
            commands::prefs::mobile_set_app_prefs,
            commands::ai::mobile_get_ai_settings,
            commands::ai::mobile_set_ai_settings,
            commands::ai::mobile_ai_validate_key,
            commands::ai::mobile_ai_stream_start,
            commands::ai::mobile_ai_stream_cancel,
            commands::ai::mobile_chatgpt_status,
            commands::ai::mobile_chatgpt_sign_in,
            commands::ai::mobile_chatgpt_complete_callback,
            commands::ai::mobile_chatgpt_sign_out,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IeumOffice mobile application");
}
