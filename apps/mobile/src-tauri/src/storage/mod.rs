pub mod backup;
pub mod home;
pub mod prefs;
pub mod recent;
pub mod recovery;
pub mod session;

pub use backup::{HwpBackupEntry, HwpBackupStore, MAX_HWP_BACKUPS};
pub use prefs::{MobileAppPrefs, MobileAppPrefsPatch, MobileHomePrefsPatch, PrefsStore};
pub use recent::{RecentDocEntry, RecentStore};
pub use recovery::{RecoveryEntry, RecoveryStore};
pub use session::{MobileDocFormat, MobileDocSession, persistent_doc_key, untitled_doc_key};

use crate::commands::readers::store::ReaderStore;
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::hwp::{
    HwpBaseline, HwpFixPayload, TabSpot, apply_hwp_save_fixes, extract_hwp_baseline, find_new_tabs,
    inspect_hwp_container, prepare_hwp_for_open, validate_hwp_magic,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_ieum_mobile::fs::{
    FolderGrantState, NativeFileBridge, NativeFsError, NativeFsErrorKind, PickedFile,
    WRITE_WORK_RELATIVE_DIR, write_new_uri_from_file, write_uri_from_file,
};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MobileShareMode {
    Edited,
    Original,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RestoreTarget {
    InPlace,
    SaveAs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileBytesResult {
    pub bytes_base64: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking_dropped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distribution: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileBytesResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tails_lost: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memos_lost: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<MobileDocSession>,
}

/// Bytes of a session that has no document location (track T6): the bundled sample document,
/// or a received file's copy in the app cache.
#[derive(Debug, Clone)]
pub(crate) enum LocalSource {
    Bundled(&'static [u8]),
    CacheFile(PathBuf),
}

impl LocalSource {
    pub(crate) fn read(&self) -> MobileResult<Vec<u8>> {
        match self {
            Self::Bundled(bytes) => Ok(bytes.to_vec()),
            Self::CacheFile(path) => std::fs::read(path).map_err(|e| {
                MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", e.to_string())
            }),
        }
    }
}

/// A single received document parked by `mobile_home_take_incoming` for the pending-open path.
#[derive(Debug, Clone)]
struct DeferredDoc {
    name: String,
    path: PathBuf,
}

#[derive(Debug, Clone)]
struct ActiveSession {
    session: MobileDocSession,
    uri: Option<String>,
    local: Option<LocalSource>,
    encrypted: bool,
    distribution: bool,
    hwp_baseline: Option<HwpBaseline>,
}

/// Active and staged-pending sessions. Opening a second document while one is active stages the
/// new session in `pending` so saving or cancelling the previous document never loses its slot
/// before the frontend confirms the switch.
#[derive(Debug, Default)]
struct SessionSlots {
    active: Option<ActiveSession>,
    pending: Option<ActiveSession>,
}

impl SessionSlots {
    fn find(&self, session_id: &str) -> Option<&ActiveSession> {
        if let Some(p) = self.pending.as_ref()
            && p.session.session_id == session_id
        {
            return Some(p);
        }
        self.active
            .as_ref()
            .filter(|a| a.session.session_id == session_id)
    }

    fn find_mut(&mut self, session_id: &str) -> Option<&mut ActiveSession> {
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.session.session_id == session_id)
        {
            return self.pending.as_mut();
        }
        self.active
            .as_mut()
            .filter(|a| a.session.session_id == session_id)
    }

    fn stage(&mut self, next: ActiveSession) {
        if self.active.is_none() {
            self.active = Some(next);
        } else {
            self.pending = Some(next);
        }
    }

    fn commit(&mut self, session_id: &str) {
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.session.session_id == session_id)
        {
            self.active = self.pending.take();
        }
    }

    fn discard(&mut self, session_id: &str) {
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.session.session_id == session_id)
        {
            self.pending = None;
        } else if self
            .active
            .as_ref()
            .is_some_and(|a| a.session.session_id == session_id)
        {
            self.active = None;
        }
    }
}

fn io_error(e: std::io::Error) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", e.to_string())
}

pub(crate) fn map_fs_error(err: NativeFsError) -> MobileError {
    match err.kind {
        NativeFsErrorKind::UserCancelled => {
            MobileError::with_detail(MobileErrorCode::UserCancelled, "mobile.fs.cancelled", err.detail)
        }
        NativeFsErrorKind::PermissionDenied => MobileError::with_detail(
            MobileErrorCode::PermissionDenied,
            "mobile.fs.permissionDenied",
            err.detail,
        ),
        NativeFsErrorKind::ReadOnlyUri => {
            MobileError::with_detail(MobileErrorCode::ReadOnlyUri, "mobile.fs.readOnly", err.detail)
        }
        NativeFsErrorKind::IoError => {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", err.detail)
        }
    }
}

/// Coordinates single active document session, OS file bridge, HWP container fixes, backups, recovery, and prefs.
pub struct MobileFileService {
    bridge: Arc<dyn NativeFileBridge>,
    recent: RecentStore,
    recovery: RecoveryStore,
    backups: HwpBackupStore,
    prefs: PrefsStore,
    readers: Arc<ReaderStore>,
    sessions: Mutex<SessionSlots>,
    backed_up_keys: Mutex<BTreeSet<String>>,
    fail_backup_for_test: AtomicBool,
    /// Formats the WebView can open; `None` until the first `set_openable_formats` call (accept all).
    openable: Mutex<Option<Vec<MobileDocFormat>>>,
    folders: home::FolderStore,
    favorites: home::FavoriteStore,
    deferred_docs: Mutex<VecDeque<DeferredDoc>>,
}

impl MobileFileService {
    pub fn new(app_data_dir: PathBuf, bridge: Arc<dyn NativeFileBridge>) -> MobileResult<Self> {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.storage.initFailed", e.to_string())
        })?;
        let readers = Arc::new(ReaderStore::new(&app_data_dir));
        Ok(Self {
            bridge,
            recent: RecentStore::new(app_data_dir.clone()),
            recovery: RecoveryStore::new(app_data_dir.clone()),
            backups: HwpBackupStore::new(app_data_dir.clone()),
            prefs: PrefsStore::new(app_data_dir.clone()),
            readers,
            folders: home::FolderStore::new(&app_data_dir),
            favorites: home::FavoriteStore::new(&app_data_dir),
            sessions: Mutex::new(SessionSlots::default()),
            backed_up_keys: Mutex::new(BTreeSet::new()),
            fail_backup_for_test: AtomicBool::new(false),
            openable: Mutex::new(None),
            deferred_docs: Mutex::new(VecDeque::new()),
        })
    }

    pub fn reader_store(&self) -> Arc<ReaderStore> {
        self.readers.clone()
    }

    /// Promotes a staged pending session to active once the WebView has committed the switch.
    pub fn commit_session(&self, session_id: &str) {
        self.sessions.lock().unwrap().commit(session_id);
    }

    /// Discards a cancelled pending session or a closed active session without touching the other.
    pub fn discard_session(&self, session_id: &str) {
        self.sessions.lock().unwrap().discard(session_id);
    }

    pub fn set_fail_backup_for_test(&self, fail: bool) {
        self.fail_backup_for_test.store(fail, Ordering::SeqCst);
    }

    /// Replaces the openable-format gate. Each ext maps through `from_known_name("x.<ext>")`.
    pub fn set_openable_formats(&self, exts: &[String]) {
        let mut formats: Vec<MobileDocFormat> = Vec::new();
        for ext in exts {
            if let Some(format) = MobileDocFormat::from_known_name(&format!("x.{ext}"))
                && !formats.contains(&format)
            {
                formats.push(format);
            }
        }
        *self.openable.lock().unwrap() = Some(formats);
    }

    fn ensure_openable_name(&self, name: &str) -> MobileResult<MobileDocFormat> {
        let guard = self.openable.lock().unwrap();
        let known = MobileDocFormat::from_known_name(name);
        let Some(formats) = guard.as_ref() else {
            return Ok(known.unwrap_or(MobileDocFormat::Md));
        };
        if let Some(format) = known
            && formats.contains(&format)
        {
            return Ok(format);
        }
        let ext = name
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .filter(|ext| !ext.is_empty())
            .unwrap_or_else(|| known.map(|f| f.ext().to_string()).unwrap_or_default());
        Err(MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.format.notOpenable",
            ext,
        ))
    }

    /// The open gate for files the user opens (picker, recent list, other apps). It runs before
    /// activate_picked touches recent docs or the active session; saving under a new name does not
    /// pass through it, so a save-as keeps working as before.
    fn ensure_openable_picked(&self, picked: &PickedFile) -> MobileResult<()> {
        self.ensure_openable_name(&picked.name).map(|_| ())
    }

    fn activate_picked(&self, picked: PickedFile, register_recent: bool) -> MobileResult<MobileDocSession> {
        self.activate_picked_in(picked, register_recent, None)
    }

    fn build_picked_session(
        &self,
        picked: PickedFile,
        register_recent: bool,
        folder_id: Option<&str>,
    ) -> MobileResult<ActiveSession> {
        let format = MobileDocFormat::from_name(&picked.name);
        let doc_key = if picked.ephemeral {
            untitled_doc_key()
        } else {
            persistent_doc_key(&picked.uri)
        };
        let session = MobileDocSession {
            session_id: Uuid::new_v4().to_string(),
            doc_key: doc_key.clone(),
            name: picked.name.clone(),
            ext: format.ext().to_string(),
            format,
            writable: picked.writable && !picked.ephemeral,
            ephemeral: picked.ephemeral,
            uri_hint: Some(picked.name.clone()),
        };
        if register_recent && !picked.ephemeral && picked.writable {
            self.recent
                .upsert_in_folder(&doc_key, &picked.uri, &picked.name, format, folder_id)?;
        }
        Ok(ActiveSession {
            session,
            uri: Some(picked.uri),
            local: None,
            encrypted: false,
            distribution: false,
            hwp_baseline: None,
        })
    }

    fn activate_picked_in(
        &self,
        picked: PickedFile,
        register_recent: bool,
        folder_id: Option<&str>,
    ) -> MobileResult<MobileDocSession> {
        let entry = self.build_picked_session(picked, register_recent, folder_id)?;
        let session = entry.session.clone();
        self.sessions.lock().unwrap().stage(entry);
        Ok(session)
    }

    /// Replaces the slot that `prev_session_id` occupied (active or pending) after Save As so an
    /// active untitled document saved during an unsaved-switch prompt preserves the pending switch.
    fn replace_saved_as_slot(
        &self,
        prev_session_id: Option<&str>,
        picked: PickedFile,
    ) -> MobileResult<MobileDocSession> {
        let entry = self.build_picked_session(picked, true, None)?;
        let session = entry.session.clone();
        let mut guard = self.sessions.lock().unwrap();
        if let Some(prev_id) = prev_session_id {
            if guard
                .pending
                .as_ref()
                .is_some_and(|p| p.session.session_id == prev_id)
            {
                guard.pending = Some(entry);
            } else {
                guard.active = Some(entry);
            }
        } else {
            guard.active = Some(entry);
        }
        Ok(session)
    }

    pub fn create_untitled_session(&self, format: MobileDocFormat) -> MobileResult<MobileDocSession> {
        let name = format!("Untitled.{}", format.ext());
        let session = MobileDocSession {
            session_id: Uuid::new_v4().to_string(),
            doc_key: untitled_doc_key(),
            name,
            ext: format.ext().to_string(),
            format,
            writable: false,
            ephemeral: false,
            uri_hint: None,
        };
        self.sessions.lock().unwrap().stage(ActiveSession {
            session: session.clone(),
            uri: None,
            local: None,
            encrypted: false,
            distribution: false,
            hwp_baseline: None,
        });
        Ok(session)
    }

    pub fn pick_open_file(&self, exts: &[String]) -> MobileResult<MobileDocSession> {
        let picked = self.bridge.pick_open_file(exts).map_err(map_fs_error)?;
        self.ensure_openable_picked(&picked)?;
        self.activate_picked(picked, true)
    }

    pub fn open_recent_doc(&self, id: &str) -> MobileResult<MobileDocSession> {
        let Some(row) = self.recent.row(id)? else {
            return Err(MobileError::with_detail(
                MobileErrorCode::PermissionDenied,
                "mobile.recent.notFound",
                "recent document entry missing",
            ));
        };
        self.open_document_uri(&row.uri, row.folder_id.as_deref())
    }

    /// Reopens a document through a grant the app holds (its own, or the linked folder's when
    /// `folder_id` is set), applies the open gate, and puts it at the top of the recent list.
    pub(crate) fn open_document_uri(&self, uri: &str, folder_id: Option<&str>) -> MobileResult<MobileDocSession> {
        if let Some(folder_id) = folder_id {
            self.ensure_folder_alive(folder_id)?;
        }
        let picked = self
            .bridge
            .open_persistent_uri(uri)
            .map_err(|e| home::map_fs_error_in(e, folder_id.is_some()))?;
        self.ensure_openable_picked(&picked)?;
        self.activate_picked_in(picked, true, folder_id)
    }

    /// Fails with `mobile.home.folderLost` when the linked folder is gone or its grant is lost.
    pub(crate) fn ensure_folder_alive(&self, folder_id: &str) -> MobileResult<home::StoredFolder> {
        let folder = self
            .folders
            .get(folder_id)?
            .ok_or_else(|| home::folder_lost("folder is not linked"))?;
        match self.bridge.check_folder_grant(&folder.uri) {
            FolderGrantState::Alive => Ok(folder),
            _ => Err(home::folder_lost("folder grant lost")),
        }
    }

    /// Opens bytes that have no document location as a read-only, ephemeral session that is
    /// not added to the recent list. The open gate applies.
    pub(crate) fn open_local(&self, name: &str, source: LocalSource) -> MobileResult<MobileDocSession> {
        let format = self.ensure_openable_name(name)?;
        let session = MobileDocSession {
            session_id: Uuid::new_v4().to_string(),
            doc_key: untitled_doc_key(),
            name: name.to_string(),
            ext: format.ext().to_string(),
            format,
            writable: false,
            ephemeral: true,
            uri_hint: Some(name.to_string()),
        };
        self.sessions.lock().unwrap().stage(ActiveSession {
            session: session.clone(),
            uri: None,
            local: Some(source),
            encrypted: false,
            distribution: false,
            hwp_baseline: None,
        });
        Ok(session)
    }

    /// Parks a single received document (copied into the app cache) for
    /// `consume_pending_open_intent`, the path single documents always take.
    pub(crate) fn defer_received_document(&self, name: String, path: PathBuf) {
        self.deferred_docs
            .lock()
            .unwrap()
            .push_back(DeferredDoc { name, path });
    }

    pub fn consume_pending_open_intent(&self) -> MobileResult<Option<MobileDocSession>> {
        let deferred = self.deferred_docs.lock().unwrap().pop_front();
        if let Some(doc) = deferred {
            return Ok(Some(self.open_local(&doc.name, LocalSource::CacheFile(doc.path))?));
        }
        let Some(picked) = self.bridge.take_pending_open_intent() else {
            return Ok(None);
        };
        // Ephemeral or read-only share-in files must never be registered into persistent recent docs automatically.
        let register = !picked.ephemeral && picked.writable;
        self.ensure_openable_picked(&picked)?;
        Ok(Some(self.activate_picked(picked, register)?))
    }

    pub fn read_file_bytes(&self, session_id: &str) -> MobileResult<ReadFileBytesResult> {
        let (uri, local, format) = {
            let active = self.active_session(session_id)?;
            (active.uri, active.local, active.session.format)
        };
        let raw = match (local, uri) {
            (Some(local), _) => local.read()?,
            (None, Some(uri)) => self.bridge.read_uri_bytes(&uri).map_err(map_fs_error)?,
            (None, None) => {
                return Ok(ReadFileBytesResult {
                    bytes_base64: B64.encode([]),
                    tracking_dropped: None,
                    encrypted: None,
                    distribution: None,
                });
            }
        };
        if format.is_hwp_family() {
            let prepared = prepare_hwp_for_open(raw, format)?;
            let baseline = if !prepared.encrypted && !prepared.distribution {
                Some(extract_hwp_baseline(&prepared.bytes, format))
            } else {
                None
            };
            if let Some(active) = self.sessions.lock().unwrap().find_mut(session_id) {
                active.encrypted = prepared.encrypted;
                active.distribution = prepared.distribution;
                active.hwp_baseline = baseline;
            }
            return Ok(ReadFileBytesResult {
                bytes_base64: B64.encode(&prepared.bytes),
                tracking_dropped: Some(prepared.tracking_dropped),
                encrypted: Some(prepared.encrypted),
                distribution: Some(prepared.distribution),
            });
        }
        Ok(ReadFileBytesResult {
            bytes_base64: B64.encode(&raw),
            tracking_dropped: None,
            encrypted: None,
            distribution: None,
        })
    }

    pub fn hwp_new_tabs(
        &self,
        session_id: &str,
        bytes_base64: &str,
        format: MobileDocFormat,
    ) -> MobileResult<Vec<TabSpot>> {
        let active = self.active_session(session_id)?;
        if active.encrypted || active.distribution {
            return Ok(Vec::new());
        }
        let bytes = B64.decode(bytes_base64).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InvalidArgument, "mobile.decode.base64", e.to_string())
        })?;
        Ok(find_new_tabs(&bytes, format))
    }

    pub fn save_file_bytes(
        &self,
        session_id: &str,
        bytes_base64: &str,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<SaveFileBytesResult> {
        let raw_bytes = B64.decode(bytes_base64).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InvalidArgument, "mobile.decode.base64", e.to_string())
        })?;
        self.save_decoded(session_id, raw_bytes, hwp_fix)
    }

    /// Saves the local file `src` over the active document, with the same checks as
    /// `save_file_bytes` (for editors whose engine writes a file, e.g. a spreadsheet working
    /// copy). HWP documents go through the same fixes and first-overwrite backup; other formats
    /// stream from the file without loading it into memory.
    pub fn save_file_from_path(
        &self,
        session_id: &str,
        src: &Path,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<SaveFileBytesResult> {
        let (active, uri) = self.writable_active(session_id)?;
        let format = hwp_fix
            .as_ref()
            .map(|f| f.format)
            .unwrap_or(active.session.format);
        if format.is_hwp_family() {
            let raw_bytes = std::fs::read(src).map_err(io_error)?;
            return self.save_decoded(session_id, raw_bytes, hwp_fix);
        }
        let work_dir = self.write_work_dir()?;
        write_uri_from_file(self.bridge.as_ref(), &uri, src, &work_dir).map_err(map_fs_error)?;
        let _ = self.recovery.discard(&active.session.doc_key);
        Ok(SaveFileBytesResult {
            ok: true,
            backup_id: None,
            tails_lost: None,
            memos_lost: None,
        })
    }

    /// "Save as" from a local file: HWP documents go through HWP save fixes, while other formats
    /// stream directly from `src` to the picked location without loading the file into memory.
    pub fn save_as_file_from_path(
        &self,
        session_id: Option<&str>,
        suggested_name: &str,
        format: MobileDocFormat,
        src: &Path,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<MobileDocSession> {
        if format.is_hwp_family() {
            let raw_bytes = std::fs::read(src).map_err(io_error)?;
            return self.save_as_decoded(session_id, suggested_name, format, raw_bytes, hwp_fix);
        }
        let prev_active = self.lookup_prev_session(session_id);
        if let Some(prev) = &prev_active
            && (prev.encrypted || prev.distribution)
        {
            return Err(MobileError::with_detail(
                MobileErrorCode::PasswordProtected,
                "mobile.hwp.passwordProtected",
                "encrypted or distribution HWP documents cannot be saved",
            ));
        }
        let picked = self
            .bridge
            .create_save_file(suggested_name, format.mime())
            .map_err(map_fs_error)?;
        let work_dir = self.write_work_dir()?;
        write_new_uri_from_file(self.bridge.as_ref(), &picked.uri, src, &work_dir)
            .map_err(map_fs_error)?;
        if let Some(prev) = &prev_active {
            let _ = self.recovery.discard(&prev.session.doc_key);
        }
        let prev_id = prev_active.as_ref().map(|p| p.session.session_id.as_str());
        self.replace_saved_as_slot(prev_id, picked)
    }

    /// Copies the active document into the local file `dest` (replaced if it exists), e.g. a
    /// working copy for an engine that reads files. Returns the byte count.
    pub fn copy_session_to_file(&self, session_id: &str, dest: &Path) -> MobileResult<u64> {
        let active = self.active_session(session_id)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        match (&active.local, &active.uri) {
            (Some(local), _) => {
                let bytes = local.read()?;
                std::fs::write(dest, &bytes).map_err(io_error)?;
                Ok(bytes.len() as u64)
            }
            (None, Some(uri)) => self.bridge.copy_uri_to_file(uri, dest).map_err(map_fs_error),
            (None, None) => Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.save.noUri",
                "untitled session has no document to copy",
            )),
        }
    }

    fn lookup_prev_session(&self, session_id: Option<&str>) -> Option<ActiveSession> {
        let guard = self.sessions.lock().unwrap();
        match session_id {
            Some(sid) => guard.find(sid).cloned(),
            None => guard.active.clone().or_else(|| guard.pending.clone()),
        }
    }

    fn active_session(&self, session_id: &str) -> MobileResult<ActiveSession> {
        let guard = self.sessions.lock().unwrap();
        guard.find(session_id).cloned().ok_or_else(|| {
            MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.session.notFound",
                "unknown active sessionId",
            )
        })
    }

    /// The active session and its document location, when it can be written in place.
    fn writable_active(&self, session_id: &str) -> MobileResult<(ActiveSession, String)> {
        let active = self.active_session(session_id)?;
        if active.session.ephemeral || !active.session.writable {
            return Err(MobileError::with_detail(
                MobileErrorCode::ReadOnlyUri,
                "mobile.save.readOnly",
                "session URI is not writable in-place",
            ));
        }
        let Some(uri) = active.uri.clone() else {
            return Err(MobileError::with_detail(
                MobileErrorCode::ReadOnlyUri,
                "mobile.save.noUri",
                "untitled session requires Save As",
            ));
        };
        Ok((active, uri))
    }

    /// `<cache>/ieum-tmp/home/write`, where a document's original is kept while it is written.
    fn write_work_dir(&self) -> MobileResult<PathBuf> {
        let dirs = self.bridge.native_dirs().map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.fs.ioError", e.detail)
        })?;
        let dir = dirs.cache_dir.join(WRITE_WORK_RELATIVE_DIR);
        std::fs::create_dir_all(&dir).map_err(io_error)?;
        Ok(dir)
    }

    fn save_decoded(
        &self,
        session_id: &str,
        raw_bytes: Vec<u8>,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<SaveFileBytesResult> {
        let (active, uri) = self.writable_active(session_id)?;

        let format = hwp_fix
            .as_ref()
            .map(|f| f.format)
            .unwrap_or(active.session.format);

        let mut final_bytes = raw_bytes;
        let mut backup_id = None;
        let mut tails_lost = None;
        let mut memos_lost = None;

        if format.is_hwp_family() {
            if active.encrypted || active.distribution {
                return Err(MobileError::with_detail(
                    MobileErrorCode::PasswordProtected,
                    "mobile.hwp.passwordProtected",
                    "encrypted or distribution HWP documents cannot be overwritten",
                ));
            }
            validate_hwp_magic(&final_bytes, format)?;
            let inspected = inspect_hwp_container(&final_bytes, format);
            if inspected.encrypted || inspected.distribution {
                return Err(MobileError::with_detail(
                    MobileErrorCode::PasswordProtected,
                    "mobile.hwp.passwordProtected",
                    "encrypted or distribution HWP documents cannot be saved",
                ));
            }
            let fixed = apply_hwp_save_fixes(
                final_bytes,
                format,
                active.hwp_baseline.as_ref(),
                hwp_fix.as_ref(),
            );
            final_bytes = fixed.bytes;
            if fixed.tails_lost {
                tails_lost = Some(true);
            }
            if fixed.memos_lost > 0 {
                memos_lost = Some(fixed.memos_lost);
            }

            // Single-owner pre-overwrite backup gate before first overwrite of this docKey.
            let already_backed_up = self
                .backed_up_keys
                .lock()
                .unwrap()
                .contains(&active.session.doc_key);
            if !already_backed_up {
                if self.fail_backup_for_test.load(Ordering::SeqCst) {
                    return Err(MobileError::with_detail(
                        MobileErrorCode::BackupFailed,
                        "mobile.backup.failed",
                        "injected backup failure",
                    ));
                }
                let orig_disk_bytes = self.bridge.read_uri_bytes(&uri).map_err(|e| {
                    MobileError::with_detail(
                        MobileErrorCode::BackupFailed,
                        "mobile.backup.readOriginalFailed",
                        e.detail,
                    )
                })?;
                let entry = self.backups.create_backup(
                    &active.session.doc_key,
                    &uri,
                    &active.session.name,
                    format,
                    &orig_disk_bytes,
                )?;
                self.backed_up_keys
                    .lock()
                    .unwrap()
                    .insert(active.session.doc_key.clone());
                backup_id = Some(entry.backup_id);
            }
        }

        self.bridge
            .write_uri_bytes_atomic(&uri, &final_bytes)
            .map_err(map_fs_error)?;
        let _ = self.recovery.discard(&active.session.doc_key);

        Ok(SaveFileBytesResult {
            ok: true,
            backup_id,
            tails_lost,
            memos_lost,
        })
    }

    pub fn save_as_file_bytes(
        &self,
        session_id: Option<&str>,
        suggested_name: &str,
        format: MobileDocFormat,
        bytes_base64: &str,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<MobileDocSession> {
        let prev_active = self.lookup_prev_session(session_id);
        if let Some(prev) = &prev_active
            && (prev.encrypted || prev.distribution)
        {
            return Err(MobileError::with_detail(
                MobileErrorCode::PasswordProtected,
                "mobile.hwp.passwordProtected",
                "encrypted or distribution HWP documents cannot be saved",
            ));
        }
        let raw_bytes = B64.decode(bytes_base64).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InvalidArgument, "mobile.decode.base64", e.to_string())
        })?;
        self.save_as_checked(prev_active, suggested_name, format, raw_bytes, hwp_fix)
    }

    fn save_as_decoded(
        &self,
        session_id: Option<&str>,
        suggested_name: &str,
        format: MobileDocFormat,
        raw_bytes: Vec<u8>,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<MobileDocSession> {
        let prev_active = self.lookup_prev_session(session_id);
        if let Some(prev) = &prev_active
            && (prev.encrypted || prev.distribution)
        {
            return Err(MobileError::with_detail(
                MobileErrorCode::PasswordProtected,
                "mobile.hwp.passwordProtected",
                "encrypted or distribution HWP documents cannot be saved",
            ));
        }
        self.save_as_checked(prev_active, suggested_name, format, raw_bytes, hwp_fix)
    }

    fn save_as_checked(
        &self,
        prev_active: Option<ActiveSession>,
        suggested_name: &str,
        format: MobileDocFormat,
        raw_bytes: Vec<u8>,
        hwp_fix: Option<HwpFixPayload>,
    ) -> MobileResult<MobileDocSession> {

        let mut final_bytes = raw_bytes;
        if format.is_hwp_family() {
            validate_hwp_magic(&final_bytes, format)?;
            let inspected = inspect_hwp_container(&final_bytes, format);
            if inspected.encrypted || inspected.distribution {
                return Err(MobileError::with_detail(
                    MobileErrorCode::PasswordProtected,
                    "mobile.hwp.passwordProtected",
                    "encrypted or distribution HWP documents cannot be saved",
                ));
            }
            let fixed = apply_hwp_save_fixes(
                final_bytes,
                format,
                prev_active.as_ref().and_then(|a| a.hwp_baseline.as_ref()),
                hwp_fix.as_ref(),
            );
            final_bytes = fixed.bytes;
        }

        let picked = self
            .bridge
            .create_save_file(suggested_name, format.mime())
            .map_err(map_fs_error)?;
        self.bridge
            .write_uri_bytes_atomic(&picked.uri, &final_bytes)
            .map_err(map_fs_error)?;
        if let Some(prev) = &prev_active {
            let _ = self.recovery.discard(&prev.session.doc_key);
        }
        let prev_id = prev_active.as_ref().map(|p| p.session.session_id.as_str());
        self.replace_saved_as_slot(prev_id, picked)
    }

    pub fn share_file(
        &self,
        session_id: &str,
        suggested_name: &str,
        mode: MobileShareMode,
        bytes_base64: Option<&str>,
    ) -> MobileResult<()> {
        let active = self.active_session(session_id)?;

        if (active.encrypted || active.distribution) && mode == MobileShareMode::Edited {
            return Err(MobileError::with_detail(
                MobileErrorCode::PasswordProtected,
                "mobile.share.protectedOriginalOnly",
                "encrypted or distribution HWP documents may only share unmodified original bytes",
            ));
        }

        let bytes = match mode {
            MobileShareMode::Original => {
                if let Some(local) = &active.local {
                    local.read()?
                } else {
                    let uri = active.uri.as_deref().ok_or_else(|| {
                        MobileError::with_detail(
                            MobileErrorCode::InvalidArgument,
                            "mobile.share.noOriginalUri",
                            "untitled session has no original file to share",
                        )
                    })?;
                    self.bridge.read_uri_bytes(uri).map_err(map_fs_error)?
                }
            }
            MobileShareMode::Edited => {
                let raw = bytes_base64.ok_or_else(|| {
                    MobileError::with_detail(
                        MobileErrorCode::InvalidArgument,
                        "mobile.share.missingBytes",
                        "edited share requires bytesBase64",
                    )
                })?;
                B64.decode(raw).map_err(|e| {
                    MobileError::with_detail(
                        MobileErrorCode::InvalidArgument,
                        "mobile.decode.base64",
                        e.to_string(),
                    )
                })?
            }
        };
        let format = MobileDocFormat::from_name(suggested_name);
        self.bridge
            .share_file_bytes(suggested_name, format.mime(), &bytes)
            .map_err(map_fs_error)
    }

    pub fn list_recent_docs(&self) -> MobileResult<Vec<RecentDocEntry>> {
        self.recent.list()
    }

    pub fn remove_recent_doc(&self, id: &str) -> MobileResult<()> {
        self.recent.remove(id)
    }

    pub fn recovery_write(
        &self,
        doc_key: &str,
        format: MobileDocFormat,
        title: &str,
        bytes_base64: &str,
    ) -> MobileResult<()> {
        // Encrypted documents never write recovery copies.
        {
            let guard = self.sessions.lock().unwrap();
            let is_protected = [guard.active.as_ref(), guard.pending.as_ref()]
                .into_iter()
                .flatten()
                .any(|s| s.session.doc_key == doc_key && (s.encrypted || s.distribution));
            if is_protected {
                return Ok(());
            }
        }
        let bytes = B64.decode(bytes_base64).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InvalidArgument, "mobile.decode.base64", e.to_string())
        })?;
        self.recovery.write(doc_key, format, title, &bytes)?;
        Ok(())
    }

    pub fn recovery_list(&self) -> MobileResult<Vec<RecoveryEntry>> {
        self.recovery.list()
    }

    pub fn recovery_read(&self, doc_key: &str) -> MobileResult<String> {
        let bytes = self.recovery.read(doc_key)?;
        Ok(B64.encode(bytes))
    }

    pub fn recovery_discard(&self, doc_key: &str) -> MobileResult<()> {
        self.recovery.discard(doc_key)
    }

    pub fn hwp_backup_list(&self) -> MobileResult<Vec<HwpBackupEntry>> {
        self.backups.list()
    }

    pub fn hwp_backup_restore(
        &self,
        backup_id: &str,
        target: RestoreTarget,
    ) -> MobileResult<RestoreBackupResult> {
        let (entry, orig_uri, bytes) = self.backups.read_entry(backup_id)?;
        match target {
            RestoreTarget::InPlace => {
                self.bridge
                    .write_uri_bytes_atomic(&orig_uri, &bytes)
                    .map_err(map_fs_error)?;
                Ok(RestoreBackupResult {
                    ok: true,
                    session: None,
                })
            }
            RestoreTarget::SaveAs => {
                let picked = self
                    .bridge
                    .create_save_file(&entry.original_name, entry.format.mime())
                    .map_err(map_fs_error)?;
                self.bridge
                    .write_uri_bytes_atomic(&picked.uri, &bytes)
                    .map_err(map_fs_error)?;
                let session = self.activate_picked(picked, true)?;
                Ok(RestoreBackupResult {
                    ok: true,
                    session: Some(session),
                })
            }
        }
    }

    pub fn hwp_backup_delete(&self, backup_id: &str) -> MobileResult<()> {
        self.backups.delete(backup_id)
    }

    pub fn get_app_prefs(&self) -> MobileResult<MobileAppPrefs> {
        self.prefs.load()
    }

    pub fn set_app_prefs(&self, patch: MobileAppPrefsPatch) -> MobileResult<MobileAppPrefs> {
        self.prefs.update(patch)
    }

    // Track T6 home helpers (used by `home::HomeService`).

    pub(crate) fn bridge(&self) -> &Arc<dyn NativeFileBridge> {
        &self.bridge
    }

    pub(crate) fn recent_store(&self) -> &RecentStore {
        &self.recent
    }

    pub(crate) fn recovery_store(&self) -> &RecoveryStore {
        &self.recovery
    }

    pub(crate) fn backup_store(&self) -> &HwpBackupStore {
        &self.backups
    }

    pub(crate) fn folder_store(&self) -> &home::FolderStore {
        &self.folders
    }

    pub(crate) fn favorite_store(&self) -> &home::FavoriteStore {
        &self.favorites
    }

    /// Whether the open gate lets `format` through (`true` before the WebView sets the list).
    pub(crate) fn is_openable_format(&self, format: MobileDocFormat) -> bool {
        self.openable
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|formats| formats.contains(&format))
    }

    /// Moves everything keyed by a renamed document (recent and favorite rows, the recovery
    /// copy, HWP backups, saved reader positions, and active/pending sessions) to its new
    /// location. Returns the new docKey.
    pub(crate) fn rekey_document(
        &self,
        old_key: &str,
        old_uri: &str,
        new_uri: &str,
        new_name: &str,
    ) -> MobileResult<String> {
        let new_key = persistent_doc_key(new_uri);
        self.recent.rekey(old_key, old_uri, &new_key, new_uri, new_name)?;
        self.favorites.rekey(old_key, old_uri, &new_key, new_uri, new_name)?;
        self.recovery.rekey(old_key, &new_key, new_name)?;
        self.backups
            .rekey(old_key, old_uri, &new_key, new_uri, new_name)?;
        self.readers.rekey(old_key, &new_key)?;
        {
            let mut keys = self.backed_up_keys.lock().unwrap();
            if keys.remove(old_key) {
                keys.insert(new_key.clone());
            }
        }
        let mut guard = self.sessions.lock().unwrap();
        let slots = &mut *guard;
        let format = MobileDocFormat::from_name(new_name);
        for slot in [slots.active.as_mut(), slots.pending.as_mut()]
            .into_iter()
            .flatten()
        {
            if slot.uri.as_deref() == Some(old_uri) {
                slot.uri = Some(new_uri.to_string());
                slot.session.doc_key = new_key.clone();
                slot.session.name = new_name.to_string();
                slot.session.ext = format.ext().to_string();
                slot.session.format = format;
                slot.session.uri_hint = Some(new_name.to_string());
            }
        }
        Ok(new_key)
    }

    /// `set_app_prefs` with the home fields (track T6) in the same write.
    pub fn set_app_prefs_with_home(
        &self,
        patch: MobileAppPrefsPatch,
        home: MobileHomePrefsPatch,
    ) -> MobileResult<MobileAppPrefs> {
        self.prefs.update_with_home(patch, home)
    }
}
