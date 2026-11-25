//! Contract tests for the home-screen native capabilities, driven through the in-memory
//! `HostFileBridge`. The Android and iOS implementations follow the same contract.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri_plugin_ieum_mobile::fs::{
    FolderGrantState, HostFileBridge, INCOMING_RELATIVE_DIR, MockIncomingFile, MockPickedDoc,
    NativeFileBridge, NativeFsErrorKind, NativeHomeErrorKind, is_https_url,
};

const TREE: &str = "host://tree/Docs";

static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);

/// A fresh cache directory per test, removed when dropped.
struct TempCache(PathBuf);

impl TempCache {
    fn new() -> Self {
        let n = NEXT_DIR.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("ieum-plugin-home-test-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempCache {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A bridge with one linked folder: `Docs/{a.hwp, b.md, Sub/c.pdf}`.
fn linked_bridge() -> HostFileBridge {
    let bridge = HostFileBridge::new();
    bridge.add_tree(TREE, "Docs");
    bridge.add_tree_file(TREE, "a.hwp", b"hwp-bytes", "application/x-hwp", 100);
    bridge.add_tree_file(TREE, "b.md", b"# md", "text/markdown", 200);
    bridge.add_tree_dir(TREE, "Sub");
    bridge.add_tree_file(TREE, "Sub/c.pdf", b"%PDF", "application/pdf", 300);
    bridge.set_next_pick_folder(TREE);
    let picked = bridge.pick_folder().unwrap();
    assert_eq!(picked.uri, TREE);
    bridge
}

fn names(entries: &[tauri_plugin_ieum_mobile::fs::NativeFolderEntry]) -> Vec<String> {
    let mut out: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    out.sort();
    out
}

fn uri_of(bridge: &HostFileBridge, sub: &[&str], name: &str) -> String {
    let sub: Vec<String> = sub.iter().map(|s| s.to_string()).collect();
    bridge
        .list_folder(TREE, &sub)
        .unwrap()
        .into_iter()
        .find(|e| e.name == name)
        .unwrap_or_else(|| panic!("{name} not listed"))
        .uri
}

#[test]
fn pick_folder_without_a_choice_is_cancelled() {
    let bridge = HostFileBridge::new();
    let err = bridge.pick_folder().unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::UserCancelled);
}

#[test]
fn picked_folder_has_a_live_grant_until_released_revoked_or_removed() {
    let bridge = HostFileBridge::new();
    bridge.set_next_pick_folder("host://tree/School");
    let picked = bridge.pick_folder().unwrap();
    assert_eq!(picked.uri, "host://tree/School");
    assert_eq!(picked.name, "School");
    assert_eq!(
        bridge.check_folder_grant(&picked.uri),
        FolderGrantState::Alive
    );
    assert!(bridge.is_tree_granted(&picked.uri));

    bridge.release_folder(&picked.uri).unwrap();
    assert_eq!(
        bridge.check_folder_grant(&picked.uri),
        FolderGrantState::Revoked
    );
    assert!(!bridge.is_tree_granted(&picked.uri));
    // Releasing twice (or an unknown folder) is not an error.
    bridge.release_folder(&picked.uri).unwrap();
    bridge.release_folder("host://tree/Unknown").unwrap();

    // Picking the same folder again restores the grant.
    bridge.set_next_pick_folder("host://tree/School");
    bridge.pick_folder().unwrap();
    assert_eq!(
        bridge.check_folder_grant(&picked.uri),
        FolderGrantState::Alive
    );

    bridge.revoke_tree(&picked.uri);
    assert_eq!(
        bridge.check_folder_grant(&picked.uri),
        FolderGrantState::Revoked
    );

    bridge.set_next_pick_folder("host://tree/School");
    bridge.pick_folder().unwrap();
    bridge.remove_tree(&picked.uri);
    assert_eq!(
        bridge.check_folder_grant(&picked.uri),
        FolderGrantState::Missing
    );
    assert_eq!(
        bridge.check_folder_grant("host://tree/Never"),
        FolderGrantState::Missing
    );
}

#[test]
fn list_folder_returns_children_with_metadata() {
    let bridge = linked_bridge();
    let root = bridge.list_folder(TREE, &[]).unwrap();
    assert_eq!(names(&root), vec!["Sub", "a.hwp", "b.md"]);
    let a = root.iter().find(|e| e.name == "a.hwp").unwrap();
    assert!(!a.is_dir);
    assert_eq!(a.mime.as_deref(), Some("application/x-hwp"));
    assert_eq!(a.size_bytes, Some(9));
    assert_eq!(a.modified_ms, Some(100));
    let sub = root.iter().find(|e| e.name == "Sub").unwrap();
    assert!(sub.is_dir);
    assert_eq!(sub.mime, None);
    assert_ne!(a.uri, sub.uri);

    let inner = bridge.list_folder(TREE, &["Sub".to_string()]).unwrap();
    assert_eq!(names(&inner), vec!["c.pdf"]);
    assert_eq!(inner[0].modified_ms, Some(300));
}

#[test]
fn list_folder_refuses_missing_sub_paths_and_lost_grants() {
    let bridge = linked_bridge();
    let err = bridge.list_folder(TREE, &["Nope".to_string()]).unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotFound);
    // A file is not a folder.
    let err = bridge
        .list_folder(TREE, &["a.hwp".to_string()])
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotFound);

    bridge.revoke_tree(TREE);
    let err = bridge.list_folder(TREE, &[]).unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::PermissionDenied);

    let unlinked = HostFileBridge::new();
    unlinked.add_tree(TREE, "Docs");
    let err = unlinked.list_folder(TREE, &[]).unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::PermissionDenied);
}

#[test]
fn documents_under_a_linked_folder_open_through_the_folder_grant() {
    let bridge = linked_bridge();
    let uri = uri_of(&bridge, &["Sub"], "c.pdf");
    let picked = bridge.open_persistent_uri(&uri).unwrap();
    assert_eq!(picked.name, "c.pdf");
    assert!(picked.writable);
    assert!(!picked.ephemeral);
    assert_eq!(bridge.read_uri_bytes(&uri).unwrap(), b"%PDF");
    bridge.write_uri_bytes_atomic(&uri, b"%PDF-2").unwrap();
    assert_eq!(bridge.read_stored_uri(&uri).unwrap(), b"%PDF-2");

    bridge.revoke_tree(TREE);
    let err = bridge.open_persistent_uri(&uri).unwrap_err();
    assert_eq!(err.kind, NativeFsErrorKind::PermissionDenied);
    let err = bridge.read_uri_bytes(&uri).unwrap_err();
    assert_eq!(err.kind, NativeFsErrorKind::PermissionDenied);
    let err = bridge.write_uri_bytes_atomic(&uri, b"x").unwrap_err();
    assert_eq!(err.kind, NativeFsErrorKind::PermissionDenied);
}

#[test]
fn rename_keeps_bytes_and_returns_the_new_location() {
    let bridge = linked_bridge();
    let old = uri_of(&bridge, &[], "a.hwp");
    let new_uri = bridge.rename_document(&old, "Plan.hwp").unwrap();
    assert_ne!(new_uri, old);
    assert_eq!(bridge.read_uri_bytes(&new_uri).unwrap(), b"hwp-bytes");
    assert!(bridge.read_stored_uri(&old).is_none());
    assert_eq!(
        names(&bridge.list_folder(TREE, &[]).unwrap()),
        vec!["Plan.hwp", "Sub", "b.md"]
    );
    assert_eq!(
        bridge.open_persistent_uri(&new_uri).unwrap().name,
        "Plan.hwp"
    );
    // Changing only the letter case of its own name is allowed.
    let again = bridge.rename_document(&new_uri, "plan.hwp").unwrap();
    assert_eq!(bridge.open_persistent_uri(&again).unwrap().name, "plan.hwp");
}

#[test]
fn rename_refusals_are_distinguishable() {
    let bridge = linked_bridge();
    let a = uri_of(&bridge, &[], "a.hwp");

    for bad in ["", "   ", "x/y.hwp", "x\\y.hwp"] {
        let err = bridge.rename_document(&a, bad).unwrap_err();
        assert_eq!(err.kind, NativeHomeErrorKind::InvalidArgument, "{bad:?}");
    }
    // Same name in the same folder, ignoring letter case; folders count too.
    let err = bridge.rename_document(&a, "B.MD").unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NameTaken);
    let err = bridge.rename_document(&a, "sub").unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NameTaken);
    // The same name in another folder is fine.
    let c = uri_of(&bridge, &["Sub"], "c.pdf");
    bridge.rename_document(&c, "a.hwp").unwrap();

    // Outside any linked folder: the OS gives no parent-folder grant.
    bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://picked/one.hwp".into(),
        name: "one.hwp".into(),
        bytes: b"1".to_vec(),
        writable: true,
        ephemeral: false,
    });
    bridge.pick_open_file(&[]).unwrap();
    let err = bridge
        .rename_document("content://picked/one.hwp", "two.hwp")
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotSupportedHere);

    // Unknown document under the folder.
    let err = bridge
        .rename_document(&format!("{TREE}/ghost.hwp"), "x.hwp")
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotFound);

    // The storage provider refuses renames.
    bridge.set_tree_ops_supported(TREE, false);
    let err = bridge.rename_document(&a, "z.hwp").unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotSupportedHere);
    bridge.set_tree_ops_supported(TREE, true);

    // The folder grant is gone.
    bridge.revoke_tree(TREE);
    let err = bridge.rename_document(&a, "z.hwp").unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::PermissionDenied);
}

#[test]
fn copy_creates_a_sibling_with_the_same_bytes() {
    let bridge = linked_bridge();
    let a = uri_of(&bridge, &[], "a.hwp");
    let copy = bridge.copy_document(&a, "a copy.hwp").unwrap();
    assert_ne!(copy, a);
    assert_eq!(bridge.read_uri_bytes(&copy).unwrap(), b"hwp-bytes");
    assert_eq!(bridge.read_uri_bytes(&a).unwrap(), b"hwp-bytes");
    let listed = bridge.list_folder(TREE, &[]).unwrap();
    let entry = listed.iter().find(|e| e.name == "a copy.hwp").unwrap();
    assert_eq!(entry.mime.as_deref(), Some("application/x-hwp"));
    assert_eq!(entry.uri, copy);

    let err = bridge.copy_document(&a, "A COPY.hwp").unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NameTaken);
    let err = bridge.copy_document(&a, "").unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::InvalidArgument);

    bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://picked/one.hwp".into(),
        name: "one.hwp".into(),
        bytes: b"1".to_vec(),
        writable: true,
        ephemeral: false,
    });
    bridge.pick_open_file(&[]).unwrap();
    let err = bridge
        .copy_document("content://picked/one.hwp", "one copy.hwp")
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotSupportedHere);
}

#[test]
fn delete_removes_only_documents_under_a_linked_folder() {
    let bridge = linked_bridge();
    let b = uri_of(&bridge, &[], "b.md");
    bridge.delete_document(&b).unwrap();
    assert_eq!(
        names(&bridge.list_folder(TREE, &[]).unwrap()),
        vec!["Sub", "a.hwp"]
    );
    let err = bridge.delete_document(&b).unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotFound);

    bridge.enqueue_open_intent(MockPickedDoc {
        uri: "content://shared/x.hwp".into(),
        name: "x.hwp".into(),
        bytes: b"x".to_vec(),
        writable: false,
        ephemeral: true,
    });
    let err = bridge
        .delete_document("content://shared/x.hwp")
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotSupportedHere);
    assert_eq!(
        bridge.read_stored_uri("content://shared/x.hwp").unwrap(),
        b"x"
    );

    let a = uri_of(&bridge, &[], "a.hwp");
    bridge.set_tree_ops_supported(TREE, false);
    let err = bridge.delete_document(&a).unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotSupportedHere);
    assert!(bridge.read_stored_uri(&a).is_some());
}

#[test]
fn share_files_sends_every_file_as_is() {
    let cache = TempCache::new();
    let bridge = linked_bridge();
    bridge.set_cache_dir(&cache.0);
    let a = uri_of(&bridge, &[], "a.hwp");
    let c = uri_of(&bridge, &["Sub"], "c.pdf");
    bridge.share_files(&[a.clone(), c.clone()]).unwrap();
    let shared = bridge.last_shared_files();
    assert_eq!(shared.len(), 2);
    assert_eq!(shared[0].name, "a.hwp");
    assert_eq!(shared[0].bytes, b"hwp-bytes");
    assert_eq!(shared[1].name, "c.pdf");
    assert_eq!(shared[1].bytes, b"%PDF");

    let err = bridge.share_files(&[]).unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::InvalidArgument);
    let err = bridge
        .share_files(&[a.clone(), "content://nowhere".into()])
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotFound);
    // A refused share leaves the previous record untouched.
    assert_eq!(bridge.last_shared_files().len(), 2);

    // Copies of received files (inside the app cache) can be shared too.
    bridge.enqueue_incoming_batch(vec![MockIncomingFile {
        name: "photo.jpg".into(),
        mime: "image/jpeg".into(),
        bytes: b"jpg".to_vec(),
    }]);
    let batch = bridge.take_incoming_batch().unwrap();
    let path = batch.files[0].path.to_string_lossy().to_string();
    bridge.share_files(&[path]).unwrap();
    assert_eq!(bridge.last_shared_files()[0].name, "photo.jpg");
    assert_eq!(bridge.last_shared_files()[0].bytes, b"jpg");
    assert_eq!(bridge.last_shared_files()[0].mime, "image/jpeg");

    // Files outside the app cache are not shared by path.
    let outside = std::env::temp_dir().join("not-in-cache.txt");
    let err = bridge
        .share_files(&[outside.to_string_lossy().to_string()])
        .unwrap_err();
    assert_eq!(err.kind, NativeHomeErrorKind::NotFound);
}

#[test]
fn incoming_batches_are_copied_into_the_cache_and_queued() {
    let cache = TempCache::new();
    let bridge = HostFileBridge::new();
    bridge.set_cache_dir(&cache.0);
    assert!(bridge.take_incoming_batch().is_none());

    let first = bridge.enqueue_incoming_batch(vec![
        MockIncomingFile {
            name: "scan.pdf".into(),
            mime: "application/pdf".into(),
            bytes: b"%PDF-1".to_vec(),
        },
        MockIncomingFile {
            name: "scan.pdf".into(),
            mime: "application/pdf".into(),
            bytes: b"%PDF-2".to_vec(),
        },
        MockIncomingFile {
            name: "a/b.png".into(),
            mime: "image/png".into(),
            bytes: b"png".to_vec(),
        },
    ]);
    let second = bridge.enqueue_incoming_batch(vec![MockIncomingFile {
        name: "one.jpg".into(),
        mime: "image/jpeg".into(),
        bytes: b"jpg".to_vec(),
    }]);
    assert_ne!(first, second);

    let batch = bridge.take_incoming_batch().unwrap();
    assert_eq!(batch.id, first);
    let names: Vec<&str> = batch.files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, vec!["scan.pdf", "scan (2).pdf", "a_b.png"]);
    let batch_dir = cache.0.join(INCOMING_RELATIVE_DIR).join(&first);
    for (file, bytes) in batch
        .files
        .iter()
        .zip([&b"%PDF-1"[..], &b"%PDF-2"[..], &b"png"[..]])
    {
        assert_eq!(file.path, batch_dir.join(&file.name));
        assert_eq!(std::fs::read(&file.path).unwrap(), bytes);
        assert_eq!(file.size_bytes, bytes.len() as u64);
    }
    assert_eq!(batch.files[2].mime, "image/png");

    assert_eq!(bridge.take_incoming_batch().unwrap().id, second);
    assert!(bridge.take_incoming_batch().is_none());
}

#[test]
fn single_document_intents_keep_their_own_queue() {
    let cache = TempCache::new();
    let bridge = HostFileBridge::new();
    bridge.set_cache_dir(&cache.0);
    bridge.enqueue_open_intent(MockPickedDoc {
        uri: "content://shared/one.hwp".into(),
        name: "one.hwp".into(),
        bytes: b"1".to_vec(),
        writable: false,
        ephemeral: true,
    });
    bridge.enqueue_incoming_batch(vec![MockIncomingFile {
        name: "p.jpg".into(),
        mime: "image/jpeg".into(),
        bytes: b"p".to_vec(),
    }]);
    // Taking the batch does not consume the single document, and vice versa.
    assert!(bridge.take_incoming_batch().is_some());
    let single = bridge.take_pending_open_intent().unwrap();
    assert_eq!(single.uri, "content://shared/one.hwp");
    assert!(single.ephemeral);
    assert!(bridge.take_pending_open_intent().is_none());
    assert!(bridge.take_incoming_batch().is_none());
}

#[test]
fn keep_screen_on_is_recorded() {
    let bridge = HostFileBridge::new();
    assert!(!bridge.keep_screen_on());
    bridge.set_keep_screen_on(true).unwrap();
    assert!(bridge.keep_screen_on());
    bridge.set_keep_screen_on(true).unwrap();
    bridge.set_keep_screen_on(false).unwrap();
    assert!(!bridge.keep_screen_on());
}

#[test]
fn only_https_urls_are_opened() {
    let bridge = HostFileBridge::new();
    bridge
        .open_external_url("https://ieumoffice.com/help")
        .unwrap();
    for bad in [
        "http://ieumoffice.com",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://",
        "",
        "https://exa mple.com",
        "intent://x#Intent;end",
    ] {
        let err = bridge.open_external_url(bad).unwrap_err();
        assert_eq!(err.kind, NativeHomeErrorKind::InvalidArgument, "{bad:?}");
    }
    assert_eq!(bridge.opened_urls(), vec!["https://ieumoffice.com/help"]);
}

#[test]
fn https_check() {
    assert!(is_https_url("https://ieumoffice.com"));
    assert!(is_https_url("HTTPS://ieumoffice.com/a?b=c#d"));
    assert!(!is_https_url("https:ieumoffice.com"));
    assert!(!is_https_url("https:///path"));
    assert!(!is_https_url(" https://ieumoffice.com"));
    assert!(!is_https_url("https://ieumoffice.com/\n"));
}

#[test]
fn native_dirs_point_into_the_cache() {
    let cache = TempCache::new();
    let bridge = HostFileBridge::new();
    bridge.set_cache_dir(&cache.0);
    let dirs = bridge.native_dirs().unwrap();
    assert_eq!(dirs.cache_dir, cache.0);
    assert!(dirs.share_temp_dir.starts_with(Path::new(&cache.0)));
}
