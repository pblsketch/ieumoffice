//! Writing a finished save out of the T1 work folder.
//!
//! The WebView never carries a saved workbook's bytes: it names a verified
//! file in the work folder and Rust reads it there. Writing back to the
//! document the user opened goes through the storage service
//! (`MobileFileService::save_file_bytes`, which keeps the active session);
//! a copy (CSV, ODS or PDF export) goes through the plugin's file bridge
//! directly (`create_save_file` + `write_uri_bytes_atomic`), which leaves the
//! active session as it is. Neither is changed here; both are only called.

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use tauri_plugin_ieum_mobile::fs::{NativeFileBridge, NativeFsError, NativeFsErrorKind};

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::MobileFileService;

use super::SheetsWorkspace;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsOriginalWritten {
    pub ok: bool,
    /// Bytes written to the original.
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsCopyWritten {
    /// The name the person gave the copy in the system save dialog.
    pub name: String,
    pub size: u64,
}

/// Writes the file at `raw_path` (inside the work folder) over the active
/// session's original document. Call it only after the file passed the save
/// checks (manifest comparison and the engine reopening it): this is the
/// first moment the original changes.
pub fn write_back_to_original(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    session_id: &str,
    raw_path: &str,
) -> MobileResult<SheetsOriginalWritten> {
    let bytes = workspace.read_bytes(raw_path)?;
    let size = bytes.len() as u64;
    // The storage service takes base64 (its WebView command's shape); the
    // encoding stays inside Rust.
    let encoded = B64.encode(&bytes);
    drop(bytes);
    let result = files.save_file_bytes(session_id, &encoded, None)?;
    Ok(SheetsOriginalWritten {
        ok: result.ok,
        size,
    })
}

/// Asks where to put a copy (system save dialog) and writes the file at
/// `raw_path` there. The active session, its original and its recovery copy
/// stay untouched.
pub fn write_copy(
    bridge: &dyn NativeFileBridge,
    workspace: &SheetsWorkspace,
    raw_path: &str,
    suggested_name: &str,
    mime: &str,
) -> MobileResult<SheetsCopyWritten> {
    let bytes = workspace.read_bytes(raw_path)?;
    let picked = bridge
        .create_save_file(suggested_name, mime)
        .map_err(fs_error)?;
    bridge
        .write_uri_bytes_atomic(&picked.uri, &bytes)
        .map_err(fs_error)?;
    Ok(SheetsCopyWritten {
        name: picked.name,
        size: bytes.len() as u64,
    })
}

/// Same mapping as the storage service uses for bridge failures.
fn fs_error(error: NativeFsError) -> MobileError {
    match error.kind {
        NativeFsErrorKind::UserCancelled => MobileError::with_detail(
            MobileErrorCode::UserCancelled,
            "mobile.fs.cancelled",
            error.detail,
        ),
        NativeFsErrorKind::PermissionDenied => MobileError::with_detail(
            MobileErrorCode::PermissionDenied,
            "mobile.fs.permissionDenied",
            error.detail,
        ),
        NativeFsErrorKind::ReadOnlyUri => MobileError::with_detail(
            MobileErrorCode::ReadOnlyUri,
            "mobile.fs.readOnly",
            error.detail,
        ),
        NativeFsErrorKind::IoError => MobileError::with_detail(
            MobileErrorCode::InternalError,
            "mobile.fs.ioError",
            error.detail,
        ),
    }
}
