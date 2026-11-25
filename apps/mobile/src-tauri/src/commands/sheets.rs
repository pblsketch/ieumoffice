//! Track T1 (sheets) Tauri commands.
//!
//! `mobile_sheets_request` carries one engine protocol line (the same JSON the
//! desktop client writes to the sidecar) and returns the engine's response.
//! The `mobile_sheets_temp_*` commands move file contents between the WebView
//! and the T1 work folder, which is the only place they (and the engine
//! requests) may name.

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::sheets::SheetsState;
use crate::storage::MobileFileService;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsTempPath {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsWorkingCopy {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SheetsOk {
    pub ok: bool,
}

async fn run_blocking<T, F>(op: F) -> MobileResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> MobileResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(op)
        .await
        .map_err(|e| {
            MobileError::with_detail(
                MobileErrorCode::InternalError,
                "mobile.internalError",
                e.to_string(),
            )
        })?
}

fn path_string(path: std::path::PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn bad_base64(error: base64::DecodeError) -> MobileError {
    MobileError::with_detail(
        MobileErrorCode::InvalidArgument,
        "mobile.sheets.badBase64",
        error.to_string(),
    )
}

/// Sends one engine request line and returns the engine's response, passed
/// to the WebView as the engine wrote it (the same JSON text the desktop
/// sidecar prints). Engine failures come back inside the response
/// (`ok: false`), as on the desktop.
#[tauri::command]
pub async fn mobile_sheets_request(
    state: State<'_, Arc<SheetsState>>,
    line: String,
) -> MobileResult<tauri::ipc::Response> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.ensure_folders()?;
        Ok(tauri::ipc::Response::new(sheets.engine.handle_line(&line)))
    })
    .await
}

/// Copies the active document into a fresh working copy in the work folder
/// and returns its path (the file the engine opens and saves from).
#[tauri::command]
pub async fn mobile_sheets_copy_session_to_temp(
    files: State<'_, Arc<MobileFileService>>,
    state: State<'_, Arc<SheetsState>>,
    session_id: String,
    ext: String,
) -> MobileResult<SheetsWorkingCopy> {
    let files = files.inner().clone();
    let sheets = state.inner().clone();
    run_blocking(move || {
        let target = sheets.workspace.new_file_path(&ext)?;
        let read = files.read_file_bytes(&session_id)?;
        let bytes = B64
            .decode(read.bytes_base64.as_bytes())
            .map_err(bad_base64)?;
        let target = path_string(target);
        sheets.workspace.write_bytes(&target, &bytes)?;
        Ok(SheetsWorkingCopy {
            path: target,
            size: bytes.len() as u64,
        })
    })
    .await
}

/// Creates an empty folder in the work folder (e.g. `read_entries` output).
#[tauri::command]
pub async fn mobile_sheets_temp_create_dir(
    state: State<'_, Arc<SheetsState>>,
) -> MobileResult<SheetsTempPath> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        Ok(SheetsTempPath {
            path: path_string(sheets.workspace.create_dir()?),
        })
    })
    .await
}

/// Returns a fresh file path (not yet created) in the work folder.
#[tauri::command]
pub async fn mobile_sheets_temp_new_path(
    state: State<'_, Arc<SheetsState>>,
    ext: String,
) -> MobileResult<SheetsTempPath> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        Ok(SheetsTempPath {
            path: path_string(sheets.workspace.new_file_path(&ext)?),
        })
    })
    .await
}

#[tauri::command]
pub async fn mobile_sheets_temp_read_text(
    state: State<'_, Arc<SheetsState>>,
    path: String,
) -> MobileResult<String> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        let bytes = sheets.workspace.read_bytes(&path)?;
        String::from_utf8(bytes).map_err(|e| {
            MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.sheets.notUtf8",
                e.to_string(),
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn mobile_sheets_temp_read_bytes(
    state: State<'_, Arc<SheetsState>>,
    path: String,
) -> MobileResult<String> {
    let sheets = state.inner().clone();
    run_blocking(move || Ok(B64.encode(sheets.workspace.read_bytes(&path)?))).await
}

#[tauri::command]
pub async fn mobile_sheets_temp_write_text(
    state: State<'_, Arc<SheetsState>>,
    path: String,
    text: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.write_bytes(&path, text.as_bytes())?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

#[tauri::command]
pub async fn mobile_sheets_temp_write_bytes(
    state: State<'_, Arc<SheetsState>>,
    path: String,
    bytes_base64: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        let bytes = B64.decode(bytes_base64.as_bytes()).map_err(bad_base64)?;
        sheets.workspace.write_bytes(&path, &bytes)?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Deletes a file or folder in the work folder.
#[tauri::command]
pub async fn mobile_sheets_temp_delete(
    state: State<'_, Arc<SheetsState>>,
    path: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.delete(&path)?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Empties the work folder. Only call it when no workbook is open: the
/// engine may be reading the working copy of an open one.
#[tauri::command]
pub async fn mobile_sheets_temp_clear(
    state: State<'_, Arc<SheetsState>>,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.clear()?;
        Ok(SheetsOk { ok: true })
    })
    .await
}
