use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::recent::now_millis;
use crate::storage::session::MobileDocFormat;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

pub const MAX_HWP_BACKUPS: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HwpBackupEntry {
    pub backup_id: String,
    pub doc_key: String,
    pub original_name: String,
    pub format: MobileDocFormat,
    pub created_at: u64,
    pub size_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredHwpBackup {
    backup_id: String,
    doc_key: String,
    original_uri: String,
    original_name: String,
    format: MobileDocFormat,
    created_at: u64,
    size_bytes: usize,
}

pub struct HwpBackupStore {
    dir: PathBuf,
}

impl HwpBackupStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            dir: app_data_dir.join("hwp-backups"),
        }
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }

    fn data_path(&self, backup_id: &str, format: MobileDocFormat) -> PathBuf {
        self.dir.join(format!("{backup_id}.{}", format.ext()))
    }

    fn load_index(&self) -> MobileResult<Vec<StoredHwpBackup>> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let text = fs::read_to_string(&path).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.indexRead", e.to_string())
        })?;
        serde_json::from_str(&text).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.indexParse", e.to_string())
        })
    }

    fn save_index(&self, entries: &[StoredHwpBackup]) -> MobileResult<()> {
        let path = self.index_path();
        let tmp = self.dir.join("index.json.tmp");
        let json = serde_json::to_string_pretty(entries).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.indexEncode", e.to_string())
        })?;
        fs::write(&tmp, json).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.indexWrite", e.to_string())
        })?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.indexRename", e.to_string())
        })?;
        Ok(())
    }

    /// Atomically writes original HWP/HWPX bytes before first overwrite, pruning oldest past MAX_HWP_BACKUPS.
    pub fn create_backup(
        &self,
        doc_key: &str,
        original_uri: &str,
        original_name: &str,
        format: MobileDocFormat,
        original_bytes: &[u8],
    ) -> MobileResult<HwpBackupEntry> {
        fs::create_dir_all(&self.dir).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.dirFailed", e.to_string())
        })?;
        let backup_id = Uuid::new_v4().to_string();
        let target = self.data_path(&backup_id, format);
        let tmp = self.dir.join(format!("{backup_id}.{}.tmp", format.ext()));
        fs::write(&tmp, original_bytes).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.writeFailed", e.to_string())
        })?;
        fs::rename(&tmp, &target).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.renameFailed", e.to_string())
        })?;

        let mut index = self.load_index()?;
        let created_at = now_millis();
        index.insert(
            0,
            StoredHwpBackup {
                backup_id: backup_id.clone(),
                doc_key: doc_key.to_string(),
                original_uri: original_uri.to_string(),
                original_name: original_name.to_string(),
                format,
                created_at,
                size_bytes: original_bytes.len(),
            },
        );
        while index.len() > MAX_HWP_BACKUPS {
            if let Some(removed) = index.pop() {
                let _ = fs::remove_file(self.data_path(&removed.backup_id, removed.format));
            }
        }
        self.save_index(&index)?;
        Ok(HwpBackupEntry {
            backup_id,
            doc_key: doc_key.to_string(),
            original_name: original_name.to_string(),
            format,
            created_at,
            size_bytes: original_bytes.len(),
        })
    }

    pub fn list(&self) -> MobileResult<Vec<HwpBackupEntry>> {
        let index = self.load_index()?;
        Ok(index
            .into_iter()
            .map(|e| HwpBackupEntry {
                backup_id: e.backup_id,
                doc_key: e.doc_key,
                original_name: e.original_name,
                format: e.format,
                created_at: e.created_at,
                size_bytes: e.size_bytes,
            })
            .collect())
    }

    pub fn read_entry(&self, backup_id: &str) -> MobileResult<(HwpBackupEntry, String, Vec<u8>)> {
        let index = self.load_index()?;
        let found = index
            .into_iter()
            .find(|e| e.backup_id == backup_id)
            .ok_or_else(|| {
                MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.backup.notFound",
                    "backup id not found",
                )
            })?;
        let bytes = fs::read(self.data_path(&found.backup_id, found.format)).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::BackupFailed, "mobile.backup.readFailed", e.to_string())
        })?;
        let uri = found.original_uri.clone();
        Ok((
            HwpBackupEntry {
                backup_id: found.backup_id,
                doc_key: found.doc_key,
                original_name: found.original_name,
                format: found.format,
                created_at: found.created_at,
                size_bytes: found.size_bytes,
            },
            uri,
            bytes,
        ))
    }

    pub fn delete(&self, backup_id: &str) -> MobileResult<()> {
        let mut index = self.load_index()?;
        if let Some(pos) = index.iter().position(|e| e.backup_id == backup_id) {
            let removed = index.remove(pos);
            let _ = fs::remove_file(self.data_path(&removed.backup_id, removed.format));
            self.save_index(&index)?;
        }
        Ok(())
    }
}
