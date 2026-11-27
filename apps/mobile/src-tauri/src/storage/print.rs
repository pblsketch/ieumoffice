//! Chunked PDF staging and native print/share execution for all mobile editors.
//!
//! Large PDFs never travel across the Tauri IPC boundary as one giant base64 string: the
//! WebView opens a stage tied to the active document session, streams 4 MiB chunks into a
//! cache file, and finishes by invoking either the OS print spooler (`ieum-tmp/print`) or
//! the OS share sheet (`<cache>/shared`). Protected sessions (encrypted/distribution HWP,
//! encrypted PDF, or encrypted workbooks) are refused here in Rust before any file is written.

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::{LocalSource, MobileDocFormat};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri_plugin_ieum_mobile::fs::{
    NativeFileBridge, NativeFsError, NativeFsErrorKind, PRINT_WORK_RELATIVE_DIR,
};
use uuid::Uuid;

/// Hard upper bound for a staged PDF (32 MiB) to protect low-RAM mobile devices.
pub const MAX_PRINT_PDF_BYTES: usize = 32 * 1024 * 1024;
const PDF_MAGIC: &[u8; 5] = b"%PDF-";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfStageTarget {
    Print,
    Share,
}

/// Snapshot of the session facts Rust needs to enforce protection rules without holding
/// the session mutex while doing disk I/O.
#[derive(Debug, Clone)]
pub struct PrintSessionContext {
    pub session_id: String,
    pub format: MobileDocFormat,
    pub name: String,
    pub uri: Option<String>,
    pub(crate) local: Option<LocalSource>,
    pub encrypted: bool,
    pub distribution: bool,
}

struct ActiveStage {
    session_id: String,
    target: PdfStageTarget,
    suggested_name: String,
    path: PathBuf,
    parent_dir_to_clean: Option<PathBuf>,
    written: usize,
    header_checked: bool,
}

#[derive(Default)]
pub struct PrintStagingService {
    stages: Mutex<HashMap<String, ActiveStage>>,
}

impl PrintStagingService {
    pub fn new() -> Self {
        Self::default()
    }

    /// Removes leftover staged print files from previous app runs.
    pub fn cleanup_stale_print_dir(&self, cache_dir: &Path) {
        let dir = cache_dir.join(PRINT_WORK_RELATIVE_DIR);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    /// Starts a chunked PDF upload for printing or sharing.
    pub fn begin(
        &self,
        ctx: &PrintSessionContext,
        suggested_name: &str,
        target: PdfStageTarget,
        expected_bytes: Option<usize>,
        bridge: &dyn NativeFileBridge,
    ) -> MobileResult<String> {
        enforce_session_printable(ctx)?;
        if let Some(expected) = expected_bytes
            && expected > MAX_PRINT_PDF_BYTES
        {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.tooLarge",
                format!("PDF exceeds the {MAX_PRINT_PDF_BYTES}-byte mobile print/share limit"),
            ));
        }

        let dirs = bridge.native_dirs().map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", e.detail)
        })?;
        let pdf_name = sanitize_pdf_name(if suggested_name.trim().is_empty() {
            &ctx.name
        } else {
            suggested_name
        });
        let stage_id = Uuid::new_v4().to_string();

        let (path, parent_dir_to_clean) = match target {
            PdfStageTarget::Print => {
                let print_dir = dirs.cache_dir.join(PRINT_WORK_RELATIVE_DIR);
                std::fs::create_dir_all(&print_dir).map_err(io_err)?;
                (print_dir.join(format!("{stage_id}-{pdf_name}")), None)
            }
            PdfStageTarget::Share => {
                let share_dir = dirs.share_temp_dir.join(format!("pdf-{stage_id}"));
                std::fs::create_dir_all(&share_dir).map_err(io_err)?;
                (share_dir.join(&pdf_name), Some(share_dir))
            }
        };

        // Pre-create an empty file so append fails fast if storage is unwritable.
        File::create(&path).map_err(io_err)?;

        let mut guard = self.stages.lock().unwrap();
        guard.insert(
            stage_id.clone(),
            ActiveStage {
                session_id: ctx.session_id.clone(),
                target,
                suggested_name: pdf_name,
                path,
                parent_dir_to_clean,
                written: 0,
                header_checked: false,
            },
        );
        Ok(stage_id)
    }

    /// Appends one base64-encoded chunk to an open stage.
    pub fn append(&self, stage_id: &str, chunk_base64: &str) -> MobileResult<usize> {
        let bytes = B64.decode(chunk_base64).map_err(|e| {
            MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.decode.base64",
                e.to_string(),
            )
        })?;

        let mut guard = self.stages.lock().unwrap();
        let Some(stage) = guard.get_mut(stage_id) else {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.stageNotFound",
                "unknown print stage id",
            ));
        };

        let next_total = stage.written.saturating_add(bytes.len());
        if next_total > MAX_PRINT_PDF_BYTES {
            let removed = guard.remove(stage_id).expect("checked above");
            cleanup_stage_files(&removed);
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.tooLarge",
                format!("PDF exceeds the {MAX_PRINT_PDF_BYTES}-byte mobile print/share limit"),
            ));
        }

        if !stage.header_checked && stage.written + bytes.len() >= PDF_MAGIC.len() {
            let mut prefix = Vec::with_capacity(PDF_MAGIC.len());
            if stage.written > 0 {
                let mut existing = File::open(&stage.path).map_err(io_err)?;
                let mut head = vec![0u8; stage.written.min(PDF_MAGIC.len())];
                existing.read_exact(&mut head).map_err(io_err)?;
                prefix.extend_from_slice(&head);
            }
            let need = PDF_MAGIC.len().saturating_sub(prefix.len());
            prefix.extend_from_slice(&bytes[..need.min(bytes.len())]);
            if prefix.as_slice() != PDF_MAGIC {
                let removed = guard.remove(stage_id).expect("checked above");
                cleanup_stage_files(&removed);
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.print.invalidPdf",
                    "staged bytes do not start with a PDF header",
                ));
            }
            stage.header_checked = true;
        }

        let mut file = OpenOptions::new()
            .append(true)
            .open(&stage.path)
            .map_err(io_err)?;
        file.write_all(&bytes).map_err(io_err)?;
        file.flush().map_err(io_err)?;
        stage.written = next_total;
        Ok(stage.written)
    }

    /// Finalizes the stage and triggers either native printing or PDF sharing.
    pub fn finish(
        &self,
        stage_id: &str,
        session_id: &str,
        format: MobileDocFormat,
        bridge: &dyn NativeFileBridge,
    ) -> MobileResult<()> {
        let stage = {
            let mut guard = self.stages.lock().unwrap();
            let matches_session = guard
                .get(stage_id)
                .is_some_and(|s| s.session_id == session_id);
            if !matches_session {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.print.stageNotFound",
                    "unknown or mismatched print stage",
                ));
            }
            guard.remove(stage_id).expect("checked above")
        };

        if stage.written < PDF_MAGIC.len() || !stage.header_checked {
            cleanup_stage_files(&stage);
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.invalidPdf",
                "staged PDF is empty or missing a PDF header",
            ));
        }

        // Defense-in-depth: refuse encrypted PDFs even if a staged PDF-format session slipped past JS checks.
        if format == MobileDocFormat::Pdf
            && let Err(err) = validate_pdf_file_unencrypted(&stage.path)
        {
            cleanup_stage_files(&stage);
            return Err(err);
        }

        let result = match stage.target {
            PdfStageTarget::Print => bridge
                .print_pdf_from_path(&stage.path, &stage.suggested_name)
                .map_err(map_print_fs_error),
            PdfStageTarget::Share => bridge
                .share_file_from_path(&stage.path, &stage.suggested_name, "application/pdf")
                .map_err(map_print_fs_error),
        };
        if result.is_err() {
            cleanup_stage_files(&stage);
        }
        result
    }

    /// Cancels an in-flight stage and deletes its temporary file.
    pub fn abort(&self, stage_id: &str) {
        let removed = self.stages.lock().unwrap().remove(stage_id);
        if let Some(stage) = removed {
            cleanup_stage_files(&stage);
        }
    }

    /// Prints an unmodified PDF session directly from its source file without routing bytes
    /// through the WebView. Encrypted PDFs are refused before invoking the OS print spooler.
    pub fn print_unmodified_session_pdf(
        &self,
        ctx: &PrintSessionContext,
        bridge: &dyn NativeFileBridge,
    ) -> MobileResult<()> {
        if ctx.format != MobileDocFormat::Pdf {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.invalidPdf",
                "direct session printing is only supported for PDF sessions",
            ));
        }
        enforce_session_printable(ctx)?;

        let dirs = bridge.native_dirs().map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", e.detail)
        })?;
        let print_dir = dirs.cache_dir.join(PRINT_WORK_RELATIVE_DIR);
        std::fs::create_dir_all(&print_dir).map_err(io_err)?;
        let pdf_name = sanitize_pdf_name(&ctx.name);
        let dest = print_dir.join(format!("{}-{pdf_name}", Uuid::new_v4()));

        let copied = if let Some(local) = &ctx.local {
            let bytes = local.read_bounded(MAX_PRINT_PDF_BYTES)?;
            std::fs::write(&dest, &bytes).map_err(io_err)?;
            bytes.len() as u64
        } else if let Some(uri) = ctx.uri.as_deref() {
            bridge.copy_uri_to_file(uri, &dest).map_err(map_print_fs_error)?
        } else {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.noOriginalFile",
                "untitled PDF session has no original file on disk",
            ));
        };

        if copied as usize > MAX_PRINT_PDF_BYTES {
            let _ = std::fs::remove_file(&dest);
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.print.tooLarge",
                format!("PDF exceeds the {MAX_PRINT_PDF_BYTES}-byte mobile print limit"),
            ));
        }

        let check = validate_pdf_file_unencrypted(&dest);
        if let Err(err) = check {
            let _ = std::fs::remove_file(&dest);
            return Err(err);
        }

        let res = bridge
            .print_pdf_from_path(&dest, &pdf_name)
            .map_err(map_print_fs_error);
        if res.is_err() {
            let _ = std::fs::remove_file(&dest);
        }
        res
    }
}

/// Checks whether raw PDF bytes carry an `/Encrypt` dictionary entry (indicating a password-
/// or permissions-encrypted PDF). Used by both printing and thumbnail extraction.
pub fn pdf_bytes_have_encrypt_dict(bytes: &[u8]) -> bool {
    const NEEDLE: &[u8] = b"/Encrypt";
    if bytes.len() < NEEDLE.len() {
        return false;
    }
    let mut pos = 0;
    while pos + NEEDLE.len() <= bytes.len() {
        if let Some(rel) = bytes[pos..].windows(NEEDLE.len()).position(|w| w == NEEDLE) {
            let end = pos + rel + NEEDLE.len();
            let next = bytes.get(end).copied();
            // A PDF name token `/Encrypt` ends at whitespace, delimiter, or EOF.
            let is_boundary = match next {
                None => true,
                Some(b) => {
                    b.is_ascii_whitespace()
                        || matches!(b, b'<' | b'>' | b'[' | b']' | b'(' | b')' | b'/' | b'%')
                }
            };
            if is_boundary {
                return true;
            }
            pos = end;
        } else {
            break;
        }
    }
    false
}

fn validate_pdf_file_unencrypted(path: &Path) -> MobileResult<()> {
    let bytes = std::fs::read(path).map_err(io_err)?;
    if bytes.len() < PDF_MAGIC.len() || &bytes[..PDF_MAGIC.len()] != PDF_MAGIC {
        return Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.print.invalidPdf",
            "file does not have a valid PDF header",
        ));
    }
    if pdf_bytes_have_encrypt_dict(&bytes) {
        return Err(MobileError::with_detail(
            MobileErrorCode::PasswordProtected,
            "mobile.print.protectedRefused",
            "encrypted PDF documents cannot be printed through temp files",
        ));
    }
    Ok(())
}

fn enforce_session_printable(ctx: &PrintSessionContext) -> MobileResult<()> {
    if ctx.encrypted || ctx.distribution {
        return Err(MobileError::with_detail(
            MobileErrorCode::PasswordProtected,
            "mobile.print.protectedRefused",
            "encrypted or distribution documents cannot be printed or exported as PDF",
        ));
    }
    Ok(())
}

const KNOWN_DOC_EXTS: &[&str] = &[
    "hwp", "hwpx", "md", "markdown", "txt", "html", "htm", "xlsx", "xlsm", "xls", "csv", "pdf",
    "pptx", "epub", "docx", "odt",
];

/// Ensures a clean, path-safe `.pdf` file name while preserving dots inside versioned stems (e.g. `Report v1.2`).
pub fn sanitize_pdf_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    let stem = if trimmed.is_empty() {
        "document"
    } else if let Some((base, ext)) = trimmed.rsplit_once('.') {
        if !base.trim().is_empty()
            && KNOWN_DOC_EXTS.contains(&ext.trim().to_ascii_lowercase().as_str())
        {
            base.trim()
        } else {
            trimmed
        }
    } else {
        trimmed
    };
    format!("{stem}.pdf")
}

fn cleanup_stage_files(stage: &ActiveStage) {
    let _ = std::fs::remove_file(&stage.path);
    if let Some(dir) = &stage.parent_dir_to_clean {
        let _ = std::fs::remove_dir_all(dir);
    }
}

fn io_err(e: std::io::Error) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", e.to_string())
}

fn map_print_fs_error(err: NativeFsError) -> MobileError {
    match err.kind {
        NativeFsErrorKind::UserCancelled => MobileError::with_detail(
            MobileErrorCode::UserCancelled,
            "mobile.userCancelled",
            err.detail,
        ),
        NativeFsErrorKind::PermissionDenied => MobileError::with_detail(
            MobileErrorCode::PermissionDenied,
            "mobile.fs.permissionDenied",
            err.detail,
        ),
        NativeFsErrorKind::ReadOnlyUri => MobileError::with_detail(
            MobileErrorCode::ReadOnlyUri,
            "mobile.fs.readOnlyUri",
            err.detail,
        ),
        NativeFsErrorKind::IoError => MobileError::with_detail(
            MobileErrorCode::InternalError,
            "mobile.fs.ioError",
            err.detail,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_ieum_mobile::fs::{HostFileBridge, MockPickedDoc};

    fn sample_pdf() -> Vec<u8> {
        b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n".to_vec()
    }

    fn make_ctx(format: MobileDocFormat, encrypted: bool, distribution: bool) -> PrintSessionContext {
        PrintSessionContext {
            session_id: "sess-1".to_string(),
            format,
            name: "report.hwp".to_string(),
            uri: Some("content://docs/report.hwp".to_string()),
            local: None,
            encrypted,
            distribution,
        }
    }

    #[test]
    fn sanitize_pdf_name_replaces_extension_and_separators() {
        assert_eq!(sanitize_pdf_name("plan.hwpx"), "plan.pdf");
        assert_eq!(sanitize_pdf_name("a/b\\c:d.md"), "a_b_c_d.pdf");
        assert_eq!(sanitize_pdf_name("   "), "document.pdf");
        assert_eq!(sanitize_pdf_name("already.pdf"), "already.pdf");
        assert_eq!(sanitize_pdf_name("Report v1.2"), "Report v1.2.pdf");
    }

    #[test]
    fn refuses_encrypted_and_distribution_sessions_in_rust() {
        let bridge = HostFileBridge::new();
        let svc = PrintStagingService::new();

        let enc = make_ctx(MobileDocFormat::Hwp, true, false);
        let err = svc
            .begin(&enc, "report.pdf", PdfStageTarget::Print, Some(100), &bridge)
            .unwrap_err();
        assert_eq!(err.code, MobileErrorCode::PasswordProtected);

        let dist = make_ctx(MobileDocFormat::Hwpx, false, true);
        let err = svc
            .begin(&dist, "report.pdf", PdfStageTarget::Share, Some(100), &bridge)
            .unwrap_err();
        assert_eq!(err.code, MobileErrorCode::PasswordProtected);
    }

    #[test]
    fn stages_chunks_and_prints_then_cleans_up_temp_file() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = HostFileBridge::new();
        bridge.set_cache_dir(tmp.path());
        let svc = PrintStagingService::new();
        let ctx = make_ctx(MobileDocFormat::Md, false, false);

        let stage_id = svc
            .begin(&ctx, "notes.md", PdfStageTarget::Print, None, &bridge)
            .unwrap();
        let pdf = sample_pdf();
        svc.append(&stage_id, &B64.encode(&pdf[..10])).unwrap();
        svc.append(&stage_id, &B64.encode(&pdf[10..])).unwrap();
        svc.finish(&stage_id, "sess-1", MobileDocFormat::Md, &bridge).unwrap();

        let jobs = bridge.printed_pdfs();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].0, "notes.pdf");
        assert_eq!(jobs[0].1, pdf);

        // HostFileBridge removes the staged print file on finish, mirroring native onFinish.
        let print_dir = tmp.path().join(PRINT_WORK_RELATIVE_DIR);
        let remaining: Vec<_> = std::fs::read_dir(&print_dir).unwrap().collect();
        assert!(remaining.is_empty());
    }

    #[test]
    fn stages_chunks_and_shares_pdf_with_pdf_mime() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = HostFileBridge::new();
        bridge.set_cache_dir(tmp.path());
        let svc = PrintStagingService::new();
        let ctx = make_ctx(MobileDocFormat::Html, false, false);

        let stage_id = svc
            .begin(&ctx, "page.html", PdfStageTarget::Share, None, &bridge)
            .unwrap();
        let pdf = sample_pdf();
        svc.append(&stage_id, &B64.encode(&pdf)).unwrap();
        svc.finish(&stage_id, "sess-1", MobileDocFormat::Md, &bridge).unwrap();

        let shared = bridge.last_shared_meta().expect("shared PDF");
        assert_eq!(shared.0, "page.pdf");
        assert_eq!(shared.1, "application/pdf");
        assert_eq!(shared.2, pdf);
    }

    #[test]
    fn rejects_non_pdf_header_and_cleans_stage() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = HostFileBridge::new();
        bridge.set_cache_dir(tmp.path());
        let svc = PrintStagingService::new();
        let ctx = make_ctx(MobileDocFormat::Md, false, false);

        let stage_id = svc
            .begin(&ctx, "fake.pdf", PdfStageTarget::Print, None, &bridge)
            .unwrap();
        let err = svc.append(&stage_id, &B64.encode(b"NOTAPDF")).unwrap_err();
        assert_eq!(err.message_key, "mobile.print.invalidPdf");
        assert!(svc.finish(&stage_id, "sess-1", MobileDocFormat::Md, &bridge).is_err());
    }

    #[test]
    fn rejects_oversized_pdf_on_begin() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = HostFileBridge::new();
        bridge.set_cache_dir(tmp.path());
        let svc = PrintStagingService::new();
        let ctx = make_ctx(MobileDocFormat::Hwp, false, false);

        let err = svc
            .begin(
                &ctx,
                "huge.pdf",
                PdfStageTarget::Print,
                Some(MAX_PRINT_PDF_BYTES + 1),
                &bridge,
            )
            .unwrap_err();
        assert_eq!(err.message_key, "mobile.print.tooLarge");
    }

    #[test]
    fn direct_session_pdf_print_streams_original_and_blocks_encrypted_pdf() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = HostFileBridge::new();
        bridge.set_cache_dir(tmp.path());
        let svc = PrintStagingService::new();

        let plain_uri = "content://docs/plain.pdf";
        bridge.set_next_pick_open(MockPickedDoc {
            uri: plain_uri.to_string(),
            name: "plain.pdf".to_string(),
            bytes: sample_pdf(),
            writable: true,
            ephemeral: false,
        });
        let plain_ctx = PrintSessionContext {
            session_id: "s-plain".to_string(),
            format: MobileDocFormat::Pdf,
            name: "plain.pdf".to_string(),
            uri: Some(plain_uri.to_string()),
            local: None,
            encrypted: false,
            distribution: false,
        };
        svc.print_unmodified_session_pdf(&plain_ctx, &bridge)
            .unwrap();
        assert_eq!(bridge.printed_pdfs().len(), 1);

        let enc_uri = "content://docs/locked.pdf";
        bridge.set_next_pick_open(MockPickedDoc {
            uri: enc_uri.to_string(),
            name: "locked.pdf".to_string(),
            bytes: b"%PDF-1.7\ntrailer << /Root 1 0 R /Encrypt 2 0 R >>\n%%EOF".to_vec(),
            writable: true,
            ephemeral: false,
        });
        let enc_ctx = PrintSessionContext {
            session_id: "s-enc".to_string(),
            format: MobileDocFormat::Pdf,
            name: "locked.pdf".to_string(),
            uri: Some(enc_uri.to_string()),
            local: None,
            encrypted: false,
            distribution: false,
        };
        let err = svc
            .print_unmodified_session_pdf(&enc_ctx, &bridge)
            .unwrap_err();
        assert_eq!(err.code, MobileErrorCode::PasswordProtected);
        assert_eq!(bridge.printed_pdfs().len(), 1);
    }
}
