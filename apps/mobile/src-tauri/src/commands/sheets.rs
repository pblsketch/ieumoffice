//! Track T1 (sheets) Tauri commands.
//!
//! `mobile_sheets_request` carries one engine protocol line (the same JSON the
//! desktop client writes to the sidecar) and returns the engine's response.
//! The `mobile_sheets_temp_*` commands move file contents between the WebView
//! and the T1 work folder, which is the only place they (and the engine
//! requests) may name.

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::sheets::save::{
    SheetsCopyWritten, SheetsOriginalWritten, write_back_to_original, write_copy,
};
use crate::sheets::{SheetsState, SheetsTempStat};
use crate::storage::MobileFileService;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;
use tauri_plugin_ieum_mobile::resolve_file_bridge;

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
    /// Where the copy's time went (diagnostics): the storage read through the
    /// native file bridge, the base64 decode, the write into the work folder.
    pub read_ms: u64,
    pub decode_ms: u64,
    pub write_ms: u64,
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
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

/// Answers one password request of the engine library (`probe`, `decrypt`,
/// `encrypt`; JSON in, JSON out, see `engine-lib/src/crypto.rs`). Paths must
/// lie inside the work folder, so a decrypted workbook only exists as a file
/// there. Failures (a wrong password included) come back inside the answer.
#[tauri::command]
pub async fn mobile_sheets_crypto(
    state: State<'_, Arc<SheetsState>>,
    line: String,
) -> MobileResult<tauri::ipc::Response> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.ensure_folders()?;
        Ok(tauri::ipc::Response::new(sheets.engine.crypto_line(&line)))
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
        let started = Instant::now();
        let read = files.read_file_bytes(&session_id)?;
        let read_ms = elapsed_ms(started);
        let started = Instant::now();
        let bytes = B64
            .decode(read.bytes_base64.as_bytes())
            .map_err(bad_base64)?;
        drop(read);
        let decode_ms = elapsed_ms(started);
        let started = Instant::now();
        let target = path_string(target);
        sheets.workspace.write_bytes(&target, &bytes)?;
        let write_ms = elapsed_ms(started);
        Ok(SheetsWorkingCopy {
            path: target,
            size: bytes.len() as u64,
            read_ms,
            decode_ms,
            write_ms,
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

/// The work folder's own path (the stand-in for `os.tmpdir()` the
/// spreadsheet save code runs with in the WebView).
#[tauri::command]
pub async fn mobile_sheets_temp_root(
    state: State<'_, Arc<SheetsState>>,
) -> MobileResult<SheetsTempPath> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.ensure_folders()?;
        Ok(SheetsTempPath {
            path: path_string(sheets.workspace.root().to_path_buf()),
        })
    })
    .await
}

/// Creates a folder (and missing parents) inside the work folder.
#[tauri::command]
pub async fn mobile_sheets_temp_mkdir(
    state: State<'_, Arc<SheetsState>>,
    path: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.make_dir(&path)?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Moves a file inside the work folder, replacing the target.
#[tauri::command]
pub async fn mobile_sheets_temp_rename(
    state: State<'_, Arc<SheetsState>>,
    from: String,
    to: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.rename(&from, &to)?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Copies a file inside the work folder, replacing the target.
#[tauri::command]
pub async fn mobile_sheets_temp_copy(
    state: State<'_, Arc<SheetsState>>,
    from: String,
    to: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.copy(&from, &to)?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Size and kind of what is at a path in the work folder (`null`: nothing).
#[tauri::command]
pub async fn mobile_sheets_temp_stat(
    state: State<'_, Arc<SheetsState>>,
    path: String,
) -> MobileResult<Option<SheetsTempStat>> {
    let sheets = state.inner().clone();
    run_blocking(move || sheets.workspace.stat(&path)).await
}

/// A file's bytes (or a range of them) as a raw IPC response: the WebView
/// receives an `ArrayBuffer`, with no base64 or JSON step in between.
#[tauri::command]
pub async fn mobile_sheets_temp_read_raw(
    state: State<'_, Arc<SheetsState>>,
    path: String,
    offset: Option<u64>,
    length: Option<u64>,
) -> MobileResult<tauri::ipc::Response> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        Ok(tauri::ipc::Response::new(
            sheets.workspace.read_range(&path, offset, length)?,
        ))
    })
    .await
}

/// Appends UTF-8 text to a file in the work folder (created if missing).
#[tauri::command]
pub async fn mobile_sheets_temp_append_text(
    state: State<'_, Arc<SheetsState>>,
    path: String,
    text: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        sheets.workspace.append_bytes(&path, text.as_bytes())?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Appends base64 bytes to a file in the work folder (created if missing).
#[tauri::command]
pub async fn mobile_sheets_temp_append_bytes(
    state: State<'_, Arc<SheetsState>>,
    path: String,
    bytes_base64: String,
) -> MobileResult<SheetsOk> {
    let sheets = state.inner().clone();
    run_blocking(move || {
        let bytes = B64.decode(bytes_base64.as_bytes()).map_err(bad_base64)?;
        sheets.workspace.append_bytes(&path, &bytes)?;
        Ok(SheetsOk { ok: true })
    })
    .await
}

/// Lowercase hex SHA-256 of a file in the work folder.
#[tauri::command]
pub async fn mobile_sheets_temp_sha256(
    state: State<'_, Arc<SheetsState>>,
    path: String,
) -> MobileResult<String> {
    let sheets = state.inner().clone();
    run_blocking(move || sheets.workspace.sha256(&path)).await
}

/// Writes a verified save (a file in the work folder) over the active
/// session's original document through the storage service. The WebView
/// calls it only after the manifest check and the engine's reopen passed.
#[tauri::command]
pub async fn mobile_sheets_save_to_original(
    files: State<'_, Arc<MobileFileService>>,
    state: State<'_, Arc<SheetsState>>,
    session_id: String,
    path: String,
) -> MobileResult<SheetsOriginalWritten> {
    let files = files.inner().clone();
    let sheets = state.inner().clone();
    run_blocking(move || write_back_to_original(&files, &sheets.workspace, &session_id, &path))
        .await
}

/// Writes a file in the work folder as a new document the person places in
/// the system save dialog (an export copy); the active session stays as is.
#[tauri::command]
pub async fn mobile_sheets_write_copy<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, Arc<SheetsState>>,
    path: String,
    suggested_name: String,
    mime: String,
) -> MobileResult<SheetsCopyWritten> {
    let bridge = resolve_file_bridge(&app);
    let sheets = state.inner().clone();
    run_blocking(move || {
        write_copy(
            bridge.as_ref(),
            &sheets.workspace,
            &path,
            &suggested_name,
            &mime,
        )
    })
    .await
}
