use ieumoffice_mobile_lib::error::MobileErrorCode;
use ieumoffice_mobile_lib::storage::{MobileDocFormat, MobileDocSession, MobileFileService};
use std::sync::Arc;
use tauri_plugin_ieum_mobile::fs::{HostFileBridge, MockPickedDoc};

const ALL_FORMATS: [(MobileDocFormat, &str, &str); 12] = [
    (MobileDocFormat::Hwp, "hwp", "application/x-hwp"),
    (MobileDocFormat::Hwpx, "hwpx", "application/haansofthwpx"),
    (MobileDocFormat::Md, "md", "text/markdown"),
    (MobileDocFormat::Txt, "txt", "text/plain"),
    (MobileDocFormat::Pdf, "pdf", "application/pdf"),
    (MobileDocFormat::Html, "html", "text/html"),
    (
        MobileDocFormat::Xlsx,
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    (
        MobileDocFormat::Xlsm,
        "xlsm",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
    ),
    (MobileDocFormat::Xls, "xls", "application/vnd.ms-excel"),
    (MobileDocFormat::Csv, "csv", "text/csv"),
    (MobileDocFormat::Epub, "epub", "application/epub+zip"),
    (
        MobileDocFormat::Pptx,
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
];

#[test]
fn from_name_maps_every_listed_extension() {
    let cases = [
        ("a.hwp", MobileDocFormat::Hwp),
        ("a.hwpx", MobileDocFormat::Hwpx),
        ("a.md", MobileDocFormat::Md),
        ("a.markdown", MobileDocFormat::Md),
        ("a.txt", MobileDocFormat::Txt),
        ("a.pdf", MobileDocFormat::Pdf),
        ("a.html", MobileDocFormat::Html),
        ("a.htm", MobileDocFormat::Html),
        ("a.xlsx", MobileDocFormat::Xlsx),
        ("a.xlsm", MobileDocFormat::Xlsm),
        ("a.xls", MobileDocFormat::Xls),
        ("a.csv", MobileDocFormat::Csv),
        ("a.epub", MobileDocFormat::Epub),
        ("a.pptx", MobileDocFormat::Pptx),
    ];
    for (name, expected) in cases {
        assert_eq!(MobileDocFormat::from_name(name), expected, "{name}");
    }
}

#[test]
fn from_name_ignores_case() {
    let cases = [
        ("REPORT.HWPX", MobileDocFormat::Hwpx),
        ("Report.Hwp", MobileDocFormat::Hwp),
        ("Notes.MarkDown", MobileDocFormat::Md),
        ("SCAN.PDF", MobileDocFormat::Pdf),
        ("Page.HTM", MobileDocFormat::Html),
        ("Book.XLSX", MobileDocFormat::Xlsx),
        ("Macro.XlSm", MobileDocFormat::Xlsm),
        ("Old.XLS", MobileDocFormat::Xls),
        ("Data.CSV", MobileDocFormat::Csv),
        ("Novel.EPUB", MobileDocFormat::Epub),
        ("Deck.PPTX", MobileDocFormat::Pptx),
        ("Plain.TXT", MobileDocFormat::Txt),
    ];
    for (name, expected) in cases {
        assert_eq!(MobileDocFormat::from_name(name), expected, "{name}");
    }
}

#[test]
fn from_name_falls_back_to_md_for_unknown_extensions() {
    for name in [
        "a.docx", "a.ppt", "a.odt", "a.json", "noext", "a.", "a.xl", "a.htmlx",
    ] {
        assert_eq!(
            MobileDocFormat::from_name(name),
            MobileDocFormat::Md,
            "{name}"
        );
    }
}

#[test]
fn ext_and_mime_cover_every_format() {
    for (format, ext, mime) in ALL_FORMATS {
        assert_eq!(format.ext(), ext, "{format:?}");
        assert_eq!(format.mime(), mime, "{format:?}");
        // ext() round-trips through from_name.
        assert_eq!(MobileDocFormat::from_name(&format!("x.{ext}")), format);
    }
}

#[test]
fn serde_values_are_lowercase_ext_names() {
    for (format, ext, _) in ALL_FORMATS {
        let json = serde_json::to_string(&format).unwrap();
        assert_eq!(json, format!("\"{ext}\""));
        let back: MobileDocFormat = serde_json::from_str(&json).unwrap();
        assert_eq!(back, format);
    }
}

#[test]
fn hwp_family_is_still_only_the_two_hangul_formats() {
    for (format, _, _) in ALL_FORMATS {
        let expected = matches!(format, MobileDocFormat::Hwp | MobileDocFormat::Hwpx);
        assert_eq!(format.is_hwp_family(), expected, "{format:?}");
    }
}

fn doc(uri: &str, name: &str, writable: bool, ephemeral: bool) -> MockPickedDoc {
    MockPickedDoc {
        uri: uri.into(),
        name: name.into(),
        bytes: b"content".to_vec(),
        writable,
        ephemeral,
    }
}

fn new_service() -> (tempfile::TempDir, Arc<HostFileBridge>, MobileFileService) {
    let tmp = tempfile::tempdir().unwrap();
    let bridge = Arc::new(HostFileBridge::new());
    let svc = MobileFileService::new(tmp.path().to_path_buf(), bridge.clone()).unwrap();
    (tmp, bridge, svc)
}

fn hangul_and_markdown_gate() -> Vec<String> {
    ["hwp", "hwpx", "md", "markdown", "txt"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn open_base_doc(bridge: &HostFileBridge, svc: &MobileFileService) -> MobileDocSession {
    bridge.set_next_pick_open(doc("content://docs/base.md", "base.md", true, false));
    svc.pick_open_file(&["md".into()]).unwrap()
}

fn assert_still_active(svc: &MobileFileService, session: &MobileDocSession) {
    // read_file_bytes only succeeds for the active session.
    svc.read_file_bytes(&session.session_id).unwrap();
}

fn assert_not_openable(err: ieumoffice_mobile_lib::error::MobileError, ext: &str) {
    assert_eq!(err.code, MobileErrorCode::InvalidArgument);
    assert_eq!(err.message_key, "mobile.format.notOpenable");
    assert_eq!(err.detail.as_deref(), Some(ext));
}

#[test]
fn gate_refuses_picked_pdf_before_recent_and_session_change() {
    let (_tmp, bridge, svc) = new_service();
    let base = open_base_doc(&bridge, &svc);
    svc.set_openable_formats(&hangul_and_markdown_gate());

    bridge.set_next_pick_open(doc("content://docs/scan.pdf", "scan.pdf", true, false));
    let err = svc.pick_open_file(&["pdf".into()]).unwrap_err();
    assert_not_openable(err, "pdf");

    let recents = svc.list_recent_docs().unwrap();
    assert_eq!(recents.len(), 1);
    assert_eq!(recents[0].doc_key, base.doc_key);
    assert_still_active(&svc, &base);
}

#[test]
fn gate_refuses_incoming_pdf_intent() {
    let (_tmp, bridge, svc) = new_service();
    let base = open_base_doc(&bridge, &svc);
    svc.set_openable_formats(&hangul_and_markdown_gate());

    bridge.enqueue_open_intent(doc("content://share/in.pdf", "in.pdf", true, false));
    let err = svc.consume_pending_open_intent().unwrap_err();
    assert_not_openable(err, "pdf");

    let recents = svc.list_recent_docs().unwrap();
    assert_eq!(recents.len(), 1);
    assert_eq!(recents[0].doc_key, base.doc_key);
    assert_still_active(&svc, &base);
}

#[test]
fn gate_refuses_recent_pdf_opened_before_the_gate_was_set() {
    let (_tmp, bridge, svc) = new_service();
    bridge.set_next_pick_open(doc("content://docs/old.pdf", "old.pdf", true, false));
    let pdf = svc.pick_open_file(&["pdf".into()]).unwrap();
    assert_eq!(pdf.format, MobileDocFormat::Pdf);
    let recents = svc.list_recent_docs().unwrap();
    assert_eq!(recents.len(), 1);
    assert_eq!(recents[0].format, MobileDocFormat::Pdf);
    let pdf_recent = recents[0].clone();

    let base = open_base_doc(&bridge, &svc);
    svc.set_openable_formats(&hangul_and_markdown_gate());

    let err = svc.open_recent_doc(&pdf_recent.id).unwrap_err();
    assert_not_openable(err, "pdf");

    // The refused entry is not bumped and the open document stays active.
    let after = svc.list_recent_docs().unwrap();
    let still = after.iter().find(|e| e.id == pdf_recent.id).unwrap();
    assert_eq!(still.opened_at, pdf_recent.opened_at);
    assert_still_active(&svc, &base);
}

#[test]
fn gate_allows_listed_formats_and_unknown_extensions_as_md() {
    let (_tmp, bridge, svc) = new_service();
    svc.set_openable_formats(&hangul_and_markdown_gate());

    bridge.set_next_pick_open(doc("content://docs/a.md", "a.md", true, false));
    let md = svc.pick_open_file(&["md".into()]).unwrap();
    assert_eq!(md.format, MobileDocFormat::Md);

    bridge.set_next_pick_open(doc("content://docs/b.docx", "b.docx", true, false));
    let docx = svc.pick_open_file(&["md".into()]).unwrap();
    assert_eq!(docx.format, MobileDocFormat::Md);

    bridge.enqueue_open_intent(doc("content://share/c.txt", "c.txt", true, false));
    let txt = svc.consume_pending_open_intent().unwrap().unwrap();
    assert_eq!(txt.format, MobileDocFormat::Txt);
    assert_still_active(&svc, &txt);
}

#[test]
fn gate_can_be_replaced() {
    let (_tmp, bridge, svc) = new_service();
    svc.set_openable_formats(&hangul_and_markdown_gate());
    bridge.set_next_pick_open(doc("content://docs/scan.pdf", "scan.pdf", true, false));
    assert_not_openable(svc.pick_open_file(&["pdf".into()]).unwrap_err(), "pdf");

    svc.set_openable_formats(&["pdf".to_string()]);
    bridge.set_next_pick_open(doc("content://docs/scan.pdf", "scan.pdf", true, false));
    let pdf = svc.pick_open_file(&["pdf".into()]).unwrap();
    assert_eq!(pdf.format, MobileDocFormat::Pdf);

    bridge.set_next_pick_open(doc("content://docs/a.md", "a.md", true, false));
    assert_not_openable(svc.pick_open_file(&["md".into()]).unwrap_err(), "md");
}

#[test]
fn without_a_gate_every_format_opens() {
    let (_tmp, bridge, svc) = new_service();
    for (format, ext, _) in ALL_FORMATS {
        let name = format!("file.{ext}");
        bridge.set_next_pick_open(doc(&format!("content://docs/{name}"), &name, true, false));
        let session = svc.pick_open_file(&[ext.into()]).unwrap();
        assert_eq!(session.format, format);
        assert_eq!(session.ext, ext);
    }
    bridge.enqueue_open_intent(doc("content://share/in.pdf", "in.pdf", false, true));
    let shared = svc.consume_pending_open_intent().unwrap().unwrap();
    assert_eq!(shared.format, MobileDocFormat::Pdf);
    assert_eq!(svc.list_recent_docs().unwrap().len(), ALL_FORMATS.len());
}
