use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use flate2::{Compression, write::DeflateEncoder};
use ieumoffice_mobile_lib::error::MobileErrorCode;
use ieumoffice_mobile_lib::hwp::{HwpFixPayload, MeasuredTab, SavePreviewInput};
use ieumoffice_mobile_lib::storage::{
    MobileAppPrefsPatch, MobileDocFormat, MobileFileService, MobileShareMode, RestoreTarget,
};
use std::io::{Cursor, Write};
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

fn make_file_header(flags: u32) -> Vec<u8> {
    let mut header = vec![0u8; 256];
    let sig = b"HWP Document File";
    header[..sig.len()].copy_from_slice(sig);
    header[32..36].copy_from_slice(&0x0501_0000u32.to_le_bytes());
    header[36..40].copy_from_slice(&flags.to_le_bytes());
    header
}

fn build_hwp5(flags: u32, sections: &[&[u8]], extras: &[(&str, &[u8])]) -> Vec<u8> {
    let compressed = (flags & 0x0001) != 0;
    let mut comp =
        cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new())).unwrap();
    {
        let mut s = comp.create_stream("/FileHeader").unwrap();
        s.write_all(&make_file_header(flags)).unwrap();
    }
    {
        let doc_info = make_record(17, 0, &[0u8; 32]);
        let data = if compressed {
            deflate_raw(&doc_info)
        } else {
            doc_info
        };
        let mut s = comp.create_stream("/DocInfo").unwrap();
        s.write_all(&data).unwrap();
    }
    if !sections.is_empty() {
        comp.create_storage("/BodyText").unwrap();
        for (idx, sec) in sections.iter().enumerate() {
            let data = if compressed {
                deflate_raw(sec)
            } else {
                sec.to_vec()
            };
            let mut s = comp.create_stream(format!("/BodyText/Section{idx}")).unwrap();
            s.write_all(&data).unwrap();
        }
    }
    for (path, data) in extras {
        if let Some(pos) = path.rfind('/')
            && pos > 0
        {
            comp.create_storage_all(&path[..pos]).unwrap();
        }
        let mut s = comp.create_stream(path).unwrap();
        s.write_all(data).unwrap();
    }
    comp.flush().unwrap();
    comp.into_inner().into_inner()
}

/// Build a section stream containing a single paragraph with one empty-width tab control (char 9).
fn section_with_empty_tab() -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&make_record(66, 0, &[0u8; 22]));
    // PARA_TEXT (tag 67, level 1): 'A', TAB (9) + 14 zero bytes (extended char = 16 bytes), '\r' (13)
    let mut text = Vec::new();
    text.extend_from_slice(&0x0041u16.to_le_bytes());
    text.extend_from_slice(&9u16.to_le_bytes());
    text.extend_from_slice(&[0u8; 14]);
    text.extend_from_slice(&13u16.to_le_bytes());
    out.extend_from_slice(&make_record(67, 1, &text));
    out
}

#[test]
fn untitled_session_and_ephemeral_share_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    let untitled = svc.create_untitled_session(MobileDocFormat::Md).unwrap();
    assert!(!untitled.writable);
    assert!(!untitled.ephemeral);
    assert!(untitled.doc_key.starts_with("untitled-"));

    // Ephemeral share-in intent opens without registering in recent docs
    bridge.enqueue_open_intent(MockPickedDoc {
        uri: "content://kakao/tmp/shared.md".into(),
        name: "shared.md".into(),
        bytes: b"# Hello".to_vec(),
        writable: false,
        ephemeral: true,
    });
    let shared = svc.consume_pending_open_intent().unwrap().unwrap();
    assert!(shared.ephemeral);
    assert!(!shared.writable);
    assert!(shared.doc_key.starts_with("untitled-"));
    assert!(svc.list_recent_docs().unwrap().is_empty());

    // Attempting in-place save on ephemeral session fails with READ_ONLY_URI
    let err = svc
        .save_file_bytes(&shared.session_id, &B64.encode(b"# Edited"), None)
        .unwrap_err();
    assert_eq!(err.code, MobileErrorCode::ReadOnlyUri);

    // Explicit Save As creates a persistent writable session and registers it in recent docs
    bridge.set_next_save_as_uri("content://docs/persisted.md");
    let saved_as = svc
        .save_as_file_bytes(
            Some(&shared.session_id),
            "persisted.md",
            MobileDocFormat::Md,
            &B64.encode(b"# Saved"),
            None,
        )
        .unwrap();
    assert!(saved_as.writable);
    assert!(!saved_as.ephemeral);
    assert_eq!(saved_as.doc_key.len(), 16);
    assert_eq!(svc.list_recent_docs().unwrap().len(), 1);
}

#[test]
fn recent_doc_permission_expiry_returns_permission_denied() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://docs/note.md".into(),
        name: "note.md".into(),
        bytes: b"hello".to_vec(),
        writable: true,
        ephemeral: false,
    });
    let opened = svc.pick_open_file(&["md".into()]).unwrap();
    let recents = svc.list_recent_docs().unwrap();
    assert_eq!(recents.len(), 1);
    assert_eq!(recents[0].doc_key, opened.doc_key);

    // Revoke URI permission on OS side -> mobile_open_recent_doc returns PERMISSION_DENIED
    bridge.revoke_uri("content://docs/note.md");
    let err = svc.open_recent_doc(&recents[0].id).unwrap_err();
    assert_eq!(err.code, MobileErrorCode::PermissionDenied);
}

#[test]
fn hwp_tracked_changes_stripped_and_encrypted_blocked_on_save_and_edited_share() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    // 1. Tracked-changes HWP5 strips ViewText and reports tracking_dropped = true
    let sec0 = section_with_empty_tab();
    let tracked = build_hwp5(
        0x0001 | 0x4000,
        &[&sec0],
        &[("/ViewText/Section0", b"old-view")],
    );
    bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://docs/tracked.hwp".into(),
        name: "tracked.hwp".into(),
        bytes: tracked,
        writable: true,
        ephemeral: false,
    });
    let s1 = svc.pick_open_file(&["hwp".into()]).unwrap();
    let read1 = svc.read_file_bytes(&s1.session_id).unwrap();
    assert_eq!(read1.tracking_dropped, Some(true));
    assert_eq!(read1.encrypted, Some(false));

    // 2. Encrypted HWP5 blocks save AND mode='edited' share, but allows mode='original' share
    let encrypted_bytes = build_hwp5(0x0001 | 0x0002, &[&sec0], &[]);
    bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://docs/secret.hwp".into(),
        name: "secret.hwp".into(),
        bytes: encrypted_bytes.clone(),
        writable: true,
        ephemeral: false,
    });
    let s2 = svc.pick_open_file(&["hwp".into()]).unwrap();
    let read2 = svc.read_file_bytes(&s2.session_id).unwrap();
    assert_eq!(read2.encrypted, Some(true));

    let save_err = svc
        .save_file_bytes(&s2.session_id, &B64.encode(&encrypted_bytes), None)
        .unwrap_err();
    assert_eq!(save_err.code, MobileErrorCode::PasswordProtected);

    let share_edited_err = svc
        .share_file(
            &s2.session_id,
            "secret.hwp",
            MobileShareMode::Edited,
            Some(&B64.encode(b"decrypted-bytes")),
        )
        .unwrap_err();
    assert_eq!(share_edited_err.code, MobileErrorCode::PasswordProtected);

    svc.share_file(&s2.session_id, "secret.hwp", MobileShareMode::Original, None)
        .unwrap();
    let shared = bridge.last_shared_bytes().unwrap();
    assert_eq!(shared, encrypted_bytes);

    // Encrypted docs never write recovery copies
    svc.recovery_write(
        &s2.doc_key,
        MobileDocFormat::Hwp,
        "secret.hwp",
        &B64.encode(b"should-not-write"),
    )
    .unwrap();
    assert!(svc.recovery_list().unwrap().is_empty());
}

#[test]
fn hwp_save_fixes_and_pre_overwrite_backup_gate() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();

    let sec0 = section_with_empty_tab();
    let orig_hwp = build_hwp5(
        0x0001,
        &[&sec0],
        &[
            ("/PrvText", b"o\x00l\x00d\x00"),
            ("/PrvImage", &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ],
    );
    bridge.set_next_pick_open(MockPickedDoc {
        uri: "content://docs/report.hwp".into(),
        name: "report.hwp".into(),
        bytes: orig_hwp.clone(),
        writable: true,
        ephemeral: false,
    });
    let session = svc.pick_open_file(&["hwp".into()]).unwrap();
    svc.read_file_bytes(&session.session_id).unwrap();

    // Detect empty tab spot
    let spots = svc
        .hwp_new_tabs(&session.session_id, &B64.encode(&orig_hwp), MobileDocFormat::Hwp)
        .unwrap();
    assert_eq!(spots.len(), 1);
    assert_eq!(spots[0].sec, 0);
    assert_eq!(spots[0].para, 0);

    // If backup write fails, overwrite MUST abort with BACKUP_FAILED and original bytes stay intact
    svc.set_fail_backup_for_test(true);
    let err = svc
        .save_file_bytes(
            &session.session_id,
            &B64.encode(&orig_hwp),
            Some(HwpFixPayload {
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
            }),
        )
        .unwrap_err();
    assert_eq!(err.code, MobileErrorCode::BackupFailed);
    assert_eq!(
        bridge.read_stored_uri("content://docs/report.hwp").unwrap(),
        orig_hwp
    );

    // Now allow backup -> first overwrite creates 1 backup, writes patched tab width & new PrvText
    svc.set_fail_backup_for_test(false);
    let res = svc
        .save_file_bytes(
            &session.session_id,
            &B64.encode(&orig_hwp),
            Some(HwpFixPayload {
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
            }),
        )
        .unwrap();
    assert!(res.ok);
    let backup_id = res.backup_id.expect("first overwrite must create backup");
    let written = bridge.read_stored_uri("content://docs/report.hwp").unwrap();
    assert_ne!(written, orig_hwp);

    // Patched tab should no longer appear as empty
    let spots_after = svc
        .hwp_new_tabs(&session.session_id, &B64.encode(&written), MobileDocFormat::Hwp)
        .unwrap();
    assert!(spots_after.is_empty());

    // Preview text updated
    let prv_text = hwp5_wasm::read_stream_inner(&written, "/PrvText", false).unwrap();
    let expected_utf16: Vec<u8> = "updated preview"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    assert_eq!(prv_text, expected_utf16);

    // Restore backup in-place brings original bytes back
    let backups = svc.hwp_backup_list().unwrap();
    assert_eq!(backups.len(), 1);
    svc.hwp_backup_restore(&backup_id, RestoreTarget::InPlace)
        .unwrap();
    assert_eq!(
        bridge.read_stored_uri("content://docs/report.hwp").unwrap(),
        orig_hwp
    );

    // Delete backup
    svc.hwp_backup_delete(&backup_id).unwrap();
    assert!(svc.hwp_backup_list().unwrap().is_empty());
}

#[test]
fn recovery_lifecycle_and_prefs_persistence() {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge).unwrap();

    svc.recovery_write(
        "doc1234567890abc",
        MobileDocFormat::Md,
        "Draft.md",
        &B64.encode(b"# Draft"),
    )
    .unwrap();
    let list = svc.recovery_list().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].doc_key, "doc1234567890abc");

    let bytes_b64 = svc.recovery_read("doc1234567890abc").unwrap();
    assert_eq!(B64.decode(bytes_b64).unwrap(), b"# Draft");

    svc.recovery_discard("doc1234567890abc").unwrap();
    assert!(svc.recovery_list().unwrap().is_empty());

    let prefs = svc
        .set_app_prefs(MobileAppPrefsPatch {
            lang: Some("ko".into()),
            theme: Some("dark".into()),
            hwp_default_format: Some(MobileDocFormat::Hwpx),
            ai_enabled: Some(false),
        })
        .unwrap();
    assert_eq!(prefs.lang, "ko");
    assert_eq!(prefs.theme, "dark");
    assert_eq!(prefs.hwp_default_format, MobileDocFormat::Hwpx);
    assert!(!prefs.ai_enabled);
    assert_eq!(svc.get_app_prefs().unwrap(), prefs);
}
