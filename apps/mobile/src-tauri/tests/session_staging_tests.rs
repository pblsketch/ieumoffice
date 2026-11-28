use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ieumoffice_mobile_lib::commands::readers::store::{ReaderPosition, now_ms};
use ieumoffice_mobile_lib::storage::home::{FileRef, HomeService};
use ieumoffice_mobile_lib::storage::{MobileDocFormat, MobileFileService};
use std::sync::Arc;
use tauri_plugin_ieum_mobile::fs::{HostFileBridge, MockPickedDoc, NativeFileBridge};

fn doc(uri: &str, name: &str, bytes: &[u8]) -> MockPickedDoc {
    MockPickedDoc {
        uri: uri.into(),
        name: name.into(),
        bytes: bytes.to_vec(),
        writable: true,
        ephemeral: false,
    }
}

#[test]
fn b4_dirty_active_doc_saves_while_next_doc_is_pending_then_commits() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    bridge.set_next_pick_open(doc("content://docs/a.md", "a.md", b"initial A"));
    let doc_a = svc.pick_open_file(&["md".into()]).unwrap();

    // Document B arrives while Document A is dirty and waiting on UnsavedModal.
    bridge.set_next_pick_open(doc("content://docs/b.md", "b.md", b"initial B"));
    let doc_b = svc.pick_open_file(&["md".into()]).unwrap();

    // Both B's preview read and A's dirty save must succeed before commit.
    let read_b = svc.read_file_bytes(&doc_b.session_id).unwrap();
    assert_eq!(B64.decode(read_b.bytes_base64).unwrap(), b"initial B");

    let saved_a = svc
        .save_file_bytes(&doc_a.session_id, &B64.encode(b"edited A"), None)
        .unwrap();
    assert!(saved_a.ok);
    assert_eq!(
        bridge.read_uri_bytes("content://docs/a.md").unwrap(),
        b"edited A"
    );

    // Committing B promotes B to active and drops A.
    svc.commit_session(&doc_b.session_id);
    assert!(svc.read_file_bytes(&doc_a.session_id).is_err());
    let read_b_after = svc.read_file_bytes(&doc_b.session_id).unwrap();
    assert_eq!(B64.decode(read_b_after.bytes_base64).unwrap(), b"initial B");
}

#[test]
fn b4_save_as_on_untitled_active_preserves_pending_doc() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    let untitled_a = svc.create_untitled_session(MobileDocFormat::Md).unwrap();
    bridge.set_next_pick_open(doc("content://docs/b.md", "b.md", b"doc B"));
    let doc_b = svc.pick_open_file(&["md".into()]).unwrap();

    bridge.set_next_save_as_uri("content://docs/saved-a.md");
    let saved_a = svc
        .save_as_file_bytes(
            Some(&untitled_a.session_id),
            "saved-a.md",
            MobileDocFormat::Md,
            &B64.encode(b"saved A"),
            None,
        )
        .unwrap();
    assert_eq!(saved_a.name, "saved-a.md");

    // Document B must still be staged and committable after Save As on A.
    svc.commit_session(&doc_b.session_id);
    let read_b = svc.read_file_bytes(&doc_b.session_id).unwrap();
    assert_eq!(B64.decode(read_b.bytes_base64).unwrap(), b"doc B");
}

#[test]
fn b4_discarding_pending_session_keeps_active_doc_writable() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    bridge.set_next_pick_open(doc("content://docs/a.md", "a.md", b"doc A"));
    let doc_a = svc.pick_open_file(&["md".into()]).unwrap();

    bridge.set_next_pick_open(doc("content://docs/locked.pdf", "locked.pdf", b"%PDF"));
    let doc_b = svc.pick_open_file(&["pdf".into()]).unwrap();

    // User cancels password prompt or unsaved modal for B.
    svc.discard_session(&doc_b.session_id);
    assert!(svc.read_file_bytes(&doc_b.session_id).is_err());

    // Document A remains active and writable.
    let saved = svc
        .save_file_bytes(&doc_a.session_id, &B64.encode(b"still A"), None)
        .unwrap();
    assert!(saved.ok);
    assert_eq!(
        bridge.read_uri_bytes("content://docs/a.md").unwrap(),
        b"still A"
    );
}

#[test]
fn f14_rename_rekeys_reader_positions_and_updates_recovery_and_backup_names() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let files = Arc::new(MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap());
    let home = HomeService::new(files.clone(), "1.0.0").unwrap();

    bridge.add_tree("content://tree/books", "Books");
    bridge.set_next_pick_folder("content://tree/books");
    let folder = home.link_folder(None).unwrap();
    let old_uri = bridge.add_tree_file(
        "content://tree/books",
        "novel.epub",
        b"epub-bytes",
        "application/epub+zip",
        1,
    );

    let entries = home.list_folder(&folder.id, &[]).unwrap();
    let entry_id = entries[0].id.clone();
    let session = home.open_folder_entry(&folder.id, &entry_id).unwrap();
    let old_key = session.doc_key.clone();

    // Seed reader position and recovery entry under the old docKey.
    let pos = ReaderPosition::Epub {
        spine_index: 3,
        href: "ch3.xhtml".into(),
        block_id: Some("p-12".into()),
    };
    files
        .reader_store()
        .set_position(&old_key, pos.clone(), now_ms())
        .unwrap();
    files
        .recovery_write(
            &old_key,
            MobileDocFormat::Epub,
            "novel.epub",
            &B64.encode(b"draft"),
        )
        .unwrap();

    let renamed = home
        .rename(
            &FileRef::Folder {
                folder_id: folder.id.clone(),
                entry_id,
            },
            "renamed-novel",
        )
        .unwrap();
    assert!(matches!(renamed, FileRef::Folder { .. }));

    // Open renamed entry to get its new docKey.
    let entries_after = home.list_folder(&folder.id, &[]).unwrap();
    let new_session = home
        .open_folder_entry(&folder.id, &entries_after[0].id)
        .unwrap();
    assert_eq!(new_session.name, "renamed-novel.epub");
    assert_ne!(new_session.doc_key, old_key);
    let _ = old_uri;

    // Reader position moved to the new docKey.
    assert_eq!(
        files.reader_store().get_state(&old_key).unwrap().position,
        None
    );
    assert_eq!(
        files
            .reader_store()
            .get_state(&new_session.doc_key)
            .unwrap()
            .position,
        Some(pos)
    );

    // Recovery entry moved and updated its display title.
    let recoveries = files.recovery_list().unwrap();
    assert_eq!(recoveries.len(), 1);
    assert_eq!(recoveries[0].doc_key, new_session.doc_key);
    assert_eq!(recoveries[0].title, "renamed-novel.epub");
}
