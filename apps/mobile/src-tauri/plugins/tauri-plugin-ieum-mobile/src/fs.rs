use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
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

/// Platform bridge for OS document pickers, persistent URI/bookmark storage, atomic writes, and sharing.
pub trait NativeFileBridge: Send + Sync {
    fn pick_open_file(&self, exts: &[String]) -> Result<PickedFile, NativeFsError>;
    fn create_save_file(
        &self,
        suggested_name: &str,
        mime: &str,
    ) -> Result<PickedFile, NativeFsError>;
    fn open_persistent_uri(&self, uri: &str) -> Result<PickedFile, NativeFsError>;
    fn read_uri_bytes(&self, uri: &str) -> Result<Vec<u8>, NativeFsError>;
    fn write_uri_bytes_atomic(&self, uri: &str, bytes: &[u8]) -> Result<(), NativeFsError>;
    fn share_file_bytes(
        &self,
        suggested_name: &str,
        mime: &str,
        bytes: &[u8],
    ) -> Result<(), NativeFsError>;
    fn take_pending_open_intent(&self) -> Option<PickedFile>;
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

#[derive(Default)]
struct HostFsState {
    files: BTreeMap<String, MockPickedDoc>,
    revoked_uris: BTreeMap<String, bool>,
    next_pick_open: Option<MockPickedDoc>,
    next_save_as_uri: Option<String>,
    pending_intents: VecDeque<MockPickedDoc>,
    last_shared: Option<(String, String, Vec<u8>)>,
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
}
