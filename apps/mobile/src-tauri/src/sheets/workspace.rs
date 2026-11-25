//! The T1 work folder: app-private temp files the spreadsheet engine reads
//! and writes (working copies, extracted entries, patched contents, saved
//! targets). The WebView may only name paths inside it.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::{MobileError, MobileErrorCode, MobileResult};

/// Folder name under the app cache directory.
pub const WORK_DIR_NAME: &str = "ieum-sheets";

pub struct SheetsWorkspace {
    root: PathBuf,
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
    pub fn new(root: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Removes everything inside the work folder (the folder itself stays).
    pub fn clear(&self) -> MobileResult<()> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return fs::create_dir_all(&self.root).map_err(io_error);
            }
            Err(error) => return Err(io_error(error)),
        };
        for entry in entries {
            let entry = entry.map_err(io_error)?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(io_error)?;
            if file_type.is_dir() {
                fs::remove_dir_all(&path).map_err(io_error)?;
            } else {
                fs::remove_file(&path).map_err(io_error)?;
            }
        }
        Ok(())
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

    /// Checks a path the WebView sent back against the work folder.
    pub fn resolve(&self, raw: &str) -> MobileResult<PathBuf> {
        let path = PathBuf::from(raw);
        if is_within(&self.root, &path) {
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
