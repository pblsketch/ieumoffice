//! AI result store: the `ai-results/` folder in the app data directory.
//!
//! Holds images the AI made or fetched and copies of attached photos, so the
//! webview does not keep large bytes around (it reads them back when needed).
//! An image is addressed as `ai-result://<uuid>.<ext>`: a lower-case
//! hyphenated v4 UUID and one of `png`, `jpg`, `webp`, `gif`. Addresses are
//! checked strictly and only name files directly inside `ai-results/`.
//!
//! Only PNG, JPEG, WebP and GIF are stored, and the bytes must start with the
//! signature of the stated type. A put writes a temporary file and renames
//! it; puts and clears are serialized, so a clear during a put leaves either
//! the whole image or nothing, never a partial file.

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Folder name under the app data directory.
pub const RESULTS_DIR_NAME: &str = "ai-results";
/// Address scheme of a stored result.
pub const RESULT_ADDRESS_PREFIX: &str = "ai-result://";

/// `(mime, extension)` of the image types the store accepts.
const IMAGE_TYPES: &[(&str, &str)] = &[
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/webp", "webp"),
    ("image/gif", "gif"),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiResultsSize {
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiResultPut {
    /// `ai-result://<uuid>.<ext>`
    pub address: String,
    pub mime: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiResultImage {
    pub data_base64: String,
    pub mime: String,
    pub bytes: u64,
}

fn refuse(key: &str) -> MobileError {
    MobileError::new(MobileErrorCode::InvalidArgument, key)
}

fn internal(key: &str, detail: impl Into<String>) -> MobileError {
    MobileError::with_detail(MobileErrorCode::InternalError, key, detail)
}

fn normalize_mime(raw: &str) -> Option<(&'static str, &'static str)> {
    let base = raw
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let base = if base == "image/jpg" {
        "image/jpeg".to_string()
    } else {
        base
    };
    IMAGE_TYPES.iter().copied().find(|(mime, _)| *mime == base)
}

fn signature_matches(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// Parses `ai-result://<uuid>.<ext>` into the file name and its MIME.
fn parse_address(address: &str) -> MobileResult<(String, &'static str)> {
    let invalid = || refuse("mobile.ai.resultAddressInvalid");
    let rest = address
        .strip_prefix(RESULT_ADDRESS_PREFIX)
        .ok_or_else(invalid)?;
    let (id, ext) = rest.split_once('.').ok_or_else(invalid)?;
    let (mime, _) = IMAGE_TYPES
        .iter()
        .copied()
        .find(|(_, e)| *e == ext)
        .ok_or_else(invalid)?;
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| invalid())?;
    // Only the canonical form: lower-case, hyphenated, nothing else around it.
    if parsed.hyphenated().to_string() != id {
        return Err(invalid());
    }
    Ok((format!("{id}.{ext}"), mime))
}

fn walk_size(dir: &Path, total: &mut MobileAiResultsSize) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            walk_size(&entry.path(), total)?;
        } else {
            total.files += 1;
            total.bytes += meta.len();
        }
    }
    Ok(())
}

pub struct MobileAiResultStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl MobileAiResultStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            dir: app_data_dir.join(RESULTS_DIR_NAME),
            lock: Mutex::new(()),
        }
    }

    /// Bytes and file count of everything inside the folder.
    pub fn size(&self) -> MobileResult<MobileAiResultsSize> {
        let _guard = self.lock.lock().unwrap();
        self.size_locked()
    }

    fn size_locked(&self) -> MobileResult<MobileAiResultsSize> {
        let mut total = MobileAiResultsSize { bytes: 0, files: 0 };
        if !self.dir.is_dir() {
            return Ok(total);
        }
        walk_size(&self.dir, &mut total)
            .map_err(|e| internal("mobile.ai.resultRead", e.to_string()))?;
        Ok(total)
    }

    /// Deletes everything inside the folder (the folder itself stays).
    pub fn clear(&self) -> MobileResult<MobileAiResultsSize> {
        let _guard = self.lock.lock().unwrap();
        if self.dir.is_dir() {
            let entries = fs::read_dir(&self.dir)
                .map_err(|e| internal("mobile.ai.resultClear", e.to_string()))?;
            for entry in entries {
                let entry = entry.map_err(|e| internal("mobile.ai.resultClear", e.to_string()))?;
                let path = entry.path();
                let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
                let res = if is_dir {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
                res.map_err(|e| internal("mobile.ai.resultClear", e.to_string()))?;
            }
        }
        self.size_locked()
    }

    /// Stores an image and returns its address.
    pub fn put_image(&self, data_base64: &str, mime: &str) -> MobileResult<MobileAiResultPut> {
        let (mime, ext) =
            normalize_mime(mime).ok_or_else(|| refuse("mobile.ai.resultMimeNotAllowed"))?;
        let bytes = STANDARD
            .decode(data_base64.trim())
            .map_err(|_| refuse("mobile.ai.resultInvalidData"))?;
        if bytes.is_empty() {
            return Err(refuse("mobile.ai.resultInvalidData"));
        }
        if !signature_matches(mime, &bytes) {
            return Err(refuse("mobile.ai.resultImageMismatch"));
        }
        let id = uuid::Uuid::new_v4().hyphenated().to_string();
        let name = format!("{id}.{ext}");

        let _guard = self.lock.lock().unwrap();
        fs::create_dir_all(&self.dir)
            .map_err(|e| internal("mobile.ai.resultWrite", e.to_string()))?;
        let tmp = self.dir.join(format!(".{id}.tmp"));
        let written = fs::File::create(&tmp).and_then(|mut f| {
            f.write_all(&bytes)?;
            f.sync_all()
        });
        if let Err(e) = written.and_then(|()| fs::rename(&tmp, self.dir.join(&name))) {
            let _ = fs::remove_file(&tmp);
            return Err(internal("mobile.ai.resultWrite", e.to_string()));
        }
        Ok(MobileAiResultPut {
            address: format!("{RESULT_ADDRESS_PREFIX}{name}"),
            mime: mime.to_string(),
            bytes: bytes.len() as u64,
        })
    }

    /// Reads an image back by its address.
    pub fn read_image(&self, address: &str) -> MobileResult<MobileAiResultImage> {
        let (name, mime) = parse_address(address)?;
        let path = self.dir.join(name);
        let not_found =
            || MobileError::new(MobileErrorCode::InvalidArgument, "mobile.ai.resultNotFound");
        // A plain file only (no link out of the folder).
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_file() => {}
            _ => return Err(not_found()),
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(not_found()),
            Err(e) => return Err(internal("mobile.ai.resultRead", e.to_string())),
        };
        Ok(MobileAiResultImage {
            data_base64: STANDARD.encode(&bytes),
            mime: mime.to_string(),
            bytes: bytes.len() as u64,
        })
    }
}
