//! Saving and copying through local files (no size-limited base64 argument to the native side).
//! The path-based saves must write exactly what the byte-based saves write.

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use flate2::{Compression, write::DeflateEncoder};
use ieumoffice_mobile_lib::error::MobileErrorCode;
use ieumoffice_mobile_lib::hwp::{HwpFixPayload, MeasuredTab, SavePreviewInput};
use ieumoffice_mobile_lib::storage::home::HomeService;
use ieumoffice_mobile_lib::storage::{MobileDocFormat, MobileFileService};
use std::io::{Cursor, Write};
use std::path::Path;
use std::sync::Arc;
use tauri_plugin_ieum_mobile::fs::{HostFileBridge, MockPickedDoc};

fn deflate_raw(data: &[u8]) -> Vec<u8> {
    let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
    enc.write_all(data).unwrap();
    enc.finish().unwrap()
}

fn make_record(tag: u16, level: u16, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let word = (u32::from(tag) & 0x3ff)
        | ((u32::from(level) & 0x3ff) << 10)
        | ((payload.len() as u32) << 20);
    out.extend_from_slice(&word.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

/// A compressed HWP 5 file with one paragraph holding an empty tab (the save fixes touch it).
fn sample_hwp() -> Vec<u8> {
    let mut header = vec![0u8; 256];
    let sig = b"HWP Document File";
    header[..sig.len()].copy_from_slice(sig);
    header[32..36].copy_from_slice(&0x0501_0000u32.to_le_bytes());
    header[36..40].copy_from_slice(&1u32.to_le_bytes());
    let mut section = make_record(66, 0, &[0u8; 22]);
    let mut text = Vec::new();
    text.extend_from_slice(&0x0041u16.to_le_bytes());
    text.extend_from_slice(&9u16.to_le_bytes());
    text.extend_from_slice(&[0u8; 14]);
    text.extend_from_slice(&13u16.to_le_bytes());
    section.extend_from_slice(&make_record(67, 1, &text));

    let mut comp =
        cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new())).unwrap();
    comp.create_stream("/FileHeader")
        .unwrap()
        .write_all(&header)
        .unwrap();
    comp.create_stream("/DocInfo")
        .unwrap()
        .write_all(&deflate_raw(&make_record(17, 0, &[0u8; 32])))
        .unwrap();
    comp.create_storage("/BodyText").unwrap();
    comp.create_stream("/BodyText/Section0")
        .unwrap()
        .write_all(&deflate_raw(&section))
        .unwrap();
    comp.create_stream("/PrvText")
        .unwrap()
        .write_all(b"o\x00l\x00d\x00")
        .unwrap();
    comp.flush().unwrap();
    comp.into_inner().into_inner()
}

/// Every stream of a compound file: its path and bytes, in path order.
fn compound_streams(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    use std::io::Read;
    let mut comp = cfb::CompoundFile::open(Cursor::new(bytes.to_vec())).unwrap();
    let mut paths: Vec<String> = comp
        .walk()
        .filter(|entry| entry.is_stream())
        .map(|entry| entry.path().to_string_lossy().into_owned())
        .collect();
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let mut data = Vec::new();
            comp.open_stream(&path)
                .unwrap()
                .read_to_end(&mut data)
                .unwrap();
            (path, data)
        })
        .collect()
}

fn hwp_fix() -> HwpFixPayload {
    HwpFixPayload {
        format: MobileDocFormat::Hwp,
        measured_tabs: vec![MeasuredTab {
            sec: 0,
            para: 0,
            cells: vec![],
            tab: 0,
            tabs: 1,
            width: 4000,
            r#type: 0,
            fill: 0,
        }],
        preview: Some(SavePreviewInput {
            text: "updated preview".into(),
            image_base64: None,
        }),
        memos: None,
    }
}

struct Env {
    tmp: tempfile::TempDir,
    bridge: Arc<HostFileBridge>,
    files: Arc<MobileFileService>,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let cache = tmp.path().join("cache");
    std::fs::create_dir_all(&cache).unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    bridge.set_cache_dir(&cache);
    let files = Arc::new(MobileFileService::new(tmp.path().join("data"), bridge.clone()).unwrap());
    Env { tmp, bridge, files }
}

impl Env {
    fn open(&self, uri: &str, name: &str, bytes: &[u8]) -> String {
        self.bridge.set_next_pick_open(MockPickedDoc {
            uri: uri.into(),
            name: name.into(),
            bytes: bytes.to_vec(),
            writable: true,
            ephemeral: false,
        });
        let ext = name.rsplit('.').next().unwrap().to_string();
        let session = self.files.pick_open_file(&[ext]).unwrap();
        self.files.read_file_bytes(&session.session_id).unwrap();
        session.session_id
    }

    fn file(&self, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = self.tmp.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn work_dir_is_empty(&self) -> bool {
        let dir = self.tmp.path().join("cache").join("ieum-tmp/home/write");
        !dir.exists() || std::fs::read_dir(dir).unwrap().next().is_none()
    }
}

/// More than 14.3 MiB: its base64 form is over the 20,000,000-character string limit the
/// Android side put on the old byte argument.
fn large_text() -> Vec<u8> {
    (0..16_000_000u32).map(|i| b'a' + (i % 26) as u8).collect()
}

#[test]
fn a_large_document_saves_from_a_file_byte_for_byte() {
    let e = env();
    let sid = e.open("content://docs/big.md", "big.md", b"# old");
    let payload = large_text();
    let src = e.file("big-new.md", &payload);

    let res = e.files.save_file_from_path(&sid, &src, None).unwrap();

    assert!(res.ok);
    assert!(e.bridge.read_stored_uri("content://docs/big.md").unwrap() == payload);
    assert!(e.work_dir_is_empty());
}

#[test]
fn the_file_and_byte_saves_write_the_same_hwp_and_both_back_up_the_original() {
    let original = sample_hwp();

    let by_bytes = env();
    let sid = by_bytes.open("content://docs/report.hwp", "report.hwp", &original);
    let a = by_bytes
        .files
        .save_file_bytes(&sid, &B64.encode(&original), Some(hwp_fix()))
        .unwrap();

    let by_file = env();
    let sid = by_file.open("content://docs/report.hwp", "report.hwp", &original);
    let src = by_file.file("report-new.hwp", &original);
    let b = by_file
        .files
        .save_file_from_path(&sid, &src, Some(hwp_fix()))
        .unwrap();

    let written_a = by_bytes
        .bridge
        .read_stored_uri("content://docs/report.hwp")
        .unwrap();
    let written_b = by_file
        .bridge
        .read_stored_uri("content://docs/report.hwp")
        .unwrap();
    assert_ne!(written_a, original, "the save fixes changed the document");
    // The compound file stamps each save with the time (8 bytes of directory entries), so two
    // saves never match byte for byte; every stream (names and contents) must.
    assert_eq!(written_a.len(), written_b.len());
    assert_eq!(compound_streams(&written_a), compound_streams(&written_b));
    assert!(a.backup_id.is_some());
    assert!(b.backup_id.is_some());
    assert_eq!(a.tails_lost, b.tails_lost);
    assert_eq!(a.memos_lost, b.memos_lost);
}

#[test]
fn save_as_from_a_file_writes_what_save_as_from_bytes_writes() {
    let payload = large_text();

    let by_bytes = env();
    by_bytes
        .bridge
        .set_next_save_as_uri("content://docs/copy-a.md");
    by_bytes
        .files
        .save_as_file_bytes(
            None,
            "copy.md",
            MobileDocFormat::Md,
            &B64.encode(&payload),
            None,
        )
        .unwrap();

    let by_file = env();
    by_file
        .bridge
        .set_next_save_as_uri("content://docs/copy-b.md");
    let src = by_file.file("copy.md", &payload);
    let session = by_file
        .files
        .save_as_file_from_path(None, "copy.md", MobileDocFormat::Md, &src, None)
        .unwrap();

    assert_eq!(session.name, "copy.md");
    let a = by_bytes
        .bridge
        .read_stored_uri("content://docs/copy-a.md")
        .unwrap();
    let b = by_file
        .bridge
        .read_stored_uri("content://docs/copy-b.md")
        .unwrap();
    assert!(a == payload && b == payload);
}

#[test]
fn copies_the_open_document_into_a_file() {
    let e = env();
    let payload = large_text();
    let sid = e.open("content://docs/big.md", "big.md", &payload);
    let dest = e.tmp.path().join("work").join("copy.md");

    let n = e.files.copy_session_to_file(&sid, &dest).unwrap();

    assert_eq!(n, payload.len() as u64);
    assert!(std::fs::read(&dest).unwrap() == payload);
}

#[test]
fn copies_the_bundled_sample_into_a_file() {
    let e = env();
    let home = HomeService::new(e.files.clone(), "1.0.0").unwrap();
    let session = home.open_sample("ko").unwrap();
    let dest = e.tmp.path().join("sample.hwpx");

    e.files
        .copy_session_to_file(&session.session_id, &dest)
        .unwrap();

    let bundled = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/storage/samples/welcome-ko.hwpx"),
    )
    .unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), bundled);
}

#[test]
fn a_write_that_breaks_halfway_leaves_the_original_and_says_so() {
    let e = env();
    let original = b"# keep this".to_vec();
    let sid = e.open("content://docs/notes.md", "notes.md", &original);
    let src = e.file("notes-new.md", &large_text());
    e.bridge.fail_next_stream_after(1000);

    let err = e.files.save_file_from_path(&sid, &src, None).unwrap_err();

    assert_eq!(err.code, MobileErrorCode::InternalError);
    assert_eq!(
        e.bridge.read_stored_uri("content://docs/notes.md").unwrap(),
        original
    );
    assert!(e.work_dir_is_empty());
}

#[test]
fn a_read_only_document_is_refused_before_anything_is_written() {
    let e = env();
    e.bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://docs/ro.md".into(),
        name: "ro.md".into(),
        bytes: b"ro".to_vec(),
        writable: false,
        ephemeral: false,
    });
    let session = e.files.pick_open_file(&["md".into()]).unwrap();
    let src = e.file("ro-new.md", b"new");

    let err = e
        .files
        .save_file_from_path(&session.session_id, &src, None)
        .unwrap_err();

    assert_eq!(err.code, MobileErrorCode::ReadOnlyUri);
    assert_eq!(e.bridge.stream_count(), 0);
}
