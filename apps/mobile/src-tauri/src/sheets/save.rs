//! Reading a document into, and writing a finished save out of, the T1 work
//! folder.
//!
//! The WebView never carries a workbook's bytes: it names a file in the work
//! folder and Rust reads it there. Every write to a place the person sees
//! goes through a function that is only called here, never changed:
//!
//! - over the document the person opened: the storage service
//!   (`MobileFileService::save_file_bytes`, which keeps the active session);
//! - as a new document (Save As of the workbook, the first save of an `.xls`
//!   or a `.csv` kept as Excel): `MobileFileService::save_as_file_bytes`,
//!   which makes the new file the active session;
//! - a copy (CSV, ODS or PDF export): the plugin's file bridge directly
//!   (`create_save_file` + `write_uri_bytes_atomic`), which leaves the active
//!   session as it is;
//! - the share sheet and the recovery copy: `share_file` and
//!   `recovery_write` of the storage service.
//!
//! Like the desktop's `errDiskChanged` guard, a write over the original is
//! refused when the document changed after it was opened (or last saved):
//! the digest of what the app read or wrote is kept per document session.
//!
//! The WebView keeps the save rules (spec 2.3, 5.1); Rust holds a last line
//! of defence for the two that must never break, from what it saw itself
//! when it read the original (`DocumentMark`):
//! - an `.xls` original is never written (the engine cannot write `.xls`;
//!   its first save is a Save As to `.xlsx`);
//! - a document whose original was encrypted never sends a plain workbook
//!   (a ZIP package) to its original, a Save As or the share sheet, and
//!   never writes a recovery copy. A CSV or PDF the person chose still goes.
//!
//! The storage calls sit in the small functions at the end ("storage
//! calls"); each one becomes a single call to track T6's file-path functions
//! (`copy_session_to_file`, `save_file_from_path`, `save_as_file_from_path`,
//! `write_uri_from_file`) once they reach this branch.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri_plugin_ieum_mobile::fs::{
    NativeFileBridge, NativeFsError, NativeFsErrorKind, write_uri_from_file,
};

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::{MobileDocFormat, MobileDocSession, MobileFileService, MobileShareMode};

use super::SheetsWorkspace;

/// `messageKey` of a write refused because the original changed since the
/// app read it (the WebView shows its own sentence for it).
pub const MESSAGE_DISK_CHANGED: &str = "mobile.sheets.diskChanged";

/// `messageKey` of a write the native file bridge could not take because of
/// the file's size.
pub const MESSAGE_TOO_LARGE: &str = "mobile.sheets.tooLargeToWrite";

/// `messageKey` of a write over an `.xls` original (never allowed).
pub const MESSAGE_LEGACY_ORIGINAL: &str = "mobile.sheets.legacyOriginal";

/// `messageKey` of a plain workbook a password document tried to send out.
pub const MESSAGE_NOT_LOCKED: &str = "mobile.sheets.notLocked";

/// `messageKey` of a recovery copy a password document asked for.
pub const MESSAGE_NO_RECOVERY: &str = "mobile.sheets.noRecoveryForLocked";

/// About the largest file the native file bridge passes today: it carries the
/// bytes as one base64 JSON string, and the Android side refuses strings over
/// 20,000,000 characters (15,000,000 bytes; the other arguments take a little
/// more). Only used to explain a write that failed, never to refuse one.
pub const BRIDGE_WRITE_SIZE_HINT: u64 = 14_900_000;

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

/// What the engine library's `probe` says about an original's bytes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OriginalProbe {
    pub encrypted: bool,
    /// A legacy `.xls` (BIFF in a compound file), encrypted or not.
    pub legacy_xls: bool,
}

/// What Rust saw of a document's original when it read it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DocumentMark {
    /// An `.xls` (by its name or its content): never written back.
    pub legacy_xls: bool,
    /// Encrypted: the session edits a decrypted copy, and only locked
    /// workbooks may leave the work folder.
    pub locked: bool,
}

/// SHA-256 of each document's original as the app last read or wrote it,
/// by document session id (the desktop keeps `session.sha256` the same way),
/// and the document's `DocumentMark`.
#[derive(Debug, Default)]
pub struct OriginalDigests {
    digests: Mutex<HashMap<String, String>>,
    marks: Mutex<HashMap<String, DocumentMark>>,
}

impl OriginalDigests {
    pub fn record(&self, session_id: &str, digest: String) {
        self.digests
            .lock()
            .unwrap()
            .insert(session_id.to_owned(), digest);
    }

    pub fn get(&self, session_id: &str) -> Option<String> {
        self.digests.lock().unwrap().get(session_id).cloned()
    }

    pub fn forget(&self, session_id: &str) {
        self.digests.lock().unwrap().remove(session_id);
        self.marks.lock().unwrap().remove(session_id);
    }

    pub fn record_mark(&self, session_id: &str, mark: DocumentMark) {
        self.marks
            .lock()
            .unwrap()
            .insert(session_id.to_owned(), mark);
    }

    /// The document's mark (the default for one Rust never read, such as an
    /// untitled or restored workbook).
    pub fn mark(&self, session_id: &str) -> DocumentMark {
        self.marks
            .lock()
            .unwrap()
            .get(session_id)
            .copied()
            .unwrap_or_default()
    }
}

/// The compound-file signature (an encrypted OOXML package, an `.xls`).
const CFB_MAGIC: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/// The signature of a ZIP package (a plain workbook).
const ZIP_MAGIC: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];

/// The mark of an original read as `ext` with these bytes. Without the
/// library's answer, a compound file named anything but `.xls` counts as
/// encrypted (a plain OOXML package is a ZIP).
fn mark_for(ext: &str, bytes: &[u8], probe: Option<OriginalProbe>) -> DocumentMark {
    let legacy_name = ext.eq_ignore_ascii_case("xls");
    match probe {
        Some(probe) => DocumentMark {
            legacy_xls: legacy_name || probe.legacy_xls,
            locked: probe.encrypted,
        },
        None => DocumentMark {
            legacy_xls: legacy_name,
            locked: !legacy_name && bytes.starts_with(&CFB_MAGIC),
        },
    }
}

/// True when the work-folder file at `raw_path` is a ZIP package (a plain
/// workbook; an encrypted one is a compound file).
fn is_plain_package(workspace: &SheetsWorkspace, raw_path: &str) -> MobileResult<bool> {
    Ok(workspace
        .read_range(raw_path, Some(0), Some(4))?
        .starts_with(&ZIP_MAGIC))
}

fn refused(message_key: &'static str, detail: &str) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InvalidArgument, message_key, detail)
}

/// Refuses a plain workbook leaving a password document (see the module note).
fn ensure_locked_if_needed(
    digests: &OriginalDigests,
    workspace: &SheetsWorkspace,
    session_id: &str,
    raw_path: &str,
) -> MobileResult<()> {
    if digests.mark(session_id).locked && is_plain_package(workspace, raw_path)? {
        return Err(refused(
            MESSAGE_NOT_LOCKED,
            "a workbook opened with a password leaves the app locked again",
        ));
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

/// Copies the active document into a fresh working copy with extension
/// `ext` in the work folder and remembers the digest of what was read (the
/// base of the "changed since it was opened" check) and its `DocumentMark`
/// (`probe`: the engine library's answer for the copy, `None` without one).
pub fn copy_original_to_work_folder(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    digests: &OriginalDigests,
    session_id: &str,
    ext: &str,
    probe: &dyn Fn(&Path) -> Option<OriginalProbe>,
) -> MobileResult<SheetsWorkingCopy> {
    let target_path = workspace.new_file_path(ext)?;
    let target = target_path.to_string_lossy().into_owned();
    let started = Instant::now();
    let size = files.copy_session_to_file(session_id, &target_path)?;
    let read_ms = elapsed_ms(started);
    let digest = workspace.sha256(&target)?;
    digests.record(session_id, digest);
    let head = if size == 0 {
        Vec::new()
    } else {
        workspace.read_range(&target, Some(0), Some(8))?
    };
    let probed = if size == 0 {
        None
    } else {
        probe(&target_path)
    };
    digests.record_mark(session_id, mark_for(ext, &head, probed));
    Ok(SheetsWorkingCopy {
        path: target,
        size,
        read_ms,
        decode_ms: 0,
        write_ms: 0,
    })
}

/// Refuses a write over the original when it is no longer what the app read
/// or last wrote. An original that cannot be read now (deleted, say) is not
/// a refusal: the write recreates it, as on the desktop.
fn ensure_original_unchanged(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    digests: &OriginalDigests,
    session_id: &str,
) -> MobileResult<()> {
    let Some(expected) = digests.get(session_id) else {
        return Ok(());
    };
    let Some(current) = current_original_digest(files, workspace, session_id) else {
        return Ok(());
    };
    if current == expected {
        return Ok(());
    }
    Err(MobileError::with_detail(
        MobileErrorCode::InvalidArgument,
        MESSAGE_DISK_CHANGED,
        "the document changed after it was opened",
    ))
}

/// A failed write of `size` bytes, told as "too large for the phone's file
/// bridge" when that is what happened (see `BRIDGE_WRITE_SIZE_HINT`).
pub fn explain_write_failure(error: MobileError, size: u64) -> MobileError {
    if error.code == MobileErrorCode::UserCancelled {
        return error;
    }
    let says_too_long = error
        .detail
        .as_deref()
        .is_some_and(|detail| detail.contains("exceeds the maximum length"));
    if size > BRIDGE_WRITE_SIZE_HINT || says_too_long {
        let detail = error.detail.unwrap_or_default();
        return MobileError::with_detail(
            MobileErrorCode::FileTooLarge,
            MESSAGE_TOO_LARGE,
            format!("{size} bytes: {detail}"),
        );
    }
    error
}

fn file_size(workspace: &SheetsWorkspace, raw_path: &str) -> MobileResult<u64> {
    Ok(workspace
        .stat(raw_path)?
        .map(|stat| stat.size)
        .unwrap_or_default())
}

/// Writes the file at `raw_path` (inside the work folder) over the active
/// session's original document. Call it only after the file passed the save
/// checks (manifest comparison and the engine reopening it): this is the
/// first moment the original changes. Refused when the original changed
/// since the app read or last wrote it, for an `.xls` original, and for a
/// plain workbook over a password document's original.
pub fn write_back_to_original(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    digests: &OriginalDigests,
    session_id: &str,
    raw_path: &str,
) -> MobileResult<SheetsOriginalWritten> {
    workspace.resolve(raw_path)?;
    if digests.mark(session_id).legacy_xls {
        return Err(refused(
            MESSAGE_LEGACY_ORIGINAL,
            "an .xls original is never written; save as .xlsx",
        ));
    }
    ensure_locked_if_needed(digests, workspace, session_id, raw_path)?;
    ensure_original_unchanged(files, workspace, digests, session_id)?;
    let size = file_size(workspace, raw_path)?;
    let digest = workspace.sha256(raw_path)?;
    store_over_original(files, workspace, session_id, raw_path)
        .map_err(|error| explain_write_failure(error, size))?;
    digests.record(session_id, digest);
    Ok(SheetsOriginalWritten { ok: true, size })
}

/// Saves the workbook at `raw_path` as a new document the person places in
/// the system save dialog (`suggested_name`: `.xlsx` or `.xlsm`). The new
/// document becomes the active session (keeping the old one's password
/// mark); the old original is not written.
pub fn save_as_new_document(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    digests: &OriginalDigests,
    session_id: Option<&str>,
    raw_path: &str,
    suggested_name: &str,
) -> MobileResult<MobileDocSession> {
    workspace.resolve(raw_path)?;
    let format = MobileDocFormat::from_name(suggested_name);
    if !matches!(format, MobileDocFormat::Xlsx | MobileDocFormat::Xlsm) {
        return Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.sheets.saveAsFormat",
            suggested_name.to_owned(),
        ));
    }
    let locked = session_id.is_some_and(|previous| digests.mark(previous).locked);
    if let Some(previous) = session_id {
        ensure_locked_if_needed(digests, workspace, previous, raw_path)?;
    }
    let size = file_size(workspace, raw_path)?;
    let digest = workspace.sha256(raw_path)?;
    let session = store_as_new_document(
        files,
        workspace,
        session_id,
        suggested_name,
        format,
        raw_path,
    )
    .map_err(|error| explain_write_failure(error, size))?;
    if let Some(previous) = session_id {
        digests.forget(previous);
    }
    digests.record(&session.session_id, digest);
    digests.record_mark(
        &session.session_id,
        DocumentMark {
            legacy_xls: false,
            locked,
        },
    );
    Ok(session)
}

/// Hands the file at `raw_path` to the system share sheet as `suggested_name`
/// (never a plain workbook of a password document).
pub fn share_from_work_folder(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    digests: &OriginalDigests,
    session_id: &str,
    raw_path: &str,
    suggested_name: &str,
) -> MobileResult<()> {
    ensure_locked_if_needed(digests, workspace, session_id, raw_path)?;
    let size = file_size(workspace, raw_path)?;
    share_file(files, workspace, session_id, raw_path, suggested_name)
        .map_err(|error| explain_write_failure(error, size))
}

/// Keeps the workbook at `raw_path` as the document's recovery copy (an
/// `.xlsx`, whatever the document's own format: see the kind's
/// `recoveryFormat`). Refused for a password document (`session_id`): its
/// workbook must not land outside the work folder in plain form.
pub fn write_recovery_copy(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    digests: &OriginalDigests,
    session_id: &str,
    doc_key: &str,
    title: &str,
    raw_path: &str,
) -> MobileResult<()> {
    if digests.mark(session_id).locked {
        return Err(refused(
            MESSAGE_NO_RECOVERY,
            "a workbook opened with a password has no recovery copy",
        ));
    }
    store_recovery_copy(files, workspace, doc_key, title, raw_path)
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
    let path = workspace.resolve(raw_path)?;
    let size = file_size(workspace, raw_path)?;
    let picked = bridge
        .create_save_file(suggested_name, mime)
        .map_err(fs_error)?;
    write_copy_into(bridge, workspace, &picked.uri, &path)
        .map_err(|error| explain_write_failure(error, size))?;
    Ok(SheetsCopyWritten {
        name: picked.name,
        size,
    })
}

// ---------------------------------------------------------------------------
// Storage calls: file-path streaming through track T6's storage/bridge helpers
// so large workbooks never cross the bridge as a single base64 string.

fn current_original_digest(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    session_id: &str,
) -> Option<String> {
    let tmp = workspace.new_file_path("tmp").ok()?;
    let digest = files
        .copy_session_to_file(session_id, &tmp)
        .ok()
        .and_then(|_| workspace.sha256(&tmp.to_string_lossy()).ok());
    let _ = std::fs::remove_file(&tmp);
    digest
}

fn store_over_original(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    session_id: &str,
    raw_path: &str,
) -> MobileResult<()> {
    files
        .save_file_from_path(session_id, &workspace.resolve(raw_path)?, None)
        .map(|_| ())
}

fn store_as_new_document(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    session_id: Option<&str>,
    suggested_name: &str,
    format: MobileDocFormat,
    raw_path: &str,
) -> MobileResult<MobileDocSession> {
    files.save_as_file_from_path(
        session_id,
        suggested_name,
        format,
        &workspace.resolve(raw_path)?,
        None,
    )
}

fn write_copy_into(
    bridge: &dyn NativeFileBridge,
    workspace: &SheetsWorkspace,
    uri: &str,
    path: &Path,
) -> MobileResult<()> {
    write_uri_from_file(bridge, uri, path, workspace.root()).map_err(fs_error)
}

/// T6 publishes no file-path share or recovery function; these keep the
/// base64 step inside Rust.
fn share_file(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    session_id: &str,
    raw_path: &str,
    suggested_name: &str,
) -> MobileResult<()> {
    let encoded = B64.encode(workspace.read_bytes(raw_path)?);
    files.share_file(
        session_id,
        suggested_name,
        MobileShareMode::Edited,
        Some(&encoded),
    )
}

fn store_recovery_copy(
    files: &MobileFileService,
    workspace: &SheetsWorkspace,
    doc_key: &str,
    title: &str,
    raw_path: &str,
) -> MobileResult<()> {
    let encoded = B64.encode(workspace.read_bytes(raw_path)?);
    files.recovery_write(doc_key, MobileDocFormat::Xlsx, title, &encoded)
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
