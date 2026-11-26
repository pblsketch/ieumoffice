//! Slot for track T4 (html) Tauri commands.
//!
//! `mobile_web_save_new_file` writes an exported document (Word, ODT or Hangul) to a new file
//! picked with the system save dialog. It never touches the active session, the recent list or
//! the recovery copies held by `MobileFileService`, so the open document keeps saving to its own
//! file after an export.

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_ieum_mobile::fs::{NativeFileBridge, NativeFsError, NativeFsErrorKind};

/// Word `.docx` export MIME type.
pub const WEB_EXPORT_MIME_DOCX: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/// ODT `.odt` export MIME type.
pub const WEB_EXPORT_MIME_ODT: &str = "application/vnd.oasis.opendocument.text";
/// Hangul `.hwpx` export MIME type.
pub const WEB_EXPORT_MIME_HWPX: &str = "application/haansofthwpx";

/// The only MIME types a new-file export accepts.
pub const WEB_EXPORT_MIMES: [&str; 3] = [
    WEB_EXPORT_MIME_DOCX,
    WEB_EXPORT_MIME_ODT,
    WEB_EXPORT_MIME_HWPX,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNewFileResult {
    pub name: String,
}

/// T4 managed state: the same OS file bridge the file service uses, without its session state.
pub struct MobileWebState {
    bridge: Arc<dyn NativeFileBridge>,
}

impl MobileWebState {
    pub fn new(bridge: Arc<dyn NativeFileBridge>) -> Self {
        Self { bridge }
    }

    /// Validates the request, asks the OS for a new file and writes the bytes to it atomically.
    pub fn save_new_file(
        &self,
        suggested_name: &str,
        mime: &str,
        bytes_base64: &str,
    ) -> MobileResult<SaveNewFileResult> {
        // Validate everything before the dialog opens, so a bad request never asks the user anything.
        if !WEB_EXPORT_MIMES.contains(&mime) {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.web.exportMime",
                mime.to_string(),
            ));
        }
        let bytes = B64.decode(bytes_base64).map_err(|e| {
            MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.decode.base64",
                e.to_string(),
            )
        })?;
        let picked = self
            .bridge
            .create_save_file(suggested_name, mime)
            .map_err(map_fs_error)?;
        self.bridge
            .write_uri_bytes_atomic(&picked.uri, &bytes)
            .map_err(map_fs_error)?;
        Ok(SaveNewFileResult { name: picked.name })
    }
}

/// Same mapping as the file service uses for OS bridge failures (kept here because that one is private).
fn map_fs_error(err: NativeFsError) -> MobileError {
    match err.kind {
        NativeFsErrorKind::UserCancelled => MobileError::with_detail(
            MobileErrorCode::UserCancelled,
            "mobile.fs.cancelled",
            err.detail,
        ),
        NativeFsErrorKind::PermissionDenied => MobileError::with_detail(
            MobileErrorCode::PermissionDenied,
            "mobile.fs.permissionDenied",
            err.detail,
        ),
        NativeFsErrorKind::ReadOnlyUri => MobileError::with_detail(
            MobileErrorCode::ReadOnlyUri,
            "mobile.fs.readOnly",
            err.detail,
        ),
        NativeFsErrorKind::IoError => MobileError::with_detail(
            MobileErrorCode::InternalError,
            "mobile.fs.ioError",
            err.detail,
        ),
    }
}

async fn run_blocking_file_op<T, F>(op: F) -> MobileResult<T>
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

#[tauri::command]
pub async fn mobile_web_save_new_file(
    state: State<'_, Arc<MobileWebState>>,
    suggested_name: String,
    mime: String,
    bytes_base64: String,
) -> MobileResult<SaveNewFileResult> {
    let web = state.inner().clone();
    run_blocking_file_op(move || web.save_new_file(&suggested_name, &mime, &bytes_base64)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{MobileDocFormat, MobileFileService};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri_plugin_ieum_mobile::fs::{HostFileBridge, MockPickedDoc, PickedFile};

    /// Test bridge: the host bridge plus a switchable cancel on the save dialog and a call log.
    struct FakeBridge {
        inner: HostFileBridge,
        cancel_save: AtomicBool,
        save_dialogs: Mutex<Vec<(String, String)>>,
    }

    impl FakeBridge {
        fn new() -> Self {
            Self {
                inner: HostFileBridge::new(),
                cancel_save: AtomicBool::new(false),
                save_dialogs: Mutex::new(Vec::new()),
            }
        }

        fn dialog_calls(&self) -> Vec<(String, String)> {
            self.save_dialogs.lock().unwrap().clone()
        }
    }

    impl NativeFileBridge for FakeBridge {
        fn pick_open_file(&self, exts: &[String]) -> Result<PickedFile, NativeFsError> {
            self.inner.pick_open_file(exts)
        }

        fn create_save_file(
            &self,
            suggested_name: &str,
            mime: &str,
        ) -> Result<PickedFile, NativeFsError> {
            self.save_dialogs
                .lock()
                .unwrap()
                .push((suggested_name.to_string(), mime.to_string()));
            if self.cancel_save.load(Ordering::SeqCst) {
                return Err(NativeFsError::new(
                    NativeFsErrorKind::UserCancelled,
                    "save dialog dismissed",
                ));
            }
            self.inner.create_save_file(suggested_name, mime)
        }

        fn open_persistent_uri(&self, uri: &str) -> Result<PickedFile, NativeFsError> {
            self.inner.open_persistent_uri(uri)
        }

        fn read_uri_bytes(&self, uri: &str) -> Result<Vec<u8>, NativeFsError> {
            self.inner.read_uri_bytes(uri)
        }

        fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError> {
            self.inner.write_uri_bytes_atomic(uri, bytes)
        }

        fn share_file_bytes(
            &self,
            suggested_name: &str,
            mime: &str,
            bytes: &[u8],
        ) -> Result<(), NativeFsError> {
            self.inner.share_file_bytes(suggested_name, mime, bytes)
        }

        fn take_pending_open_intent(&self) -> Option<PickedFile> {
            self.inner.take_pending_open_intent()
        }
    }

    fn setup() -> (
        tempfile::TempDir,
        Arc<FakeBridge>,
        MobileFileService,
        MobileWebState,
    ) {
        let tmp = tempfile::tempdir().unwrap();
        let bridge = Arc::new(FakeBridge::new());
        let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();
        let web = MobileWebState::new(bridge.clone());
        (tmp, bridge, svc, web)
    }

    #[test]
    fn writes_the_bytes_to_the_picked_new_file() {
        let (_tmp, bridge, _svc, web) = setup();
        bridge
            .inner
            .set_next_save_as_uri("content://exports/note.docx");
        let bytes = vec![0x50u8, 0x4b, 0x03, 0x04, 1, 2, 3];

        let result = web
            .save_new_file("note.docx", WEB_EXPORT_MIME_DOCX, &B64.encode(&bytes))
            .unwrap();

        assert_eq!(
            result,
            SaveNewFileResult {
                name: "note.docx".into()
            }
        );
        assert_eq!(
            bridge.inner.read_stored_uri("content://exports/note.docx"),
            Some(bytes)
        );
        assert_eq!(
            bridge.dialog_calls(),
            vec![("note.docx".to_string(), WEB_EXPORT_MIME_DOCX.to_string())]
        );
    }

    #[test]
    fn accepts_each_of_the_three_export_mime_types() {
        let (_tmp, bridge, _svc, web) = setup();
        for (name, mime) in [
            ("a.docx", WEB_EXPORT_MIME_DOCX),
            ("a.odt", WEB_EXPORT_MIME_ODT),
            ("a.hwpx", WEB_EXPORT_MIME_HWPX),
        ] {
            let uri = format!("content://exports/{name}");
            bridge.inner.set_next_save_as_uri(uri.clone());
            web.save_new_file(name, mime, &B64.encode(b"x")).unwrap();
            assert_eq!(bridge.inner.read_stored_uri(&uri), Some(b"x".to_vec()));
        }
    }

    #[test]
    fn rejects_other_mime_types_without_opening_the_dialog() {
        let (_tmp, bridge, _svc, web) = setup();
        for mime in [
            "text/markdown",
            "text/html",
            "application/pdf",
            "",
            "APPLICATION/HAANSOFTHWPX",
        ] {
            let err = web
                .save_new_file("a.md", mime, &B64.encode(b"x"))
                .unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument, "mime {mime:?}");
        }
        assert!(bridge.dialog_calls().is_empty());
    }

    #[test]
    fn rejects_bad_base64_without_opening_the_dialog() {
        let (_tmp, bridge, _svc, web) = setup();
        let err = web
            .save_new_file("a.docx", WEB_EXPORT_MIME_DOCX, "not base64 !!")
            .unwrap_err();
        assert_eq!(err.code, MobileErrorCode::InvalidArgument);
        assert!(bridge.dialog_calls().is_empty());
    }

    #[test]
    fn cancelling_the_dialog_returns_user_cancelled_and_writes_nothing() {
        let (_tmp, bridge, _svc, web) = setup();
        bridge.cancel_save.store(true, Ordering::SeqCst);
        bridge
            .inner
            .set_next_save_as_uri("content://exports/never.docx");

        let err = web
            .save_new_file("never.docx", WEB_EXPORT_MIME_DOCX, &B64.encode(b"x"))
            .unwrap_err();

        assert_eq!(err.code, MobileErrorCode::UserCancelled);
        assert_eq!(err.message_key, "mobile.fs.cancelled");
        assert_eq!(
            bridge.inner.read_stored_uri("content://exports/never.docx"),
            None
        );
    }

    #[test]
    fn export_keeps_the_open_session_recent_list_and_recovery_copies() {
        let (_tmp, bridge, svc, web) = setup();
        bridge.inner.set_next_pick_open(MockPickedDoc {
            uri: "content://docs/note.md".into(),
            name: "note.md".into(),
            bytes: b"# Note\n".to_vec(),
            writable: true,
            ephemeral: false,
        });
        let session = svc.pick_open_file(&["md".into()]).unwrap();
        svc.recovery_write(
            &session.doc_key,
            MobileDocFormat::Md,
            "note.md",
            &B64.encode(b"# Draft\n"),
        )
        .unwrap();
        let recent_before = svc.list_recent_docs().unwrap();
        let recovery_before: Vec<String> = svc
            .recovery_list()
            .unwrap()
            .into_iter()
            .map(|e| e.doc_key)
            .collect();

        bridge
            .inner
            .set_next_save_as_uri("content://exports/note.hwpx");
        let result = web
            .save_new_file("note.hwpx", WEB_EXPORT_MIME_HWPX, &B64.encode(b"PK-hwpx"))
            .unwrap();
        assert_eq!(result.name, "note.hwpx");

        // Neither the recent list nor the recovery copies learned about the exported file.
        assert_eq!(svc.list_recent_docs().unwrap(), recent_before);
        let recovery_after: Vec<String> = svc
            .recovery_list()
            .unwrap()
            .into_iter()
            .map(|e| e.doc_key)
            .collect();
        assert_eq!(recovery_after, recovery_before);
        assert_eq!(
            svc.recovery_read(&session.doc_key).unwrap(),
            B64.encode(b"# Draft\n")
        );

        // The open markdown session is still the active one and still saves to its own file.
        let read = svc.read_file_bytes(&session.session_id).unwrap();
        assert_eq!(B64.decode(read.bytes_base64).unwrap(), b"# Note\n".to_vec());
        svc.save_file_bytes(&session.session_id, &B64.encode(b"# Note 2\n"), None)
            .unwrap();
        assert_eq!(
            bridge.inner.read_stored_uri("content://docs/note.md"),
            Some(b"# Note 2\n".to_vec())
        );
        assert_eq!(
            bridge.inner.read_stored_uri("content://exports/note.hwpx"),
            Some(b"PK-hwpx".to_vec())
        );
    }
}
