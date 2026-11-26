pub mod ai;
pub mod commands;
pub mod error;
pub mod hwp;
pub mod secrets;
pub mod sheets;
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

            // T1 sheets state
            app.manage(crate::sheets::SheetsState::for_app(app.handle())?);

            // T2 pdf state

            // T3 pdf tools state

            // T4 html state
            app.manage(Arc::new(commands::html::MobileWebState::new(resolve_file_bridge(app.handle()))));

            // T5 readers state
            app.manage(commands::readers::store::ReaderStore::new(
                &app.path()
                    .app_data_dir()
                    .unwrap_or_else(|_| std::env::temp_dir().join("ieumoffice-mobile")),
            ));

            // T6 home state
            let home_files = app.state::<Arc<MobileFileService>>().inner().clone();
            let home_version = app.package_info().version.to_string();
            let home_service = crate::storage::home::HomeService::new(home_files, home_version)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(Arc::new(home_service));

            // T7 ai state

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
            commands::files::mobile_set_openable_formats,
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
            // T1 sheets
            commands::sheets::mobile_sheets_request,
            commands::sheets::mobile_sheets_crypto,
            commands::sheets::mobile_sheets_copy_session_to_temp,
            commands::sheets::mobile_sheets_temp_create_dir,
            commands::sheets::mobile_sheets_temp_new_path,
            commands::sheets::mobile_sheets_temp_read_text,
            commands::sheets::mobile_sheets_temp_read_bytes,
            commands::sheets::mobile_sheets_temp_write_text,
            commands::sheets::mobile_sheets_temp_write_bytes,
            commands::sheets::mobile_sheets_temp_delete,
            commands::sheets::mobile_sheets_temp_clear,
            commands::sheets::mobile_sheets_temp_root,
            commands::sheets::mobile_sheets_temp_mkdir,
            commands::sheets::mobile_sheets_temp_rename,
            commands::sheets::mobile_sheets_temp_copy,
            commands::sheets::mobile_sheets_temp_stat,
            commands::sheets::mobile_sheets_temp_read_raw,
            commands::sheets::mobile_sheets_temp_append_text,
            commands::sheets::mobile_sheets_temp_append_bytes,
            commands::sheets::mobile_sheets_temp_sha256,
            commands::sheets::mobile_sheets_save_to_original,
            commands::sheets::mobile_sheets_save_as,
            commands::sheets::mobile_sheets_share_file,
            commands::sheets::mobile_sheets_write_recovery,
            commands::sheets::mobile_sheets_write_copy,

            // T2 pdf

            // T3 pdf tools
            commands::pdf_tools::mobile_pdf_tools_share,
            commands::pdf_tools::mobile_pdf_tools_save_copy,

            // T4 html
            commands::html::mobile_web_save_new_file,

            // T5 readers
            commands::readers::mobile_readers_get_state,
            commands::readers::mobile_readers_set_position,
            commands::readers::mobile_readers_set_settings,

            // T6 home
            commands::home::mobile_home_list_folders,
            commands::home::mobile_home_link_folder,
            commands::home::mobile_home_unlink_folder,
            commands::home::mobile_home_count_folder_entries,
            commands::home::mobile_home_list_folder,
            commands::home::mobile_home_open_folder_entry,
            commands::home::mobile_home_open_favorite,
            commands::home::mobile_home_list_favorites,
            commands::home::mobile_home_set_favorite,
            commands::home::mobile_home_list_groups,
            commands::home::mobile_home_save_group,
            commands::home::mobile_home_delete_group,
            commands::home::mobile_home_move_to_group,
            commands::home::mobile_home_rename,
            commands::home::mobile_home_duplicate,
            commands::home::mobile_home_delete,
            commands::home::mobile_home_share_files,
            commands::home::mobile_home_read_bytes,
            commands::home::mobile_home_recent_meta,
            commands::home::mobile_home_take_incoming,
            commands::home::mobile_home_open_incoming_entry,
            commands::home::mobile_home_open_sample,
            commands::home::mobile_home_storage_usage,
            commands::home::mobile_home_clear_storage,
            commands::home::mobile_home_app_info,
            commands::home::mobile_home_keep_screen_on,
            commands::home::mobile_home_open_external_url,

            // T7 ai
            commands::ai::relay::mobile_ai_relay_start,
            commands::ai::relay::mobile_ai_relay_cancel,
            commands::ai::relay::mobile_ai_get_custom_endpoint,
            commands::ai::relay::mobile_ai_set_custom_endpoint,
            commands::ai::relay::mobile_ai_clear_custom_endpoint,
            commands::ai::web::mobile_ai_search_start,
            commands::ai::web::mobile_ai_web_fetch_start,
            commands::ai::web::mobile_ai_web_cancel,
            commands::ai::tools::mobile_ai_get_tool_settings,
            commands::ai::tools::mobile_ai_set_tool_settings,
            commands::ai::tools::mobile_ai_results_size,
            commands::ai::tools::mobile_ai_results_clear,
            commands::ai::tools::mobile_ai_results_put_image,
            commands::ai::tools::mobile_ai_results_read_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running IeumOffice mobile application");
}
