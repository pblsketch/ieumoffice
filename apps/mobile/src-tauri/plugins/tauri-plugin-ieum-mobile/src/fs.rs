use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Metadata returned when a native OS picker or incoming intent supplies a document URI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub uri: String,
    pub name: String,
    pub writable: bool,
    pub ephemeral: bool,
}

/// Failure category returned by the OS file/share bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeFsErrorKind {
    UserCancelled,
    PermissionDenied,
    ReadOnlyUri,
    IoError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeFsError {
    pub kind: NativeFsErrorKind,
    pub detail: String,
}

impl NativeFsError {
    pub fn new(kind: NativeFsErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }
}

/// Where received files are copied, relative to the app cache directory
/// (`<cache>/ieum-tmp/home/incoming/<batchId>/<name>`).
pub const INCOMING_RELATIVE_DIR: &str = "ieum-tmp/home/incoming";

/// A folder the user linked through the system folder picker. `uri` is the Android tree URI
/// (with a persisted read/write grant) or the base64 iOS security-scoped bookmark.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    pub uri: String,
    pub name: String,
}

/// Whether the long-lived grant on a linked folder still works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderGrantState {
    /// The grant is held and the folder can be read.
    Alive,
    /// The OS no longer holds the grant (released, cleared, or revoked).
    Revoked,
    /// The grant may be held, but the folder itself is gone (moved or deleted).
    Missing,
}

/// One child of a linked folder (or of a sub folder inside it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFolderEntry {
    /// Document location under the folder grant: an Android tree document URI or an iOS
    /// `ieum-tree:` token. Accepted by `open_persistent_uri`, `read_uri_bytes`,
    /// `write_uri_bytes_atomic`, and the rename/copy/delete/share methods. Never shown on screen.
    pub uri: String,
    pub name: String,
    pub is_dir: bool,
    /// MIME type reported by the OS; `None` for folders and when unknown.
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// Last modification time in milliseconds since the Unix epoch.
    #[serde(default)]
    pub modified_ms: Option<i64>,
}

/// One received file, already copied into the app cache.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeIncomingFile {
    /// Display name (sanitized, unique inside its batch).
    pub name: String,
    pub mime: String,
    /// Absolute path of the copy: `<cache>/ieum-tmp/home/incoming/<batchId>/<name>`.
    pub path: PathBuf,
    pub size_bytes: u64,
}

/// Files received together (several files, or one picture) through the OS share sheet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeIncomingBatch {
    pub id: String,
    pub files: Vec<NativeIncomingFile>,
}

/// App directories the native side writes into.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDirs {
    /// The app cache directory (Android `Context.cacheDir`, iOS Caches).
    pub cache_dir: PathBuf,
    /// Where share-out temporary copies are written (Android `<cache>/shared`,
    /// iOS `<tmp>/share-out`).
    pub share_temp_dir: PathBuf,
}

/// Failure category of the home-screen file operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeHomeErrorKind {
    /// The user closed a system picker without choosing.
    UserCancelled,
    /// The folder grant (or the document grant) is gone.
    PermissionDenied,
    /// The OS or the storage provider refuses this operation here: no parent folder grant
    /// (the document is not under a linked folder) or the provider does not support it.
    NotSupportedHere,
    /// Another document or folder with the same name (ignoring letter case) is in the folder.
    NameTaken,
    /// The document, sub folder, or file is not there.
    NotFound,
    /// Bad argument: empty name, name with `/` or `\`, non-https URL, empty list.
    InvalidArgument,
    IoError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeHomeError {
    pub kind: NativeHomeErrorKind,
    pub detail: String,
}

impl NativeHomeError {
    pub fn new(kind: NativeHomeErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }
}

impl From<NativeFsError> for NativeHomeError {
    fn from(err: NativeFsError) -> Self {
        let kind = match err.kind {
            NativeFsErrorKind::UserCancelled => NativeHomeErrorKind::UserCancelled,
            NativeFsErrorKind::PermissionDenied => NativeHomeErrorKind::PermissionDenied,
            NativeFsErrorKind::ReadOnlyUri => NativeHomeErrorKind::NotSupportedHere,
            NativeFsErrorKind::IoError => NativeHomeErrorKind::IoError,
        };
        Self::new(kind, err.detail)
    }
}

/// True for an absolute `https://` URL with a host and no whitespace, control characters,
/// or user info. Everything else is refused by `open_external_url`.
pub fn is_https_url(url: &str) -> bool {
    let Some(scheme) = url.get(..8) else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("https://") {
        return false;
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let rest = &url[8..];
    let authority = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
    !authority.is_empty() && !authority.contains('@') && !authority.starts_with(':')
}

/// True when `name` can be a document name: not blank, no path separators, not `.`/`..`,
/// no control characters.
pub fn is_valid_document_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed != "."
        && trimmed != ".."
        && !name.contains(['/', '\\'])
        && !name.chars().any(|c| c.is_control())
}

/// Platform bridge for OS document pickers, persistent URI/bookmark storage, atomic writes, and sharing.
pub trait NativeFileBridge: Send + Sync {
    fn pick_open_file(&self, exts: &[String]) -> Result<PickedFile, NativeFsError>;
    fn create_save_file(
        &self,
        suggested_name: &str,
        mime: &str,
    ) -> Result<PickedFile, NativeFsError>;
    /// Reopens a document through a grant the app still holds: its own persisted grant, or
    /// the grant of a linked folder it lives under (a `NativeFolderEntry::uri`).
    fn open_persistent_uri(&self, uri: &str) -> Result<PickedFile, NativeFsError>;
    fn read_uri_bytes(&self, uri: &str) -> Result<Vec<u8>, NativeFsError>;
    fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError>;
    fn share_file_bytes(
        &self,
        suggested_name: &str,
        mime: &str,
        bytes: &[u8],
    ) -> Result<(), NativeFsError>;
    /// Pops the oldest single document received through VIEW/SEND (or iOS open-in). Several
    /// files and pictures never land here; they arrive through `take_incoming_batch`.
    fn take_pending_open_intent(&self) -> Option<PickedFile>;

    /// Opens the system folder picker and keeps a long-lived read/write grant on the chosen
    /// folder (Android tree URI permission, iOS security-scoped bookmark). Cancel is
    /// `UserCancelled`. No OS permission dialog is shown.
    fn pick_folder(&self) -> Result<PickedFolder, NativeHomeError>;
    /// Gives back the long-lived grant on a linked folder. Unknown or already released
    /// folders are not an error.
    fn release_folder(&self, folder_uri: &str) -> Result<(), NativeHomeError>;
    /// Reports whether a linked folder's grant still works. Never shows a dialog; a failed
    /// native call counts as `Revoked`.
    fn check_folder_grant(&self, folder_uri: &str) -> FolderGrantState;
    /// Lists the children of a linked folder, or of the sub folder reached by following
    /// `sub_path` (folder names from the linked folder down). Order is unspecified.
    /// A lost grant is `PermissionDenied`; a missing sub folder is `NotFound`.
    fn list_folder(
        &self,
        folder_uri: &str,
        sub_path: &[String],
    ) -> Result<Vec<NativeFolderEntry>, NativeHomeError>;
    /// Renames a document under a linked folder to `new_name` (full name, extension included)
    /// and returns its new location. The bytes are untouched. Refusals: `InvalidArgument`
    /// (bad name), `NameTaken`, `NotSupportedHere` (not under a linked folder, or the provider
    /// cannot rename), `PermissionDenied` (folder grant lost), `NotFound`.
    fn rename_document(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError>;
    /// Creates `new_name` next to a document under a linked folder, copies the bytes as they
    /// are, and returns the copy's location. Same refusals as `rename_document`; on
    /// `NameTaken` the caller picks another name.
    fn copy_document(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError>;
    /// Deletes a document under a linked folder (Android: permanently through SAF; iOS: moves
    /// it to the Files trash). Same refusals as `rename_document` (no name checks).
    fn delete_document(&self, uri: &str) -> Result<(), NativeHomeError>;
    /// Opens the OS share sheet with every file as it is (no conversion). Each item is a
    /// document location the app holds a grant for, or an absolute path inside the app cache
    /// (a received file). An empty list is `InvalidArgument`; an unknown item is `NotFound`.
    fn share_files(&self, uris: &[String]) -> Result<(), NativeHomeError>;
    /// Pops the oldest batch of received files (Android SEND_MULTIPLE, or SEND of a picture),
    /// already copied into `<cache>/ieum-tmp/home/incoming/<batchId>/`.
    fn take_incoming_batch(&self) -> Option<NativeIncomingBatch>;
    /// Keeps the screen from turning off (`true`) or lets it sleep again (`false`).
    fn set_keep_screen_on(&self, on: bool) -> Result<(), NativeHomeError>;
    /// Opens an `https://` URL in the system browser. Anything else is `InvalidArgument`.
    fn open_external_url(&self, url: &str) -> Result<(), NativeHomeError>;
    /// The app cache directory and the share-out temporary copy directory.
    fn native_dirs(&self) -> Result<NativeDirs, NativeHomeError>;
}

/// Synthetic document entry for host tests and desktop development builds.
#[derive(Debug, Clone)]
pub struct MockPickedDoc {
    pub uri: String,
    pub name: String,
    pub bytes: Vec<u8>,
    pub writable: bool,
    pub ephemeral: bool,
}

/// Synthetic received file for `HostFileBridge::enqueue_incoming_batch`.
#[derive(Debug, Clone)]
pub struct MockIncomingFile {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// One file handed to the host share sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedFile {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// A folder tree on the simulated device. Children live at `<tree uri>/<relative path>`.
struct HostTree {
    name: String,
    granted: bool,
    missing: bool,
    ops_supported: bool,
}

#[derive(Default)]
struct HostFileMeta {
    mime: Option<String>,
    modified_ms: Option<i64>,
}

#[derive(Default)]
struct HostFsState {
    files: BTreeMap<String, MockPickedDoc>,
    revoked_uris: BTreeMap<String, bool>,
    next_pick_open: Option<MockPickedDoc>,
    next_save_as_uri: Option<String>,
    pending_intents: VecDeque<MockPickedDoc>,
    last_shared: Option<(String, String, Vec<u8>)>,
    trees: BTreeMap<String, HostTree>,
    tree_dirs: BTreeSet<String>,
    file_meta: BTreeMap<String, HostFileMeta>,
    next_pick_folder: Option<String>,
    incoming_batches: VecDeque<NativeIncomingBatch>,
    incoming_counter: u64,
    /// MIME type of every received copy, kept after its batch is taken.
    incoming_mimes: BTreeMap<PathBuf, String>,
    keep_screen_on: bool,
    opened_urls: Vec<String>,
    last_shared_files: Vec<SharedFile>,
    cache_dir: Option<PathBuf>,
}

impl HostFsState {
    /// The linked-folder tree a document location lives under, if any.
    fn tree_of(&self, uri: &str) -> Option<String> {
        self.trees
            .keys()
            .find(|tree| {
                uri.len() > tree.len() + 1
                    && uri.starts_with(tree.as_str())
                    && uri.as_bytes()[tree.len()] == b'/'
            })
            .cloned()
    }

    fn tree_access(&self, tree_uri: &str) -> Result<(), NativeHomeError> {
        match self.trees.get(tree_uri) {
            Some(tree) if tree.granted && !tree.missing => Ok(()),
            _ => Err(NativeHomeError::new(
                NativeHomeErrorKind::PermissionDenied,
                "folder grant lost",
            )),
        }
    }

    /// Fails with `PermissionDenied` when `uri` is under a linked folder whose grant is gone.
    fn check_tree_for_fs(&self, uri: &str) -> Result<(), NativeFsError> {
        match self.tree_of(uri) {
            Some(tree) => self
                .tree_access(&tree)
                .map_err(|e| NativeFsError::new(NativeFsErrorKind::PermissionDenied, e.detail)),
            None => Ok(()),
        }
    }

    /// Checks that `uri` is an existing document under a linked folder whose grant works and
    /// whose provider supports rename/copy/delete.
    fn check_home_doc(&self, uri: &str) -> Result<(), NativeHomeError> {
        let Some(tree) = self.tree_of(uri) else {
            return Err(if self.files.contains_key(uri) {
                NativeHomeError::new(
                    NativeHomeErrorKind::NotSupportedHere,
                    "document is not under a linked folder",
                )
            } else {
                NativeHomeError::new(NativeHomeErrorKind::NotFound, "unknown document")
            });
        };
        self.tree_access(&tree)?;
        if !self.files.contains_key(uri) {
            return Err(NativeHomeError::new(
                NativeHomeErrorKind::NotFound,
                "document missing",
            ));
        }
        if !self.trees.get(&tree).is_some_and(|t| t.ops_supported) {
            return Err(NativeHomeError::new(
                NativeHomeErrorKind::NotSupportedHere,
                "storage provider refuses this operation",
            ));
        }
        Ok(())
    }

    /// The location `new_name` would take next to `uri`, refusing bad or taken names.
    fn sibling_uri(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError> {
        if !is_valid_document_name(new_name) {
            return Err(NativeHomeError::new(
                NativeHomeErrorKind::InvalidArgument,
                "invalid document name",
            ));
        }
        let parent = uri.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        let candidate = format!("{parent}/{new_name}");
        let folded = candidate.to_lowercase();
        let taken = self
            .files
            .keys()
            .chain(self.tree_dirs.iter())
            .any(|k| k != uri && k.to_lowercase() == folded);
        if taken {
            return Err(NativeHomeError::new(
                NativeHomeErrorKind::NameTaken,
                "name already used in this folder",
            ));
        }
        Ok(candidate)
    }

    fn cache_dir(&self) -> PathBuf {
        self.cache_dir
            .clone()
            .unwrap_or_else(|| std::env::temp_dir().join("ieum-host-file-bridge"))
    }
}

/// Makes a received file name safe and unique (ignoring letter case) inside its batch:
/// path separators and control characters become `_`, duplicates get ` (2)`, ` (3)`, ...
fn unique_incoming_name(raw: &str, taken: &mut Vec<String>) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim();
    let base = if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "file".to_string()
    } else {
        cleaned.to_string()
    };
    let (stem, ext) = match base.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
        _ => (base.clone(), String::new()),
    };
    let mut name = base.clone();
    let mut n = 2;
    while taken.iter().any(|t| t.to_lowercase() == name.to_lowercase()) {
        name = format!("{stem} ({n}){ext}");
        n += 1;
    }
    taken.push(name.clone());
    name
}

/// In-memory host bridge used by cargo tests and desktop preview runs.
pub struct HostFileBridge {
    state: Mutex<HostFsState>,
}

impl Default for HostFileBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl HostFileBridge {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(HostFsState::default()),
        }
    }

    pub fn set_next_pick_open(&self, doc: MockPickedDoc) {
        let mut guard = self.state.lock().unwrap();
        guard.files.insert(doc.uri.clone(), doc.clone());
        guard.revoked_uris.remove(&doc.uri);
        guard.next_pick_open = Some(doc);
    }

    pub fn set_next_save_as_uri(&self, uri: impl Into<String>) {
        let mut guard = self.state.lock().unwrap();
        guard.next_save_as_uri = Some(uri.into());
    }

    pub fn enqueue_open_intent(&self, doc: MockPickedDoc) {
        let mut guard = self.state.lock().unwrap();
        guard.files.insert(doc.uri.clone(), doc.clone());
        guard.revoked_uris.remove(&doc.uri);
        guard.pending_intents.push_back(doc);
    }

    pub fn revoke_uri(&self, uri: &str) {
        let mut guard = self.state.lock().unwrap();
        guard.revoked_uris.insert(uri.to_string(), true);
    }

    pub fn read_stored_uri(&self, uri: &str) -> Option<Vec<u8>> {
        let guard = self.state.lock().unwrap();
        guard.files.get(uri).map(|d| d.bytes.clone())
    }

    pub fn last_shared_bytes(&self) -> Option<Vec<u8>> {
        let guard = self.state.lock().unwrap();
        guard.last_shared.as_ref().map(|(_, _, b)| b.clone())
    }

    /// Adds a folder tree to the simulated device (not linked yet; `pick_folder` grants it).
    pub fn add_tree(&self, tree_uri: &str, name: &str) {
        let mut guard = self.state.lock().unwrap();
        guard
            .trees
            .entry(tree_uri.to_string())
            .and_modify(|t| t.name = name.to_string())
            .or_insert_with(|| HostTree {
                name: name.to_string(),
                granted: false,
                missing: false,
                ops_supported: true,
            });
    }

    /// Adds a sub folder (and its parents) at `rel_path` (`a/b`) inside a tree.
    pub fn add_tree_dir(&self, tree_uri: &str, rel_path: &str) {
        let mut guard = self.state.lock().unwrap();
        let mut current = tree_uri.to_string();
        for part in rel_path.split('/').filter(|p| !p.is_empty()) {
            current = format!("{current}/{part}");
            guard.tree_dirs.insert(current.clone());
        }
    }

    /// Adds a document at `rel_path` (`a/b.hwp`) inside a tree, creating parent folders, and
    /// returns its location.
    pub fn add_tree_file(
        &self,
        tree_uri: &str,
        rel_path: &str,
        bytes: &[u8],
        mime: &str,
        modified_ms: i64,
    ) -> String {
        if let Some((dir, _)) = rel_path.rsplit_once('/') {
            self.add_tree_dir(tree_uri, dir);
        }
        let uri = format!("{tree_uri}/{rel_path}");
        let name = rel_path.rsplit('/').next().unwrap_or(rel_path).to_string();
        let mut guard = self.state.lock().unwrap();
        guard.files.insert(
            uri.clone(),
            MockPickedDoc {
                uri: uri.clone(),
                name,
                bytes: bytes.to_vec(),
                writable: true,
                ephemeral: false,
            },
        );
        guard.file_meta.insert(
            uri.clone(),
            HostFileMeta {
                mime: Some(mime.to_string()),
                modified_ms: Some(modified_ms),
            },
        );
        uri
    }

    /// The next `pick_folder` call returns (and grants) this tree; unknown trees are created
    /// with the last URI segment as their name.
    pub fn set_next_pick_folder(&self, tree_uri: impl Into<String>) {
        let mut guard = self.state.lock().unwrap();
        guard.next_pick_folder = Some(tree_uri.into());
    }

    /// Simulates the OS dropping a linked folder's grant.
    pub fn revoke_tree(&self, tree_uri: &str) {
        let mut guard = self.state.lock().unwrap();
        if let Some(tree) = guard.trees.get_mut(tree_uri) {
            tree.granted = false;
        }
    }

    /// Simulates a linked folder being moved or deleted outside the app.
    pub fn remove_tree(&self, tree_uri: &str) {
        let mut guard = self.state.lock().unwrap();
        if let Some(tree) = guard.trees.get_mut(tree_uri) {
            tree.missing = true;
        }
    }

    /// Simulates a storage provider that refuses rename, copy, and delete.
    pub fn set_tree_ops_supported(&self, tree_uri: &str, supported: bool) {
        let mut guard = self.state.lock().unwrap();
        if let Some(tree) = guard.trees.get_mut(tree_uri) {
            tree.ops_supported = supported;
        }
    }

    /// Whether the app currently holds the grant on a tree.
    pub fn is_tree_granted(&self, tree_uri: &str) -> bool {
        let guard = self.state.lock().unwrap();
        guard.trees.get(tree_uri).is_some_and(|t| t.granted)
    }

    /// Sets the app cache directory used for received files and `native_dirs`.
    /// Default: `<system temp>/ieum-host-file-bridge`.
    pub fn set_cache_dir(&self, dir: impl AsRef<Path>) {
        let mut guard = self.state.lock().unwrap();
        guard.cache_dir = Some(dir.as_ref().to_path_buf());
    }

    /// Simulates receiving several files (or one picture): writes copies under
    /// `<cache>/ieum-tmp/home/incoming/<batchId>/` and queues the batch. Returns the batch id.
    pub fn enqueue_incoming_batch(&self, files: Vec<MockIncomingFile>) -> String {
        let mut guard = self.state.lock().unwrap();
        guard.incoming_counter += 1;
        let id = format!("batch-{}", guard.incoming_counter);
        let dir = guard.cache_dir().join(INCOMING_RELATIVE_DIR).join(&id);
        std::fs::create_dir_all(&dir).expect("create incoming batch dir");
        let mut taken = Vec::new();
        let mut out = Vec::new();
        for file in files {
            let name = unique_incoming_name(&file.name, &mut taken);
            let path = dir.join(&name);
            std::fs::write(&path, &file.bytes).expect("write incoming file");
            guard.incoming_mimes.insert(path.clone(), file.mime.clone());
            out.push(NativeIncomingFile {
                name,
                mime: file.mime,
                path,
                size_bytes: file.bytes.len() as u64,
            });
        }
        guard.incoming_batches.push_back(NativeIncomingBatch {
            id: id.clone(),
            files: out,
        });
        id
    }

    /// Whether the screen is currently kept on.
    pub fn keep_screen_on(&self) -> bool {
        self.state.lock().unwrap().keep_screen_on
    }

    /// Every URL `open_external_url` accepted, oldest first.
    pub fn opened_urls(&self) -> Vec<String> {
        self.state.lock().unwrap().opened_urls.clone()
    }

    /// The files of the last successful `share_files` call.
    pub fn last_shared_files(&self) -> Vec<SharedFile> {
        self.state.lock().unwrap().last_shared_files.clone()
    }
}

impl NativeFileBridge for HostFileBridge {
    fn pick_open_file(&self, _exts: &[String]) -> Result<PickedFile, NativeFsError> {
        let mut guard = self.state.lock().unwrap();
        let doc = guard
            .next_pick_open
            .take()
            .ok_or_else(|| NativeFsError::new(NativeFsErrorKind::UserCancelled, "no file picked"))?;
        Ok(PickedFile {
            uri: doc.uri,
            name: doc.name,
            writable: doc.writable,
            ephemeral: doc.ephemeral,
        })
    }

    fn create_save_file(
        &self,
        suggested_name: &str,
        _mime: &str,
    ) -> Result<PickedFile, NativeFsError> {
        let mut guard = self.state.lock().unwrap();
        let uri = guard
            .next_save_as_uri
            .take()
            .unwrap_or_else(|| format!("host://saved/{suggested_name}"));
        guard.revoked_uris.remove(&uri);
        guard.files.insert(
            uri.clone(),
            MockPickedDoc {
                uri: uri.clone(),
                name: suggested_name.to_string(),
                bytes: Vec::new(),
                writable: true,
                ephemeral: false,
            },
        );
        Ok(PickedFile {
            uri,
            name: suggested_name.to_string(),
            writable: true,
            ephemeral: false,
        })
    }

    fn open_persistent_uri(&self, uri: &str) -> Result<PickedFile, NativeFsError> {
        let guard = self.state.lock().unwrap();
        guard.check_tree_for_fs(uri)?;
        if guard.revoked_uris.get(uri).copied().unwrap_or(false) {
            return Err(NativeFsError::new(
                NativeFsErrorKind::PermissionDenied,
                "persistent URI permission expired",
            ));
        }
        let doc = guard.files.get(uri).ok_or_else(|| {
            NativeFsError::new(NativeFsErrorKind::PermissionDenied, "URI not found")
        })?;
        Ok(PickedFile {
            uri: doc.uri.clone(),
            name: doc.name.clone(),
            writable: doc.writable,
            ephemeral: false,
        })
    }

    fn read_uri_bytes(&self, uri: &str) -> Result<Vec<u8>, NativeFsError> {
        let guard = self.state.lock().unwrap();
        guard.check_tree_for_fs(uri)?;
        if guard.revoked_uris.get(uri).copied().unwrap_or(false) {
            return Err(NativeFsError::new(
                NativeFsErrorKind::PermissionDenied,
                "URI permission expired",
            ));
        }
        guard
            .files
            .get(uri)
            .map(|d| d.bytes.clone())
            .ok_or_else(|| NativeFsError::new(NativeFsErrorKind::PermissionDenied, "URI missing"))
    }

    fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError> {
        let mut guard = self.state.lock().unwrap();
        guard.check_tree_for_fs(uri)?;
        if guard.revoked_uris.get(uri).copied().unwrap_or(false) {
            return Err(NativeFsError::new(
                NativeFsErrorKind::PermissionDenied,
                "URI permission expired",
            ));
        }
        let entry = guard.files.get_mut(uri).ok_or_else(|| {
            NativeFsError::new(NativeFsErrorKind::PermissionDenied, "URI missing")
        })?;
        if !entry.writable || entry.ephemeral {
            return Err(NativeFsError::new(
                NativeFsErrorKind::ReadOnlyUri,
                "URI is not writable",
            ));
        }
        entry.bytes = bytes.to_vec();
        Ok(())
    }

    fn share_file_bytes(
        &self,
        suggested_name: &str,
        mime: &str,
        bytes: &[u8],
    ) -> Result<(), NativeFsError> {
        let mut guard = self.state.lock().unwrap();
        guard.last_shared = Some((suggested_name.to_string(), mime.to_string(), bytes.to_vec()));
        Ok(())
    }

    fn take_pending_open_intent(&self) -> Option<PickedFile> {
        let mut guard = self.state.lock().unwrap();
        guard.pending_intents.pop_front().map(|doc| PickedFile {
            uri: doc.uri,
            name: doc.name,
            writable: doc.writable,
            ephemeral: doc.ephemeral,
        })
    }

    fn pick_folder(&self) -> Result<PickedFolder, NativeHomeError> {
        let mut guard = self.state.lock().unwrap();
        let uri = guard.next_pick_folder.take().ok_or_else(|| {
            NativeHomeError::new(NativeHomeErrorKind::UserCancelled, "no folder picked")
        })?;
        let default_name = uri.rsplit('/').next().unwrap_or(&uri).to_string();
        let tree = guard.trees.entry(uri.clone()).or_insert_with(|| HostTree {
            name: default_name,
            granted: false,
            missing: false,
            ops_supported: true,
        });
        tree.granted = true;
        tree.missing = false;
        Ok(PickedFolder {
            uri,
            name: tree.name.clone(),
        })
    }

    fn release_folder(&self, folder_uri: &str) -> Result<(), NativeHomeError> {
        let mut guard = self.state.lock().unwrap();
        if let Some(tree) = guard.trees.get_mut(folder_uri) {
            tree.granted = false;
        }
        Ok(())
    }

    fn check_folder_grant(&self, folder_uri: &str) -> FolderGrantState {
        let guard = self.state.lock().unwrap();
        match guard.trees.get(folder_uri) {
            None => FolderGrantState::Missing,
            Some(tree) if tree.missing => FolderGrantState::Missing,
            Some(tree) if !tree.granted => FolderGrantState::Revoked,
            Some(_) => FolderGrantState::Alive,
        }
    }

    fn list_folder(
        &self,
        folder_uri: &str,
        sub_path: &[String],
    ) -> Result<Vec<NativeFolderEntry>, NativeHomeError> {
        let guard = self.state.lock().unwrap();
        guard.tree_access(folder_uri)?;
        let mut dir = folder_uri.to_string();
        for part in sub_path {
            if !is_valid_document_name(part) {
                return Err(NativeHomeError::new(
                    NativeHomeErrorKind::NotFound,
                    "invalid sub folder name",
                ));
            }
            dir = format!("{dir}/{part}");
            if !guard.tree_dirs.contains(&dir) {
                return Err(NativeHomeError::new(
                    NativeHomeErrorKind::NotFound,
                    "sub folder missing",
                ));
            }
        }
        let prefix = format!("{dir}/");
        let direct_child = |key: &str| -> Option<String> {
            key.strip_prefix(prefix.as_str())
                .filter(|rest| !rest.is_empty() && !rest.contains('/'))
                .map(str::to_string)
        };
        let mut entries = Vec::new();
        for key in &guard.tree_dirs {
            if let Some(name) = direct_child(key) {
                entries.push(NativeFolderEntry {
                    uri: key.clone(),
                    name,
                    is_dir: true,
                    mime: None,
                    size_bytes: None,
                    modified_ms: None,
                });
            }
        }
        for (key, doc) in &guard.files {
            if direct_child(key).is_some() {
                let meta = guard.file_meta.get(key);
                entries.push(NativeFolderEntry {
                    uri: key.clone(),
                    name: doc.name.clone(),
                    is_dir: false,
                    mime: meta.and_then(|m| m.mime.clone()),
                    size_bytes: Some(doc.bytes.len() as u64),
                    modified_ms: meta.and_then(|m| m.modified_ms),
                });
            }
        }
        Ok(entries)
    }

    fn rename_document(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError> {
        let mut guard = self.state.lock().unwrap();
        guard.check_home_doc(uri)?;
        let new_uri = guard.sibling_uri(uri, new_name)?;
        let mut doc = guard.files.remove(uri).expect("checked above");
        doc.uri = new_uri.clone();
        doc.name = new_name.to_string();
        guard.files.insert(new_uri.clone(), doc);
        if let Some(meta) = guard.file_meta.remove(uri) {
            guard.file_meta.insert(new_uri.clone(), meta);
        }
        guard.revoked_uris.remove(&new_uri);
        Ok(new_uri)
    }

    fn copy_document(&self, uri: &str, new_name: &str) -> Result<String, NativeHomeError> {
        let mut guard = self.state.lock().unwrap();
        guard.check_home_doc(uri)?;
        let new_uri = guard.sibling_uri(uri, new_name)?;
        let bytes = guard.files.get(uri).expect("checked above").bytes.clone();
        let mime = guard.file_meta.get(uri).and_then(|m| m.mime.clone());
        let modified = guard
            .file_meta
            .values()
            .filter_map(|m| m.modified_ms)
            .max()
            .unwrap_or(0)
            + 1;
        guard.files.insert(
            new_uri.clone(),
            MockPickedDoc {
                uri: new_uri.clone(),
                name: new_name.to_string(),
                bytes,
                writable: true,
                ephemeral: false,
            },
        );
        guard.file_meta.insert(
            new_uri.clone(),
            HostFileMeta {
                mime,
                modified_ms: Some(modified),
            },
        );
        guard.revoked_uris.remove(&new_uri);
        Ok(new_uri)
    }

    fn delete_document(&self, uri: &str) -> Result<(), NativeHomeError> {
        let mut guard = self.state.lock().unwrap();
        guard.check_home_doc(uri)?;
        guard.files.remove(uri);
        guard.file_meta.remove(uri);
        Ok(())
    }

    fn share_files(&self, uris: &[String]) -> Result<(), NativeHomeError> {
        let mut guard = self.state.lock().unwrap();
        if uris.is_empty() {
            return Err(NativeHomeError::new(
                NativeHomeErrorKind::InvalidArgument,
                "nothing to share",
            ));
        }
        let cache = std::fs::canonicalize(guard.cache_dir()).ok();
        let mut shared = Vec::with_capacity(uris.len());
        for uri in uris {
            if let Some(doc) = guard.files.get(uri) {
                guard.check_tree_for_fs(uri)?;
                if guard.revoked_uris.get(uri).copied().unwrap_or(false) {
                    return Err(NativeHomeError::new(
                        NativeHomeErrorKind::PermissionDenied,
                        "URI permission expired",
                    ));
                }
                let mime = guard
                    .file_meta
                    .get(uri)
                    .and_then(|m| m.mime.clone())
                    .unwrap_or_else(|| "application/octet-stream".to_string());
                shared.push(SharedFile {
                    name: doc.name.clone(),
                    mime,
                    bytes: doc.bytes.clone(),
                });
                continue;
            }
            let path = Path::new(uri);
            let in_cache = path.is_absolute()
                && cache.as_ref().is_some_and(|cache| {
                    std::fs::canonicalize(path).is_ok_and(|p| p.starts_with(cache) && p.is_file())
                });
            if !in_cache {
                return Err(NativeHomeError::new(
                    NativeHomeErrorKind::NotFound,
                    "nothing to share at this location",
                ));
            }
            let bytes = std::fs::read(path)
                .map_err(|e| NativeHomeError::new(NativeHomeErrorKind::IoError, e.to_string()))?;
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let mime = guard
                .incoming_mimes
                .get(path)
                .cloned()
                .unwrap_or_else(|| "application/octet-stream".to_string());
            shared.push(SharedFile { name, mime, bytes });
        }
        guard.last_shared_files = shared;
        Ok(())
    }

    fn take_incoming_batch(&self) -> Option<NativeIncomingBatch> {
        self.state.lock().unwrap().incoming_batches.pop_front()
    }

    fn set_keep_screen_on(&self, on: bool) -> Result<(), NativeHomeError> {
        self.state.lock().unwrap().keep_screen_on = on;
        Ok(())
    }

    fn open_external_url(&self, url: &str) -> Result<(), NativeHomeError> {
        if !is_https_url(url) {
            return Err(NativeHomeError::new(
                NativeHomeErrorKind::InvalidArgument,
                "only https URLs are opened",
            ));
        }
        self.state.lock().unwrap().opened_urls.push(url.to_string());
        Ok(())
    }

    fn native_dirs(&self) -> Result<NativeDirs, NativeHomeError> {
        let cache_dir = self.state.lock().unwrap().cache_dir();
        Ok(NativeDirs {
            share_temp_dir: cache_dir.join("shared"),
            cache_dir,
        })
    }
}
