use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::session::MobileDocFormat;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAppPrefs {
    pub lang: String,
    pub theme: String,
    pub hwp_default_format: MobileDocFormat,
    pub ai_enabled: bool,
    // Home fields (track T6). Each has a serde default so a prefs.json written before them still
    // reads; a missing field reads as below, which differs from a fresh install only for
    // `first_run_done` (false in both, so prototype users see the first-run guide once).
    /// Editor kind ids (and `pdfTools`) the user turned off.
    #[serde(default)]
    pub editors_off: Vec<String>,
    /// Home card item ids hidden from the new-document cards.
    #[serde(default)]
    pub home_kinds_hidden: Vec<String>,
    /// Home card item ids in the user's order; ids not listed follow in registry order.
    #[serde(default)]
    pub home_kinds_order: Vec<String>,
    #[serde(default = "default_true")]
    pub keep_screen_on_while_reading: bool,
    #[serde(default)]
    pub first_run_done: bool,
    /// Ids of the first-use tips already shown.
    #[serde(default)]
    pub tips_seen: Vec<String>,
    /// App version whose "what's new" was last seen; empty means none recorded.
    #[serde(default)]
    pub last_seen_version: String,
}

fn default_true() -> bool {
    true
}

impl Default for MobileAppPrefs {
    fn default() -> Self {
        Self {
            lang: "ko".to_string(),
            theme: "system".to_string(),
            hwp_default_format: MobileDocFormat::Hwpx,
            // AI starts hidden on mobile; the user turns it on in Settings.
            ai_enabled: false,
            editors_off: Vec::new(),
            home_kinds_hidden: Vec::new(),
            home_kinds_order: Vec::new(),
            keep_screen_on_while_reading: true,
            first_run_done: false,
            tips_seen: Vec::new(),
            last_seen_version: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAppPrefsPatch {
    pub lang: Option<String>,
    pub theme: Option<String>,
    pub hwp_default_format: Option<MobileDocFormat>,
    pub ai_enabled: Option<bool>,
}

/// The home fields of a prefs patch (track T6). Kept apart from `MobileAppPrefsPatch` so code that
/// builds that patch field by field keeps compiling. Lists replace the stored list wholesale.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileHomePrefsPatch {
    pub editors_off: Option<Vec<String>>,
    pub home_kinds_hidden: Option<Vec<String>>,
    pub home_kinds_order: Option<Vec<String>>,
    pub keep_screen_on_while_reading: Option<bool>,
    pub first_run_done: Option<bool>,
    pub tips_seen: Option<Vec<String>>,
    pub last_seen_version: Option<String>,
}

impl MobileHomePrefsPatch {
    fn apply(self, prefs: &mut MobileAppPrefs) {
        if let Some(list) = self.editors_off {
            prefs.editors_off = list;
        }
        if let Some(list) = self.home_kinds_hidden {
            prefs.home_kinds_hidden = list;
        }
        if let Some(list) = self.home_kinds_order {
            prefs.home_kinds_order = list;
        }
        if let Some(on) = self.keep_screen_on_while_reading {
            prefs.keep_screen_on_while_reading = on;
        }
        if let Some(done) = self.first_run_done {
            prefs.first_run_done = done;
        }
        if let Some(list) = self.tips_seen {
            prefs.tips_seen = list;
        }
        if let Some(version) = self.last_seen_version {
            prefs.last_seen_version = version;
        }
    }
}

pub struct PrefsStore {
    path: PathBuf,
}

impl PrefsStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("prefs.json"),
        }
    }

    pub fn load(&self) -> MobileResult<MobileAppPrefs> {
        if !self.path.exists() {
            return Ok(MobileAppPrefs::default());
        }
        let text = fs::read_to_string(&self.path).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.prefs.readFailed", e.to_string())
        })?;
        serde_json::from_str(&text).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.prefs.parseFailed", e.to_string())
        })
    }

    pub fn update(&self, patch: MobileAppPrefsPatch) -> MobileResult<MobileAppPrefs> {
        self.update_with_home(patch, MobileHomePrefsPatch::default())
    }

    /// Applies both parts of a patch and writes the file once; nothing is written when a value is refused.
    pub fn update_with_home(
        &self,
        patch: MobileAppPrefsPatch,
        home: MobileHomePrefsPatch,
    ) -> MobileResult<MobileAppPrefs> {
        let mut prefs = self.load()?;
        if let Some(lang) = patch.lang {
            prefs.lang = lang;
        }
        if let Some(theme) = patch.theme {
            if !matches!(theme.as_str(), "light" | "dark" | "system") {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.prefs.invalidTheme",
                    "theme must be light, dark, or system",
                ));
            }
            prefs.theme = theme;
        }
        if let Some(fmt) = patch.hwp_default_format {
            if !fmt.is_hwp_family() {
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.prefs.invalidHwpFormat",
                    "hwpDefaultFormat must be hwp or hwpx",
                ));
            }
            prefs.hwp_default_format = fmt;
        }
        if let Some(enabled) = patch.ai_enabled {
            prefs.ai_enabled = enabled;
        }
        home.apply(&mut prefs);
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                MobileError::with_detail(MobileErrorCode::InternalError, "mobile.prefs.dirFailed", e.to_string())
            })?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(&prefs).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.prefs.encodeFailed", e.to_string())
        })?;
        fs::write(&tmp, json).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.prefs.writeFailed", e.to_string())
        })?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.prefs.renameFailed", e.to_string())
        })?;
        Ok(prefs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, PrefsStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = PrefsStore::new(dir.path().to_path_buf());
        (dir, store)
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn fresh_install_uses_the_first_values() {
        let (_dir, store) = store();
        let prefs = store.load().unwrap();
        assert_eq!(prefs.hwp_default_format, MobileDocFormat::Hwpx);
        assert!(prefs.editors_off.is_empty());
        assert!(prefs.home_kinds_hidden.is_empty());
        assert!(prefs.home_kinds_order.is_empty());
        assert!(prefs.keep_screen_on_while_reading);
        assert!(!prefs.first_run_done);
        assert!(prefs.tips_seen.is_empty());
        assert_eq!(prefs.last_seen_version, "");
    }

    #[test]
    fn an_old_prefs_file_without_the_new_fields_still_reads() {
        let (dir, store) = store();
        fs::write(
            dir.path().join("prefs.json"),
            r#"{"lang":"en","theme":"dark","hwpDefaultFormat":"hwp","aiEnabled":true}"#,
        )
        .unwrap();
        let prefs = store.load().unwrap();
        assert_eq!(prefs.lang, "en");
        assert_eq!(prefs.theme, "dark");
        assert_eq!(prefs.hwp_default_format, MobileDocFormat::Hwp);
        assert!(prefs.ai_enabled);
        assert!(prefs.editors_off.is_empty());
        assert!(prefs.home_kinds_hidden.is_empty());
        assert!(prefs.home_kinds_order.is_empty());
        assert!(prefs.keep_screen_on_while_reading);
        // existing prototype users see the first-run guide once
        assert!(!prefs.first_run_done);
        assert!(prefs.tips_seen.is_empty());
        assert_eq!(prefs.last_seen_version, "");
    }

    #[test]
    fn writes_the_new_fields_in_camel_case() {
        let (dir, store) = store();
        store
            .update_with_home(
                MobileAppPrefsPatch::default(),
                MobileHomePrefsPatch {
                    first_run_done: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        let text = fs::read_to_string(dir.path().join("prefs.json")).unwrap();
        for key in [
            "\"editorsOff\"",
            "\"homeKindsHidden\"",
            "\"homeKindsOrder\"",
            "\"keepScreenOnWhileReading\"",
            "\"firstRunDone\"",
            "\"tipsSeen\"",
            "\"lastSeenVersion\"",
        ] {
            assert!(text.contains(key), "{key} missing from {text}");
        }
    }

    #[test]
    fn each_new_field_patch_persists() {
        let (dir, store) = store();
        let updated = store
            .update_with_home(
                MobileAppPrefsPatch::default(),
                MobileHomePrefsPatch {
                    editors_off: Some(strings(&["markdown", "pdfTools"])),
                    home_kinds_hidden: Some(strings(&["md"])),
                    home_kinds_order: Some(strings(&["md", "hwp"])),
                    keep_screen_on_while_reading: Some(false),
                    first_run_done: Some(true),
                    tips_seen: Some(strings(&["editButton", "flowView"])),
                    last_seen_version: Some("0.2.0".to_string()),
                },
            )
            .unwrap();
        let reread = PrefsStore::new(dir.path().to_path_buf()).load().unwrap();
        assert_eq!(reread, updated);
        assert_eq!(reread.editors_off, strings(&["markdown", "pdfTools"]));
        assert_eq!(reread.home_kinds_hidden, strings(&["md"]));
        assert_eq!(reread.home_kinds_order, strings(&["md", "hwp"]));
        assert!(!reread.keep_screen_on_while_reading);
        assert!(reread.first_run_done);
        assert_eq!(reread.tips_seen, strings(&["editButton", "flowView"]));
        assert_eq!(reread.last_seen_version, "0.2.0");
        // the four older fields keep their values
        assert_eq!(reread.lang, "ko");
        assert_eq!(reread.hwp_default_format, MobileDocFormat::Hwpx);
    }

    #[test]
    fn list_patches_replace_the_whole_list() {
        let (_dir, store) = store();
        let home = |list: &[&str]| MobileHomePrefsPatch {
            editors_off: Some(strings(list)),
            tips_seen: Some(strings(list)),
            ..Default::default()
        };
        store
            .update_with_home(MobileAppPrefsPatch::default(), home(&["sheets", "pdf"]))
            .unwrap();
        let prefs = store
            .update_with_home(MobileAppPrefsPatch::default(), home(&["epub"]))
            .unwrap();
        assert_eq!(prefs.editors_off, strings(&["epub"]));
        assert_eq!(prefs.tips_seen, strings(&["epub"]));
        let cleared = store
            .update_with_home(MobileAppPrefsPatch::default(), home(&[]))
            .unwrap();
        assert!(cleared.editors_off.is_empty());
        assert!(cleared.tips_seen.is_empty());
    }

    #[test]
    fn an_older_style_patch_leaves_the_new_fields_alone() {
        let (_dir, store) = store();
        store
            .update_with_home(
                MobileAppPrefsPatch::default(),
                MobileHomePrefsPatch {
                    editors_off: Some(strings(&["markdown"])),
                    keep_screen_on_while_reading: Some(false),
                    first_run_done: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        let prefs = store
            .update(MobileAppPrefsPatch {
                theme: Some("light".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(prefs.theme, "light");
        assert_eq!(prefs.editors_off, strings(&["markdown"]));
        assert!(!prefs.keep_screen_on_while_reading);
        assert!(prefs.first_run_done);
    }

    #[test]
    fn a_refused_patch_writes_nothing() {
        let (dir, store) = store();
        let err = store.update_with_home(
            MobileAppPrefsPatch {
                theme: Some("blue".into()),
                ..Default::default()
            },
            MobileHomePrefsPatch {
                first_run_done: Some(true),
                ..Default::default()
            },
        );
        assert!(err.is_err());
        assert!(!dir.path().join("prefs.json").exists());
        assert!(!store.load().unwrap().first_run_done);
    }
}
