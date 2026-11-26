//! App-side tests for track T1: the work folder, the state setup, the linked
//! engine library seen through its C ABI, and the app's compressed output.
//! The engine's protocol behaviour itself is tested in `engine-lib`.

use std::fs;
use std::io::{Cursor, Write};

use serde_json::{Value, json};

use super::path_guard::PATH_OUTSIDE_WORK_FOLDER;
use super::{SheetsEngine, SheetsState, SheetsWorkspace};

#[test]
fn workspace_keeps_reads_writes_and_deletes_inside_its_root() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let root = workspace.root().to_path_buf();
    assert_eq!(root, dir.path().join("ieum-tmp").join("sheets"));
    let engine_dir = workspace.engine_temp_dir().to_path_buf();
    assert_eq!(engine_dir, root.join("engine"));
    assert!(engine_dir.is_dir());
    // An engine session cache, as the engine would create it.
    let session_cache = engine_dir.join("genspark-ai-excel-s1");
    fs::create_dir(&session_cache).unwrap();
    fs::write(session_cache.join("cells.bin"), "c").unwrap();

    let made = workspace.create_dir().unwrap();
    assert!(made.is_dir() && made.starts_with(&root));
    let file = made.join("entry-0.bin");
    let raw = file.to_string_lossy().into_owned();
    workspace.write_bytes(&raw, b"abc").unwrap();
    assert_eq!(workspace.read_bytes(&raw).unwrap(), b"abc");

    let nested = root.join("a").join("b").join("c.xml");
    workspace
        .write_bytes(&nested.to_string_lossy(), b"<c/>")
        .unwrap();
    assert!(nested.is_file());

    let new_path = workspace.new_file_path("xlsx").unwrap();
    assert!(!new_path.exists() && new_path.starts_with(&root));
    assert!(workspace.new_file_path("../x").is_err());
    assert!(workspace.new_file_path("").is_err());

    let outside = dir.path().join("secret.txt");
    fs::write(&outside, "x").unwrap();
    for raw in [
        outside.to_string_lossy().into_owned(),
        root.join("..")
            .join("secret.txt")
            .to_string_lossy()
            .into_owned(),
        root.to_string_lossy().into_owned(),
        "relative/path.xml".to_owned(),
        // The engine's temp directory is not the WebView's.
        engine_dir.to_string_lossy().into_owned(),
        session_cache
            .join("cells.bin")
            .to_string_lossy()
            .into_owned(),
        engine_dir.join("new.xml").to_string_lossy().into_owned(),
    ] {
        let error = workspace.read_bytes(&raw).unwrap_err();
        assert_eq!(error.message_key, "mobile.sheets.pathOutsideWork", "{raw}");
        assert!(workspace.write_bytes(&raw, b"y").is_err(), "{raw}");
        assert!(workspace.delete(&raw).is_err(), "{raw}");
    }
    assert_eq!(fs::read_to_string(&outside).unwrap(), "x");

    workspace.delete(&made.to_string_lossy()).unwrap();
    assert!(!made.exists());
    workspace.delete(&made.to_string_lossy()).unwrap();

    assert!(session_cache.join("cells.bin").is_file());

    // `clear` keeps the engine's session caches (workbooks may be open)...
    workspace.clear().unwrap();
    assert!(root.is_dir());
    let left: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(left, vec![engine_dir.clone()]);
    assert!(session_cache.is_dir());
    // ...`clear_all` does not, and leaves an empty engine directory.
    workspace.clear_all().unwrap();
    assert!(engine_dir.is_dir());
    assert_eq!(fs::read_dir(&engine_dir).unwrap().count(), 0);

    // Folders removed from outside (the app's "clear temp files") come back.
    fs::remove_dir_all(dir.path().join("ieum-tmp")).unwrap();
    workspace.ensure_folders().unwrap();
    assert!(engine_dir.is_dir());
}

#[test]
fn state_setup_empties_the_work_folder_left_by_a_previous_run() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir
        .path()
        .join(super::TEMP_ROOT_NAME)
        .join(super::WORK_DIR_NAME);
    let leftover = root.join("d-old");
    fs::create_dir_all(&leftover).unwrap();
    fs::write(leftover.join("entry-0.bin"), "x").unwrap();
    // A session cache the engine left when the OS ended the app.
    let orphan = root
        .join(super::ENGINE_DIR_NAME)
        .join("genspark-ai-excel-old");
    fs::create_dir_all(&orphan).unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    assert_eq!(state.workspace.root(), root);
    assert!(state.workspace.engine_temp_dir().is_dir());
    assert!(!leftover.exists());
    assert!(!orphan.exists());
    // The engine got the same work folder.
    let outside = parse(
        &state
            .engine
            .handle_line(&manifest_request(&dir.path().join("x.zip"))),
    );
    assert_eq!(outside["error"]["message"], json!(PATH_OUTSIDE_WORK_FOLDER));
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

fn manifest_request(path: &std::path::Path) -> String {
    json!({ "version": 1, "requestId": "m", "command": "archive_manifest", "path": path })
        .to_string()
}

fn write_zip(path: &std::path::Path) {
    let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
    writer
        .start_file("a.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"hello").unwrap();
    writer.finish().unwrap();
}

/// The library `build.rs` linked answers through the C ABI with the
/// desktop's JSON text.
#[test]
fn the_linked_engine_answers_protocol_lines() {
    let dir = tempfile::tempdir().unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    let book = state.workspace.root().join("a.zip");
    write_zip(&book);

    let text = state.engine.handle_line(&manifest_request(&book));
    assert!(
        text.starts_with(r#"{"version":1,"requestId":"m","ok":true,"result":{"entries":[{"#),
        "{text}"
    );
    assert_eq!(parse(&text)["result"]["entries"][0]["name"], json!("a.txt"));

    let malformed = parse(&state.engine.handle_line("{not json"));
    assert_eq!(malformed["error"]["code"], json!("invalid_json"));
    assert_eq!(malformed["requestId"], json!(""));

    // An engine without a folder rule (as on the desktop) accepts any path.
    let free = SheetsEngine::new(None).unwrap();
    let elsewhere = dir.path().join("b.zip");
    write_zip(&elsewhere);
    assert_eq!(
        parse(&free.handle_line(&manifest_request(&elsewhere)))["ok"],
        json!(true)
    );
}

/// The password commands of the linked library: a workbook the desktop
/// encrypted is probed, refused with a wrong password, decrypted into the work
/// folder with the right one, and encrypted again; paths outside the work
/// folder are refused.
#[test]
fn the_linked_engine_decrypts_and_encrypts_inside_the_work_folder() {
    let dir = tempfile::tempdir().unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    let root = state.workspace.root().to_path_buf();
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/sheets/engine-lib/tests/fixtures/crypto");
    let locked = root.join("locked.xlsx");
    fs::copy(fixtures.join("small.pc-agile.xlsx"), &locked).unwrap();
    let crypto = |request: Value| parse(&state.engine.crypto_line(&request.to_string()));

    assert_eq!(
        crypto(json!({ "op": "probe", "path": locked }))["result"],
        json!({ "encrypted": true, "supported": true, "document": "ooxml" })
    );
    let plain = root.join("plain.xlsx");
    let wrong =
        crypto(json!({ "op": "decrypt", "source": locked, "target": plain, "password": "nope" }));
    assert_eq!(wrong["error"]["code"], json!("wrong_password"));
    assert!(!plain.exists());
    let opened = crypto(
        json!({ "op": "decrypt", "source": locked, "target": plain, "password": "비밀번호 pw1" }),
    );
    assert_eq!(opened["result"]["document"], json!("ooxml"));
    assert_eq!(
        fs::read(&plain).unwrap(),
        fs::read(fixtures.join("small.xlsx")).unwrap()
    );
    let relocked = root.join("relocked.xlsx");
    let encrypted =
        crypto(json!({ "op": "encrypt", "source": plain, "target": relocked, "password": "pw" }));
    assert_eq!(encrypted["ok"], json!(true));
    assert_eq!(
        crypto(json!({ "op": "probe", "path": relocked }))["result"]["encrypted"],
        json!(true)
    );
    let outside = dir.path().join("outside.xlsx");
    let refused =
        crypto(json!({ "op": "decrypt", "source": locked, "target": outside, "password": "pw" }));
    assert_eq!(refused["error"]["code"], json!("invalid_request"));
    assert!(!outside.exists());
}

/// A panic inside the engine fails only that request, even though this crate
/// may be built with `panic = "abort"` (the library unwinds on its own).
/// Debug builds link the library with its `test-panic` feature.
#[cfg(ieum_sheets_test_panic)]
#[test]
fn a_panic_inside_the_linked_engine_fails_only_that_request() {
    let dir = tempfile::tempdir().unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    let answer = parse(&state.engine.handle_line(
        &json!({ "version": 1, "requestId": "boom", "command": "__ieum_test_panic" }).to_string(),
    ));
    assert_eq!(
        answer,
        json!({
            "version": 1, "requestId": "boom", "ok": false,
            "error": {
                "code": "workbook_error",
                "message": "The spreadsheet engine could not process this request.",
            },
        })
    );
    let book = state.workspace.root().join("a.zip");
    write_zip(&book);
    assert_eq!(
        parse(&state.engine.handle_line(&manifest_request(&book)))["ok"],
        json!(true)
    );
}

/// Compressed bytes the app writes for a fixed payload, through the same
/// code paths as its saves: `hwp5_wasm::rewrite_streams_inner` (HWP 5 body
/// streams, flate2 raw deflate) and a zip 2 `Deflated` entry (HWPX parts).
/// Returns (hwp stream length, hwp stream SHA-256, zip length, zip SHA-256).
fn app_compression_digests() -> (usize, String, usize, String) {
    use sha2::Digest;

    fn hex(bytes: &[u8]) -> String {
        sha2::Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    // Deterministic text with repeats, so the compressor has real choices.
    let words = ["표 ", "문단", "hello ", "셀", "0123", "가나다라", " ", "\n"];
    let mut state = 0x2545_f491_u32;
    let mut payload = Vec::new();
    while payload.len() < 300_000 {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        payload.extend_from_slice(words[(state % 8) as usize].as_bytes());
    }

    // A minimal compressed HWP 5 container with one body section.
    let mut comp = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    let mut header = vec![0u8; 256];
    header[..hwp5_wasm::SIGNATURE.len()].copy_from_slice(hwp5_wasm::SIGNATURE);
    header[32..36].copy_from_slice(&[0, 3, 0, 5]);
    header[36..40].copy_from_slice(&hwp5_wasm::FLAG_COMPRESSED.to_le_bytes());
    comp.create_stream("/FileHeader")
        .unwrap()
        .write_all(&header)
        .unwrap();
    comp.create_storage("/BodyText").unwrap();
    comp.create_stream("/BodyText/Section0")
        .unwrap()
        .write_all(&[0x03, 0x00])
        .unwrap();
    comp.flush().unwrap();
    let hwp = comp.into_inner().into_inner();
    let manifest = format!(
        r#"[{{"path":"/BodyText/Section0","offset":0,"length":{}}}]"#,
        payload.len()
    );
    let saved = hwp5_wasm::rewrite_streams_inner(&hwp, &manifest, &payload).unwrap();
    let raw = hwp5_wasm::read_stream_inner(&saved, "/BodyText/Section0", false).unwrap();
    assert_eq!(
        hwp5_wasm::read_stream_inner(&saved, "/BodyText/Section0", true).unwrap(),
        payload
    );

    let mut zipped = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(Cursor::new(&mut zipped));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(zip::DateTime::default());
        writer.start_file("Contents/section0.xml", options).unwrap();
        writer.write_all(&payload).unwrap();
        writer.finish().unwrap();
    }
    (raw.len(), hex(&raw), zipped.len(), hex(&zipped))
}

/// The engine must not change how the rest of the app compresses. Expected
/// values were captured from the app before the engine came in (12923b5e6,
/// flate2 on miniz_oxide). Linking the engine crate into this workspace
/// switched flate2 to zlib-rs and gave (42418, 65b42a8d…, 42558, d40ca9d0…).
#[test]
fn hwp_and_hwpx_compression_matches_the_app_before_the_engine() {
    assert_eq!(
        app_compression_digests(),
        (
            42923,
            "7bc0b90ed5225b4cab627102a59929aee3a0cce282000badda0a37ea88c067df".to_owned(),
            43063,
            "ff36a6936d87cf2b2de7b7203c9512daf5280e2893c0a517465879abde991ea5".to_owned(),
        )
    );
}

#[test]
fn workspace_file_operations_for_the_save_path_stay_inside_its_root() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let root = workspace.root().to_path_buf();
    let raw = |path: &std::path::Path| path.to_string_lossy().into_owned();

    // Folders and appended pieces (a large patched entry arrives in pieces).
    let save_dir = root.join("ai-excel-save-abc").join("extract-0");
    workspace.make_dir(&raw(&save_dir)).unwrap();
    assert!(save_dir.is_dir());
    let part = root.join("ai-excel-save-abc").join("replace-0.bin");
    workspace.append_bytes(&raw(&part), b"<sheet>").unwrap();
    workspace
        .append_bytes(&raw(&part), "\u{d55c}</sheet>".as_bytes())
        .unwrap();
    assert_eq!(
        fs::read_to_string(&part).unwrap(),
        "<sheet>\u{d55c}</sheet>"
    );

    // Ranged and whole reads.
    assert_eq!(
        workspace.read_range(&raw(&part), None, None).unwrap(),
        fs::read(&part).unwrap()
    );
    assert_eq!(
        workspace.read_range(&raw(&part), Some(1), Some(5)).unwrap(),
        b"sheet"
    );
    assert_eq!(
        workspace
            .read_range(&raw(&part), Some(100), Some(5))
            .unwrap(),
        b""
    );

    // Stat, copy, rename (replacing), digest.
    let stat = workspace.stat(&raw(&part)).unwrap().unwrap();
    assert!(stat.is_file && !stat.is_dir);
    assert_eq!(stat.size, fs::metadata(&part).unwrap().len());
    assert!(
        workspace
            .stat(&raw(&root.join("missing.xml")))
            .unwrap()
            .is_none()
    );
    let copy = root.join("copy.bin");
    workspace.copy(&raw(&part), &raw(&copy)).unwrap();
    assert_eq!(fs::read(&copy).unwrap(), fs::read(&part).unwrap());
    let moved = root.join("moved.bin");
    fs::write(&moved, "old").unwrap();
    workspace.rename(&raw(&copy), &raw(&moved)).unwrap();
    assert!(!copy.exists());
    assert_eq!(fs::read(&moved).unwrap(), fs::read(&part).unwrap());
    fs::write(&copy, "abc").unwrap();
    assert_eq!(
        workspace.sha256(&raw(&copy)).unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );

    // None of them reaches outside the work folder or into the engine's folder.
    let outside = dir.path().join("secret.txt");
    fs::write(&outside, "x").unwrap();
    let engine_file = workspace.engine_temp_dir().join("cells.bin");
    for target in [
        raw(&outside),
        raw(&engine_file),
        raw(&root.join("..").join("y")),
    ] {
        assert!(workspace.make_dir(&target).is_err(), "{target}");
        assert!(workspace.append_bytes(&target, b"y").is_err(), "{target}");
        assert!(
            workspace.read_range(&target, Some(0), Some(1)).is_err(),
            "{target}"
        );
        assert!(workspace.stat(&target).is_err(), "{target}");
        assert!(workspace.sha256(&target).is_err(), "{target}");
        assert!(workspace.copy(&raw(&part), &target).is_err(), "{target}");
        assert!(workspace.copy(&target, &raw(&part)).is_err(), "{target}");
        assert!(workspace.rename(&raw(&part), &target).is_err(), "{target}");
        assert!(workspace.rename(&target, &raw(&part)).is_err(), "{target}");
    }
    assert_eq!(fs::read_to_string(&outside).unwrap(), "x");
    assert!(!engine_file.exists());
}

fn host_file_service(
    dir: &std::path::Path,
) -> (
    std::sync::Arc<tauri_plugin_ieum_mobile::fs::HostFileBridge>,
    crate::storage::MobileFileService,
) {
    let bridge = std::sync::Arc::new(tauri_plugin_ieum_mobile::fs::HostFileBridge::new());
    let files = crate::storage::MobileFileService::new(dir.join("data"), bridge.clone()).unwrap();
    (bridge, files)
}

/// The verified save reaches the original through the storage service, byte
/// for byte, and only for the active session.
#[test]
fn a_verified_save_is_written_back_to_the_sessions_original() {
    use tauri_plugin_ieum_mobile::fs::MockPickedDoc;
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let (bridge, files) = host_file_service(dir.path());
    bridge.set_next_pick_open(MockPickedDoc {
        uri: "host://picked/book.xlsx".into(),
        name: "book.xlsx".into(),
        bytes: b"original".to_vec(),
        writable: true,
        ephemeral: false,
    });
    let session = files.pick_open_file(&["xlsx".into()]).unwrap();
    let digests = super::save::OriginalDigests::default();
    let saved = workspace.root().join("f-saved.xlsx");
    let bytes: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
    fs::write(&saved, &bytes).unwrap();

    let raw = saved.to_string_lossy().into_owned();
    let unknown =
        super::save::write_back_to_original(&files, &workspace, &digests, "not-a-session", &raw);
    assert!(unknown.is_err());
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        b"original"
    );

    let written = super::save::write_back_to_original(
        &files,
        &workspace,
        &digests,
        &session.session_id,
        &raw,
    )
    .unwrap();
    assert!(written.ok);
    assert_eq!(written.size, bytes.len() as u64);
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        bytes
    );

    // A path outside the work folder is refused before the original is touched.
    let outside = dir.path().join("elsewhere.xlsx");
    fs::write(&outside, "x").unwrap();
    assert!(
        super::save::write_back_to_original(
            &files,
            &workspace,
            &digests,
            &session.session_id,
            &outside.to_string_lossy()
        )
        .is_err()
    );
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        bytes
    );
}

/// An export copy is a new document; the active session's original stays.
#[test]
fn an_export_copy_goes_to_a_new_document_and_leaves_the_original() {
    use tauri_plugin_ieum_mobile::fs::MockPickedDoc;
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let (bridge, files) = host_file_service(dir.path());
    bridge.set_next_pick_open(MockPickedDoc {
        uri: "host://picked/book.xlsx".into(),
        name: "book.xlsx".into(),
        bytes: b"original".to_vec(),
        writable: true,
        ephemeral: false,
    });
    files.pick_open_file(&["xlsx".into()]).unwrap();
    bridge.set_next_save_as_uri("host://saved/book.csv");
    let csv = workspace.root().join("f-copy.csv");
    fs::write(&csv, "a,b\n1,2\n").unwrap();
    let written = super::save::write_copy(
        bridge.as_ref(),
        &workspace,
        &csv.to_string_lossy(),
        "book.csv",
        "text/csv",
    )
    .unwrap();
    assert_eq!(written.name, "book.csv");
    assert_eq!(written.size, 8);
    assert_eq!(
        bridge.read_stored_uri("host://saved/book.csv").unwrap(),
        b"a,b\n1,2\n"
    );
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        b"original"
    );
}

fn picked_book(bridge: &tauri_plugin_ieum_mobile::fs::HostFileBridge, bytes: &[u8]) {
    bridge.set_next_pick_open(tauri_plugin_ieum_mobile::fs::MockPickedDoc {
        uri: "host://picked/book.xlsx".into(),
        name: "book.xlsx".into(),
        bytes: bytes.to_vec(),
        writable: true,
        ephemeral: false,
    });
}

/// Like the desktop's `errDiskChanged`: a document another app changed after
/// it was opened is not overwritten; once the app wrote it, its own write is
/// the new base.
#[test]
fn a_save_over_an_original_changed_since_it_was_opened_is_refused() {
    use tauri_plugin_ieum_mobile::fs::NativeFileBridge;
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let (bridge, files) = host_file_service(dir.path());
    let digests = super::save::OriginalDigests::default();
    picked_book(&bridge, b"original");
    let session = files.pick_open_file(&["xlsx".into()]).unwrap();
    let copy = super::save::copy_original_to_work_folder(
        &files,
        &workspace,
        &digests,
        &session.session_id,
        "xlsx",
        &|_| None,
    )
    .unwrap();
    assert_eq!(fs::read(&copy.path).unwrap(), b"original");
    let saved = workspace.root().join("f-saved.xlsx");
    fs::write(&saved, b"saved once").unwrap();
    let raw = saved.to_string_lossy().into_owned();

    // Another app rewrites the document.
    bridge
        .write_uri_bytes_atomic("host://picked/book.xlsx", b"changed elsewhere")
        .unwrap();
    let refused = super::save::write_back_to_original(
        &files,
        &workspace,
        &digests,
        &session.session_id,
        &raw,
    )
    .unwrap_err();
    assert_eq!(refused.message_key, super::save::MESSAGE_DISK_CHANGED);
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        b"changed elsewhere"
    );

    // Reopened (a fresh read records the new base), the save goes through,
    // and the app's own write does not count as a change next time.
    super::save::copy_original_to_work_folder(
        &files,
        &workspace,
        &digests,
        &session.session_id,
        "xlsx",
        &|_| None,
    )
    .unwrap();
    super::save::write_back_to_original(&files, &workspace, &digests, &session.session_id, &raw)
        .unwrap();
    fs::write(&saved, b"saved twice").unwrap();
    super::save::write_back_to_original(&files, &workspace, &digests, &session.session_id, &raw)
        .unwrap();
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        b"saved twice"
    );
}

/// Save As writes a new document that becomes the session; the old original
/// is not written, and only workbook names are taken.
#[test]
fn save_as_makes_a_new_document_and_leaves_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let (bridge, files) = host_file_service(dir.path());
    let digests = super::save::OriginalDigests::default();
    bridge.set_next_pick_open(tauri_plugin_ieum_mobile::fs::MockPickedDoc {
        uri: "host://picked/book.xls".into(),
        name: "book.xls".into(),
        bytes: b"legacy".to_vec(),
        writable: true,
        ephemeral: false,
    });
    let session = files.pick_open_file(&["xls".into()]).unwrap();
    super::save::copy_original_to_work_folder(
        &files,
        &workspace,
        &digests,
        &session.session_id,
        "xls",
        &|_| None,
    )
    .unwrap();
    let saved = workspace.root().join("f-saved.xlsx");
    fs::write(&saved, b"new workbook").unwrap();
    let raw = saved.to_string_lossy().into_owned();

    let refused = super::save::save_as_new_document(
        &files,
        &workspace,
        &digests,
        Some(&session.session_id),
        &raw,
        "book.xls",
    )
    .unwrap_err();
    assert_eq!(refused.message_key, "mobile.sheets.saveAsFormat");

    bridge.set_next_save_as_uri("host://saved/book.xlsx");
    let next = super::save::save_as_new_document(
        &files,
        &workspace,
        &digests,
        Some(&session.session_id),
        &raw,
        "book.xlsx",
    )
    .unwrap();
    assert_eq!(next.name, "book.xlsx");
    assert_ne!(next.session_id, session.session_id);
    assert!(next.writable);
    assert_eq!(
        bridge.read_stored_uri("host://saved/book.xlsx").unwrap(),
        b"new workbook"
    );
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xls").unwrap(),
        b"legacy"
    );
    assert!(digests.get(&session.session_id).is_none());
    assert_eq!(
        digests.get(&next.session_id),
        Some(super::save::sha256_hex(b"new workbook"))
    );
    // The new document saves in place afterwards.
    fs::write(&saved, b"edited again").unwrap();
    super::save::write_back_to_original(&files, &workspace, &digests, &next.session_id, &raw)
        .unwrap();
    assert_eq!(
        bridge.read_stored_uri("host://saved/book.xlsx").unwrap(),
        b"edited again"
    );
}

/// The share sheet and the recovery copy take a work-folder file.
#[test]
fn share_and_recovery_read_the_work_folder_file() {
    use base64::Engine as _;
    let dir = tempfile::tempdir().unwrap();
    let workspace = SheetsWorkspace::for_cache_dir(dir.path()).unwrap();
    let (bridge, files) = host_file_service(dir.path());
    picked_book(&bridge, b"original");
    let session = files.pick_open_file(&["xlsx".into()]).unwrap();
    let staged = workspace.root().join("f-share.xlsx");
    fs::write(&staged, b"edited copy").unwrap();
    let raw = staged.to_string_lossy().into_owned();
    super::save::share_from_work_folder(
        &files,
        &workspace,
        &super::save::OriginalDigests::default(),
        &session.session_id,
        &raw,
        "book.xlsx",
    )
    .unwrap();
    assert_eq!(bridge.last_shared_bytes().unwrap(), b"edited copy");
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        b"original"
    );

    super::save::write_recovery_copy(
        &files,
        &workspace,
        &super::save::OriginalDigests::default(),
        &session.session_id,
        &session.doc_key,
        "book.xlsx",
        &raw,
    )
    .unwrap();
    let listed = files.recovery_list().unwrap();
    assert!(listed.iter().any(|entry| entry.doc_key == session.doc_key));
    let read = base64::engine::general_purpose::STANDARD
        .decode(files.recovery_read(&session.doc_key).unwrap())
        .unwrap();
    assert_eq!(read, b"edited copy");
    let outside = dir.path().join("outside.xlsx");
    fs::write(&outside, "x").unwrap();
    assert!(
        super::save::write_recovery_copy(
            &files,
            &workspace,
            &super::save::OriginalDigests::default(),
            &session.session_id,
            &session.doc_key,
            "book.xlsx",
            &outside.to_string_lossy()
        )
        .is_err()
    );
}

/// A failed write of a large file is told as such (the native bridge's
/// argument limit); a small one keeps its own error, a cancel stays a cancel.
#[test]
fn a_large_failed_write_is_explained_as_too_large() {
    use crate::error::{MobileError, MobileErrorCode};
    let bridge_limit = MobileError::with_detail(
        MobileErrorCode::InternalError,
        "mobile.fs.ioError",
        "String length (20051115) exceeds the maximum length (20000000)",
    );
    let explained = super::save::explain_write_failure(bridge_limit, 15_038_336);
    assert_eq!(explained.code, MobileErrorCode::FileTooLarge);
    assert_eq!(explained.message_key, super::save::MESSAGE_TOO_LARGE);
    let small = MobileError::with_detail(
        MobileErrorCode::PermissionDenied,
        "mobile.fs.permissionDenied",
        "revoked",
    );
    assert_eq!(
        super::save::explain_write_failure(small, 1_000).code,
        MobileErrorCode::PermissionDenied
    );
    let cancel = MobileError::new(MobileErrorCode::UserCancelled, "mobile.fs.cancelled");
    assert_eq!(
        super::save::explain_write_failure(cancel, 30_000_000).code,
        MobileErrorCode::UserCancelled
    );
}

/// The Rust half of saving a workbook opened with a password: the desktop's
/// encrypted file is decrypted into the work folder, the save is locked again
/// with the same password (`encrypt`, as the WebView asks) and only the locked
/// file reaches the original. The result decrypts to the saved workbook.
/// `IEUM_WRITE_SHEETS_FIXTURES=1` keeps it as `small.mobile-relocked.xlsx`,
/// which the desktop decryption opens in `tests/sheets-save-relock.test.ts`.
#[test]
fn a_password_workbook_is_saved_locked_again_with_its_password() {
    let dir = tempfile::tempdir().unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    let workspace = &state.workspace;
    let (bridge, files) = host_file_service(dir.path());
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/sheets/engine-lib/tests/fixtures/crypto");
    let pc_locked = fs::read(fixtures.join("small.pc-agile.xlsx")).unwrap();
    picked_book(&bridge, &pc_locked);
    let session = files.pick_open_file(&["xlsx".into()]).unwrap();
    let copy = super::save::copy_original_to_work_folder(
        &files,
        workspace,
        &state.originals,
        &session.session_id,
        "xlsx",
        &|path| state.engine.probe_original(path),
    )
    .unwrap();
    let crypto = |request: Value| parse(&state.engine.crypto_line(&request.to_string()));
    let password = "비밀번호 pw1";
    let plain = workspace.root().join("plain.xlsx");
    let opened = crypto(
        json!({ "op": "decrypt", "source": copy.path, "target": plain, "password": password }),
    );
    assert_eq!(opened["ok"], json!(true));
    let relocked = workspace.root().join("relocked.xlsx");
    let locked = crypto(
        json!({ "op": "encrypt", "source": plain, "target": relocked, "password": password }),
    );
    assert_eq!(locked["ok"], json!(true));
    super::save::write_back_to_original(
        &files,
        workspace,
        &state.originals,
        &session.session_id,
        &relocked.to_string_lossy(),
    )
    .unwrap();
    let stored = bridge.read_stored_uri("host://picked/book.xlsx").unwrap();
    assert_ne!(stored, fs::read(&plain).unwrap());
    let back = workspace.root().join("stored.xlsx");
    fs::write(&back, &stored).unwrap();
    assert_eq!(
        crypto(json!({ "op": "probe", "path": back }))["result"]["encrypted"],
        json!(true)
    );
    let reopened = workspace.root().join("reopened.xlsx");
    let decrypted = crypto(
        json!({ "op": "decrypt", "source": back, "target": reopened, "password": password }),
    );
    assert_eq!(decrypted["ok"], json!(true));
    assert_eq!(
        fs::read(&reopened).unwrap(),
        fs::read(fixtures.join("small.xlsx")).unwrap()
    );
    let kept = fixtures.join("small.mobile-relocked.xlsx");
    if std::env::var_os("IEUM_WRITE_SHEETS_FIXTURES").is_some() {
        fs::write(&kept, &stored).unwrap();
    }
    // The committed sample still opens with the password (the desktop test reads it).
    let sample = workspace.root().join("sample.xlsx");
    fs::copy(&kept, &sample).unwrap();
    let sample_plain = workspace.root().join("sample-plain.xlsx");
    let sample_open = crypto(
        json!({ "op": "decrypt", "source": sample, "target": sample_plain, "password": password }),
    );
    assert_eq!(sample_open["ok"], json!(true));
    assert_eq!(
        fs::read(&sample_plain).unwrap(),
        fs::read(fixtures.join("small.xlsx")).unwrap()
    );
}

fn crypto_fixture(name: &str) -> Vec<u8> {
    fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/sheets/engine-lib/tests/fixtures/crypto")
            .join(name),
    )
    .unwrap()
}

/// Last line of defence for spec 2.3: an `.xls` original is never written,
/// whatever the WebView asks, and whether the app learns it from the name
/// or from the file itself. Save As to an `.xlsx` is the way out, and that
/// new document saves in place.
#[test]
fn an_xls_original_is_never_written_back() {
    let dir = tempfile::tempdir().unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    let workspace = &state.workspace;
    let (bridge, files) = host_file_service(dir.path());
    let legacy = crypto_fixture("plain.xls");
    let probe = |path: &std::path::Path| state.engine.probe_original(path);
    let saved = workspace.root().join("f-saved.xlsx");
    fs::write(&saved, crypto_fixture("small.xlsx")).unwrap();
    let raw = saved.to_string_lossy().into_owned();

    // Named .xls, and an .xls file the WebView calls .xlsx.
    for (name, claimed) in [("book.xls", "xls"), ("book2.xls", "xlsx")] {
        let uri = format!("host://picked/{name}");
        bridge.set_next_pick_open(tauri_plugin_ieum_mobile::fs::MockPickedDoc {
            uri: uri.clone(),
            name: name.into(),
            bytes: legacy.clone(),
            writable: true,
            ephemeral: false,
        });
        let session = files.pick_open_file(&["xls".into()]).unwrap();
        super::save::copy_original_to_work_folder(
            &files,
            workspace,
            &state.originals,
            &session.session_id,
            claimed,
            &probe,
        )
        .unwrap();
        let refused = super::save::write_back_to_original(
            &files,
            workspace,
            &state.originals,
            &session.session_id,
            &raw,
        )
        .unwrap_err();
        assert_eq!(
            refused.message_key,
            super::save::MESSAGE_LEGACY_ORIGINAL,
            "{name}"
        );
        assert_eq!(bridge.read_stored_uri(&uri).unwrap(), legacy, "{name}");

        bridge.set_next_save_as_uri(&format!("host://saved/{name}x"));
        let next = super::save::save_as_new_document(
            &files,
            workspace,
            &state.originals,
            Some(&session.session_id),
            &raw,
            "book.xlsx",
        )
        .unwrap();
        super::save::write_back_to_original(
            &files,
            workspace,
            &state.originals,
            &next.session_id,
            &raw,
        )
        .unwrap();
        assert_eq!(bridge.read_stored_uri(&uri).unwrap(), legacy, "{name}");
    }
}

/// Last line of defence for spec 5.1: a document opened with a password
/// never sends a plain workbook out — not over the original, not to Save
/// As (nor the new document after it), not to the share sheet, and never
/// as a recovery copy. Locked files, and a CSV or PDF the person chose,
/// still go.
#[test]
fn a_password_workbook_never_sends_out_its_plain_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let state = SheetsState::new(dir.path()).unwrap();
    let workspace = &state.workspace;
    let digests = &state.originals;
    let (bridge, files) = host_file_service(dir.path());
    let pc_locked = crypto_fixture("small.pc-agile.xlsx");
    picked_book(&bridge, &pc_locked);
    let session = files.pick_open_file(&["xlsx".into()]).unwrap();
    let copy = super::save::copy_original_to_work_folder(
        &files,
        workspace,
        digests,
        &session.session_id,
        "xlsx",
        &|path| state.engine.probe_original(path),
    )
    .unwrap();
    let crypto = |request: Value| parse(&state.engine.crypto_line(&request.to_string()));
    let password = "비밀번호 pw1";
    let plain = workspace.root().join("plain.xlsx");
    crypto(json!({ "op": "decrypt", "source": copy.path, "target": plain, "password": password }));
    let plain_raw = plain.to_string_lossy().into_owned();
    let relocked = workspace.root().join("relocked.xlsx");
    crypto(json!({ "op": "encrypt", "source": plain, "target": relocked, "password": password }));
    let relocked_raw = relocked.to_string_lossy().into_owned();
    let id = session.session_id.as_str();

    let refused = super::save::write_back_to_original(&files, workspace, digests, id, &plain_raw)
        .unwrap_err();
    assert_eq!(refused.message_key, super::save::MESSAGE_NOT_LOCKED);
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        pc_locked
    );
    let refused = super::save::share_from_work_folder(
        &files,
        workspace,
        digests,
        id,
        &plain_raw,
        "book.xlsx",
    )
    .unwrap_err();
    assert_eq!(refused.message_key, super::save::MESSAGE_NOT_LOCKED);
    assert!(bridge.last_shared_bytes().is_none());
    let refused = super::save::write_recovery_copy(
        &files,
        workspace,
        digests,
        id,
        &session.doc_key,
        "book.xlsx",
        &plain_raw,
    )
    .unwrap_err();
    assert_eq!(refused.message_key, super::save::MESSAGE_NO_RECOVERY);
    assert!(files.recovery_list().unwrap().is_empty());
    let refused = super::save::save_as_new_document(
        &files,
        workspace,
        digests,
        Some(id),
        &plain_raw,
        "book.xlsx",
    )
    .unwrap_err();
    assert_eq!(refused.message_key, super::save::MESSAGE_NOT_LOCKED);

    // A CSV of the sheet is the person's own choice (as on the desktop).
    let csv = workspace.root().join("f-sheet.csv");
    fs::write(&csv, "a,b\n1,2\n").unwrap();
    super::save::share_from_work_folder(
        &files,
        workspace,
        digests,
        id,
        &csv.to_string_lossy(),
        "book.csv",
    )
    .unwrap();
    // The locked file goes everywhere a workbook goes.
    super::save::write_back_to_original(&files, workspace, digests, id, &relocked_raw).unwrap();
    super::save::share_from_work_folder(&files, workspace, digests, id, &relocked_raw, "book.xlsx")
        .unwrap();
    bridge.set_next_save_as_uri("host://saved/copy.xlsx");
    let next = super::save::save_as_new_document(
        &files,
        workspace,
        digests,
        Some(id),
        &relocked_raw,
        "copy.xlsx",
    )
    .unwrap();
    // The new document is still the password workbook.
    let refused = super::save::write_back_to_original(
        &files,
        workspace,
        digests,
        &next.session_id,
        &plain_raw,
    )
    .unwrap_err();
    assert_eq!(refused.message_key, super::save::MESSAGE_NOT_LOCKED);
}
