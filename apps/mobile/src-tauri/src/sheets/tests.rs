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
    let saved = workspace.root().join("f-saved.xlsx");
    let bytes: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
    fs::write(&saved, &bytes).unwrap();

    let raw = saved.to_string_lossy().into_owned();
    let unknown = super::save::write_back_to_original(&files, &workspace, "not-a-session", &raw);
    assert!(unknown.is_err());
    assert_eq!(
        bridge.read_stored_uri("host://picked/book.xlsx").unwrap(),
        b"original"
    );

    let written =
        super::save::write_back_to_original(&files, &workspace, &session.session_id, &raw).unwrap();
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
