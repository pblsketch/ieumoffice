//! Tests for the in-process engine dispatch. Fixtures are written by hand
//! (a minimal SpreadsheetML package) so the tests need no extra crates.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};

use crate::dispatch::{
    CancelledRequests, Dispatched, InFlightRequest, Request, Response, handle_request,
};
use crate::path_guard::is_within;
use crate::recalc_worker::RecalcWorker;
use crate::{PATH_OUTSIDE_WORK_FOLDER, SheetsEngine};

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#;

const WORKBOOK: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#;

const WORKBOOK_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;

const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#;

fn sheet_xml(a1: i64) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1"><v>{a1}</v></c></row><row r="2"><c r="A2"><f>A1*2</f><v>{}</v></c></row></sheetData></worksheet>"#,
        a1 * 2
    )
}

/// A one-sheet workbook: A1 = `a1`, A2 = `=A1*2` with its cached value.
fn write_workbook(path: &Path, a1: i64) {
    write_workbook_with_styles(path, a1, STYLES);
}

/// The same workbook without `<cellStyles>`: Excel opens it, but IronCalc's
/// importer panics on it (index out of bounds), which the engine turns into
/// `workbook_error` for that `recalc_cells` request.
fn write_workbook_ironcalc_panics_on(path: &Path) {
    let styles = STYLES.replace(
        r#"<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>"#,
        "",
    );
    assert_ne!(styles, STYLES);
    write_workbook_with_styles(path, 3, &styles);
}

fn write_workbook_with_styles(path: &Path, a1: i64, styles: &str) {
    let file = File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let sheet = sheet_xml(a1);
    for (name, body) in [
        ("[Content_Types].xml", CONTENT_TYPES),
        ("_rels/.rels", ROOT_RELS),
        ("xl/workbook.xml", WORKBOOK),
        ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
        ("xl/styles.xml", styles),
        ("xl/worksheets/sheet1.xml", sheet.as_str()),
    ] {
        zip.start_file(name, options).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
}

fn line(value: Value) -> String {
    value.to_string()
}

fn expect_ok(response: Response) -> Value {
    assert!(
        response.ok,
        "{:?}",
        response.error.map(|error| (error.code, error.message))
    );
    response.result.unwrap()
}

fn expect_err(response: Response) -> (&'static str, String) {
    assert!(
        !response.ok,
        "expected a failure, got {:?}",
        response.result
    );
    let error = response.error.unwrap();
    (error.code, error.message)
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    source: PathBuf,
    engine: SheetsEngine,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("work");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("book.xlsx");
    write_workbook(&source, 10);
    let engine = SheetsEngine::new(Some(root.clone()));
    Fixture {
        _dir: dir,
        root,
        source,
        engine,
    }
}

fn recalc_request(id: &str, path: &Path, edits: Value) -> String {
    line(json!({
        "version": 1,
        "requestId": id,
        "command": "recalc_cells",
        "path": path,
        "edits": edits,
        "reads": [{
            "sheet": "Sheet1",
            "range": { "startRow": 0, "endRow": 1, "startColumn": 0, "endColumn": 0 },
        }],
    }))
}

fn formatted_cells(result: &Value) -> Vec<String> {
    result["cells"]
        .as_array()
        .unwrap()
        .iter()
        .map(|cell| cell["formatted"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn round_trip_open_read_manifest_entries_save_recalc() {
    let fx = fixture();
    let engine = &fx.engine;

    let opened = expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "o1", "command": "open", "path": fx.source,
    }))));
    let session_id = opened["sessionId"].as_str().unwrap().to_owned();
    let sheet_id = opened["sheets"][0]["id"].as_str().unwrap().to_owned();
    assert_eq!(sheet_id, "sheet-1");

    let range = expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "r1", "command": "read_range",
        "sessionId": session_id, "sheetId": sheet_id,
        "range": { "startRow": 0, "endRow": 1, "startColumn": 0, "endColumn": 0 },
    }))));
    let cells = range["cells"].as_array().unwrap();
    assert_eq!(cells.len(), 2, "{range}");
    assert_eq!(cells[1]["formula"], json!("=A1*2"));

    let manifest = expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "m1", "command": "archive_manifest", "path": fx.source,
    }))));
    let names: Vec<&str> = manifest["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"xl/worksheets/sheet1.xml"), "{names:?}");

    let out_dir = fx.root.join("entries");
    fs::create_dir(&out_dir).unwrap();
    let extracted = expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "e1", "command": "read_entries", "path": fx.source,
        "entries": ["xl/worksheets/sheet1.xml"], "outputDir": out_dir,
    }))));
    let entry_path = PathBuf::from(extracted["entries"][0]["path"].as_str().unwrap());
    let original = fs::read_to_string(&entry_path).unwrap();
    assert_eq!(original, sheet_xml(10));

    // Patch A1 to 21 (cached A2 left as the file had it, like the host does
    // before its stale-formula refresh) and save to a new target.
    let patched_path = fx.root.join("sheet1.patched.xml");
    fs::write(&patched_path, original.replace("<v>10</v>", "<v>21</v>")).unwrap();
    let target = fx.root.join("saved.xlsx");
    let saved = expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "s1", "command": "save_archive",
        "sourcePath": fx.source, "targetPath": target,
        "replacements": [{ "name": "xl/worksheets/sheet1.xml", "contentPath": patched_path }],
        "removals": [], "additions": [],
    }))));
    let before = saved["beforeEntries"].as_array().unwrap();
    let after = saved["afterEntries"].as_array().unwrap();
    assert_eq!(before.len(), after.len());
    for (b, a) in before.iter().zip(after) {
        assert_eq!(b["name"], a["name"]);
        if b["name"] != json!("xl/worksheets/sheet1.xml") {
            // Untouched entries are copied byte for byte.
            assert_eq!(b, a);
        }
    }

    let recalced = expect_ok(engine.handle_line(&recalc_request("c1", &target, json!([]))));
    assert_eq!(formatted_cells(&recalced), vec!["21", "42"]);

    let edited = expect_ok(engine.handle_line(&recalc_request(
        "c2",
        &target,
        json!([{ "sheet": "Sheet1", "row": 0, "column": 0, "input": "5" }]),
    )));
    assert_eq!(formatted_cells(&edited), vec!["5", "10"]);

    let closed = expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "x1", "command": "close", "sessionId": session_id,
    }))));
    assert_eq!(closed, json!({ "closed": true }));
}

#[test]
fn unknown_session_answers_with_the_desktop_sentence() {
    let fx = fixture();
    let response = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "r", "command": "read_range",
        "sessionId": "nope", "sheetId": "sheet-1",
        "range": { "startRow": 0, "endRow": 0, "startColumn": 0, "endColumn": 0 },
    })));
    assert_eq!(response.request_id, "r");
    assert_eq!(response.version, 1);
    assert_eq!(
        expect_err(response),
        ("invalid_request", "Unknown workbook session.".to_owned())
    );
    let closed = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "c", "command": "close", "sessionId": "nope",
    })));
    assert_eq!(
        expect_err(closed),
        ("invalid_request", "Unknown workbook session.".to_owned())
    );
}

#[test]
fn version_mismatch_is_refused_for_queued_and_cancel_requests() {
    let fx = fixture();
    let open = fx.engine.handle_line(&line(json!({
        "version": 2, "requestId": "o", "command": "open", "path": fx.source,
    })));
    assert_eq!(
        expect_err(open),
        (
            "unsupported_version",
            "Unsupported sidecar protocol version.".to_owned()
        )
    );
    let cancel = fx.engine.handle_line(&line(json!({
        "version": 0, "requestId": "c", "command": "cancel", "targetRequestId": "o",
    })));
    assert_eq!(
        expect_err(cancel),
        (
            "unsupported_version",
            "Unsupported sidecar protocol version.".to_owned()
        )
    );
}

#[test]
fn malformed_lines_answer_invalid_json_with_an_empty_request_id() {
    let fx = fixture();
    let response = fx.engine.handle_line("{not json");
    assert_eq!(response.request_id, "");
    let (code, message) = expect_err(response);
    assert_eq!(code, "invalid_json");
    assert!(
        message.starts_with("Invalid sidecar request: "),
        "{message}"
    );

    let unknown = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "u", "command": "no_such_command",
    })));
    assert_eq!(expect_err(unknown).0, "invalid_json");
}

#[test]
fn overlapping_recalc_answers_busy_and_the_loop_stays_free() {
    let fx = fixture();
    let engine = &fx.engine;
    // A recalculation that has taken the busy flag but not finished yet.
    let job = engine
        .recalc
        .dispatch(
            "first".into(),
            fx.source.clone(),
            Vec::new(),
            Vec::new(),
            false,
        )
        .ok()
        .expect("the first recalc takes the flag");

    let busy = engine.handle_line(&recalc_request("second", &fx.source, json!([])));
    let (code, message) = expect_err(busy);
    assert_eq!(code, "recalc_busy");
    assert_eq!(
        message,
        "Formula engine is busy with another recalculation."
    );
    assert!(message.contains("busy with another recalculation"));

    // Other requests are not held up by the pending recalc.
    expect_ok(engine.handle_line(&line(json!({
        "version": 1, "requestId": "m", "command": "archive_manifest", "path": fx.source,
    }))));

    expect_ok(job.run());
    // The flag is released once the first one answered.
    expect_ok(engine.handle_line(&recalc_request("third", &fx.source, json!([]))));
}

#[test]
fn concurrent_recalc_from_two_threads_answers_one_busy() {
    let fx = fixture();
    let engine = Arc::new(fx.engine);
    let source = fx.source.clone();
    // Hold the formula cache so the first recalc parks after taking busy.
    let guard = engine.recalc.lock_cache_for_test();
    let first = {
        let engine = Arc::clone(&engine);
        let source = source.clone();
        std::thread::spawn(move || engine.handle_line(&recalc_request("a", &source, json!([]))))
    };
    // Wait until the first call holds the busy flag (it then parks on the
    // cache lock held above).
    for _ in 0..2500 {
        if engine.recalc.is_busy_for_test() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    assert!(
        engine.recalc.is_busy_for_test(),
        "the first recalc never started"
    );
    let busy = engine.handle_line(&recalc_request("b", &source, json!([])));
    drop(guard);
    let (code, _) = expect_err(busy);
    assert_eq!(code, "recalc_busy");
    expect_ok(first.join().unwrap());
}

#[test]
fn cancelled_requests_are_skipped_once() {
    let fx = fixture();
    let cancel = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "c", "command": "cancel", "targetRequestId": "victim",
    })));
    assert_eq!(expect_ok(cancel), json!({ "cancelled": true }));

    let open = line(json!({
        "version": 1, "requestId": "victim", "command": "open", "path": fx.source,
    }));
    assert_eq!(
        expect_err(fx.engine.handle_line(&open)),
        (
            "cancelled",
            "Request was cancelled by the client.".to_owned()
        )
    );
    expect_ok(fx.engine.handle_line(&open));
}

#[test]
fn a_cancel_for_the_running_request_trips_its_flag() {
    let fx = fixture();
    let in_flight = fx.engine.in_flight_for_test();
    in_flight.begin("running");
    expect_ok(fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "c", "command": "cancel", "targetRequestId": "running",
    }))));
    assert!(in_flight.flag().load(std::sync::atomic::Ordering::Acquire));
}

#[test]
fn cancel_during_an_in_flight_open_abandons_it() {
    let fx = fixture();
    let mut sessions = xlsx_sidecar::WorkbookSessions::new();
    let recalc = RecalcWorker::new();
    let cancelled = CancelledRequests::new();
    let in_flight = InFlightRequest::new();
    in_flight.begin("victim");
    in_flight.cancel("victim");
    let request: Request = serde_json::from_value(json!({
        "version": 1, "requestId": "victim", "command": "open", "path": fx.source,
    }))
    .unwrap();
    let Dispatched::Done(response) = handle_request(
        request,
        &mut sessions,
        &recalc,
        &cancelled,
        &in_flight,
        &|_| Ok(()),
    ) else {
        panic!("open is answered by the loop");
    };
    assert_eq!(
        expect_err(response),
        (
            "cancelled",
            "Request was cancelled by the client.".to_owned()
        )
    );
}

#[test]
fn save_archive_keeps_the_source_resident_model_warm() {
    let fx = fixture();
    let first = expect_ok(
        fx.engine
            .handle_line(&recalc_request("r", &fx.source, json!([]))),
    );
    assert_eq!(first["cached"], json!(false));
    expect_ok(fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "s", "command": "save_archive",
        "sourcePath": fx.source, "targetPath": fx.root.join("recovery.xlsx"),
        "replacements": [], "removals": [], "additions": [],
    }))));
    let second = expect_ok(
        fx.engine
            .handle_line(&recalc_request("r2", &fx.source, json!([]))),
    );
    assert_eq!(second["cached"], json!(true));
}

#[test]
fn close_purges_the_resident_model() {
    let fx = fixture();
    let opened = expect_ok(fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "o", "command": "open", "path": fx.source,
    }))));
    expect_ok(
        fx.engine
            .handle_line(&recalc_request("r", &fx.source, json!([]))),
    );
    expect_ok(fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "x", "command": "close", "sessionId": opened["sessionId"],
    }))));
    assert_eq!(fx.engine.recalc.pending_purge_count(), 0);
    let again = expect_ok(
        fx.engine
            .handle_line(&recalc_request("r2", &fx.source, json!([]))),
    );
    assert_eq!(again["cached"], json!(false));
}

#[test]
fn convert_workbook_answers_through_the_same_envelope() {
    let fx = fixture();
    let result = expect_ok(fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "c", "command": "convert_workbook",
        "path": fx.source, "targetPath": fx.root.join("converted.xlsx"),
    }))));
    assert_eq!(result["sheets"], json!(1));
    assert_eq!(result["cells"], json!(2));
    assert_eq!(result["formulasDropped"], json!(0));
}

#[test]
fn paths_outside_the_work_folder_are_refused() {
    let fx = fixture();
    let outside = fx._dir.path().join("outside.xlsx");
    write_workbook(&outside, 1);
    let open = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "o", "command": "open", "path": outside,
    })));
    assert_eq!(
        expect_err(open),
        ("invalid_request", PATH_OUTSIDE_WORK_FOLDER.to_owned())
    );

    let dotted = fx.root.join("..").join("outside.xlsx");
    let manifest = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "m", "command": "archive_manifest", "path": dotted,
    })));
    assert_eq!(expect_err(manifest).0, "invalid_request");

    let content = fx._dir.path().join("content.xml");
    fs::write(&content, "<x/>").unwrap();
    let save = fx.engine.handle_line(&line(json!({
        "version": 1, "requestId": "s", "command": "save_archive",
        "sourcePath": fx.source, "targetPath": fx.root.join("out.xlsx"),
        "replacements": [{ "name": "xl/styles.xml", "contentPath": content }],
        "removals": [], "additions": [],
    })));
    assert_eq!(
        expect_err(save),
        ("invalid_request", PATH_OUTSIDE_WORK_FOLDER.to_owned())
    );
    assert!(!fx.root.join("out.xlsx").exists());
}

#[test]
fn is_within_rejects_the_root_itself_and_parent_steps() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("w");
    fs::create_dir(&root).unwrap();
    assert!(is_within(&root, &root.join("f.xlsx")));
    assert!(!is_within(&root, &root));
    assert!(!is_within(&root, &root.join("x").join("..").join("f.xlsx")));
    assert!(!is_within(&root, Path::new("f.xlsx")));
}

/// Optional parity check against the desktop sidecar executable. Runs only
/// when `IEUM_XLSX_SIDECAR_EXE` names a built `xlsx-sidecar` binary: the same
/// request lines go to the process and to the in-process dispatch, and the
/// responses must be equal once per-run values (paths, session ids) are
/// replaced by placeholders.
#[test]
fn responses_match_the_desktop_sidecar_executable() {
    let Some(exe) = std::env::var_os("IEUM_XLSX_SIDECAR_EXE") else {
        eprintln!("skipped: IEUM_XLSX_SIDECAR_EXE is not set");
        return;
    };
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let run = |dir: &Path, send: &dyn Fn(&str) -> String| -> Vec<String> {
        let source = dir.join("book.xlsx");
        write_workbook(&source, 10);
        let out_dir = dir.join("entries");
        fs::create_dir_all(&out_dir).unwrap();
        let patched = dir.join("patched.xml");
        fs::write(&patched, sheet_xml(21)).unwrap();
        let panicking = dir.join("no-cell-styles.xlsx");
        write_workbook_ironcalc_panics_on(&panicking);
        let mut answers = Vec::new();
        let opened = send(&line(json!({
            "version": 1, "requestId": "o", "command": "open", "path": source,
        })));
        let session = parse(&opened)["result"]["sessionId"].clone();
        answers.push(opened);
        // Indexing runs on its own thread; ask again until it is complete,
        // as the desktop client does, so both sides answer the same thing.
        let read = line(
            json!({ "version": 1, "requestId": "r", "command": "read_range",
            "sessionId": session, "sheetId": "sheet-1",
            "range": { "startRow": 0, "endRow": 1, "startColumn": 0, "endColumn": 0 } }),
        );
        let mut range = send(&read);
        for _ in 0..500 {
            if parse(&range)["result"]["indexingComplete"] == json!(true) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            range = send(&read);
        }
        answers.push(range);
        for request in [
            json!({ "version": 1, "requestId": "f", "command": "read_formula_cells",
                "sessionId": session, "sheetId": "sheet-1" }),
            json!({ "version": 1, "requestId": "find", "command": "find_cells",
                "sessionId": session, "query": "2" }),
            json!({ "version": 1, "requestId": "ro", "command": "read_row_outline",
                "sessionId": session, "sheetId": "sheet-1" }),
            json!({ "version": 1, "requestId": "m", "command": "archive_manifest", "path": source }),
            json!({ "version": 1, "requestId": "e", "command": "read_entries", "path": source,
                "entries": ["xl/worksheets/sheet1.xml"], "outputDir": out_dir }),
            json!({ "version": 1, "requestId": "sc", "command": "scan_entries", "path": source,
                "entries": ["xl/worksheets/sheet1.xml"], "needle": "A1*2" }),
            json!({ "version": 1, "requestId": "s", "command": "save_archive",
                "sourcePath": source, "targetPath": dir.join("saved.xlsx"),
                "replacements": [{ "name": "xl/worksheets/sheet1.xml", "contentPath": patched }],
                "removals": [], "additions": [] }),
            json!({ "version": 1, "requestId": "c", "command": "recalc_cells",
                "path": dir.join("saved.xlsx"), "reportStale": true,
                "reads": [{ "sheet": "Sheet1",
                    "range": { "startRow": 0, "endRow": 1, "startColumn": 0, "endColumn": 0 } }] }),
            json!({ "version": 1, "requestId": "cv", "command": "convert_workbook",
                "path": source, "targetPath": dir.join("converted.xlsx") }),
            json!({ "version": 1, "requestId": "od", "command": "convert_to_ods",
                "path": source, "targetPath": dir.join("book.ods") }),
            json!({ "version": 1, "requestId": "lx", "command": "list_external_links", "path": source }),
            json!({ "version": 1, "requestId": "ip", "command": "recalc_cells", "path": panicking,
                "reads": [{ "sheet": "Sheet1",
                    "range": { "startRow": 0, "endRow": 1, "startColumn": 0, "endColumn": 0 } }] }),
            json!({ "version": 1, "requestId": "bad", "command": "read_range",
                "sessionId": "nope", "sheetId": "sheet-1",
                "range": { "startRow": 0, "endRow": 0, "startColumn": 0, "endColumn": 0 } }),
            json!({ "version": 9, "requestId": "v", "command": "archive_manifest", "path": source }),
            json!({ "version": 1, "requestId": "x", "command": "close", "sessionId": session }),
        ] {
            answers.push(send(&line(request)));
        }
        let saved = fs::read(dir.join("saved.xlsx")).unwrap();
        answers.push(json!({ "savedBytes": saved }).to_string());
        answers
    };

    // The desktop sidecar process.
    let desktop_dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = std::cell::RefCell::new(child.stdin.take().unwrap());
    let stdout = std::cell::RefCell::new(BufReader::new(child.stdout.take().unwrap()));
    let desktop = run(desktop_dir.path(), &|request| {
        writeln!(stdin.borrow_mut(), "{request}").unwrap();
        stdin.borrow_mut().flush().unwrap();
        let mut answer = String::new();
        stdout.borrow_mut().read_line(&mut answer).unwrap();
        answer.trim_end_matches(['\r', '\n']).to_owned()
    });
    drop(stdin);
    let _ = child.wait();

    // The library, through its C ABI (the path the app takes).
    let mobile_dir = tempfile::tempdir().unwrap();
    let engine = FfiEngine::new(mobile_dir.path());
    let mobile = run(mobile_dir.path(), &|request| engine.send(request));

    // Compared as response text, byte for byte (key order included), once
    // per-run values (paths, session ids) are replaced by placeholders.
    let normalize = |answers: Vec<String>, dir: &Path| -> Vec<String> {
        let dir_json = serde_json::to_string(&dir.to_string_lossy()).unwrap();
        let dir_json = &dir_json[1..dir_json.len() - 1];
        let session = parse(&answers[0])["result"]["sessionId"]
            .as_str()
            .unwrap_or("")
            .to_owned();
        answers
            .iter()
            .map(|text| {
                text.replace(dir_json, "<dir>")
                    .replace(&session, "<session>")
            })
            .collect()
    };
    let desktop = normalize(desktop, desktop_dir.path());
    let mobile = normalize(mobile, mobile_dir.path());
    assert_eq!(desktop.len(), mobile.len());
    for (index, (d, m)) in desktop.iter().zip(&mobile).enumerate() {
        assert_eq!(d, m, "answer {index} differs");
    }
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

/// The engine as the app sees it: only the exported C functions.
struct FfiEngine(*mut crate::IeumSheetsEngine);

impl FfiEngine {
    fn new(work_root: &Path) -> Self {
        let root = work_root.to_str().unwrap().as_bytes();
        // SAFETY: a valid byte slice.
        let engine = unsafe { crate::ieum_sheets_engine_new(root.as_ptr(), root.len()) };
        assert!(!engine.is_null());
        Self(engine)
    }

    fn send(&self, line: &str) -> String {
        send_bytes(self.0, line.as_bytes()).unwrap()
    }
}

/// One call through the C ABI; `None` when the library answered null.
fn send_bytes(engine: *const crate::IeumSheetsEngine, line: &[u8]) -> Option<String> {
    let mut len = 0usize;
    // SAFETY: a valid byte slice and a writable length; the engine pointer is
    // live or null (which the library refuses).
    let ptr = unsafe {
        crate::ieum_sheets_engine_handle_line(engine, line.as_ptr(), line.len(), &mut len)
    };
    if ptr.is_null() {
        return None;
    }
    // SAFETY: the library returned `len` bytes at `ptr`.
    let text = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
    // SAFETY: the pair just returned, freed once.
    unsafe { crate::ieum_sheets_engine_free_response(ptr, len) };
    Some(String::from_utf8(text).unwrap())
}

impl Drop for FfiEngine {
    fn drop(&mut self) {
        // SAFETY: created by `new`, freed once.
        unsafe { crate::ieum_sheets_engine_free(self.0) };
    }
}

// SAFETY: the engine is thread-safe (the app calls it from several threads).
unsafe impl Send for FfiEngine {}
unsafe impl Sync for FfiEngine {}

#[test]
fn abi_version_is_one() {
    assert_eq!(crate::ieum_sheets_engine_abi_version(), crate::ABI_VERSION);
    assert_eq!(crate::ABI_VERSION, 1);
}

#[test]
fn ffi_answers_lines_like_the_desktop_writes_them() {
    let fx = fixture();
    let engine = FfiEngine::new(&fx.root);
    let text = engine.send(&line(json!({
        "version": 1, "requestId": "m", "command": "archive_manifest", "path": fx.source,
    })));
    assert!(
        text.starts_with(r#"{"version":1,"requestId":"m","ok":true,"result":{"entries":["#),
        "{text}"
    );
    assert!(!text.ends_with('\n'));
    assert_eq!(
        parse(&engine.send("{not json"))["error"]["code"],
        json!("invalid_json")
    );
    // Not UTF-8: answered as a malformed line, not a crash.
    let answer = parse(&send_bytes(engine.0, &[0xff, 0xfe, b'{']).unwrap());
    assert_eq!(answer["error"]["code"], json!("invalid_json"));
    assert_eq!(answer["requestId"], json!(""));
}

#[test]
fn ffi_refuses_paths_outside_the_work_folder() {
    let fx = fixture();
    let engine = FfiEngine::new(&fx.root);
    let outside = fx._dir.path().join("outside.xlsx");
    write_workbook(&outside, 1);
    let answer = parse(&engine.send(&line(json!({
        "version": 1, "requestId": "o", "command": "open", "path": outside,
    }))));
    assert_eq!(answer["error"]["code"], json!("invalid_request"));
    assert_eq!(answer["error"]["message"], json!(PATH_OUTSIDE_WORK_FOLDER));
}

#[test]
fn ffi_new_refuses_a_work_folder_that_is_not_utf8() {
    let bad = [0xffu8, 0xfe];
    // SAFETY: a valid byte slice.
    let engine = unsafe { crate::ieum_sheets_engine_new(bad.as_ptr(), bad.len()) };
    assert!(engine.is_null());
    // Null handles are refused, not dereferenced.
    // SAFETY: null is allowed.
    unsafe { crate::ieum_sheets_engine_free(engine) };
    assert_eq!(send_bytes(engine, b"{}"), None);
}

/// A panic inside the engine answers that request with `workbook_error` and
/// leaves the engine usable (the app keeps `panic = "abort"`; this library
/// unwinds and catches at its boundary).
#[test]
fn a_panic_fails_only_that_request() {
    let fx = fixture();
    let engine = FfiEngine::new(&fx.root);
    let opened = parse(&engine.send(&line(json!({
        "version": 1, "requestId": "o", "command": "open", "path": fx.source,
    }))));
    let session = opened["result"]["sessionId"].clone();

    let answer = parse(&engine.send(&line(json!({
        "version": 1, "requestId": "boom", "command": crate::TEST_PANIC_COMMAND,
    }))));
    assert_eq!(
        answer,
        json!({
            "version": 1, "requestId": "boom", "ok": false,
            "error": { "code": "workbook_error", "message": crate::PANIC_MESSAGE },
        })
    );

    // The open session and the formula engine still answer.
    let range = parse(&engine.send(&line(json!({
        "version": 1, "requestId": "r", "command": "read_range",
        "sessionId": session, "sheetId": "sheet-1",
        "range": { "startRow": 0, "endRow": 0, "startColumn": 0, "endColumn": 0 },
    }))));
    assert_eq!(range["ok"], json!(true), "{range}");
    let recalced = parse(&engine.send(&recalc_request("c", &fx.source, json!([]))));
    assert_eq!(recalced["ok"], json!(true), "{recalced}");
}

/// Two threads: panics on one do not disturb requests on the other.
#[test]
fn a_panic_on_one_thread_leaves_concurrent_requests_alone() {
    let fx = fixture();
    let engine = Arc::new(FfiEngine::new(&fx.root));
    let panicker = {
        let engine = Arc::clone(&engine);
        std::thread::spawn(move || {
            (0..20)
                .map(|index| {
                    parse(&engine.send(&line(json!({
                        "version": 1, "requestId": format!("p{index}"),
                        "command": crate::TEST_PANIC_COMMAND,
                    }))))["error"]["code"]
                        .clone()
                })
                .collect::<Vec<_>>()
        })
    };
    for index in 0..20 {
        let answer = parse(&engine.send(&line(json!({
            "version": 1, "requestId": format!("m{index}"),
            "command": "archive_manifest", "path": fx.source,
        }))));
        assert_eq!(answer["ok"], json!(true), "{answer}");
    }
    for code in panicker.join().unwrap() {
        assert_eq!(code, json!("workbook_error"));
    }
}

/// A real engine panic (IronCalc's importer on a workbook without
/// `<cellStyles>`): the engine's own `catch_unwind` answers `workbook_error`
/// exactly as the desktop sidecar does, which needs this library to unwind.
#[test]
fn an_ironcalc_import_panic_fails_only_that_recalc() {
    let fx = fixture();
    let engine = FfiEngine::new(&fx.root);
    let broken = fx.root.join("no-cell-styles.xlsx");
    write_workbook_ironcalc_panics_on(&broken);
    let answer = parse(&engine.send(&recalc_request("ip", &broken, json!([]))));
    assert_eq!(
        answer,
        json!({
            "version": 1, "requestId": "ip", "ok": false,
            "error": {
                "code": "workbook_error",
                "message": "The formula engine could not process this workbook.",
            },
        })
    );
    // The busy flag was released and the formula engine still works.
    let ok = parse(&engine.send(&recalc_request("ok", &fx.source, json!([]))));
    assert_eq!(ok["ok"], json!(true), "{ok}");
}
