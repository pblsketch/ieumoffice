//! JSON stores of the home screen (track T6): linked folders (`folders.json`) and favorites
//! with their groups (`favorites.json`). Locations stay here; the WebView never sees them.

use super::FavoriteGroup;
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::session::MobileDocFormat;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn store_error(key: &str, detail: impl ToString) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InternalError, key, detail.to_string())
}

/// One JSON file read whole and replaced atomically. `update` holds a lock so two commands
/// running at once do not drop each other's change.
struct JsonFile {
    path: PathBuf,
    lock: Mutex<()>,
}

impl JsonFile {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    fn read<T: DeserializeOwned + Default>(&self) -> MobileResult<T> {
        if !self.path.exists() {
            return Ok(T::default());
        }
        let text = fs::read_to_string(&self.path)
            .map_err(|e| store_error("mobile.home.storeReadFailed", e))?;
        serde_json::from_str(&text).map_err(|e| store_error("mobile.home.storeParseFailed", e))
    }

    fn write<T: Serialize>(&self, value: &T) -> MobileResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| store_error("mobile.home.storeDirFailed", e))?;
        }
        let json = serde_json::to_string_pretty(value)
            .map_err(|e| store_error("mobile.home.storeEncodeFailed", e))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| store_error("mobile.home.storeWriteFailed", e))?;
        fs::rename(&tmp, &self.path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            store_error("mobile.home.storeRenameFailed", e)
        })
    }

    /// Loads, lets `f` change the value, and writes it back when `f` succeeds.
    fn update<T, R>(&self, f: impl FnOnce(&mut T) -> MobileResult<R>) -> MobileResult<R>
    where
        T: DeserializeOwned + Serialize + Default,
    {
        let _guard = self.lock.lock().unwrap();
        let mut value: T = self.read()?;
        let out = f(&mut value)?;
        self.write(&value)?;
        Ok(out)
    }
}

/// A linked folder with its long-lived grant (Android tree URI, iOS bookmark).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredFolder {
    pub(crate) id: String,
    pub(crate) uri: String,
    pub(crate) name: String,
    pub(crate) added_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FoldersFile {
    #[serde(default)]
    pub(crate) folders: Vec<StoredFolder>,
}

pub(crate) struct FolderStore {
    file: JsonFile,
}

impl FolderStore {
    pub(crate) fn new(app_data_dir: &Path) -> Self {
        Self {
            file: JsonFile::new(app_data_dir.join("folders.json")),
        }
    }

    pub(crate) fn list(&self) -> MobileResult<Vec<StoredFolder>> {
        Ok(self.file.read::<FoldersFile>()?.folders)
    }

    pub(crate) fn get(&self, id: &str) -> MobileResult<Option<StoredFolder>> {
        Ok(self.list()?.into_iter().find(|f| f.id == id))
    }

    pub(crate) fn update<R>(
        &self,
        f: impl FnOnce(&mut Vec<StoredFolder>) -> MobileResult<R>,
    ) -> MobileResult<R> {
        self.file
            .update(|file: &mut FoldersFile| f(&mut file.folders))
    }
}

/// A starred file. It keeps its own location so it opens after leaving the recent list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredFavorite {
    pub(crate) doc_key: String,
    pub(crate) uri: String,
    pub(crate) name: String,
    pub(crate) format: MobileDocFormat,
    #[serde(default)]
    pub(crate) group_id: Option<String>,
    #[serde(default)]
    pub(crate) folder_id: Option<String>,
    pub(crate) added_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FavoritesFile {
    /// Newest first.
    #[serde(default)]
    pub(crate) favorites: Vec<StoredFavorite>,
    /// In creation order.
    #[serde(default)]
    pub(crate) groups: Vec<FavoriteGroup>,
}

pub(crate) struct FavoriteStore {
    file: JsonFile,
}

impl FavoriteStore {
    pub(crate) fn new(app_data_dir: &Path) -> Self {
        Self {
            file: JsonFile::new(app_data_dir.join("favorites.json")),
        }
    }

    pub(crate) fn load(&self) -> MobileResult<FavoritesFile> {
        self.file.read()
    }

    pub(crate) fn update<R>(
        &self,
        f: impl FnOnce(&mut FavoritesFile) -> MobileResult<R>,
    ) -> MobileResult<R> {
        self.file.update(f)
    }

    /// Removes every favorite `pred` matches and returns how many went.
    pub(crate) fn remove_where(
        &self,
        pred: impl Fn(&StoredFavorite) -> bool,
    ) -> MobileResult<usize> {
        self.update(|file| {
            let before = file.favorites.len();
            file.favorites.retain(|f| !pred(f));
            Ok(before - file.favorites.len())
        })
    }

    /// Points the favorite of a renamed document at its new location and docKey.
    pub(crate) fn rekey(
        &self,
        old_key: &str,
        old_uri: &str,
        new_key: &str,
        new_uri: &str,
        new_name: &str,
    ) -> MobileResult<()> {
        if !self
            .load()?
            .favorites
            .iter()
            .any(|f| f.doc_key == old_key || f.uri == old_uri)
        {
            return Ok(());
        }
        self.update(|file| {
            for fav in file.favorites.iter_mut() {
                if fav.doc_key == old_key || fav.uri == old_uri {
                    fav.doc_key = new_key.to_string();
                    fav.uri = new_uri.to_string();
                    fav.name = new_name.to_string();
                    fav.format = MobileDocFormat::from_name(new_name);
                }
            }
            // One row per docKey, even if the new key was starred already.
            let mut seen = std::collections::BTreeSet::new();
            file.favorites.retain(|f| seen.insert(f.doc_key.clone()));
            Ok(())
        })
    }
}
