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
}

impl Default for MobileAppPrefs {
    fn default() -> Self {
        Self {
            lang: "ko".to_string(),
            theme: "system".to_string(),
            hwp_default_format: MobileDocFormat::Hwpx,
            ai_enabled: true,
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
