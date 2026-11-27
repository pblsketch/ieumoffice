//! The file-based write path: documents are written from a local file (no size-limited base64
//! argument) and a failed or wrong write puts the original back.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri_plugin_ieum_mobile::fs::{
    HostFileBridge, MockPickedDoc, NativeFileBridge, NativeFsError, NativeFsErrorKind,
    write_new_uri_from_file, write_uri_from_file,
};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn work_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ieum-safe-write-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn bridge_with(uri: &str, bytes: &[u8]) -> HostFileBridge {
    let bridge = HostFileBridge::new();
    bridge.set_next_pick_open(MockPickedDoc {
        uri: uri.to_string(),
        name: "doc.xlsx".to_string(),
        bytes: bytes.to_vec(),
        writable: true,
        ephemeral: false,
    });
    bridge
}

/// A payload larger than the 20,000,000-character limit Android puts on one string argument
/// once base64-encoded (about 14.3 MiB of file).
fn big_payload() -> Vec<u8> {
    (0..31_000_000u32)
        .map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8)
        .collect()
}

fn left_over_files(dir: &PathBuf) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

#[test]
fn copies_a_document_into_a_file_byte_for_byte() {
    let dir = work_dir();
    let original = big_payload();
    let bridge = bridge_with("content://docs/big.xlsx", &original);
    let dest = dir.join("copy.bin");
    let n = bridge
        .copy_uri_to_file("content://docs/big.xlsx", &dest)
        .unwrap();
    assert_eq!(n, original.len() as u64);
    assert!(std::fs::read(&dest).unwrap() == original);
}

#[test]
fn writes_a_large_file_exactly_and_leaves_no_temp_files() {
    let dir = work_dir();
    let bridge = bridge_with("content://docs/big.xlsx", b"old contents");
    let src = dir.join("new.bin");
    let payload = big_payload();
    std::fs::write(&src, &payload).unwrap();
    let scratch = dir.join("work");

    write_uri_from_file(&bridge, "content://docs/big.xlsx", &src, &scratch).unwrap();

    assert!(bridge.read_uri_bytes("content://docs/big.xlsx").unwrap() == payload);
    assert!(
        left_over_files(&scratch).is_empty(),
        "{:?}",
        left_over_files(&scratch)
    );
}

#[test]
fn a_write_that_breaks_halfway_puts_the_original_back() {
    let dir = work_dir();
    let original = b"the original document bytes".to_vec();
    let bridge = bridge_with("content://docs/a.hwp", &original);
    let src = dir.join("new.bin");
    std::fs::write(&src, vec![7u8; 4096]).unwrap();
    // the provider truncates, takes 100 bytes, then fails
    bridge.fail_next_stream_after(100);

    let err =
        write_uri_from_file(&bridge, "content://docs/a.hwp", &src, &dir.join("work")).unwrap_err();

    assert_eq!(err.kind, NativeFsErrorKind::IoError);
    assert!(err.detail.contains("original restored"), "{}", err.detail);
    assert_eq!(
        bridge.read_uri_bytes("content://docs/a.hwp").unwrap(),
        original
    );
    assert!(left_over_files(&dir.join("work")).is_empty());
}

#[test]
fn a_write_that_silently_differs_is_caught_and_rolled_back() {
    let dir = work_dir();
    let original = b"keep me".to_vec();
    let bridge = bridge_with("content://docs/b.md", &original);
    let src = dir.join("new.bin");
    std::fs::write(&src, b"new text that the provider mangles").unwrap();
    bridge.corrupt_next_stream();

    let err =
        write_uri_from_file(&bridge, "content://docs/b.md", &src, &dir.join("work")).unwrap_err();

    assert_eq!(err.kind, NativeFsErrorKind::IoError);
    assert!(err.detail.contains("differs"), "{}", err.detail);
    assert_eq!(
        bridge.read_uri_bytes("content://docs/b.md").unwrap(),
        original
    );
}

#[test]
fn keeps_the_rollback_copy_when_the_original_cannot_be_put_back() {
    let dir = work_dir();
    let original = b"precious".to_vec();
    let bridge = bridge_with("content://docs/c.md", &original);
    let src = dir.join("new.bin");
    std::fs::write(&src, vec![1u8; 512]).unwrap();
    bridge.fail_next_stream_after(10);
    bridge.fail_stream_after_next(0);

    let err =
        write_uri_from_file(&bridge, "content://docs/c.md", &src, &dir.join("work")).unwrap_err();

    assert!(err.detail.contains("NOT restored"), "{}", err.detail);
    let kept = left_over_files(&dir.join("work"));
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert_eq!(
        std::fs::read(dir.join("work").join(&kept[0])).unwrap(),
        original
    );
}

#[test]
fn does_not_touch_a_document_it_cannot_read_first() {
    let dir = work_dir();
    let bridge = bridge_with("content://docs/d.md", b"old");
    bridge.revoke_uri("content://docs/d.md");
    let src = dir.join("new.bin");
    std::fs::write(&src, b"new").unwrap();

    let err =
        write_uri_from_file(&bridge, "content://docs/d.md", &src, &dir.join("work")).unwrap_err();

    assert_eq!(err.kind, NativeFsErrorKind::PermissionDenied);
    assert_eq!(bridge.stream_count(), 0);
}

#[test]
fn write_new_uri_skips_preread_for_uninitialized_cloud_documents_and_verifies_after_write() {
    struct UnreadableUntilWritten {
        inner: HostFileBridge,
    }
    impl NativeFileBridge for UnreadableUntilWritten {
        fn pick_open_file(
            &self,
            exts: &[String],
        ) -> Result<tauri_plugin_ieum_mobile::fs::PickedFile, NativeFsError> {
            self.inner.pick_open_file(exts)
        }
        fn create_save_file(
            &self,
            suggested_name: &str,
            mime: &str,
        ) -> Result<tauri_plugin_ieum_mobile::fs::PickedFile, NativeFsError> {
            self.inner.create_save_file(suggested_name, mime)
        }
        fn open_persistent_uri(
            &self,
            uri: &str,
        ) -> Result<tauri_plugin_ieum_mobile::fs::PickedFile, NativeFsError> {
            self.inner.open_persistent_uri(uri)
        }
        fn read_uri_bytes(&self, uri: &str) -> Result<Vec<u8>, NativeFsError> {
            self.inner.read_uri_bytes(uri)
        }
        fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError> {
            self.inner.write_uri_bytes_atomic(uri, bytes)
        }
        fn copy_uri_to_file(&self, uri: &str, dest: &std::path::Path) -> Result<u64, NativeFsError> {
            if self.inner.stream_count() == 0 {
                return Err(NativeFsError::new(
                    NativeFsErrorKind::IoError,
                    "uninitialized cloud document cannot be read before first write",
                ));
            }
            self.inner.copy_uri_to_file(uri, dest)
        }
        fn stream_file_to_uri(
            &self,
            uri: &str,
            src: &std::path::Path,
        ) -> Result<u64, NativeFsError> {
            self.inner.stream_file_to_uri(uri, src)
        }
        fn share_file_bytes(
            &self,
            suggested_name: &str,
            mime: &str,
            bytes: &[u8],
        ) -> Result<(), NativeFsError> {
            self.inner.share_file_bytes(suggested_name, mime, bytes)
        }
        fn take_pending_open_intent(
            &self,
        ) -> Option<tauri_plugin_ieum_mobile::fs::PickedFile> {
            self.inner.take_pending_open_intent()
        }
        fn pick_folder(
            &self,
        ) -> Result<
            tauri_plugin_ieum_mobile::fs::PickedFolder,
            tauri_plugin_ieum_mobile::fs::NativeHomeError,
        > {
            self.inner.pick_folder()
        }
        fn release_folder(
            &self,
            tree_uri: &str,
        ) -> Result<(), tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.release_folder(tree_uri)
        }
        fn check_folder_grant(
            &self,
            tree_uri: &str,
        ) -> tauri_plugin_ieum_mobile::fs::FolderGrantState {
            self.inner.check_folder_grant(tree_uri)
        }
        fn list_folder(
            &self,
            tree_uri: &str,
            sub_path: &[String],
        ) -> Result<
            Vec<tauri_plugin_ieum_mobile::fs::NativeFolderEntry>,
            tauri_plugin_ieum_mobile::fs::NativeHomeError,
        > {
            self.inner.list_folder(tree_uri, sub_path)
        }
        fn rename_document(
            &self,
            uri: &str,
            new_name: &str,
        ) -> Result<String, tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.rename_document(uri, new_name)
        }
        fn copy_document(
            &self,
            uri: &str,
            new_name: &str,
        ) -> Result<String, tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.copy_document(uri, new_name)
        }
        fn delete_document(
            &self,
            uri: &str,
        ) -> Result<(), tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.delete_document(uri)
        }
        fn share_files(
            &self,
            paths: &[String],
        ) -> Result<(), tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.share_files(paths)
        }
        fn take_incoming_batch(
            &self,
        ) -> Option<tauri_plugin_ieum_mobile::fs::NativeIncomingBatch> {
            self.inner.take_incoming_batch()
        }
        fn set_keep_screen_on(
            &self,
            on: bool,
        ) -> Result<(), tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.set_keep_screen_on(on)
        }
        fn open_external_url(
            &self,
            url: &str,
        ) -> Result<(), tauri_plugin_ieum_mobile::fs::NativeHomeError> {
            self.inner.open_external_url(url)
        }
        fn native_dirs(
            &self,
        ) -> Result<
            tauri_plugin_ieum_mobile::fs::NativeDirs,
            tauri_plugin_ieum_mobile::fs::NativeHomeError,
        > {
            self.inner.native_dirs()
        }
    }

    let dir = work_dir();
    let inner = HostFileBridge::new();
    inner.set_next_save_as_uri("content://cloud/new.pdf");
    let created = inner
        .create_save_file("new.pdf", "application/pdf")
        .unwrap();
    let bridge = UnreadableUntilWritten { inner };
    let src = dir.join("payload.pdf");
    std::fs::write(&src, b"%PDF-1.7 new cloud document").unwrap();
    let scratch = dir.join("work");

    write_new_uri_from_file(&bridge, &created.uri, &src, &scratch).unwrap();

    assert_eq!(
        bridge.inner.read_uri_bytes(&created.uri).unwrap(),
        b"%PDF-1.7 new cloud document"
    );
    assert!(left_over_files(&scratch).is_empty());
}
