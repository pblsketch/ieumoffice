use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::recent::now_millis;
use crate::storage::session::MobileDocFormat;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub doc_key: String,
    pub format: MobileDocFormat,
    pub title: String,
    pub updated_at: u64,
    pub size_bytes: usize,
}

pub struct RecoveryStore {
    dir: PathBuf,
}

impl RecoveryStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            dir: app_data_dir.join("recovery"),
        }
    }

    fn validate_key(doc_key: &str) -> MobileResult<()> {
        if doc_key.is_empty()
            || doc_key.len() > 80
            || !doc_key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.recovery.invalidKey",
                "invalid docKey",
            ));
        }
        Ok(())
    }

    fn meta_path(&self, doc_key: &str) -> PathBuf {
        self.dir.join(format!("{doc_key}.meta.json"))
    }

    fn data_path(&self, doc_key: &str) -> PathBuf {
        self.dir.join(format!("{doc_key}.bin"))
    }

    pub fn write(
        &self,
        doc_key: &str,
        format: MobileDocFormat,
        title: &str,
        bytes: &[u8],
    ) -> MobileResult<RecoveryEntry> {
        Self::validate_key(doc_key)?;
        fs::create_dir_all(&self.dir).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.dirFailed", e.to_string())
        })?;
        let data_tmp = self.dir.join(format!("{doc_key}.bin.tmp"));
        fs::write(&data_tmp, bytes).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.writeFailed", e.to_string())
        })?;
        fs::rename(&data_tmp, self.data_path(doc_key)).map_err(|e| {
            let _ = fs::remove_file(&data_tmp);
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.renameFailed", e.to_string())
        })?;

        let entry = RecoveryEntry {
            doc_key: doc_key.to_string(),
            format,
            title: title.to_string(),
            updated_at: now_millis(),
            size_bytes: bytes.len(),
        };
        let meta_tmp = self.dir.join(format!("{doc_key}.meta.json.tmp"));
        let json = serde_json::to_string_pretty(&entry).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.encodeFailed", e.to_string())
        })?;
        fs::write(&meta_tmp, json).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.metaWriteFailed", e.to_string())
        })?;
        fs::rename(&meta_tmp, self.meta_path(doc_key)).map_err(|e| {
            let _ = fs::remove_file(&meta_tmp);
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.metaRenameFailed", e.to_string())
        })?;
        Ok(entry)
    }

    pub fn list(&self) -> MobileResult<Vec<RecoveryEntry>> {
        if !self.dir.exists() {
            return Ok(Vec::new());
        }
        let mut entries = Vec::new();
        for item in fs::read_dir(&self.dir).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recovery.listFailed", e.to_string())
        })? {
            let Ok(dir_entry) = item else { continue };
            let name = dir_entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".meta.json") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(dir_entry.path())
                && let Ok(parsed) = serde_json::from_str::<RecoveryEntry>(&text)
                && self.data_path(&parsed.doc_key).exists()
            {
                entries.push(parsed);
            }
        }
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(entries)
    }

    pub fn read(&self, doc_key: &str) -> MobileResult<Vec<u8>> {
        Self::validate_key(doc_key)?;
        fs::read(self.data_path(doc_key)).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::PermissionDenied, "mobile.recovery.readFailed", e.to_string())
        })
    }

    pub fn discard(&self, doc_key: &str) -> MobileResult<()> {
        Self::validate_key(doc_key)?;
        let _ = fs::remove_file(self.data_path(doc_key));
        let _ = fs::remove_file(self.meta_path(doc_key));
        Ok(())
    }
}
