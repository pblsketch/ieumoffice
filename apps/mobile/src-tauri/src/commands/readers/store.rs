//! Reading positions and the device-wide reader settings for the EPUB and PPTX readers.
//!
//! Everything lives in one file, `<app data>/readers/positions.json`:
//! `{ "version": 1, "settings": <ReaderSettings|null>, "entries": { "<docKey>": { "position", "at" } } }`.
//! A missing or unreadable file reads as the empty state, and the next write replaces it.
//! Writes go to a temp file in the same folder and are renamed over the old file.
//! The logic works on a plain directory path so it can be tested without a running Tauri app.

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// How many positions are kept, newest first. Same count as the PC EPUB editor keeps.
pub const MAX_READER_ENTRIES: usize = 1_000;

const FILE_VERSION: u32 = 1;
const FILE_NAME: &str = "positions.json";
const TEMP_FILE_NAME: &str = "positions.json.tmp";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ReaderPosition {
    #[serde(rename = "epub", rename_all = "camelCase")]
    Epub {
        spine_index: u32,
        href: String,
        block_id: Option<String>,
    },
    #[serde(rename = "pptx", rename_all = "camelCase")]
    Pptx { slide_index: u32, part_path: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderTheme {
    App,
    Light,
    Sepia,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderLayout {
    Paged,
    Scroll,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    pub font_scale: f64,
    pub line_height: Option<f64>,
    pub theme: ReaderTheme,
    pub layout: ReaderLayout,
    pub notes_open: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderState {
    pub position: Option<ReaderPosition>,
    pub settings: Option<ReaderSettings>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReaderEntry {
    pub position: ReaderPosition,
    /// Write time in milliseconds since the Unix epoch.
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReaderFile {
    pub version: u32,
    pub settings: Option<ReaderSettings>,
    pub entries: BTreeMap<String, ReaderEntry>,
}

impl Default for ReaderFile {
    fn default() -> Self {
        Self {
            version: FILE_VERSION,
            settings: None,
            entries: BTreeMap::new(),
        }
    }
}

fn invalid(message_key: &str, detail: impl Into<String>) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InvalidArgument, message_key, detail)
}

fn internal(message_key: &str, err: impl ToString) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InternalError, message_key, err.to_string())
}

pub fn validate_doc_key(doc_key: &str) -> MobileResult<()> {
    if doc_key.trim().is_empty() {
        return Err(invalid(
            "mobile.readers.invalidDocKey",
            "docKey must be a non-empty string",
        ));
    }
    Ok(())
}

/// Turns a raw JSON value into a reading position, or `INVALID_ARGUMENT` when the shape is wrong.
pub fn parse_position(value: Value) -> MobileResult<ReaderPosition> {
    serde_json::from_value(value)
        .map_err(|e| invalid("mobile.readers.invalidPosition", e.to_string()))
}

pub fn validate_settings(settings: &ReaderSettings) -> MobileResult<()> {
    if !settings.font_scale.is_finite() || settings.font_scale <= 0.0 {
        return Err(invalid(
            "mobile.readers.invalidSettings",
            "fontScale must be a finite number above 0",
        ));
    }
    if let Some(line_height) = settings.line_height {
        if !line_height.is_finite() || line_height <= 0.0 {
            return Err(invalid(
                "mobile.readers.invalidSettings",
                "lineHeight must be null or a finite number above 0",
            ));
        }
    }
    Ok(())
}

/// Turns a raw JSON value into reader settings, or `INVALID_ARGUMENT` when the shape is wrong.
pub fn parse_settings(value: Value) -> MobileResult<ReaderSettings> {
    let settings: ReaderSettings = serde_json::from_value(value)
        .map_err(|e| invalid("mobile.readers.invalidSettings", e.to_string()))?;
    validate_settings(&settings)?;
    Ok(settings)
}

pub fn readers_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("readers")
}

/// Reads the file in `dir`. A missing, unreadable, corrupt, or other-version file is the empty state.
pub fn load_file(dir: &Path) -> ReaderFile {
    let Ok(text) = fs::read_to_string(dir.join(FILE_NAME)) else {
        return ReaderFile::default();
    };
    match serde_json::from_str::<ReaderFile>(&text) {
        Ok(file) if file.version == FILE_VERSION => file,
        _ => ReaderFile::default(),
    }
}

/// Writes the file in `dir` through a temp file in the same folder and a rename.
pub fn write_file_atomic(dir: &Path, file: &ReaderFile) -> MobileResult<()> {
    fs::create_dir_all(dir).map_err(|e| internal("mobile.readers.dirFailed", e))?;
    let json =
        serde_json::to_string(file).map_err(|e| internal("mobile.readers.encodeFailed", e))?;
    let tmp = dir.join(TEMP_FILE_NAME);
    fs::write(&tmp, json).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        internal("mobile.readers.writeFailed", e)
    })?;
    fs::rename(&tmp, dir.join(FILE_NAME)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        internal("mobile.readers.renameFailed", e)
    })
}

/// Drops the oldest entries until at most `max` remain. `keep` is never dropped.
pub fn prune_entries(entries: &mut BTreeMap<String, ReaderEntry>, max: usize, keep: &str) {
    if entries.len() <= max {
        return;
    }
    let mut candidates: Vec<(u64, String)> = entries
        .iter()
        .filter(|(key, _)| key.as_str() != keep)
        .map(|(key, entry)| (entry.at, key.clone()))
        .collect();
    candidates.sort();
    let excess = entries.len() - max;
    for (_, key) in candidates.into_iter().take(excess) {
        entries.remove(&key);
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Managed state for the reader commands. The mutex serializes every read-modify-write.
pub struct ReaderStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl ReaderStore {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            dir: readers_dir(app_data_dir),
            lock: Mutex::new(()),
        }
    }

    pub fn get_state(&self, doc_key: &str) -> MobileResult<ReaderState> {
        validate_doc_key(doc_key)?;
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let file = load_file(&self.dir);
        Ok(ReaderState {
            position: file.entries.get(doc_key).map(|e| e.position.clone()),
            settings: file.settings,
        })
    }

    pub fn set_position(
        &self,
        doc_key: &str,
        position: ReaderPosition,
        at: u64,
    ) -> MobileResult<()> {
        validate_doc_key(doc_key)?;
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut file = load_file(&self.dir);
        file.entries
            .insert(doc_key.to_string(), ReaderEntry { position, at });
        prune_entries(&mut file.entries, MAX_READER_ENTRIES, doc_key);
        write_file_atomic(&self.dir, &file)
    }

    pub fn set_settings(&self, settings: ReaderSettings) -> MobileResult<()> {
        validate_settings(&settings)?;
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut file = load_file(&self.dir);
        file.settings = Some(settings);
        write_file_atomic(&self.dir, &file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn epub(spine_index: u32) -> ReaderPosition {
        ReaderPosition::Epub {
            spine_index,
            href: format!("text/ch{spine_index}.xhtml"),
            block_id: Some("b12".to_string()),
        }
    }

    fn settings() -> ReaderSettings {
        ReaderSettings {
            font_scale: 1.25,
            line_height: Some(1.6),
            theme: ReaderTheme::Sepia,
            layout: ReaderLayout::Scroll,
            notes_open: true,
        }
    }

    fn dir_entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn empty_state_when_no_file() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(tmp.path());
        let state = store.get_state("doc-1").unwrap();
        assert_eq!(
            state,
            ReaderState {
                position: None,
                settings: None
            }
        );
    }

    #[test]
    fn position_and_settings_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(tmp.path());
        let pptx = ReaderPosition::Pptx {
            slide_index: 4,
            part_path: "ppt/slides/slide5.xml".to_string(),
        };
        store.set_position("doc-epub", epub(3), 10).unwrap();
        store.set_position("doc-pptx", pptx.clone(), 11).unwrap();
        store.set_settings(settings()).unwrap();

        // A fresh store reads what the first one wrote.
        let again = ReaderStore::new(tmp.path());
        let epub_state = again.get_state("doc-epub").unwrap();
        assert_eq!(epub_state.position, Some(epub(3)));
        assert_eq!(epub_state.settings, Some(settings()));
        assert_eq!(again.get_state("doc-pptx").unwrap().position, Some(pptx));
        assert_eq!(again.get_state("doc-other").unwrap().position, None);

        let raw: Value = serde_json::from_str(
            &fs::read_to_string(tmp.path().join("readers").join("positions.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(raw["version"], json!(1));
        assert_eq!(
            raw["entries"]["doc-epub"],
            json!({
                "position": { "kind": "epub", "spineIndex": 3, "href": "text/ch3.xhtml", "blockId": "b12" },
                "at": 10
            })
        );
        assert_eq!(
            raw["entries"]["doc-pptx"]["position"],
            json!({ "kind": "pptx", "slideIndex": 4, "partPath": "ppt/slides/slide5.xml" })
        );
        assert_eq!(
            raw["settings"],
            json!({ "fontScale": 1.25, "lineHeight": 1.6, "theme": "sepia", "layout": "scroll", "notesOpen": true })
        );
    }

    #[test]
    fn epub_block_id_may_be_null() {
        let pos = parse_position(
            json!({ "kind": "epub", "spineIndex": 0, "href": "a.xhtml", "blockId": null }),
        )
        .unwrap();
        assert_eq!(
            pos,
            ReaderPosition::Epub {
                spine_index: 0,
                href: "a.xhtml".to_string(),
                block_id: None
            }
        );
        assert_eq!(
            serde_json::to_value(&pos).unwrap(),
            json!({ "kind": "epub", "spineIndex": 0, "href": "a.xhtml", "blockId": null })
        );
    }

    #[test]
    fn rewriting_a_doc_key_replaces_its_position() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(tmp.path());
        store.set_position("doc", epub(1), 1).unwrap();
        store.set_position("doc", epub(7), 2).unwrap();
        assert_eq!(store.get_state("doc").unwrap().position, Some(epub(7)));
        assert_eq!(load_file(&readers_dir(tmp.path())).entries.len(), 1);
    }

    #[test]
    fn keeps_only_the_newest_thousand_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = readers_dir(tmp.path());
        // Seed 1,000 entries with distinct times; doc-0 is the oldest.
        let mut file = ReaderFile::default();
        for i in 0..MAX_READER_ENTRIES as u64 {
            file.entries.insert(
                format!("doc-{i}"),
                ReaderEntry {
                    position: epub(i as u32),
                    at: 1_000 + i,
                },
            );
        }
        write_file_atomic(&dir, &file).unwrap();

        let store = ReaderStore::new(tmp.path());
        store.set_position("doc-new", epub(1), 50_000).unwrap();
        let after = load_file(&dir);
        assert_eq!(after.entries.len(), MAX_READER_ENTRIES);
        assert!(
            !after.entries.contains_key("doc-0"),
            "oldest entry is dropped"
        );
        assert!(after.entries.contains_key("doc-1"));
        assert!(after.entries.contains_key("doc-999"));
        assert!(after.entries.contains_key("doc-new"));

        // Touching doc-1 makes doc-2 the oldest; the next new key drops doc-2.
        store.set_position("doc-1", epub(2), 50_001).unwrap();
        store.set_position("doc-newer", epub(3), 50_002).unwrap();
        let after = load_file(&dir);
        assert_eq!(after.entries.len(), MAX_READER_ENTRIES);
        assert!(after.entries.contains_key("doc-1"));
        assert!(!after.entries.contains_key("doc-2"));
        assert!(after.entries.contains_key("doc-newer"));
    }

    #[test]
    fn the_entry_just_written_survives_pruning_even_with_an_old_time() {
        let mut entries = BTreeMap::new();
        for i in 0..3u64 {
            entries.insert(
                format!("k{i}"),
                ReaderEntry {
                    position: epub(0),
                    at: 100 + i,
                },
            );
        }
        entries.insert(
            "now".to_string(),
            ReaderEntry {
                position: epub(0),
                at: 1,
            },
        );
        prune_entries(&mut entries, 3, "now");
        assert_eq!(entries.len(), 3);
        assert!(entries.contains_key("now"));
        assert!(!entries.contains_key("k0"));
    }

    #[test]
    fn corrupt_file_reads_empty_and_next_write_replaces_it() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = readers_dir(tmp.path());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("positions.json"), "{ not json").unwrap();

        let store = ReaderStore::new(tmp.path());
        assert_eq!(
            store.get_state("doc").unwrap(),
            ReaderState {
                position: None,
                settings: None
            }
        );
        store.set_position("doc", epub(2), 5).unwrap();
        assert_eq!(store.get_state("doc").unwrap().position, Some(epub(2)));
        let raw: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("positions.json")).unwrap()).unwrap();
        assert_eq!(raw["version"], json!(1));
    }

    #[test]
    fn wrong_shape_or_version_in_file_reads_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = readers_dir(tmp.path());
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("positions.json"),
            r#"{"version":1,"settings":null,"entries":{"doc":{"position":{"kind":"mobi"},"at":1}}}"#,
        )
        .unwrap();
        assert_eq!(load_file(&dir), ReaderFile::default());
        fs::write(
            dir.join("positions.json"),
            r#"{"version":2,"settings":null,"entries":{}}"#,
        )
        .unwrap();
        assert_eq!(load_file(&dir), ReaderFile::default());
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(tmp.path());
        store.set_position("doc", epub(1), 1).unwrap();
        store.set_settings(settings()).unwrap();
        store.set_position("doc", epub(2), 2).unwrap();
        assert_eq!(
            dir_entries(&readers_dir(tmp.path())),
            vec!["positions.json".to_string()]
        );
    }

    #[test]
    fn rejects_positions_with_a_bad_kind_or_index() {
        let cases = [
            json!({ "kind": "mobi", "spineIndex": 0, "href": "a.xhtml", "blockId": null }),
            json!({ "spineIndex": 0, "href": "a.xhtml", "blockId": null }),
            json!({ "kind": "epub", "spineIndex": -1, "href": "a.xhtml", "blockId": null }),
            json!({ "kind": "epub", "spineIndex": 1.5, "href": "a.xhtml", "blockId": null }),
            json!({ "kind": "epub", "spineIndex": 0, "href": 3, "blockId": null }),
            json!({ "kind": "pptx", "slideIndex": -2, "partPath": "ppt/slides/slide1.xml" }),
            json!({ "kind": "pptx", "slideIndex": 0 }),
            json!("epub"),
            json!(null),
        ];
        for case in cases {
            let err = parse_position(case.clone()).expect_err(&format!("accepted {case}"));
            assert_eq!(err.code, MobileErrorCode::InvalidArgument, "{case}");
            assert_eq!(err.message_key, "mobile.readers.invalidPosition");
        }
    }

    #[test]
    fn rejects_settings_with_a_bad_theme_layout_or_scale() {
        let good = json!({ "fontScale": 1.0, "lineHeight": null, "theme": "app", "layout": "paged", "notesOpen": false });
        assert!(parse_settings(good.clone()).is_ok());
        let mut cases = Vec::new();
        for (field, bad) in [
            ("theme", json!("blue")),
            ("layout", json!("spread")),
            ("fontScale", json!(0)),
            ("fontScale", json!(-1.0)),
            ("fontScale", json!(null)),
            ("fontScale", json!("1")),
            ("lineHeight", json!(0)),
            ("lineHeight", json!("tall")),
            ("notesOpen", json!("yes")),
        ] {
            let mut value = good.clone();
            value[field] = bad;
            cases.push(value);
        }
        for case in cases {
            let err = parse_settings(case.clone()).expect_err(&format!("accepted {case}"));
            assert_eq!(err.code, MobileErrorCode::InvalidArgument, "{case}");
            assert_eq!(err.message_key, "mobile.readers.invalidSettings");
        }
    }

    #[test]
    fn rejects_nan_and_infinite_font_scale() {
        // JSON cannot carry NaN, so check the typed path the store guards with.
        let tmp = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(tmp.path());
        for scale in [f64::NAN, f64::INFINITY] {
            let err = store
                .set_settings(ReaderSettings {
                    font_scale: scale,
                    ..settings()
                })
                .unwrap_err();
            assert_eq!(err.code, MobileErrorCode::InvalidArgument);
        }
        assert!(!readers_dir(tmp.path()).join("positions.json").exists());
    }

    #[test]
    fn rejects_an_empty_doc_key() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ReaderStore::new(tmp.path());
        assert_eq!(
            store.get_state("").unwrap_err().code,
            MobileErrorCode::InvalidArgument
        );
        assert_eq!(
            store.set_position("  ", epub(0), 1).unwrap_err().code,
            MobileErrorCode::InvalidArgument
        );
        assert!(!readers_dir(tmp.path()).join("positions.json").exists());
    }

    #[test]
    fn invalid_argument_serializes_with_the_shared_code() {
        let err = parse_position(json!({ "kind": "mobi" })).unwrap_err();
        assert_eq!(
            serde_json::to_value(&err).unwrap()["code"],
            json!("INVALID_ARGUMENT")
        );
    }
}
