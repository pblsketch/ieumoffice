//! Home screen service (mobile v1 track T6): linked folders, favorites and groups, file actions
//! (rename, duplicate, delete, share, read), received files, storage usage and clearing, the
//! bundled sample document, and app info.
//!
//! Document locations (URIs, bookmarks, cache paths) never leave Rust: the WebView gets opaque
//! ids (`FolderEntry::id`, `IncomingEntry::id`, recent row ids, docKeys) and this service maps
//! them back.

mod disk;
mod stores;

pub(crate) use stores::{FavoriteStore, FolderStore, StoredFolder};

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::recent::now_millis;
use crate::storage::{
    LocalSource, MobileDocFormat, MobileDocSession, MobileFileService, ThumbnailCache,
    ThumbnailPayload, map_fs_error, persistent_doc_key, thumbnails::extract_thumbnail_from_bytes,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;
use stores::StoredFavorite;
use tauri_plugin_ieum_mobile::fs::{
    FolderGrantState, INCOMING_RELATIVE_DIR, NativeDirs, NativeFsError, NativeFsErrorKind,
    NativeHomeError, NativeHomeErrorKind, is_openable_external_url, is_valid_document_name,
};
use uuid::Uuid;

// Message keys of the home commands (spec 3.20). The WebView picks its text by these.
pub const KEY_NAME_INVALID: &str = "mobile.home.nameInvalid";
pub const KEY_NAME_TAKEN: &str = "mobile.home.nameTaken";
pub const KEY_NOT_SUPPORTED_HERE: &str = "mobile.home.notSupportedHere";
pub const KEY_GROUP_NAME_INVALID: &str = "mobile.home.groupNameInvalid";
pub const KEY_GROUP_NAME_TAKEN: &str = "mobile.home.groupNameTaken";
pub const KEY_FOLDER_LOST: &str = "mobile.home.folderLost";
pub const KEY_URL_REFUSED: &str = "mobile.home.urlRefused";
/// A reference the service no longer knows (stale listing, removed row). Shown as a general failure.
pub const KEY_NOT_FOUND: &str = "mobile.home.notFound";
pub const KEY_FAILED: &str = "mobile.home.failed";
const KEY_NOT_OPENABLE: &str = "mobile.format.notOpenable";

// The product name is spelled out in these two file names on purpose: Rust cannot read
// packages/i18n/src/product.ts, so change them together with it if the product name changes.
/// Name of the bundled sample document for the Korean screen language.
pub const SAMPLE_NAME_KO: &str = "이음오피스 시작하기.hwpx";
/// Name of the bundled sample document for every other screen language.
pub const SAMPLE_NAME_EN: &str = "Getting started with IeumOffice.hwpx";
const SAMPLE_KO: &[u8] = include_bytes!("../samples/welcome-ko.hwpx");
const SAMPLE_EN: &[u8] = include_bytes!("../samples/welcome-en.hwpx");

/// Picture extensions the folder tab and received files show (lower case).
pub const PICTURE_EXTENSIONS: [&str; 8] =
    ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"];
/// Extensions that map to a document format (lower case); everything else is not a document.
const DOCUMENT_EXTENSIONS: [&str; 14] = [
    "hwp", "hwpx", "md", "markdown", "txt", "pdf", "html", "htm", "xlsx", "xlsm", "xls", "csv",
    "epub", "pptx",
];

/// Longest run of " 2", " 3", ... tried when a copy name is taken (guards a provider that
/// reports every name as taken; not a size limit).
const MAX_COPY_NAME_TRIES: u32 = 1000;

// --- Types sent over IPC (camelCase, same meaning as `@genoffice/mobile-bridge/home`) ---

/// Points at one file the home screen shows, whichever list it came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileRef {
    Recent {
        id: String,
    },
    Favorite {
        #[serde(rename = "docKey")]
        doc_key: String,
    },
    Folder {
        #[serde(rename = "folderId")]
        folder_id: String,
        #[serde(rename = "entryId")]
        entry_id: String,
    },
    Incoming {
        #[serde(rename = "batchId")]
        batch_id: String,
        #[serde(rename = "entryId")]
        entry_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderStatus {
    Ok,
    Lost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolder {
    pub id: String,
    pub name: String,
    pub status: FolderStatus,
    /// `revoked` (the OS no longer holds the grant) or `missing` (the folder moved or was deleted).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lost_reason: Option<String>,
    pub added_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    /// Opaque key, valid with its folder id for this app run.
    pub id: String,
    pub name: String,
    pub is_dir: bool,
    /// Set for documents the open gate lets through.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<MobileDocFormat>,
    pub is_picture: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<i64>,
    /// The file is starred (same document key as its favorite row).
    pub favorite: bool,
    /// The starred file's group, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteEntry {
    pub doc_key: String,
    pub name: String,
    pub format: MobileDocFormat,
    /// `null` when the favorite is in no group.
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    pub added_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteGroup {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingEntry {
    pub id: String,
    pub name: String,
    pub mime: String,
    /// Set for documents the open gate lets through.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<MobileDocFormat>,
    pub is_picture: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingBatch {
    pub id: String,
    pub entries: Vec<IncomingEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkFolderResult {
    pub removed_entries: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountFolderEntriesResult {
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailure {
    pub file_ref: FileRef,
    pub message_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFilesResult {
    pub deleted: Vec<FileRef>,
    pub failed: Vec<DeleteFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRefBytes {
    pub bytes_base64: String,
    pub name: String,
    pub mime: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMetaEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub recovery_bytes: u64,
    pub temp_bytes: u64,
    pub backup_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClearStorageKind {
    Temp,
    Recovery,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearStorageResult {
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppPlatform {
    Android,
    Ios,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: AppPlatform,
    /// OS release ("16" on Android); empty when unknown.
    pub os_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeOkResult {
    pub ok: bool,
}

// --- Names, formats, errors ---

/// Lower-case extension after the last dot (none for `.hidden` or `name.`).
fn extension(name: &str) -> Option<String> {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => Some(ext.to_ascii_lowercase()),
        _ => None,
    }
}

/// `name` split into base name and extension (the extension keeps its letter case).
fn split_name(name: &str) -> (&str, Option<&str>) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem, Some(ext)),
        _ => (name, None),
    }
}

/// The document format of a file name, or `None` when it is not a document type the app knows.
pub fn known_format(name: &str) -> Option<MobileDocFormat> {
    let ext = extension(name)?;
    DOCUMENT_EXTENSIONS
        .contains(&ext.as_str())
        .then(|| MobileDocFormat::from_name(name))
}

fn picture_mime(name: &str) -> Option<&'static str> {
    Some(match extension(name)?.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        _ => return None,
    })
}

fn is_picture(name: &str, mime: Option<&str>) -> bool {
    extension(name).is_some_and(|ext| PICTURE_EXTENSIONS.contains(&ext.as_str()))
        || mime.is_some_and(|m| m.to_ascii_lowercase().starts_with("image/"))
}

fn mime_for(name: &str) -> String {
    known_format(name)
        .map(|f| f.mime())
        .or_else(|| picture_mime(name))
        .unwrap_or("application/octet-stream")
        .to_string()
}

fn copy_name(name: &str, suffix: &str, n: u32) -> String {
    let (base, ext) = split_name(name);
    let mut out = base.to_string();
    let suffix = suffix.trim();
    if !suffix.is_empty() {
        out.push(' ');
        out.push_str(suffix);
    }
    if n > 1 {
        out.push_str(&format!(" {n}"));
    }
    if let Some(ext) = ext {
        out.push('.');
        out.push_str(ext);
    }
    out
}

fn err(code: MobileErrorCode, key: &str, detail: impl Into<String>) -> MobileError {
    MobileError::with_detail(code, key, detail)
}

pub(crate) fn folder_lost(detail: &str) -> MobileError {
    err(MobileErrorCode::PermissionDenied, KEY_FOLDER_LOST, detail)
}

fn not_found(detail: &str) -> MobileError {
    err(MobileErrorCode::InternalError, KEY_NOT_FOUND, detail)
}

fn not_supported_here(detail: &str) -> MobileError {
    err(
        MobileErrorCode::PermissionDenied,
        KEY_NOT_SUPPORTED_HERE,
        detail,
    )
}

fn not_openable(name: &str) -> MobileError {
    err(
        MobileErrorCode::InvalidArgument,
        KEY_NOT_OPENABLE,
        extension(name).unwrap_or_default(),
    )
}

/// `map_fs_error`, except that a lost grant under a linked folder reads as `folderLost`.
pub(crate) fn map_fs_error_in(e: NativeFsError, in_folder: bool) -> MobileError {
    if in_folder && e.kind == NativeFsErrorKind::PermissionDenied {
        return folder_lost(&e.detail);
    }
    map_fs_error(e)
}

/// Maps a native home failure to the spec 3.20 error table. `invalid_key` is the message key
/// for `InvalidArgument` (a bad name for rename/copy).
fn map_home_error(e: NativeHomeError, in_folder: bool, invalid_key: &str) -> MobileError {
    use MobileErrorCode as C;
    match e.kind {
        NativeHomeErrorKind::UserCancelled => {
            err(C::UserCancelled, "mobile.fs.cancelled", e.detail)
        }
        NativeHomeErrorKind::PermissionDenied if in_folder => folder_lost(&e.detail),
        NativeHomeErrorKind::PermissionDenied => {
            err(C::PermissionDenied, "mobile.fs.permissionDenied", e.detail)
        }
        NativeHomeErrorKind::NotSupportedHere => not_supported_here(&e.detail),
        NativeHomeErrorKind::NameTaken => err(C::InvalidArgument, KEY_NAME_TAKEN, e.detail),
        NativeHomeErrorKind::InvalidArgument => err(C::InvalidArgument, invalid_key, e.detail),
        NativeHomeErrorKind::NotFound => not_found(&e.detail),
        NativeHomeErrorKind::IoError => err(C::InternalError, KEY_FAILED, e.detail),
    }
}

// --- Service ---

/// A folder listing row the WebView may refer to by its opaque id.
#[derive(Debug, Clone)]
struct EntryInfo {
    folder_id: String,
    uri: String,
    name: String,
    is_dir: bool,
    size_bytes: Option<u64>,
    modified_at: Option<i64>,
}

/// One received file of a batch taken in this run.
#[derive(Debug, Clone)]
struct ReceivedFile {
    id: String,
    name: String,
    mime: String,
    path: PathBuf,
}

/// What a `FileRef` points at.
enum Target {
    /// A document the app reaches through a grant.
    Doc {
        uri: String,
        name: String,
        doc_key: String,
        folder_id: Option<String>,
        size_bytes: Option<u64>,
        modified_at: Option<i64>,
    },
    /// A received file's copy in the app cache.
    Received {
        name: String,
        mime: String,
        path: PathBuf,
    },
}

pub struct HomeService {
    files: Arc<MobileFileService>,
    /// When this service (and so this app run) started; clearing skips files changed since.
    started_at: SystemTime,
    app_version: String,
    dirs: Mutex<Option<NativeDirs>>,
    entries: Mutex<HashMap<String, EntryInfo>>,
    incoming: Mutex<HashMap<String, Vec<ReceivedFile>>>,
    os_version: OnceLock<String>,
}

impl HomeService {
    /// Creates the service and removes received-file copies left by earlier runs.
    pub fn new(
        files: Arc<MobileFileService>,
        app_version: impl Into<String>,
    ) -> MobileResult<Self> {
        let service = Self {
            files,
            started_at: SystemTime::now(),
            app_version: app_version.into(),
            dirs: Mutex::new(None),
            entries: Mutex::new(HashMap::new()),
            incoming: Mutex::new(HashMap::new()),
            os_version: OnceLock::new(),
        };
        if let Some(dirs) = service.dirs() {
            disk::clear_tree_older_than(
                &dirs.cache_dir.join(INCOMING_RELATIVE_DIR),
                service.started_at,
            );
        }
        Ok(service)
    }

    fn dirs(&self) -> Option<NativeDirs> {
        let mut guard = self.dirs.lock().unwrap();
        if guard.is_none() {
            *guard = self.files.bridge().native_dirs().ok();
        }
        guard.clone()
    }

    fn remember(
        &self,
        folder_id: &str,
        uri: &str,
        name: &str,
        is_dir: bool,
        size_bytes: Option<u64>,
        modified_at: Option<i64>,
    ) -> String {
        let id = persistent_doc_key(&format!("{folder_id}\n{uri}"));
        self.entries.lock().unwrap().insert(
            id.clone(),
            EntryInfo {
                folder_id: folder_id.to_string(),
                uri: uri.to_string(),
                name: name.to_string(),
                is_dir,
                size_bytes,
                modified_at,
            },
        );
        id
    }

    fn forget_uri(&self, uri: &str) {
        self.entries.lock().unwrap().retain(|_, e| e.uri != uri);
    }

    fn entry(&self, folder_id: &str, entry_id: &str) -> MobileResult<EntryInfo> {
        self.entries
            .lock()
            .unwrap()
            .get(entry_id)
            .filter(|e| e.folder_id == folder_id)
            .cloned()
            .ok_or_else(|| not_found("unknown folder entry"))
    }

    fn received(&self, batch_id: &str, entry_id: &str) -> MobileResult<ReceivedFile> {
        self.incoming
            .lock()
            .unwrap()
            .get(batch_id)
            .and_then(|files| files.iter().find(|f| f.id == entry_id))
            .cloned()
            .ok_or_else(|| not_found("unknown received file"))
    }

    fn resolve(&self, file_ref: &FileRef) -> MobileResult<Target> {
        match file_ref {
            FileRef::Recent { id } => {
                let row = self
                    .files
                    .recent_store()
                    .row(id)?
                    .ok_or_else(|| not_found("unknown recent row"))?;
                Ok(Target::Doc {
                    uri: row.uri,
                    name: row.name,
                    doc_key: row.doc_key,
                    folder_id: row.folder_id,
                    size_bytes: None,
                    modified_at: None,
                })
            }
            FileRef::Favorite { doc_key } => {
                let fav = self
                    .favorite(doc_key)?
                    .ok_or_else(|| not_found("unknown favorite"))?;
                Ok(Target::Doc {
                    uri: fav.uri,
                    name: fav.name,
                    doc_key: fav.doc_key,
                    folder_id: fav.folder_id,
                    size_bytes: None,
                    modified_at: None,
                })
            }
            FileRef::Folder {
                folder_id,
                entry_id,
            } => {
                let info = self.entry(folder_id, entry_id)?;
                if info.is_dir {
                    return Err(err(
                        MobileErrorCode::InvalidArgument,
                        KEY_NOT_FOUND,
                        "folder entry is a folder",
                    ));
                }
                Ok(Target::Doc {
                    doc_key: persistent_doc_key(&info.uri),
                    uri: info.uri,
                    name: info.name,
                    folder_id: Some(info.folder_id),
                    size_bytes: info.size_bytes,
                    modified_at: info.modified_at,
                })
            }
            FileRef::Incoming { batch_id, entry_id } => {
                let file = self.received(batch_id, entry_id)?;
                Ok(Target::Received {
                    name: file.name,
                    mime: file.mime,
                    path: file.path,
                })
            }
        }
    }

    fn favorite(&self, doc_key: &str) -> MobileResult<Option<StoredFavorite>> {
        Ok(self
            .files
            .favorite_store()
            .load()?
            .favorites
            .into_iter()
            .find(|f| f.doc_key == doc_key))
    }

    // --- Linked folders ---

    fn linked_folder(&self, folder: &StoredFolder) -> LinkedFolder {
        let (status, lost_reason) = match self.files.bridge().check_folder_grant(&folder.uri) {
            FolderGrantState::Alive => (FolderStatus::Ok, None),
            FolderGrantState::Revoked => (FolderStatus::Lost, Some("revoked".to_string())),
            FolderGrantState::Missing => (FolderStatus::Lost, Some("missing".to_string())),
        };
        LinkedFolder {
            id: folder.id.clone(),
            name: folder.name.clone(),
            status,
            lost_reason,
            added_at: folder.added_at,
        }
    }

    pub fn list_folders(&self) -> MobileResult<Vec<LinkedFolder>> {
        Ok(self
            .files
            .folder_store()
            .list()?
            .iter()
            .map(|f| self.linked_folder(f))
            .collect())
    }

    /// Opens the system folder picker and links the chosen folder, or puts it in place of the
    /// linked folder `replace_id` (same id, so its recent and favorite rows stay).
    pub fn link_folder(&self, replace_id: Option<&str>) -> MobileResult<LinkedFolder> {
        if let Some(id) = replace_id
            && self.files.folder_store().get(id)?.is_none()
        {
            return Err(not_found("unknown linked folder"));
        }
        let picked = self
            .files
            .bridge()
            .pick_folder()
            .map_err(|e| map_home_error(e, false, KEY_FAILED))?;
        let (folder, released) = self.files.folder_store().update(|folders| {
            if let Some(id) = replace_id {
                let row = folders
                    .iter_mut()
                    .find(|f| f.id == id)
                    .ok_or_else(|| not_found("unknown linked folder"))?;
                let old_uri = std::mem::replace(&mut row.uri, picked.uri.clone());
                row.name = picked.name.clone();
                let released = (old_uri != picked.uri).then_some(old_uri);
                return Ok((row.clone(), released));
            }
            if let Some(existing) = folders.iter().find(|f| f.uri == picked.uri) {
                return Ok((existing.clone(), None));
            }
            let row = StoredFolder {
                id: Uuid::new_v4().to_string(),
                uri: picked.uri.clone(),
                name: picked.name.clone(),
                added_at: now_millis(),
            };
            folders.push(row.clone());
            Ok((row, None))
        })?;
        if let Some(old_uri) = released {
            let _ = self.files.bridge().release_folder(&old_uri);
            self.entries
                .lock()
                .unwrap()
                .retain(|_, e| e.folder_id != folder.id);
        }
        Ok(self.linked_folder(&folder))
    }

    /// Recent and favorite rows that belong to a linked folder.
    pub fn count_folder_entries(&self, id: &str) -> MobileResult<CountFolderEntriesResult> {
        let recent = self
            .files
            .recent_store()
            .rows()?
            .iter()
            .filter(|r| r.folder_id.as_deref() == Some(id))
            .count();
        let favorites = self
            .files
            .favorite_store()
            .load()?
            .favorites
            .iter()
            .filter(|f| f.folder_id.as_deref() == Some(id))
            .count();
        Ok(CountFolderEntriesResult {
            count: recent + favorites,
        })
    }

    /// Unlinks a folder: drops its recent and favorite rows, gives the grant back. The files
    /// themselves stay.
    pub fn unlink_folder(&self, id: &str) -> MobileResult<UnlinkFolderResult> {
        let removed = self.files.folder_store().update(|folders| {
            let pos = folders.iter().position(|f| f.id == id);
            Ok(pos.map(|p| folders.remove(p)))
        })?;
        let recent = self
            .files
            .recent_store()
            .remove_where(|r| r.folder_id.as_deref() == Some(id))?;
        let favorites = self
            .files
            .favorite_store()
            .remove_where(|f| f.folder_id.as_deref() == Some(id))?;
        if let Some(folder) = removed {
            let _ = self.files.bridge().release_folder(&folder.uri);
        }
        self.entries
            .lock()
            .unwrap()
            .retain(|_, e| e.folder_id != id);
        Ok(UnlinkFolderResult {
            removed_entries: recent + favorites,
        })
    }

    /// Lists sub folders, documents the open gate lets through, and pictures; folders first,
    /// then the most recently modified first.
    pub fn list_folder(&self, folder_id: &str, path: &[String]) -> MobileResult<Vec<FolderEntry>> {
        let folder = self
            .files
            .folder_store()
            .get(folder_id)?
            .ok_or_else(|| folder_lost("folder is not linked"))?;
        let raw = self
            .files
            .bridge()
            .list_folder(&folder.uri, path)
            .map_err(|e| map_home_error(e, true, KEY_NOT_FOUND))?;
        let favorites = self.files.favorite_store().load()?.favorites;
        let mut out = Vec::new();
        for item in raw {
            let picture = !item.is_dir && is_picture(&item.name, item.mime.as_deref());
            let starred = if item.is_dir {
                None
            } else {
                let key = persistent_doc_key(&item.uri);
                favorites.iter().find(|f| f.doc_key == key)
            };
            let format = if item.is_dir || picture {
                None
            } else {
                match known_format(&item.name) {
                    Some(f) if self.files.is_openable_format(f) => Some(f),
                    _ => continue,
                }
            };
            let size_bytes = if item.is_dir { None } else { item.size_bytes };
            out.push(FolderEntry {
                id: self.remember(
                    folder_id,
                    &item.uri,
                    &item.name,
                    item.is_dir,
                    size_bytes,
                    item.modified_ms,
                ),
                name: item.name,
                is_dir: item.is_dir,
                format,
                is_picture: picture,
                size_bytes,
                modified_at: item.modified_ms,
                favorite: starred.is_some(),
                group_id: starred.and_then(|f| f.group_id.clone()),
            });
        }
        out.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| b.modified_at.cmp(&a.modified_at))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    /// Opens a folder file through the folder grant (open gate applies) and adds it to the
    /// recent list with its folder.
    pub fn open_folder_entry(
        &self,
        folder_id: &str,
        entry_id: &str,
    ) -> MobileResult<MobileDocSession> {
        let info = self.entry(folder_id, entry_id)?;
        if info.is_dir || known_format(&info.name).is_none() {
            return Err(not_openable(&info.name));
        }
        self.files.open_document_uri(&info.uri, Some(folder_id))
    }

    /// Opens a favorite through its stored grant (its folder's when it has one).
    pub fn open_favorite(&self, doc_key: &str) -> MobileResult<MobileDocSession> {
        let fav = self
            .favorite(doc_key)?
            .ok_or_else(|| not_found("unknown favorite"))?;
        self.files
            .open_document_uri(&fav.uri, fav.folder_id.as_deref())
    }

    /// Location hints for the recent rows (the linked folder a row was opened through).
    pub fn recent_meta(&self) -> MobileResult<Vec<RecentMetaEntry>> {
        let names: BTreeMap<String, String> = self
            .files
            .folder_store()
            .list()?
            .into_iter()
            .map(|f| (f.id, f.name))
            .collect();
        Ok(self
            .files
            .recent_store()
            .rows()?
            .into_iter()
            .map(|r| RecentMetaEntry {
                folder_name: r.folder_id.as_ref().and_then(|id| names.get(id).cloned()),
                folder_id: r.folder_id,
                id: r.id,
            })
            .collect())
    }

    // --- Favorites and groups ---

    pub fn list_favorites(&self) -> MobileResult<Vec<FavoriteEntry>> {
        Ok(self
            .files
            .favorite_store()
            .load()?
            .favorites
            .into_iter()
            .map(|f| FavoriteEntry {
                doc_key: f.doc_key,
                name: f.name,
                format: f.format,
                group_id: f.group_id,
                folder_id: f.folder_id,
                added_at: f.added_at,
            })
            .collect())
    }

    /// Stars (`on`) or unstars a file. One favorite per docKey; unstarring also takes it out of
    /// its group.
    pub fn set_favorite(&self, file_ref: &FileRef, on: bool) -> MobileResult<Vec<FavoriteEntry>> {
        if let (FileRef::Favorite { doc_key }, false) = (file_ref, on) {
            self.files
                .favorite_store()
                .remove_where(|f| &f.doc_key == doc_key)?;
            self.files.evict_thumbnail_cache(doc_key);
            return self.list_favorites();
        }
        let Target::Doc {
            uri,
            name,
            doc_key,
            folder_id,
            ..
        } = self.resolve(file_ref)?
        else {
            return Err(not_supported_here("received files cannot be starred"));
        };
        if !on {
            self.files
                .favorite_store()
                .remove_where(|f| f.doc_key == doc_key)?;
            self.files.evict_thumbnail_cache(&doc_key);
            return self.list_favorites();
        }
        let format = known_format(&name).ok_or_else(|| not_openable(&name))?;
        self.files.favorite_store().update(|file| {
            if !file.favorites.iter().any(|f| f.doc_key == doc_key) {
                file.favorites.insert(
                    0,
                    StoredFavorite {
                        doc_key: doc_key.clone(),
                        uri: uri.clone(),
                        name: name.clone(),
                        format,
                        group_id: None,
                        folder_id: folder_id.clone(),
                        added_at: now_millis(),
                    },
                );
            }
            Ok(())
        })?;
        self.list_favorites()
    }

    pub fn list_groups(&self) -> MobileResult<Vec<FavoriteGroup>> {
        Ok(self.files.favorite_store().load()?.groups)
    }

    /// Creates a group (`id` = `None`) or renames group `id`. Names are trimmed, must not be
    /// empty, and must differ (ignoring letter case) from every other group's.
    pub fn save_group(&self, id: Option<&str>, name: &str) -> MobileResult<Vec<FavoriteGroup>> {
        let name = name.trim();
        if name.is_empty() {
            return Err(err(
                MobileErrorCode::InvalidArgument,
                KEY_GROUP_NAME_INVALID,
                "empty group name",
            ));
        }
        let folded = name.to_lowercase();
        self.files.favorite_store().update(|file| {
            if file
                .groups
                .iter()
                .any(|g| Some(g.id.as_str()) != id && g.name.trim().to_lowercase() == folded)
            {
                return Err(err(
                    MobileErrorCode::InvalidArgument,
                    KEY_GROUP_NAME_TAKEN,
                    "group name already used",
                ));
            }
            match id {
                Some(id) => {
                    let group = file
                        .groups
                        .iter_mut()
                        .find(|g| g.id == id)
                        .ok_or_else(|| not_found("unknown group"))?;
                    group.name = name.to_string();
                }
                None => file.groups.push(FavoriteGroup {
                    id: Uuid::new_v4().to_string(),
                    name: name.to_string(),
                }),
            }
            Ok(())
        })?;
        self.list_groups()
    }

    /// Deletes a group; its favorites stay starred, in no group.
    pub fn delete_group(&self, id: &str) -> MobileResult<Vec<FavoriteGroup>> {
        self.files.favorite_store().update(|file| {
            file.groups.retain(|g| g.id != id);
            for fav in file.favorites.iter_mut() {
                if fav.group_id.as_deref() == Some(id) {
                    fav.group_id = None;
                }
            }
            Ok(())
        })?;
        self.list_groups()
    }

    /// Moves the starred files among `refs` into group `group_id` (`None` = no group). Files
    /// that are not starred are left alone.
    pub fn move_to_group(
        &self,
        refs: &[FileRef],
        group_id: Option<&str>,
    ) -> MobileResult<Vec<FavoriteEntry>> {
        let keys: BTreeSet<String> = refs
            .iter()
            .filter_map(|r| match r {
                FileRef::Favorite { doc_key } => Some(doc_key.clone()),
                other => match self.resolve(other) {
                    Ok(Target::Doc { doc_key, .. }) => Some(doc_key),
                    _ => None,
                },
            })
            .collect();
        self.files.favorite_store().update(|file| {
            if let Some(gid) = group_id
                && !file.groups.iter().any(|g| g.id == gid)
            {
                return Err(not_found("unknown group"));
            }
            for fav in file.favorites.iter_mut() {
                if keys.contains(&fav.doc_key) {
                    fav.group_id = group_id.map(str::to_string);
                }
            }
            Ok(())
        })?;
        self.list_favorites()
    }

    // --- File actions ---

    /// Renames a file, keeping its extension (`new_base_name` is the name without it), and
    /// moves its recent and favorite rows, recovery copy, and HWP backups to the new docKey.
    pub fn rename(&self, file_ref: &FileRef, new_base_name: &str) -> MobileResult<FileRef> {
        let Target::Doc {
            uri,
            name,
            doc_key,
            folder_id,
            ..
        } = self.resolve(file_ref)?
        else {
            return Err(not_supported_here("received files cannot be renamed"));
        };
        let base = new_base_name.trim();
        let new_name = match split_name(&name).1 {
            Some(ext) => format!("{base}.{ext}"),
            None => base.to_string(),
        };
        if base.is_empty() || base.contains(['/', '\\']) || !is_valid_document_name(&new_name) {
            return Err(err(
                MobileErrorCode::InvalidArgument,
                KEY_NAME_INVALID,
                "invalid document name",
            ));
        }
        let new_uri = self
            .files
            .bridge()
            .rename_document(&uri, &new_name)
            .map_err(|e| map_home_error(e, folder_id.is_some(), KEY_NAME_INVALID))?;
        let new_key = self
            .files
            .rekey_document(&doc_key, &uri, &new_uri, &new_name)?;
        self.forget_uri(&uri);
        Ok(match file_ref {
            FileRef::Folder { folder_id, .. } => FileRef::Folder {
                entry_id: self.remember(folder_id, &new_uri, &new_name, false, None, None),
                folder_id: folder_id.clone(),
            },
            FileRef::Favorite { .. } => FileRef::Favorite { doc_key: new_key },
            other => other.clone(),
        })
    }

    /// Copies a file. Inside a linked folder the copy goes next to it as
    /// "<name> <copySuffix>.<ext>" (then " 2", " 3", ...); anywhere else the system save
    /// dialog asks where, and the copy joins the recent list. `None` when the dialog was
    /// cancelled (or the copy is not a document the recent list can hold).
    pub fn duplicate(
        &self,
        file_ref: &FileRef,
        copy_suffix: &str,
    ) -> MobileResult<Option<FileRef>> {
        let bridge = self.files.bridge();
        let (name, bytes) = match self.resolve(file_ref)? {
            Target::Doc {
                uri,
                name,
                folder_id: Some(folder_id),
                ..
            } => {
                for n in 1..=MAX_COPY_NAME_TRIES {
                    let candidate = copy_name(&name, copy_suffix, n);
                    match bridge.copy_document(&uri, &candidate) {
                        Ok(copy_uri) => {
                            return Ok(Some(FileRef::Folder {
                                entry_id: self.remember(
                                    &folder_id,
                                    &copy_uri,
                                    &candidate,
                                    false,
                                    None,
                                    None,
                                ),
                                folder_id,
                            }));
                        }
                        Err(e) if e.kind == NativeHomeErrorKind::NameTaken => continue,
                        Err(e) => return Err(map_home_error(e, true, KEY_NAME_INVALID)),
                    }
                }
                return Err(err(
                    MobileErrorCode::InvalidArgument,
                    KEY_NAME_TAKEN,
                    "no free copy name",
                ));
            }
            Target::Doc { uri, name, .. } => {
                let bytes = bridge.read_uri_bytes(&uri).map_err(map_fs_error)?;
                (name, bytes)
            }
            Target::Received { name, path, .. } => (name, LocalSource::CacheFile(path).read()?),
        };
        let suggested = copy_name(&name, copy_suffix, 1);
        let picked = match bridge.create_save_file(&suggested, &mime_for(&suggested)) {
            Ok(picked) => picked,
            Err(e) if e.kind == NativeFsErrorKind::UserCancelled => return Ok(None),
            Err(e) => return Err(map_fs_error(e)),
        };
        bridge
            .write_uri_bytes_atomic(&picked.uri, &bytes)
            .map_err(map_fs_error)?;
        let Some(format) = known_format(&picked.name) else {
            return Ok(None);
        };
        let row = self.files.recent_store().upsert(
            &persistent_doc_key(&picked.uri),
            &picked.uri,
            &picked.name,
            format,
        )?;
        Ok(Some(FileRef::Recent { id: row.id }))
    }

    /// Deletes files one by one (Android: for good through SAF; iOS: to the Files trash) and
    /// drops their recent and favorite rows. Recovery copies stay.
    pub fn delete(&self, refs: &[FileRef]) -> MobileResult<DeleteFilesResult> {
        let mut result = DeleteFilesResult {
            deleted: Vec::new(),
            failed: Vec::new(),
        };
        for file_ref in refs {
            let outcome = match self.resolve(file_ref) {
                Ok(Target::Doc {
                    uri,
                    doc_key,
                    folder_id,
                    ..
                }) => self
                    .files
                    .bridge()
                    .delete_document(&uri)
                    .map_err(|e| map_home_error(e, folder_id.is_some(), KEY_FAILED))
                    .and_then(|()| {
                        self.files
                            .recent_store()
                            .remove_where(|r| r.doc_key == doc_key || r.uri == uri)?;
                        self.files
                            .favorite_store()
                            .remove_where(|f| f.doc_key == doc_key || f.uri == uri)?;
                        self.files.evict_thumbnail_cache(&doc_key);
                        self.forget_uri(&uri);
                        Ok(())
                    }),
                Ok(Target::Received { .. }) => {
                    Err(not_supported_here("received files cannot be deleted"))
                }
                Err(e) => Err(e),
            };
            match outcome {
                Ok(()) => result.deleted.push(file_ref.clone()),
                Err(e) => result.failed.push(DeleteFailure {
                    file_ref: file_ref.clone(),
                    message_key: e.message_key,
                }),
            }
        }
        Ok(result)
    }

    /// Sends the original files to the OS share sheet, all at once.
    pub fn share_files(&self, refs: &[FileRef]) -> MobileResult<HomeOkResult> {
        let mut items = Vec::with_capacity(refs.len());
        let mut in_folder = false;
        for file_ref in refs {
            match self.resolve(file_ref)? {
                Target::Doc { uri, folder_id, .. } => {
                    in_folder |= folder_id.is_some();
                    items.push(uri);
                }
                Target::Received { path, .. } => items.push(path.to_string_lossy().to_string()),
            }
        }
        self.files
            .bridge()
            .share_files(&items)
            .map_err(|e| map_home_error(e, in_folder, KEY_FAILED))?;
        Ok(HomeOkResult { ok: true })
    }

    /// Reads one file whole (the PDF tools read their inputs one at a time through this).
    pub fn read_bytes(&self, file_ref: &FileRef) -> MobileResult<FileRefBytes> {
        let (mime, name, bytes) = match self.resolve(file_ref)? {
            Target::Doc {
                uri,
                name,
                folder_id,
                ..
            } => {
                let bytes = self
                    .files
                    .bridge()
                    .read_uri_bytes(&uri)
                    .map_err(|e| map_fs_error_in(e, folder_id.is_some()))?;
                (mime_for(&name), name, bytes)
            }
            Target::Received { name, mime, path } => {
                let mime = if mime.is_empty() {
                    mime_for(&name)
                } else {
                    mime
                };
                (mime, name, LocalSource::CacheFile(path).read()?)
            }
        };
        Ok(FileRefBytes {
            bytes_base64: B64.encode(bytes),
            name,
            mime,
        })
    }

    // --- Document thumbnails ---

    fn thumbnail_fingerprint(
        &self,
        file_ref: &FileRef,
        doc_key: &str,
        size_bytes: Option<u64>,
        modified_at: Option<i64>,
    ) -> String {
        match file_ref {
            FileRef::Recent { id } => self
                .files
                .recent_store()
                .rows()
                .ok()
                .and_then(|rows| rows.into_iter().find(|r| r.id == *id))
                .map(|r| format!("recent:{}", r.opened_at))
                .unwrap_or_else(|| format!("recent:{doc_key}")),
            FileRef::Favorite { .. } => self
                .files
                .recent_store()
                .rows()
                .ok()
                .and_then(|rows| rows.into_iter().find(|r| r.doc_key == doc_key))
                .map(|r| format!("recent:{}", r.opened_at))
                .unwrap_or_else(|| {
                    self.files
                        .favorite_store()
                        .load()
                        .ok()
                        .and_then(|f| f.favorites.into_iter().find(|x| x.doc_key == doc_key))
                        .map(|x| format!("fav:{}", x.added_at))
                        .unwrap_or_else(|| format!("fav:{doc_key}"))
                }),
            FileRef::Folder {
                folder_id,
                entry_id,
            } => format!(
                "folder:{folder_id}:{entry_id}:{}:{}",
                size_bytes.unwrap_or(0),
                modified_at.unwrap_or(0)
            ),
            FileRef::Incoming { batch_id, entry_id } => format!("incoming:{batch_id}:{entry_id}"),
        }
    }

    /// Returns a cached or freshly extracted thumbnail for a home/folder/incoming file.
    /// Never extracts or caches thumbnails for encrypted or distribution documents.
    pub fn get_thumbnail(
        &self,
        file_ref: &FileRef,
        max_px: Option<u32>,
    ) -> MobileResult<ThumbnailPayload> {
        const MAX_THUMB_SOURCE_BYTES: usize = 32 * 1024 * 1024;
        let max_px = max_px.unwrap_or(320).clamp(64, 1024);
        let target = match self.resolve(file_ref) {
            Ok(t) => t,
            Err(_) => return Ok(ThumbnailPayload::None),
        };
        let cache_dir = self.dirs().map(|d| d.cache_dir);

        let (doc_key, name, mime_hint, bytes) = match target {
            Target::Doc {
                uri,
                name,
                doc_key,
                size_bytes,
                modified_at,
                ..
            } => {
                let format = known_format(&name);
                let picture = is_picture(&name, None);
                if format.is_none() && !picture {
                    return Ok(ThumbnailPayload::None);
                }
                if self.files.is_protected_doc_key(&doc_key) {
                    return Ok(ThumbnailPayload::None);
                }
                if size_bytes.is_some_and(|s| s > MAX_THUMB_SOURCE_BYTES as u64) {
                    return Ok(ThumbnailPayload::None);
                }
                let fp = self.thumbnail_fingerprint(file_ref, &doc_key, size_bytes, modified_at);
                if let Some(dir) = &cache_dir
                    && let Some(hit) = ThumbnailCache::get(dir, &doc_key, &fp)
                {
                    return Ok(hit);
                }
                let Ok(bytes) = self.files.bridge().read_uri_bytes(&uri) else {
                    return Ok(ThumbnailPayload::None);
                };
                (Some((doc_key, fp)), name, None, bytes)
            }
            Target::Received { name, mime, path } => {
                let format = known_format(&name);
                let picture = is_picture(&name, Some(&mime));
                if format.is_none() && !picture {
                    return Ok(ThumbnailPayload::None);
                }
                let Ok(bytes) = LocalSource::CacheFile(path).read_bounded(MAX_THUMB_SOURCE_BYTES)
                else {
                    return Ok(ThumbnailPayload::None);
                };
                (None, name, Some(mime), bytes)
            }
        };

        // Guard against huge files whose size was unavailable prior to reading.
        if bytes.len() > MAX_THUMB_SOURCE_BYTES {
            return Ok(ThumbnailPayload::None);
        }

        let format = known_format(&name);
        let picture = is_picture(&name, mime_hint.as_deref());
        let payload = if !picture && format == Some(MobileDocFormat::Pdf) {
            match &cache_dir {
                Some(dir) => ThumbnailCache::render_pdf_bytes(
                    dir,
                    &bytes,
                    max_px,
                    self.files.bridge().as_ref(),
                ),
                None => ThumbnailPayload::None,
            }
        } else {
            extract_thumbnail_from_bytes(format, picture, &bytes)
        };

        if let (Some(dir), Some((doc_key, fp))) = (&cache_dir, doc_key)
            && !matches!(payload, ThumbnailPayload::None)
        {
            ThumbnailCache::put(dir, &doc_key, &fp, &payload);
        }
        Ok(payload)
    }

    // --- Received files ---

    /// Takes the oldest waiting batch of received files (several files, or one picture). A
    /// batch holding a single document goes to the pending-open path instead
    /// (`consume_pending_open_intent`); then the next batch is tried.
    pub fn take_incoming(&self) -> MobileResult<Option<IncomingBatch>> {
        loop {
            let Some(batch) = self.files.bridge().take_incoming_batch() else {
                return Ok(None);
            };
            if batch.files.is_empty() {
                continue;
            }
            if let [only] = batch.files.as_slice()
                && !is_picture(&only.name, Some(&only.mime))
            {
                self.files
                    .defer_received_document(only.name.clone(), only.path.clone());
                continue;
            }
            let mut stored = Vec::with_capacity(batch.files.len());
            let mut entries = Vec::with_capacity(batch.files.len());
            for (i, file) in batch.files.into_iter().enumerate() {
                let id = format!("e{i}");
                let picture = is_picture(&file.name, Some(&file.mime));
                let format = if picture {
                    None
                } else {
                    known_format(&file.name).filter(|f| self.files.is_openable_format(*f))
                };
                entries.push(IncomingEntry {
                    id: id.clone(),
                    name: file.name.clone(),
                    mime: file.mime.clone(),
                    format,
                    is_picture: picture,
                    size_bytes: Some(file.size_bytes),
                });
                stored.push(ReceivedFile {
                    id,
                    name: file.name,
                    mime: file.mime,
                    path: file.path,
                });
            }
            self.incoming
                .lock()
                .unwrap()
                .insert(batch.id.clone(), stored);
            return Ok(Some(IncomingBatch {
                id: batch.id,
                entries,
            }));
        }
    }

    /// Opens a received document read-only from its cache copy (not added to the recent list).
    pub fn open_incoming_entry(
        &self,
        batch_id: &str,
        entry_id: &str,
    ) -> MobileResult<MobileDocSession> {
        let file = self.received(batch_id, entry_id)?;
        if is_picture(&file.name, Some(&file.mime)) || known_format(&file.name).is_none() {
            return Err(not_openable(&file.name));
        }
        self.files
            .open_local(&file.name, LocalSource::CacheFile(file.path))
    }

    // --- Sample document ---

    /// Opens the bundled sample (Korean for `ko`/`ko-*`, English otherwise) read-only; it is
    /// not added to the recent list.
    pub fn open_sample(&self, lang: &str) -> MobileResult<MobileDocSession> {
        let lower = lang.trim().to_ascii_lowercase();
        let korean = lower == "ko" || lower.starts_with("ko-") || lower.starts_with("ko_");
        let (name, bytes) = if korean {
            (SAMPLE_NAME_KO, SAMPLE_KO)
        } else {
            (SAMPLE_NAME_EN, SAMPLE_EN)
        };
        self.files.open_local(name, LocalSource::Bundled(bytes))
    }

    // --- Storage ---

    fn temp_roots(&self) -> Vec<PathBuf> {
        let Some(dirs) = self.dirs() else {
            return Vec::new();
        };
        let tmp = dirs.cache_dir.join("ieum-tmp");
        let mut roots = vec![tmp.clone()];
        if !dirs.share_temp_dir.starts_with(&tmp) {
            roots.push(dirs.share_temp_dir);
        }
        roots
    }

    /// Sizes of the recovery copies, the HWP backups, and the temporary files
    /// (`<cache>/ieum-tmp/` and the share-out copies).
    pub fn storage_usage(&self) -> MobileResult<StorageUsage> {
        Ok(StorageUsage {
            recovery_bytes: disk::tree_size(self.files.recovery_store().dir()),
            temp_bytes: self.temp_roots().iter().map(|p| disk::tree_size(p)).sum(),
            backup_bytes: disk::tree_size(self.files.backup_store().dir()),
        })
    }

    /// Clears temporary files or recovery copies, skipping files changed since this app run
    /// started (they may be in use) and the recovery copy of `keep_doc_key`.
    pub fn clear_storage(
        &self,
        kind: ClearStorageKind,
        keep_doc_key: Option<&str>,
    ) -> MobileResult<ClearStorageResult> {
        let freed_bytes = match kind {
            ClearStorageKind::Temp => self
                .temp_roots()
                .iter()
                .map(|p| disk::clear_tree_older_than(p, self.started_at))
                .sum(),
            ClearStorageKind::Recovery => self
                .files
                .recovery_store()
                .clear_older_than(self.started_at, keep_doc_key),
        };
        Ok(ClearStorageResult { freed_bytes })
    }

    // --- App info, screen, links ---

    pub fn app_info(&self) -> AppInfo {
        let platform = if cfg!(target_os = "android") {
            AppPlatform::Android
        } else if cfg!(target_os = "ios") {
            AppPlatform::Ios
        } else {
            AppPlatform::Other
        };
        AppInfo {
            version: self.app_version.clone(),
            platform,
            os_version: self.os_version.get_or_init(os_version).clone(),
        }
    }

    pub fn keep_screen_on(&self, on: bool) -> MobileResult<HomeOkResult> {
        self.files
            .bridge()
            .set_keep_screen_on(on)
            .map_err(|e| map_home_error(e, false, KEY_FAILED))?;
        Ok(HomeOkResult { ok: true })
    }

    /// Opens an `https://` URL in the system browser; anything else is `mobile.home.urlRefused`.
    pub fn open_external_url(&self, url: &str) -> MobileResult<HomeOkResult> {
        if !is_openable_external_url(url) {
            return Err(err(
                MobileErrorCode::InvalidArgument,
                KEY_URL_REFUSED,
                "only http, https, and mailto URLs are opened",
            ));
        }
        self.files
            .bridge()
            .open_external_url(url)
            .map_err(|e| map_home_error(e, false, KEY_URL_REFUSED))?;
        Ok(HomeOkResult { ok: true })
    }
}

/// The OS release. Android reads the system property with the platform's own tool (a fixed
/// program, no shell); elsewhere it is left empty.
fn os_version() -> String {
    #[cfg(target_os = "android")]
    {
        std::process::Command::new("/system/bin/getprop")
            .arg("ro.build.version.release")
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "android"))]
    {
        String::new()
    }
}
