//! The T1 work folder: app-private temp files the spreadsheet engine reads
//! and writes (working copies, extracted entries, patched contents, saved
//! targets). The WebView may only name paths inside it.
//!
//! It lives at `<app cache>/ieum-tmp/sheets/`, under the app's shared temp
//! root (`ieum-tmp/`, which Settings > Storage measures and can clear), and
//! holds nothing that must survive a restart. Its `engine/` subfolder is the
//! engine's own temp directory (Android points `TMPDIR` at it), where each
//! open workbook keeps a session cache; the WebView may not name paths in it.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use uuid::Uuid;

use crate::error::{MobileError, MobileErrorCode, MobileResult};

/// The app's shared temp root under the app cache directory.
pub const TEMP_ROOT_NAME: &str = "ieum-tmp";
/// T1's folder under the temp root.
pub const WORK_DIR_NAME: &str = "sheets";
/// The engine's temp directory inside the work folder.
pub const ENGINE_DIR_NAME: &str = "engine";

pub struct SheetsWorkspace {
    root: PathBuf,
    engine_dir: PathBuf,
}

/// What `SheetsWorkspace::stat` found at a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetsTempStat {
    pub size: u64,
    pub is_file: bool,
    pub is_dir: bool,
}

pub use super::path_guard::is_within;

fn io_error(error: io::Error) -> MobileError {
    MobileError::with_detail(
        MobileErrorCode::InternalError,
        "mobile.sheets.ioError",
        error.to_string(),
    )
}

fn outside_error(raw: &str) -> MobileError {
    MobileError::with_detail(
        MobileErrorCode::InvalidArgument,
        "mobile.sheets.pathOutsideWork",
        raw.to_owned(),
    )
}

/// File extensions a working copy may carry: short, lowercase ASCII letters
/// and digits only.
fn valid_ext(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= 8
        && ext
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

impl SheetsWorkspace {
    /// The work folder for the app cache directory `cache_dir`
    /// (`<cache_dir>/ieum-tmp/sheets`), with its `engine/` subfolder.
    pub fn for_cache_dir(cache_dir: &Path) -> io::Result<Self> {
        Self::new(cache_dir.join(TEMP_ROOT_NAME).join(WORK_DIR_NAME))
    }

    pub fn new(root: PathBuf) -> io::Result<Self> {
        let engine_dir = root.join(ENGINE_DIR_NAME);
        fs::create_dir_all(&engine_dir)?;
        Ok(Self { root, engine_dir })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The engine's temp directory (its open workbooks' session caches).
    pub fn engine_temp_dir(&self) -> &Path {
        &self.engine_dir
    }

    /// Recreates the work folder and the engine's temp directory if they are
    /// gone (the app's "clear temp files" may remove empty folders); the
    /// engine creates its session caches with a plain `create_dir`.
    pub fn ensure_folders(&self) -> MobileResult<()> {
        fs::create_dir_all(&self.engine_dir).map_err(io_error)
    }

    /// Removes the work files (the folder itself and the engine's temp
    /// directory stay: open workbooks keep their session caches there).
    pub fn clear(&self) -> MobileResult<()> {
        self.remove_entries(false)
    }

    /// Removes everything, the engine's session caches included. Only when no
    /// workbook can be open: at app start, where caches left by a run the OS
    /// ended are reclaimed.
    pub fn clear_all(&self) -> MobileResult<()> {
        self.remove_entries(true)
    }

    fn remove_entries(&self, engine_too: bool) -> MobileResult<()> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return fs::create_dir_all(&self.engine_dir).map_err(io_error);
            }
            Err(error) => return Err(io_error(error)),
        };
        for entry in entries {
            let entry = entry.map_err(io_error)?;
            let path = entry.path();
            if !engine_too && path == self.engine_dir {
                continue;
            }
            let file_type = entry.file_type().map_err(io_error)?;
            if file_type.is_dir() {
                fs::remove_dir_all(&path).map_err(io_error)?;
            } else {
                fs::remove_file(&path).map_err(io_error)?;
            }
        }
        fs::create_dir_all(&self.engine_dir).map_err(io_error)
    }

    /// Creates a fresh empty folder (e.g. the `outputDir` of `read_entries`).
    pub fn create_dir(&self) -> MobileResult<PathBuf> {
        fs::create_dir_all(&self.root).map_err(io_error)?;
        let path = self.root.join(format!("d-{}", Uuid::new_v4().simple()));
        fs::create_dir(&path).map_err(io_error)?;
        Ok(path)
    }

    /// A fresh, not yet existing file path with the given extension.
    pub fn new_file_path(&self, ext: &str) -> MobileResult<PathBuf> {
        if !valid_ext(ext) {
            return Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.sheets.badExtension",
                ext.to_owned(),
            ));
        }
        fs::create_dir_all(&self.root).map_err(io_error)?;
        Ok(self
            .root
            .join(format!("f-{}.{ext}", Uuid::new_v4().simple())))
    }

    /// Checks a path the WebView sent back against the work folder (the
    /// engine's temp directory excluded).
    pub fn resolve(&self, raw: &str) -> MobileResult<PathBuf> {
        let path = PathBuf::from(raw);
        let in_engine_dir = path.starts_with(&self.engine_dir)
            || path
                .canonicalize()
                .ok()
                .zip(self.engine_dir.canonicalize().ok())
                .is_some_and(|(resolved, engine_dir)| resolved.starts_with(engine_dir));
        if is_within(&self.root, &path) && !in_engine_dir {
            Ok(path)
        } else {
            Err(outside_error(raw))
        }
    }

    pub fn read_bytes(&self, raw: &str) -> MobileResult<Vec<u8>> {
        let path = self.resolve(raw)?;
        fs::read(&path).map_err(io_error)
    }

    /// Writes (replacing) a file inside the work folder, creating its parent
    /// folders inside the work folder as needed.
    pub fn write_bytes(&self, raw: &str, bytes: &[u8]) -> MobileResult<()> {
        let path = self.resolve(raw)?;
        if let Some(parent) = path.parent()
            && parent != self.root
        {
            fs::create_dir_all(parent).map_err(io_error)?;
            // Re-check now that the parent exists and can be resolved.
            self.resolve(raw)?;
        }
        fs::write(&path, bytes).map_err(io_error)
    }

    /// Appends to a file inside the work folder (creating it and its parent
    /// folders inside the work folder as needed). A save writes large patched
    /// entries in pieces so no single WebView message holds a whole part.
    pub fn append_bytes(&self, raw: &str, bytes: &[u8]) -> MobileResult<()> {
        let path = self.resolve(raw)?;
        if let Some(parent) = path.parent()
            && parent != self.root
        {
            fs::create_dir_all(parent).map_err(io_error)?;
            self.resolve(raw)?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(io_error)?;
        file.write_all(bytes).map_err(io_error)
    }

    /// Reads `length` bytes from `offset` (both optional: the whole file from
    /// the start). Reading past the end returns what is there.
    pub fn read_range(
        &self,
        raw: &str,
        offset: Option<u64>,
        length: Option<u64>,
    ) -> MobileResult<Vec<u8>> {
        let path = self.resolve(raw)?;
        if offset.is_none() && length.is_none() {
            return fs::read(&path).map_err(io_error);
        }
        let mut file = fs::File::open(&path).map_err(io_error)?;
        file.seek(SeekFrom::Start(offset.unwrap_or(0)))
            .map_err(io_error)?;
        let mut bytes = Vec::new();
        match length {
            Some(length) => {
                file.take(length)
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
            }
            None => {
                file.read_to_end(&mut bytes).map_err(io_error)?;
            }
        }
        Ok(bytes)
    }

    /// Creates a folder (and its missing parents) inside the work folder.
    pub fn make_dir(&self, raw: &str) -> MobileResult<()> {
        let path = self.resolve(raw)?;
        fs::create_dir_all(&path).map_err(io_error)?;
        self.resolve(raw).map(|_| ())
    }

    /// Moves a file inside the work folder, replacing the target.
    pub fn rename(&self, from: &str, to: &str) -> MobileResult<()> {
        let from = self.resolve(from)?;
        let to = self.resolve(to)?;
        fs::rename(&from, &to).map_err(io_error)
    }

    /// Copies a file inside the work folder, replacing the target; returns
    /// the number of bytes copied.
    pub fn copy(&self, from: &str, to: &str) -> MobileResult<u64> {
        let from = self.resolve(from)?;
        let to = self.resolve(to)?;
        fs::copy(&from, &to).map_err(io_error)
    }

    /// What is at a path inside the work folder, or `None` when nothing is.
    pub fn stat(&self, raw: &str) -> MobileResult<Option<SheetsTempStat>> {
        let path = self.resolve(raw)?;
        match fs::metadata(&path) {
            Ok(metadata) => Ok(Some(SheetsTempStat {
                size: metadata.len(),
                is_file: metadata.is_file(),
                is_dir: metadata.is_dir(),
            })),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_error(error)),
        }
    }

    /// Lowercase hex SHA-256 of a file inside the work folder, streamed.
    pub fn sha256(&self, raw: &str) -> MobileResult<String> {
        use sha2::{Digest, Sha256};
        let path = self.resolve(raw)?;
        let mut file = fs::File::open(&path).map_err(io_error)?;
        let mut hasher = Sha256::new();
        io::copy(&mut file, &mut hasher).map_err(io_error)?;
        Ok(hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    /// Deletes a file or a whole folder inside the work folder. A path that is
    /// already gone counts as deleted.
    pub fn delete(&self, raw: &str) -> MobileResult<()> {
        let path = self.resolve(raw)?;
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io_error(error)),
        };
        if metadata.is_dir() {
            fs::remove_dir_all(&path).map_err(io_error)
        } else {
            fs::remove_file(&path).map_err(io_error)
        }
    }
}
