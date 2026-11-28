//! Track T3 (pdf tools) Tauri commands.
//!
//! A PDF tool result lives only in WebView memory. These commands hand it to the OS share
//! sheet or write it to a place the person picks in the system save dialog. They never touch
//! the active document session, the recent documents list or recovery copies: they only use
//! the native file bridge, never `MobileFileService`.

use crate::commands::files::OkResult;
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_ieum_mobile::fs::{NativeFileBridge, NativeFsError, NativeFsErrorKind};
use tauri_plugin_ieum_mobile::resolve_file_bridge;

/// MIME types a PDF tool result may carry (PDF, extracted text, split ZIP).
pub const PDF_TOOLS_ALLOWED_MIMES: [&str; 3] = ["application/pdf", "text/plain", "application/zip"];

/// Result of saving a copy: the file name the OS reports for the picked location.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToolsSaveCopyResult {
    pub name: String,
}

fn map_bridge_error(err: NativeFsError) -> MobileError {
    // Same codes and message keys as the storage service uses for the same bridge failures.
    match err.kind {
        NativeFsErrorKind::UserCancelled => {
            MobileError::with_detail(MobileErrorCode::UserCancelled, "mobile.fs.cancelled", err.detail)
        }
        NativeFsErrorKind::PermissionDenied => MobileError::with_detail(
            MobileErrorCode::PermissionDenied,
            "mobile.fs.permissionDenied",
            err.detail,
        ),
        NativeFsErrorKind::ReadOnlyUri => {
            MobileError::with_detail(MobileErrorCode::ReadOnlyUri, "mobile.fs.readOnly", err.detail)
        }
        NativeFsErrorKind::IoError => {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", err.detail)
        }
    }
}

async fn run_blocking<T, F>(op: F) -> MobileResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> MobileResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(op)
        .await
        .map_err(|e| MobileError::with_detail(MobileErrorCode::InternalError, "mobile.internalError", e.to_string()))?
}

/// Removes path separators and control characters and trims the ends. A name left empty,
/// or made only of dots, is rejected.
pub fn sanitize_tool_file_name(name: &str) -> MobileResult<String> {
    let cleaned: String = name
        .chars()
        .filter(|c| *c != '/' && *c != '\\' && !c.is_control())
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned.chars().all(|c| c == '.') {
        return Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.pdfTools.invalidName",
            "result file name is empty",
        ));
    }
    Ok(cleaned.to_string())
}

/// Checks the MIME type, the name and the base64 payload before any bridge call.
fn prepare(suggested_name: &str, mime: &str, bytes_base64: &str) -> MobileResult<(String, Vec<u8>)> {
    if !PDF_TOOLS_ALLOWED_MIMES.contains(&mime) {
        return Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.pdfTools.mimeNotAllowed",
            mime.to_string(),
        ));
    }
    let name = sanitize_tool_file_name(suggested_name)?;
    let bytes = B64.decode(bytes_base64).map_err(|e| {
        MobileError::with_detail(MobileErrorCode::InvalidArgument, "mobile.decode.base64", e.to_string())
    })?;
    Ok((name, bytes))
}

/// Sends a tool result to the OS share sheet.
pub fn share_tool_result(
    bridge: &dyn NativeFileBridge,
    suggested_name: &str,
    mime: &str,
    bytes_base64: &str,
) -> MobileResult<()> {
    let (name, bytes) = prepare(suggested_name, mime, bytes_base64)?;
    bridge
        .share_file_bytes(&name, mime, &bytes)
        .map_err(map_bridge_error)
}

/// Asks the system save dialog for a place and writes the tool result there.
pub fn save_tool_result_copy(
    bridge: &dyn NativeFileBridge,
    suggested_name: &str,
    mime: &str,
    bytes_base64: &str,
) -> MobileResult<PdfToolsSaveCopyResult> {
    let (name, bytes) = prepare(suggested_name, mime, bytes_base64)?;
    let picked = bridge
        .create_save_file(&name, mime)
        .map_err(map_bridge_error)?;
    bridge
        .write_uri_bytes_atomic(&picked.uri, &bytes)
        .map_err(map_bridge_error)?;
    let saved_name = if picked.name.trim().is_empty() { name } else { picked.name };
    Ok(PdfToolsSaveCopyResult { name: saved_name })
}

#[tauri::command]
pub async fn mobile_pdf_tools_share<R: Runtime>(
    app: AppHandle<R>,
    suggested_name: String,
    mime: String,
    bytes_base64: String,
) -> MobileResult<OkResult> {
    let bridge = resolve_file_bridge(&app);
    run_blocking(move || {
        share_tool_result(bridge.as_ref(), &suggested_name, &mime, &bytes_base64)?;
        Ok(OkResult { ok: true })
    })
    .await
}

#[tauri::command]
pub async fn mobile_pdf_tools_save_copy<R: Runtime>(
    app: AppHandle<R>,
    suggested_name: String,
    mime: String,
    bytes_base64: String,
) -> MobileResult<PdfToolsSaveCopyResult> {
    let bridge = resolve_file_bridge(&app);
    run_blocking(move || save_tool_result_copy(bridge.as_ref(), &suggested_name, &mime, &bytes_base64))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MobileFileService;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tauri_plugin_ieum_mobile::fs::{
        FolderGrantState, HostFileBridge, MockPickedDoc, NativeDirs, NativeFolderEntry,
        NativeHomeError, NativeHomeErrorKind, NativeIncomingBatch, PickedFile, PickedFolder,
    };

    /// Records every bridge call; the save dialog can be set to report a cancel.
    #[derive(Default)]
    struct RecordingBridge {
        cancel_save: bool,
        shared: Mutex<Vec<(String, String, Vec<u8>)>>,
        save_requests: Mutex<Vec<(String, String)>>,
        writes: Mutex<Vec<(String, Vec<u8>)>>,
    }

    impl NativeFileBridge for RecordingBridge {
        fn pick_open_file(&self, _exts: &[String]) -> Result<PickedFile, NativeFsError> {
            panic!("pdf tools must not open files")
        }

        fn create_save_file(
            &self,
            suggested_name: &str,
            mime: &str,
        ) -> Result<PickedFile, NativeFsError> {
            self.save_requests
                .lock()
                .unwrap()
                .push((suggested_name.to_string(), mime.to_string()));
            if self.cancel_save {
                return Err(NativeFsError::new(NativeFsErrorKind::UserCancelled, "closed"));
            }
            Ok(PickedFile {
                uri: format!("content://picked/{suggested_name}"),
                name: format!("picked-{suggested_name}"),
                writable: true,
                ephemeral: false,
            })
        }

        fn open_persistent_uri(&self, _uri: &str) -> Result<PickedFile, NativeFsError> {
            panic!("pdf tools must not reopen persistent URIs")
        }

        fn read_uri_bytes(&self, _uri: &str) -> Result<Vec<u8>, NativeFsError> {
            panic!("pdf tools must not read URIs")
        }

        fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError> {
            self.writes.lock().unwrap().push((uri.to_string(), bytes.to_vec()));
            Ok(())
        }

        fn share_file_bytes(
            &self,
            suggested_name: &str,
            mime: &str,
            bytes: &[u8],
        ) -> Result<(), NativeFsError> {
            self.shared.lock().unwrap().push((
                suggested_name.to_string(),
                mime.to_string(),
                bytes.to_vec(),
            ));
            Ok(())
        }

        fn take_pending_open_intent(&self) -> Option<PickedFile> {
            None
        }

        fn copy_uri_to_file(&self, _uri: &str, _dest: &Path) -> Result<u64, NativeFsError> {
            Err(NativeFsError::new(
                NativeFsErrorKind::IoError,
                "unused in pdf_tools tests",
            ))
        }

        fn stream_file_to_uri(&self, _uri: &str, _src: &Path) -> Result<u64, NativeFsError> {
            Err(NativeFsError::new(
                NativeFsErrorKind::IoError,
                "unused in pdf_tools tests",
            ))
        }

        fn pick_folder(&self) -> Result<PickedFolder, NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn release_folder(&self, _folder_uri: &str) -> Result<(), NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn check_folder_grant(&self, _folder_uri: &str) -> FolderGrantState {
            FolderGrantState::Revoked
        }

        fn list_folder(
            &self,
            _folder_uri: &str,
            _sub_path: &[String],
        ) -> Result<Vec<NativeFolderEntry>, NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn rename_document(&self, _uri: &str, _new_name: &str) -> Result<String, NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn copy_document(&self, _uri: &str, _new_name: &str) -> Result<String, NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn delete_document(&self, _uri: &str) -> Result<(), NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn share_files(&self, _uris: &[String]) -> Result<(), NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn take_incoming_batch(&self) -> Option<NativeIncomingBatch> {
            None
        }

        fn set_keep_screen_on(&self, _on: bool) -> Result<(), NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn open_external_url(&self, _url: &str) -> Result<(), NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }

        fn native_dirs(&self) -> Result<NativeDirs, NativeHomeError> {
            Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "unused in pdf_tools tests",
            ))
        }
    }

    fn b64(bytes: &[u8]) -> String {
        B64.encode(bytes)
    }

    #[test]
    fn share_sends_the_decoded_bytes_with_name_and_mime() {
        let bridge = RecordingBridge::default();
        share_tool_result(&bridge, "merged.pdf", "application/pdf", &b64(b"%PDF-1.7 body"))
            .unwrap();
        let shared = bridge.shared.lock().unwrap();
        assert_eq!(shared.len(), 1);
        assert_eq!(shared[0].0, "merged.pdf");
        assert_eq!(shared[0].1, "application/pdf");
        assert_eq!(shared[0].2, b"%PDF-1.7 body".to_vec());
        assert!(bridge.save_requests.lock().unwrap().is_empty());
    }

    #[test]
    fn share_accepts_text_and_zip_results() {
        let bridge = RecordingBridge::default();
        share_tool_result(&bridge, "a.txt", "text/plain", &b64(b"hello")).unwrap();
        share_tool_result(&bridge, "a-split.zip", "application/zip", &b64(b"PK\x03\x04")).unwrap();
        assert_eq!(bridge.shared.lock().unwrap().len(), 2);
    }

    #[test]
    fn save_writes_the_bytes_to_the_picked_uri_and_returns_the_picked_name() {
        let bridge = RecordingBridge::default();
        let res =
            save_tool_result_copy(&bridge, "split-1.pdf", "application/pdf", &b64(b"%PDF-x"))
                .unwrap();
        assert_eq!(res, PdfToolsSaveCopyResult { name: "picked-split-1.pdf".into() });
        assert_eq!(
            *bridge.save_requests.lock().unwrap(),
            vec![("split-1.pdf".to_string(), "application/pdf".to_string())]
        );
        assert_eq!(
            *bridge.writes.lock().unwrap(),
            vec![("content://picked/split-1.pdf".to_string(), b"%PDF-x".to_vec())]
        );
        assert!(bridge.shared.lock().unwrap().is_empty());
    }

    #[test]
    fn save_accepts_an_empty_result() {
        let bridge = RecordingBridge::default();
        save_tool_result_copy(&bridge, "empty.txt", "text/plain", "").unwrap();
        assert_eq!(bridge.writes.lock().unwrap()[0].1, Vec::<u8>::new());
    }

    #[test]
    fn closing_the_save_dialog_is_user_cancelled_and_writes_nothing() {
        let bridge = RecordingBridge { cancel_save: true, ..Default::default() };
        let err = save_tool_result_copy(&bridge, "out.pdf", "application/pdf", &b64(b"x"))
            .unwrap_err();
        assert_eq!(err.code, MobileErrorCode::UserCancelled);
        assert_eq!(err.message_key, "mobile.fs.cancelled");
        assert!(bridge.writes.lock().unwrap().is_empty());
    }

    #[test]
    fn save_leaves_the_active_session_recent_list_and_recovery_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = Arc::new(HostFileBridge::new());
        let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();
        bridge.set_next_pick_open(MockPickedDoc {
            uri: "content://docs/base.pdf".into(),
            name: "base.pdf".into(),
            bytes: b"%PDF-base".to_vec(),
            writable: true,
            ephemeral: false,
        });
        let base = svc.pick_open_file(&["pdf".into()]).unwrap();
        let recents_before = svc.list_recent_docs().unwrap();
        let recovery_before = svc.recovery_list().unwrap();

        let res = save_tool_result_copy(
            bridge.as_ref(),
            "base-compressed.pdf",
            "application/pdf",
            &b64(b"%PDF-small"),
        )
        .unwrap();
        assert_eq!(res.name, "base-compressed.pdf");
        assert_eq!(
            bridge.read_stored_uri("host://saved/base-compressed.pdf"),
            Some(b"%PDF-small".to_vec())
        );
        share_tool_result(bridge.as_ref(), "base-compressed.pdf", "application/pdf", &b64(b"z"))
            .unwrap();

        // read_file_bytes only succeeds for the active session, so the opened document is still active.
        let read = svc.read_file_bytes(&base.session_id).unwrap();
        assert_eq!(B64.decode(read.bytes_base64).unwrap(), b"%PDF-base".to_vec());
        let recents_after = svc.list_recent_docs().unwrap();
        assert_eq!(recents_after.len(), recents_before.len());
        assert_eq!(recents_after[0].doc_key, base.doc_key);
        assert_eq!(svc.recovery_list().unwrap().len(), recovery_before.len());
        // The original file is not overwritten.
        assert_eq!(
            bridge.read_stored_uri("content://docs/base.pdf"),
            Some(b"%PDF-base".to_vec())
        );
    }

    #[test]
    fn other_mime_types_are_invalid_arguments_and_reach_no_bridge_call() {
        let bridge = RecordingBridge::default();
        for mime in ["application/x-hwp", "text/html", "", "APPLICATION/PDF", "application/pdf; x"] {
            let err = share_tool_result(&bridge, "a.pdf", mime, &b64(b"x")).unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument, "share {mime}");
            assert_eq!(err.message_key, "mobile.pdfTools.mimeNotAllowed");
            let err = save_tool_result_copy(&bridge, "a.pdf", mime, &b64(b"x")).unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument, "save {mime}");
        }
        assert!(bridge.shared.lock().unwrap().is_empty());
        assert!(bridge.save_requests.lock().unwrap().is_empty());
    }

    #[test]
    fn names_lose_path_separators_and_control_characters() {
        assert_eq!(sanitize_tool_file_name("../../etc/passwd.pdf").unwrap(), "....etcpasswd.pdf");
        assert_eq!(sanitize_tool_file_name("a\\b/c.pdf").unwrap(), "abc.pdf");
        assert_eq!(sanitize_tool_file_name("line\nbreak\t\u{0}.txt").unwrap(), "linebreak.txt");
        assert_eq!(sanitize_tool_file_name("  보고서-split.zip  ").unwrap(), "보고서-split.zip");

        let bridge = RecordingBridge::default();
        save_tool_result_copy(&bridge, "dir/sub\\out\u{7}.pdf", "application/pdf", &b64(b"x"))
            .unwrap();
        share_tool_result(&bridge, "dir/out.pdf", "application/pdf", &b64(b"x")).unwrap();
        assert_eq!(bridge.save_requests.lock().unwrap()[0].0, "dirsubout.pdf");
        assert_eq!(bridge.shared.lock().unwrap()[0].0, "dirout.pdf");
    }

    #[test]
    fn empty_names_are_invalid_arguments() {
        let bridge = RecordingBridge::default();
        for name in ["", "   ", "///", "\\\n", "..", "."] {
            let err = sanitize_tool_file_name(name).unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument, "{name:?}");
            assert_eq!(err.message_key, "mobile.pdfTools.invalidName");
            let err = save_tool_result_copy(&bridge, name, "application/pdf", &b64(b"x"))
                .unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument);
            let err = share_tool_result(&bridge, name, "application/pdf", &b64(b"x")).unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument);
        }
        assert!(bridge.save_requests.lock().unwrap().is_empty());
        assert!(bridge.shared.lock().unwrap().is_empty());
    }

    #[test]
    fn bad_base64_is_an_invalid_argument_and_reaches_no_bridge_call() {
        let bridge = RecordingBridge::default();
        let err = share_tool_result(&bridge, "a.pdf", "application/pdf", "not base64!").unwrap_err();
        assert_eq!(err.code, MobileErrorCode::InvalidArgument);
        assert_eq!(err.message_key, "mobile.decode.base64");
        let err =
            save_tool_result_copy(&bridge, "a.pdf", "application/pdf", "@@@").unwrap_err();
        assert_eq!(err.code, MobileErrorCode::InvalidArgument);
        assert_eq!(err.message_key, "mobile.decode.base64");
        assert!(bridge.shared.lock().unwrap().is_empty());
        assert!(bridge.save_requests.lock().unwrap().is_empty());
    }
}
