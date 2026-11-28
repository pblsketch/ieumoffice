use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::session::MobileDocFormat;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_RECENT_DOCS: usize = 30;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocEntry {
    pub id: String,
    pub doc_key: String,
    pub name: String,
    pub format: MobileDocFormat,
    pub opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredRecentDoc {
    id: String,
    doc_key: String,
    uri: String,
    name: String,
    format: MobileDocFormat,
    opened_at: u64,
}

pub struct RecentStore {
    path: PathBuf,
}

impl RecentStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("recent.json"),
        }
    }

    fn load_raw(&self) -> MobileResult<Vec<StoredRecentDoc>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let text = fs::read_to_string(&self.path).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recent.readFailed", e.to_string())
        })?;
        serde_json::from_str(&text).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recent.parseFailed", e.to_string())
        })
    }

    fn save_raw(&self, entries: &[StoredRecentDoc]) -> MobileResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recent.dirFailed", e.to_string())
            })?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(entries).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recent.encodeFailed", e.to_string())
        })?;
        fs::write(&tmp, json).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recent.writeFailed", e.to_string())
        })?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.recent.renameFailed", e.to_string())
        })?;
        Ok(())
    }

    pub fn upsert(
        &self,
        doc_key: &str,
        uri: &str,
        name: &str,
        format: MobileDocFormat,
    ) -> MobileResult<RecentDocEntry> {
        let mut items = self.load_raw()?;
        let now = now_millis();
        items.retain(|entry| entry.doc_key != doc_key && entry.uri != uri);
        let id = Uuid::new_v4().to_string();
        items.insert(
            0,
            StoredRecentDoc {
                id: id.clone(),
                doc_key: doc_key.to_string(),
                uri: uri.to_string(),
                name: name.to_string(),
                format,
                opened_at: now,
            },
        );
        items.truncate(MAX_RECENT_DOCS);
        self.save_raw(&items)?;
        Ok(RecentDocEntry {
            id,
            doc_key: doc_key.to_string(),
            name: name.to_string(),
            format,
            opened_at: now,
        })
    }

    pub fn list(&self) -> MobileResult<Vec<RecentDocEntry>> {
        let items = self.load_raw()?;
        Ok(items
            .into_iter()
            .map(|e| RecentDocEntry {
                id: e.id,
                doc_key: e.doc_key,
                name: e.name,
                format: e.format,
                opened_at: e.opened_at,
            })
            .collect())
    }

    pub fn resolve_uri(&self, id: &str) -> MobileResult<Option<(String, MobileDocFormat)>> {
        let items = self.load_raw()?;
        Ok(items
            .into_iter()
            .find(|e| e.id == id)
            .map(|e| (e.uri, e.format)))
    }

    pub fn remove(&self, id: &str) -> MobileResult<()> {
        let mut items = self.load_raw()?;
        items.retain(|e| e.id != id);
        self.save_raw(&items)
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
