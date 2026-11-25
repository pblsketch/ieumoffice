//! Track T6 home service: linked folders, favorites and groups, file actions, received files,
//! storage usage, the sample document, and the small device commands.

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ieumoffice_mobile_lib::error::{MobileError, MobileErrorCode};
use ieumoffice_mobile_lib::storage::home::{
    AppPlatform, ClearStorageKind, FileRef, FolderStatus, HomeService, LinkedFolder,
};
use ieumoffice_mobile_lib::storage::{
    MobileDocFormat, MobileFileService, RestoreTarget, persistent_doc_key,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri_plugin_ieum_mobile::fs::{HostFileBridge, MockIncomingFile, MockPickedDoc};

struct Env {
    _tmp: tempfile::TempDir,
    bridge: Arc<HostFileBridge>,
    files: Arc<MobileFileService>,
    home: HomeService,
    data: PathBuf,
    cache: PathBuf,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path().join("data");
    let cache = tmp.path().join("cache");
    fs::create_dir_all(&cache).unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    bridge.set_cache_dir(&cache);
    let files = Arc::new(MobileFileService::new(data.clone(), bridge.clone()).unwrap());
    let home = HomeService::new(files.clone(), "1.2.3").unwrap();
    Env {
        _tmp: tmp,
        bridge,
        files,
        home,
        data,
        cache,
    }
}

impl Env {
    /// A second service over the same app data, as after an app restart.
    fn restart(&self) -> HomeService {
        let files =
            Arc::new(MobileFileService::new(self.data.clone(), self.bridge.clone()).unwrap());
        HomeService::new(files, "1.2.3").unwrap()
    }

    fn link(&self, tree: &str, name: &str) -> LinkedFolder {
        self.bridge.add_tree(tree, name);
        self.bridge.set_next_pick_folder(tree);
        self.home.link_folder(None).unwrap()
    }

    fn pick(&self, uri: &str, name: &str, bytes: &[u8]) -> String {
        self.bridge.set_next_pick_open(MockPickedDoc {
            uri: uri.to_string(),
            name: name.to_string(),
            bytes: bytes.to_vec(),
            writable: true,
            ephemeral: false,
        });
        self.files.pick_open_file(&[]).unwrap();
        self.files
            .list_recent_docs()
            .unwrap()
            .into_iter()
            .find(|r| r.name == name)
            .unwrap()
            .id
    }

    fn entry_id(&self, folder_id: &str, path: &[&str], name: &str) -> String {
        let path: Vec<String> = path.iter().map(|s| s.to_string()).collect();
        self.home
            .list_folder(folder_id, &path)
            .unwrap()
            .into_iter()
            .find(|e| e.name == name)
            .unwrap_or_else(|| panic!("{name} not listed"))
            .id
    }

    /// Opens a folder file through the folder grant and returns its recent row id.
    fn open_in_folder(&self, folder_id: &str, name: &str) -> String {
        let entry = self.entry_id(folder_id, &[], name);
        self.home.open_folder_entry(folder_id, &entry).unwrap();
        self.files
            .list_recent_docs()
            .unwrap()
            .into_iter()
            .find(|r| r.name == name)
            .unwrap()
            .id
    }
}

fn backdate(path: &Path) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(3600))
        .unwrap();
}

fn postdate(path: &Path) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() + Duration::from_secs(3600))
        .unwrap();
}

fn assert_err(err: MobileError, code: MobileErrorCode, key: &str) {
    assert_eq!(err.code, code, "{err}");
    assert_eq!(err.message_key, key, "{err}");
}

fn recent(id: &str) -> FileRef {
    FileRef::Recent { id: id.to_string() }
}

fn folder_ref(folder_id: &str, entry_id: &str) -> FileRef {
    FileRef::Folder {
        folder_id: folder_id.to_string(),
        entry_id: entry_id.to_string(),
    }
}

const TREE: &str = "content://tree/docs";

fn sample_file(name: &str) -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/storage/samples")
            .join(name),
    )
    .unwrap()
}

// --- FileRef and JSON shapes ---

#[test]
fn file_ref_reads_and_writes_the_bridge_shape() {
    let refs: Vec<FileRef> = serde_json::from_str(
        r#"[{"kind":"recent","id":"r1"},{"kind":"favorite","docKey":"k1"},
            {"kind":"folder","folderId":"f1","entryId":"e1"},
            {"kind":"incoming","batchId":"b1","entryId":"e2"}]"#,
    )
    .unwrap();
    assert_eq!(refs[0], recent("r1"));
    assert_eq!(
        refs[1],
        FileRef::Favorite {
            doc_key: "k1".into()
        }
    );
    assert_eq!(refs[2], folder_ref("f1", "e1"));
    assert_eq!(
        refs[3],
        FileRef::Incoming {
            batch_id: "b1".into(),
            entry_id: "e2".into()
        }
    );
    let json = serde_json::to_value(&refs[2]).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"kind":"folder","folderId":"f1","entryId":"e1"})
    );
}

// --- Favorites and groups ---

#[test]
fn favorites_keep_one_row_per_doc_key_and_outlive_the_recent_list() {
    let e = env();
    let id = e.pick("host://picked/a.md", "a.md", b"# a");
    let list = e.home.set_favorite(&recent(&id), true).unwrap();
    assert_eq!(list.len(), 1);
    let list = e.home.set_favorite(&recent(&id), true).unwrap();
    assert_eq!(list.len(), 1, "the same docKey stays one favorite");
    let fav = &list[0];
    assert_eq!(fav.name, "a.md");
    assert_eq!(fav.format, MobileDocFormat::Md);
    assert_eq!(fav.group_id, None);
    assert_eq!(fav.doc_key, persistent_doc_key("host://picked/a.md"));
    let json = serde_json::to_value(fav).unwrap();
    assert!(json.get("groupId").is_some_and(|v| v.is_null()));
    assert!(json.get("addedAt").is_some());
    assert!(
        !json.to_string().contains("host://"),
        "no location leaks: {json}"
    );

    e.files.remove_recent_doc(&id).unwrap();
    let again = e.restart();
    assert_eq!(again.list_favorites().unwrap().len(), 1);

    // A favorite opens again through its own stored grant and comes back into the recent list.
    let session = again.open_favorite(&fav.doc_key).unwrap();
    assert_eq!(session.name, "a.md");
    assert_eq!(e.files.list_recent_docs().unwrap().len(), 1);

    let fav_ref = FileRef::Favorite {
        doc_key: fav.doc_key.clone(),
    };
    assert!(again.set_favorite(&fav_ref, false).unwrap().is_empty());
}

#[test]
fn group_names_are_trimmed_unique_ignoring_case_and_never_empty() {
    let e = env();
    let groups = e.home.save_group(None, "  Work ").unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].name, "Work");
    let work = groups[0].id.clone();

    assert_err(
        e.home.save_group(None, "work").unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.home.groupNameTaken",
    );
    assert_err(
        e.home.save_group(None, "   ").unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.home.groupNameInvalid",
    );
    let groups = e.home.save_group(None, "Home").unwrap();
    assert_eq!(groups.len(), 2);
    assert_err(
        e.home.save_group(Some(&work), " HOME").unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.home.groupNameTaken",
    );
    // Renaming a group to a new letter case of its own name is fine.
    let groups = e.home.save_group(Some(&work), "WORK").unwrap();
    assert_eq!(groups.iter().find(|g| g.id == work).unwrap().name, "WORK");
    assert_eq!(e.home.list_groups().unwrap().len(), 2);
}

#[test]
fn a_favorite_is_in_at_most_one_group_and_deleting_a_group_ungroups() {
    let e = env();
    let a = e.pick("host://picked/a.md", "a.md", b"a");
    let b = e.pick("host://picked/b.md", "b.md", b"b");
    e.home.set_favorite(&recent(&a), true).unwrap();
    let g1 = e.home.save_group(None, "One").unwrap()[0].id.clone();
    let g2 = e
        .home
        .save_group(None, "Two")
        .unwrap()
        .into_iter()
        .find(|g| g.name == "Two")
        .unwrap()
        .id;

    // `b` is not a favorite, so moving it does nothing.
    let favs = e
        .home
        .move_to_group(&[recent(&a), recent(&b)], Some(&g1))
        .unwrap();
    assert_eq!(favs.len(), 1);
    assert_eq!(favs[0].group_id.as_deref(), Some(g1.as_str()));
    let favs = e.home.move_to_group(&[recent(&a)], Some(&g2)).unwrap();
    assert_eq!(favs[0].group_id.as_deref(), Some(g2.as_str()));
    let favs = e.home.move_to_group(&[recent(&a)], None).unwrap();
    assert_eq!(favs[0].group_id, None);

    e.home.move_to_group(&[recent(&a)], Some(&g2)).unwrap();
    let groups = e.home.delete_group(&g2).unwrap();
    assert_eq!(groups.len(), 1);
    let favs = e.home.list_favorites().unwrap();
    assert_eq!(favs.len(), 1, "the file stays starred");
    assert_eq!(favs[0].group_id, None);

    // Unstarring takes the file out of its group too (the row goes away).
    e.home.move_to_group(&[recent(&a)], Some(&g1)).unwrap();
    assert!(e.home.set_favorite(&recent(&a), false).unwrap().is_empty());
}

// --- Linked folders ---

#[test]
fn linked_folders_report_lost_grants_and_relink_in_place() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    assert_eq!(folder.name, "Docs");
    assert_eq!(folder.status, FolderStatus::Ok);
    let json = serde_json::to_value(&folder).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(!json.to_string().contains("content://"), "{json}");

    e.bridge.revoke_tree(TREE);
    let listed = e.home.list_folders().unwrap();
    assert_eq!(listed[0].status, FolderStatus::Lost);
    assert_eq!(listed[0].lost_reason.as_deref(), Some("revoked"));
    assert_eq!(serde_json::to_value(&listed[0]).unwrap()["status"], "lost");
    assert_err(
        e.home.list_folder(&folder.id, &[]).unwrap_err(),
        MobileErrorCode::PermissionDenied,
        "mobile.home.folderLost",
    );

    e.bridge.set_next_pick_folder(TREE);
    let relinked = e.home.link_folder(Some(&folder.id)).unwrap();
    assert_eq!(relinked.id, folder.id);
    assert_eq!(relinked.status, FolderStatus::Ok);
    assert_eq!(e.home.list_folders().unwrap().len(), 1);

    e.bridge.remove_tree(TREE);
    let listed = e.home.list_folders().unwrap();
    assert_eq!(listed[0].lost_reason.as_deref(), Some("missing"));

    // Linking the same folder again does not add a second row.
    let e2 = env();
    e2.link(TREE, "Docs");
    e2.bridge.set_next_pick_folder(TREE);
    e2.home.link_folder(None).unwrap();
    assert_eq!(e2.home.list_folders().unwrap().len(), 1);

    // Cancelling the picker is USER_CANCELLED.
    assert_eq!(
        e2.home.link_folder(None).unwrap_err().code,
        MobileErrorCode::UserCancelled
    );
}

#[test]
fn folder_listing_shows_folders_then_openable_files_and_pictures_newest_first() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    e.bridge.add_tree_dir(TREE, "Sub");
    e.bridge
        .add_tree_file(TREE, "a.hwpx", b"PK", "application/haansofthwpx", 100);
    e.bridge
        .add_tree_file(TREE, "b.pdf", b"%PDF", "application/pdf", 300);
    e.bridge
        .add_tree_file(TREE, "c.JPG", b"jpg", "image/jpeg", 200);
    e.bridge
        .add_tree_file(TREE, "d.zip", b"zip", "application/zip", 400);
    e.bridge
        .add_tree_file(TREE, "e.heic", b"heic", "image/heic", 50);
    e.bridge
        .add_tree_file(TREE, "f.docx", b"docx", "application/octet-stream", 500);
    e.bridge
        .add_tree_file(TREE, "Sub/inner.md", b"# inner", "text/markdown", 10);
    e.files
        .set_openable_formats(&["hwpx".into(), "pdf".into(), "md".into()]);

    let entries = e.home.list_folder(&folder.id, &[]).unwrap();
    let names: Vec<&str> = entries.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(names, ["Sub", "b.pdf", "c.JPG", "a.hwpx", "e.heic"]);
    assert!(entries[0].is_dir);
    assert_eq!(entries[1].format, Some(MobileDocFormat::Pdf));
    assert!(!entries[1].is_picture);
    assert_eq!(entries[1].modified_at, Some(300));
    assert_eq!(entries[1].size_bytes, Some(4));
    assert!(entries[2].is_picture);
    assert_eq!(entries[2].format, None);
    let json = serde_json::to_string(&entries).unwrap();
    assert!(!json.contains("content://"), "{json}");
    assert!(json.contains("\"isDir\""));
    for entry in &entries {
        assert!(!entry.id.contains('/'), "opaque id: {}", entry.id);
    }

    let inner = e
        .home
        .list_folder(&folder.id, &["Sub".to_string()])
        .unwrap();
    assert_eq!(inner.len(), 1);
    assert_eq!(inner[0].name, "inner.md");
    assert_eq!(inner[0].format, Some(MobileDocFormat::Md));
}

#[test]
fn opening_a_folder_entry_uses_the_gate_and_remembers_the_folder() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    e.bridge
        .add_tree_file(TREE, "a.md", b"# a", "text/markdown", 1);
    e.bridge
        .add_tree_file(TREE, "p.png", b"png", "image/png", 2);
    e.bridge
        .add_tree_file(TREE, "s.pdf", b"%PDF", "application/pdf", 3);
    e.files.set_openable_formats(&["md".into()]);

    let id = e.entry_id(&folder.id, &[], "a.md");
    let session = e.home.open_folder_entry(&folder.id, &id).unwrap();
    assert_eq!(session.name, "a.md");
    assert!(session.writable);
    assert!(!session.ephemeral);
    let bytes = e.files.read_file_bytes(&session.session_id).unwrap();
    assert_eq!(B64.decode(bytes.bytes_base64).unwrap(), b"# a");

    let rows = e.files.list_recent_docs().unwrap();
    assert_eq!(rows.len(), 1);
    let meta = e.home.recent_meta().unwrap();
    assert_eq!(meta.len(), 1);
    assert_eq!(meta[0].id, rows[0].id);
    assert_eq!(meta[0].folder_id.as_deref(), Some(folder.id.as_str()));
    assert_eq!(meta[0].folder_name.as_deref(), Some("Docs"));

    // Pictures and formats the gate does not list are refused (the picture is not listed as a
    // document, so ask for it with the id from a listing taken while the gate was open).
    let png = e.entry_id(&folder.id, &[], "p.png");
    assert_err(
        e.home.open_folder_entry(&folder.id, &png).unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.format.notOpenable",
    );
    e.files.set_openable_formats(&["md".into(), "pdf".into()]);
    let pdf = e.entry_id(&folder.id, &[], "s.pdf");
    e.files.set_openable_formats(&["md".into()]);
    assert_err(
        e.home.open_folder_entry(&folder.id, &pdf).unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.format.notOpenable",
    );
    assert_eq!(e.files.list_recent_docs().unwrap().len(), 1);

    // Reopening from the recent list keeps the folder link.
    let row = rows[0].id.clone();
    e.files.open_recent_doc(&row).unwrap();
    let meta = e.home.recent_meta().unwrap();
    assert_eq!(meta[0].folder_id.as_deref(), Some(folder.id.as_str()));

    // A lost folder grant shows as folderLost when reopening from the recent list.
    e.bridge.revoke_tree(TREE);
    let row = e.files.list_recent_docs().unwrap()[0].id.clone();
    assert_err(
        e.files.open_recent_doc(&row).unwrap_err(),
        MobileErrorCode::PermissionDenied,
        "mobile.home.folderLost",
    );
}

#[test]
fn an_old_recent_json_without_folder_ids_still_reads() {
    let e = env();
    fs::create_dir_all(&e.data).unwrap();
    fs::write(
        e.data.join("recent.json"),
        r#"[{"id":"r1","doc_key":"k1","uri":"host://old/a.md","name":"a.md","format":"md","opened_at":5}]"#,
    )
    .unwrap();
    let rows = e.files.list_recent_docs().unwrap();
    assert_eq!(rows.len(), 1);
    let meta = e.home.recent_meta().unwrap();
    assert_eq!(meta[0].id, "r1");
    assert_eq!(meta[0].folder_id, None);
    let json = serde_json::to_value(&meta[0]).unwrap();
    assert!(json.get("folderId").is_none(), "{json}");
}

#[test]
fn unlinking_a_folder_drops_its_rows_returns_the_count_and_releases_the_grant() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    e.bridge
        .add_tree_file(TREE, "a.md", b"a", "text/markdown", 1);
    e.bridge
        .add_tree_file(TREE, "b.md", b"b", "text/markdown", 2);
    let a = e.open_in_folder(&folder.id, "a.md");
    e.open_in_folder(&folder.id, "b.md");
    e.home.set_favorite(&recent(&a), true).unwrap();
    let outside = e.pick("host://picked/c.md", "c.md", b"c");
    e.home.set_favorite(&recent(&outside), true).unwrap();

    assert_eq!(e.home.count_folder_entries(&folder.id).unwrap().count, 3);
    let removed = e.home.unlink_folder(&folder.id).unwrap();
    assert_eq!(removed.removed_entries, 3);
    assert_eq!(
        serde_json::to_value(&removed).unwrap(),
        serde_json::json!({"removedEntries": 3})
    );
    assert!(!e.bridge.is_tree_granted(TREE));
    assert!(e.home.list_folders().unwrap().is_empty());
    let rows = e.files.list_recent_docs().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "c.md");
    assert_eq!(e.home.list_favorites().unwrap().len(), 1);
    // The files themselves stay.
    assert!(e.bridge.read_stored_uri(&format!("{TREE}/a.md")).is_some());
}

// --- Rename, duplicate, delete ---

#[test]
fn rename_keeps_the_extension_and_moves_recent_favorite_recovery_and_backup() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    let old_uri = e.bridge.add_tree_file(
        TREE,
        "draft.hwpx",
        b"PKoriginal",
        "application/haansofthwpx",
        1,
    );
    e.bridge.add_tree_file(
        TREE,
        "Other.hwpx",
        b"PKother",
        "application/haansofthwpx",
        2,
    );
    let id = e.open_in_folder(&folder.id, "draft.hwpx");
    let old_key = persistent_doc_key(&old_uri);
    e.home.set_favorite(&recent(&id), true).unwrap();
    e.files
        .recovery_write(
            &old_key,
            MobileDocFormat::Hwpx,
            "draft",
            &B64.encode(b"recovered"),
        )
        .unwrap();
    // A backup taken before the first overwrite, written as the backup store keeps it.
    let backups = e.data.join("hwp-backups");
    fs::create_dir_all(&backups).unwrap();
    fs::write(backups.join("bk1.hwpx"), b"PKbackup").unwrap();
    fs::write(
        backups.join("index.json"),
        serde_json::json!([{
            "backup_id": "bk1", "doc_key": old_key, "original_uri": old_uri,
            "original_name": "draft.hwpx", "format": "hwpx", "created_at": 1, "size_bytes": 8
        }])
        .to_string(),
    )
    .unwrap();

    let renamed = e.home.rename(&recent(&id), "  Report ").unwrap();
    assert_eq!(renamed, recent(&id), "the recent row keeps its id");
    let new_uri = format!("{TREE}/Report.hwpx");
    let new_key = persistent_doc_key(&new_uri);
    assert!(e.bridge.read_stored_uri(&new_uri).is_some());
    assert!(e.bridge.read_stored_uri(&old_uri).is_none());

    let rows = e.files.list_recent_docs().unwrap();
    assert_eq!(rows[0].name, "Report.hwpx");
    assert_eq!(rows[0].doc_key, new_key);
    let favs = e.home.list_favorites().unwrap();
    assert_eq!(favs[0].doc_key, new_key);
    assert_eq!(favs[0].name, "Report.hwpx");
    let rec = e.files.recovery_list().unwrap();
    assert_eq!(rec.len(), 1);
    assert_eq!(rec[0].doc_key, new_key);
    assert_eq!(
        B64.decode(e.files.recovery_read(&new_key).unwrap())
            .unwrap(),
        b"recovered"
    );
    let bk = e.files.hwp_backup_list().unwrap();
    assert_eq!(bk[0].doc_key, new_key);
    e.files
        .hwp_backup_restore("bk1", RestoreTarget::InPlace)
        .unwrap();
    assert_eq!(e.bridge.read_stored_uri(&new_uri).unwrap(), b"PKbackup");

    // The renamed file reopens from the recent list (reopening gives the row a new id).
    e.files.open_recent_doc(&id).unwrap();
    let id = e.files.list_recent_docs().unwrap()[0].id.clone();

    // Refusals.
    for bad in ["", "   ", "a/b", "a\\b"] {
        assert_err(
            e.home.rename(&recent(&id), bad).unwrap_err(),
            MobileErrorCode::InvalidArgument,
            "mobile.home.nameInvalid",
        );
    }
    assert_err(
        e.home.rename(&recent(&id), "other").unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.home.nameTaken",
    );
    let outside = e.pick("host://picked/x.md", "x.md", b"x");
    assert_err(
        e.home.rename(&recent(&outside), "y").unwrap_err(),
        MobileErrorCode::PermissionDenied,
        "mobile.home.notSupportedHere",
    );
    e.bridge.set_tree_ops_supported(TREE, false);
    assert_err(
        e.home.rename(&recent(&id), "Final").unwrap_err(),
        MobileErrorCode::PermissionDenied,
        "mobile.home.notSupportedHere",
    );
}

#[test]
fn rename_of_a_folder_entry_or_favorite_returns_a_working_reference() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    e.bridge
        .add_tree_file(TREE, "a.md", b"a", "text/markdown", 1);
    let entry = e.entry_id(&folder.id, &[], "a.md");
    let renamed = e.home.rename(&folder_ref(&folder.id, &entry), "b").unwrap();
    let FileRef::Folder { entry_id, .. } = &renamed else {
        panic!("folder ref expected: {renamed:?}");
    };
    let session = e.home.open_folder_entry(&folder.id, entry_id).unwrap();
    assert_eq!(session.name, "b.md");

    let row = e.files.list_recent_docs().unwrap()[0].id.clone();
    let favs = e.home.set_favorite(&recent(&row), true).unwrap();
    let fav = FileRef::Favorite {
        doc_key: favs[0].doc_key.clone(),
    };
    let renamed = e.home.rename(&fav, "c").unwrap();
    let new_key = persistent_doc_key(&format!("{TREE}/c.md"));
    assert_eq!(renamed, FileRef::Favorite { doc_key: new_key });
    assert_eq!(e.home.list_favorites().unwrap()[0].name, "c.md");
}

#[test]
fn duplicate_inside_a_folder_numbers_taken_names_and_outside_uses_the_save_dialog() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    e.bridge
        .add_tree_file(TREE, "plan.hwpx", b"PKplan", "application/haansofthwpx", 1);
    let entry = e.entry_id(&folder.id, &[], "plan.hwpx");
    let src = folder_ref(&folder.id, &entry);

    let first = e.home.duplicate(&src, "복사본").unwrap().unwrap();
    assert!(matches!(first, FileRef::Folder { .. }));
    assert_eq!(
        e.bridge
            .read_stored_uri(&format!("{TREE}/plan 복사본.hwpx"))
            .unwrap(),
        b"PKplan"
    );
    e.home.duplicate(&src, "복사본").unwrap().unwrap();
    assert!(
        e.bridge
            .read_stored_uri(&format!("{TREE}/plan 복사본 2.hwpx"))
            .is_some()
    );
    e.home.duplicate(&src, "복사본").unwrap().unwrap();
    assert!(
        e.bridge
            .read_stored_uri(&format!("{TREE}/plan 복사본 3.hwpx"))
            .is_some()
    );

    // A recent row opened through the folder copies inside the folder too.
    let row = e.open_in_folder(&folder.id, "plan.hwpx");
    e.home.duplicate(&recent(&row), "copy").unwrap().unwrap();
    assert!(
        e.bridge
            .read_stored_uri(&format!("{TREE}/plan copy.hwpx"))
            .is_some()
    );

    // Outside a folder: the system save dialog, then the copy is in the recent list.
    let outside = e.pick("host://picked/notes.md", "notes.md", b"# notes");
    e.bridge.set_next_save_as_uri("host://saved/chosen.md");
    let copy = e
        .home
        .duplicate(&recent(&outside), "copy")
        .unwrap()
        .unwrap();
    assert_eq!(
        e.bridge.read_stored_uri("host://saved/chosen.md").unwrap(),
        b"# notes"
    );
    let FileRef::Recent { id } = copy else {
        panic!("recent ref expected");
    };
    let rows = e.files.list_recent_docs().unwrap();
    assert!(rows.iter().any(|r| r.id == id && r.name == "notes copy.md"));
}

#[test]
fn delete_reports_each_item_and_drops_recent_and_favorite_rows_but_not_recovery() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    let uri = e
        .bridge
        .add_tree_file(TREE, "a.md", b"a", "text/markdown", 1);
    let row = e.open_in_folder(&folder.id, "a.md");
    e.home.set_favorite(&recent(&row), true).unwrap();
    let key = persistent_doc_key(&uri);
    e.files
        .recovery_write(&key, MobileDocFormat::Md, "a", &B64.encode(b"rec"))
        .unwrap();
    let outside = e.pick("host://picked/x.md", "x.md", b"x");

    let result = e.home.delete(&[recent(&row), recent(&outside)]).unwrap();
    assert_eq!(result.deleted, vec![recent(&row)]);
    assert_eq!(result.failed.len(), 1);
    assert_eq!(result.failed[0].file_ref, recent(&outside));
    assert_eq!(result.failed[0].message_key, "mobile.home.notSupportedHere");
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(
        json["failed"][0]["messageKey"],
        "mobile.home.notSupportedHere"
    );
    assert_eq!(json["failed"][0]["fileRef"]["kind"], "recent");

    assert!(e.bridge.read_stored_uri(&uri).is_none());
    let rows = e.files.list_recent_docs().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "x.md");
    assert!(e.home.list_favorites().unwrap().is_empty());
    assert_eq!(e.files.recovery_list().unwrap().len(), 1);
}

// --- Share and read bytes ---

#[test]
fn share_sends_originals_and_read_bytes_serves_any_reference() {
    let e = env();
    let folder = e.link(TREE, "Docs");
    e.bridge
        .add_tree_file(TREE, "s.pdf", b"%PDF-1", "application/pdf", 1);
    e.bridge
        .add_tree_file(TREE, "p.jpg", b"jpgdata", "image/jpeg", 2);
    let pdf = e.entry_id(&folder.id, &[], "s.pdf");
    let jpg = e.entry_id(&folder.id, &[], "p.jpg");
    e.bridge.enqueue_incoming_batch(vec![
        MockIncomingFile {
            name: "one.png".into(),
            mime: "image/png".into(),
            bytes: b"png1".to_vec(),
        },
        MockIncomingFile {
            name: "two.pdf".into(),
            mime: "application/pdf".into(),
            bytes: b"%PDF-2".to_vec(),
        },
    ]);
    let batch = e.home.take_incoming().unwrap().unwrap();
    let png = FileRef::Incoming {
        batch_id: batch.id.clone(),
        entry_id: batch.entries[0].id.clone(),
    };

    let ok = e
        .home
        .share_files(&[folder_ref(&folder.id, &pdf), png.clone()])
        .unwrap();
    assert!(ok.ok);
    let shared = e.bridge.last_shared_files();
    assert_eq!(shared.len(), 2);
    assert_eq!(shared[0].bytes, b"%PDF-1");
    assert_eq!(shared[1].bytes, b"png1");

    let read = e.home.read_bytes(&folder_ref(&folder.id, &pdf)).unwrap();
    assert_eq!(B64.decode(&read.bytes_base64).unwrap(), b"%PDF-1");
    assert_eq!(read.name, "s.pdf");
    assert_eq!(read.mime, "application/pdf");
    let read = e.home.read_bytes(&folder_ref(&folder.id, &jpg)).unwrap();
    assert_eq!(read.mime, "image/jpeg");
    let read = e.home.read_bytes(&png).unwrap();
    assert_eq!(B64.decode(&read.bytes_base64).unwrap(), b"png1");
    assert_eq!(read.name, "one.png");
    assert_eq!(read.mime, "image/png");
    let json = serde_json::to_value(&read).unwrap();
    assert!(json.get("bytesBase64").is_some());
}

// --- Received files ---

#[test]
fn a_single_received_document_stays_on_the_pending_open_path() {
    let e = env();
    e.bridge.enqueue_incoming_batch(vec![MockIncomingFile {
        name: "memo.md".into(),
        mime: "text/markdown".into(),
        bytes: b"# memo".to_vec(),
    }]);
    assert!(e.home.take_incoming().unwrap().is_none());
    let session = e.files.consume_pending_open_intent().unwrap().unwrap();
    assert_eq!(session.name, "memo.md");
    assert!(!session.writable);
    assert!(session.ephemeral);
    let bytes = e.files.read_file_bytes(&session.session_id).unwrap();
    assert_eq!(B64.decode(bytes.bytes_base64).unwrap(), b"# memo");
    assert!(e.files.list_recent_docs().unwrap().is_empty());
    assert!(e.files.consume_pending_open_intent().unwrap().is_none());
}

#[test]
fn several_files_or_one_picture_come_back_as_a_batch() {
    let e = env();
    e.files.set_openable_formats(&["pdf".into(), "md".into()]);
    e.bridge.enqueue_incoming_batch(vec![MockIncomingFile {
        name: "photo.jpg".into(),
        mime: "image/jpeg".into(),
        bytes: b"jpg".to_vec(),
    }]);
    let single = e.home.take_incoming().unwrap().unwrap();
    assert_eq!(single.entries.len(), 1);
    assert!(single.entries[0].is_picture);

    e.bridge.enqueue_incoming_batch(vec![
        MockIncomingFile {
            name: "a.pdf".into(),
            mime: "application/pdf".into(),
            bytes: b"%PDF-a".to_vec(),
        },
        MockIncomingFile {
            name: "b.jpg".into(),
            mime: "image/jpeg".into(),
            bytes: b"jpg".to_vec(),
        },
        MockIncomingFile {
            name: "c.zip".into(),
            mime: "application/zip".into(),
            bytes: b"zip".to_vec(),
        },
    ]);
    let batch = e.home.take_incoming().unwrap().unwrap();
    assert_eq!(batch.entries.len(), 3);
    let pdf = &batch.entries[0];
    assert_eq!(pdf.format, Some(MobileDocFormat::Pdf));
    assert!(!pdf.is_picture);
    assert_eq!(pdf.mime, "application/pdf");
    assert_eq!(pdf.size_bytes, Some(6));
    assert!(batch.entries[1].is_picture);
    assert_eq!(batch.entries[1].format, None);
    assert_eq!(batch.entries[2].format, None);
    let json = serde_json::to_string(&batch).unwrap();
    assert!(!json.contains("ieum-tmp"), "no paths leak: {json}");
    assert!(json.contains("\"isPicture\""));

    let session = e.home.open_incoming_entry(&batch.id, &pdf.id).unwrap();
    assert_eq!(session.name, "a.pdf");
    assert!(!session.writable);
    assert!(session.ephemeral);
    let bytes = e.files.read_file_bytes(&session.session_id).unwrap();
    assert_eq!(B64.decode(bytes.bytes_base64).unwrap(), b"%PDF-a");
    assert!(e.files.list_recent_docs().unwrap().is_empty());
    assert_err(
        e.home
            .open_incoming_entry(&batch.id, &batch.entries[1].id)
            .unwrap_err(),
        MobileErrorCode::InvalidArgument,
        "mobile.format.notOpenable",
    );
    assert!(e.home.take_incoming().unwrap().is_none());
}

#[test]
fn received_copies_from_earlier_runs_are_removed_at_start() {
    let e = env();
    let incoming = e.cache.join("ieum-tmp/home/incoming");
    let old = incoming.join("b-old/old.pdf");
    let fresh = incoming.join("b-new/new.pdf");
    fs::create_dir_all(old.parent().unwrap()).unwrap();
    fs::create_dir_all(fresh.parent().unwrap()).unwrap();
    fs::write(&old, b"old").unwrap();
    fs::write(&fresh, b"new").unwrap();
    backdate(&old);
    postdate(&fresh);
    let _again = e.restart();
    assert!(!old.exists());
    assert!(
        !old.parent().unwrap().exists(),
        "empty batch folder removed"
    );
    assert!(fresh.exists());
}

// --- Storage usage and clearing ---

#[test]
fn storage_usage_and_clearing_skip_files_written_in_this_run() {
    let e = env();
    e.files
        .recovery_write("keepkey", MobileDocFormat::Md, "keep", &B64.encode(b"1234"))
        .unwrap();
    e.files
        .recovery_write("oldkey", MobileDocFormat::Md, "old", &B64.encode(b"123456"))
        .unwrap();
    for name in [
        "keepkey.bin",
        "keepkey.meta.json",
        "oldkey.bin",
        "oldkey.meta.json",
    ] {
        backdate(&e.data.join("recovery").join(name));
    }
    e.files
        .recovery_write("newkey", MobileDocFormat::Md, "new", &B64.encode(b"12"))
        .unwrap();
    let backups = e.data.join("hwp-backups");
    fs::create_dir_all(&backups).unwrap();
    fs::write(backups.join("x.hwp"), vec![0u8; 50]).unwrap();

    let tmp_old = e.cache.join("ieum-tmp/pdf/old.bin");
    let tmp_new = e.cache.join("ieum-tmp/new.bin");
    let shared_old = e.cache.join("shared/out.pdf");
    for (path, len) in [(&tmp_old, 10usize), (&tmp_new, 20), (&shared_old, 30)] {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![1u8; len]).unwrap();
    }
    backdate(&tmp_old);
    backdate(&shared_old);

    let dir_size = |dir: &Path| -> u64 {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().metadata().unwrap().len())
            .sum()
    };
    let usage = e.home.storage_usage().unwrap();
    assert_eq!(usage.recovery_bytes, dir_size(&e.data.join("recovery")));
    assert_eq!(usage.backup_bytes, 50);
    assert_eq!(usage.temp_bytes, 60);
    let json = serde_json::to_value(&usage).unwrap();
    assert_eq!(json["tempBytes"], 60);

    let freed = e.home.clear_storage(ClearStorageKind::Temp, None).unwrap();
    assert_eq!(freed.freed_bytes, 40);
    assert!(!tmp_old.exists());
    assert!(!shared_old.exists());
    assert!(tmp_new.exists());

    let before = dir_size(&e.data.join("recovery"));
    let freed = e
        .home
        .clear_storage(ClearStorageKind::Recovery, Some("keepkey"))
        .unwrap();
    let keys: Vec<String> = e
        .files
        .recovery_list()
        .unwrap()
        .into_iter()
        .map(|r| r.doc_key)
        .collect();
    assert!(keys.contains(&"keepkey".to_string()));
    assert!(keys.contains(&"newkey".to_string()));
    assert!(!keys.contains(&"oldkey".to_string()));
    assert_eq!(
        freed.freed_bytes,
        before - dir_size(&e.data.join("recovery"))
    );
    assert!(freed.freed_bytes > 0);
    let kind: ClearStorageKind = serde_json::from_str("\"recovery\"").unwrap();
    assert_eq!(kind, ClearStorageKind::Recovery);
}

// --- Sample document ---

#[test]
fn the_sample_opens_read_only_from_bundled_bytes_and_stays_out_of_recent() {
    let e = env();
    let ko = e.home.open_sample("ko").unwrap();
    assert_eq!(ko.name, "이음오피스 시작하기.hwpx");
    assert_eq!(ko.format, MobileDocFormat::Hwpx);
    assert!(!ko.writable);
    assert!(ko.ephemeral);
    let bytes = e.files.read_file_bytes(&ko.session_id).unwrap();
    assert_eq!(
        B64.decode(bytes.bytes_base64).unwrap(),
        sample_file("welcome-ko.hwpx")
    );
    assert!(e.files.list_recent_docs().unwrap().is_empty());

    let ko_region = e.home.open_sample("ko-KR").unwrap();
    assert_eq!(ko_region.name, "이음오피스 시작하기.hwpx");
    for lang in ["en", "ja", "kok", "tr", ""] {
        let session = e.home.open_sample(lang).unwrap();
        assert_eq!(
            session.name, "Getting started with IeumOffice.hwpx",
            "{lang}"
        );
        let bytes = e.files.read_file_bytes(&session.session_id).unwrap();
        assert_eq!(
            B64.decode(bytes.bytes_base64).unwrap(),
            sample_file("welcome-en.hwpx")
        );
    }
    assert!(e.files.list_recent_docs().unwrap().is_empty());
}

// --- App info, screen, links ---

#[test]
fn app_info_screen_and_external_links() {
    let e = env();
    let info = e.home.app_info();
    assert_eq!(info.version, "1.2.3");
    assert_eq!(info.platform, AppPlatform::Other);
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["platform"], "other");
    assert!(json.get("osVersion").is_some());

    assert!(e.home.keep_screen_on(true).unwrap().ok);
    assert!(e.bridge.keep_screen_on());
    e.home.keep_screen_on(false).unwrap();
    assert!(!e.bridge.keep_screen_on());

    for bad in ["http://example.com", "javascript:alert(1)", "file:///etc"] {
        assert_err(
            e.home.open_external_url(bad).unwrap_err(),
            MobileErrorCode::InvalidArgument,
            "mobile.home.urlRefused",
        );
    }
    assert!(
        e.home
            .open_external_url("https://example.com/a")
            .unwrap()
            .ok
    );
    assert_eq!(
        e.bridge.opened_urls(),
        vec!["https://example.com/a".to_string()]
    );
}
