pub mod backup;
pub mod prefs;
pub mod recent;
pub mod recovery;
pub mod session;

pub use backup::{HwpBackupEntry, HwpBackupStore, MAX_HWP_BACKUPS};
pub use prefs::{MobileAppPrefs, MobileAppPrefsPatch, PrefsStore};
pub use recent::{RecentDocEntry, RecentStore};
pub use recovery::{RecoveryEntry, RecoveryStore};
pub use session::{MobileDocFormat, MobileDocSession, persistent_doc_key, untitled_doc_key};

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::hwp::{
    HwpBaseline, HwpFixPayload, TabSpot, apply_hwp_save_fixes, extract_hwp_baseline, find_new_tabs,
    inspect_hwp_container, prepare_hwp_for_open, validate_hwp_magic,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_ieum_mobile::fs::{NativeFileBridge, NativeFsError, NativeFsErrorKind, PickedFile};
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

#[derive(Debug, Clone)]
struct ActiveSession {
    session: MobileDocSession,
    uri: Option<String>,
    encrypted: bool,
    distribution: bool,
    hwp_baseline: Option<HwpBaseline>,
}

fn map_fs_error(err: NativeFsError) -> MobileError {
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
    active: Mutex<Option<ActiveSession>>,
    backed_up_keys: Mutex<BTreeSet<String>>,
    fail_backup_for_test: AtomicBool,
}

impl MobileFileService {
    pub fn new(app_data_dir: PathBuf, bridge: Arc<dyn NativeFileBridge>) -> MobileResult<Self> {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InternalError, "mobile.storage.initFailed", e.to_string())
        })?;
        Ok(Self {
            bridge,
            recent: RecentStore::new(app_data_dir.clone()),
            recovery: RecoveryStore::new(app_data_dir.clone()),
            backups: HwpBackupStore::new(app_data_dir.clone()),
            prefs: PrefsStore::new(app_data_dir),
            active: Mutex::new(None),
            backed_up_keys: Mutex::new(BTreeSet::new()),
            fail_backup_for_test: AtomicBool::new(false),
        })
    }

    pub fn set_fail_backup_for_test(&self, fail: bool) {
        self.fail_backup_for_test.store(fail, Ordering::SeqCst);
    }

    fn activate_picked(&self, picked: PickedFile, register_recent: bool) -> MobileResult<MobileDocSession> {
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
            self.recent.upsert(&doc_key, &picked.uri, &picked.name, format)?;
        }
        *self.active.lock().unwrap() = Some(ActiveSession {
            session: session.clone(),
            uri: Some(picked.uri),
            encrypted: false,
            distribution: false,
            hwp_baseline: None,
        });
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
        *self.active.lock().unwrap() = Some(ActiveSession {
            session: session.clone(),
            uri: None,
            encrypted: false,
            distribution: false,
            hwp_baseline: None,
        });
        Ok(session)
    }

    pub fn pick_open_file(&self, exts: &[String]) -> MobileResult<MobileDocSession> {
        let picked = self.bridge.pick_open_file(exts).map_err(map_fs_error)?;
        self.activate_picked(picked, true)
    }

    pub fn open_recent_doc(&self, id: &str) -> MobileResult<MobileDocSession> {
        let Some((uri, _fmt)) = self.recent.resolve_uri(id)? else {
            return Err(MobileError::with_detail(
                MobileErrorCode::PermissionDenied,
                "mobile.recent.notFound",
                "recent document entry missing",
            ));
        };
        let picked = self.bridge.open_persistent_uri(&uri).map_err(map_fs_error)?;
        self.activate_picked(picked, true)
    }

    pub fn consume_pending_open_intent(&self) -> MobileResult<Option<MobileDocSession>> {
        let Some(picked) = self.bridge.take_pending_open_intent() else {
            return Ok(None);
        };
        // Ephemeral or read-only share-in files must never be registered into persistent recent docs automatically.
        let register = !picked.ephemeral && picked.writable;
        Ok(Some(self.activate_picked(picked, register)?))
    }

    pub fn read_file_bytes(&self, session_id: &str) -> MobileResult<ReadFileBytesResult> {
        let (uri, format) = {
            let guard = self.active.lock().unwrap();
            let active = guard.as_ref().filter(|a| a.session.session_id == session_id).ok_or_else(|| {
                MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.session.notFound",
                    "unknown active sessionId",
                )
            })?;
            (active.uri.clone(), active.session.format)
        };
        let Some(uri) = uri else {
            return Ok(ReadFileBytesResult {
                bytes_base64: B64.encode([]),
                tracking_dropped: None,
                encrypted: None,
                distribution: None,
            });
        };
        let raw = self.bridge.read_uri_bytes(&uri).map_err(map_fs_error)?;
        if format.is_hwp_family() {
            let prepared = prepare_hwp_for_open(raw, format)?;
            let baseline = if !prepared.encrypted && !prepared.distribution {
                Some(extract_hwp_baseline(&prepared.bytes, format))
            } else {
                None
            };
            if let Some(active) = self.active.lock().unwrap().as_mut()
                && active.session.session_id == session_id
            {
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
        let guard = self.active.lock().unwrap();
        let active = guard.as_ref().filter(|a| a.session.session_id == session_id).ok_or_else(|| {
            MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.session.notFound",
                "unknown active sessionId",
            )
        })?;
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
        let active = {
            let guard = self.active.lock().unwrap();
            guard
                .as_ref()
                .filter(|a| a.session.session_id == session_id)
                .cloned()
                .ok_or_else(|| {
                    MobileError::with_detail(
                        MobileErrorCode::InvalidArgument,
                        "mobile.session.notFound",
                        "unknown active sessionId",
                    )
                })?
        };
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
        let raw_bytes = B64.decode(bytes_base64).map_err(|e| {
            MobileError::with_detail(MobileErrorCode::InvalidArgument, "mobile.decode.base64", e.to_string())
        })?;

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
        let prev_active = {
            let guard = self.active.lock().unwrap();
            match session_id {
                Some(sid) => guard.as_ref().filter(|a| a.session.session_id == sid).cloned(),
                None => guard.clone(),
            }
        };
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
        self.activate_picked(picked, true)
    }

    pub fn share_file(
        &self,
        session_id: &str,
        suggested_name: &str,
        mode: MobileShareMode,
        bytes_base64: Option<&str>,
    ) -> MobileResult<()> {
        let active = {
            let guard = self.active.lock().unwrap();
            guard
                .as_ref()
                .filter(|a| a.session.session_id == session_id)
                .cloned()
                .ok_or_else(|| {
                    MobileError::with_detail(
                        MobileErrorCode::InvalidArgument,
                        "mobile.session.notFound",
                        "unknown active sessionId",
                    )
                })?
        };

        if (active.encrypted || active.distribution) && mode == MobileShareMode::Edited {
            return Err(MobileError::with_detail(
                MobileErrorCode::PasswordProtected,
                "mobile.share.protectedOriginalOnly",
                "encrypted or distribution HWP documents may only share unmodified original bytes",
            ));
        }

        let bytes = match mode {
            MobileShareMode::Original => {
                let uri = active.uri.as_deref().ok_or_else(|| {
                    MobileError::with_detail(
                        MobileErrorCode::InvalidArgument,
                        "mobile.share.noOriginalUri",
                        "untitled session has no original file to share",
                    )
                })?;
                self.bridge.read_uri_bytes(uri).map_err(map_fs_error)?
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
        if let Some(active) = self.active.lock().unwrap().as_ref()
            && active.session.doc_key == doc_key
            && (active.encrypted || active.distribution)
        {
            return Ok(());
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
}
