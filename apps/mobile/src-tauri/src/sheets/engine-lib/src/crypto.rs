//! Password-protected workbooks (track T1): find out whether a file is
//! encrypted, decrypt it into a plain file, and encrypt a plain workbook again.
//!
//! The desktop does the same in its main process with `officecrypto-tool`
//! (`packages/electron-utils/src/office-encryption.ts`); the phone uses
//! `msoffice-crypto` (chosen by the XLS-T4 prototype) and writes the same
//! format the desktop writes: ECMA-376 agile, AES-256, SHA-512, spin count
//! 100000. Every path must lie inside the work folder, so a decrypted
//! workbook only ever exists as a file there (it never crosses the WebView
//! bridge).
//!
//! Requests and answers are JSON text over the library's C ABI
//! (`ieum_sheets_engine_crypto_line`):
//!
//! - `{"op":"probe","path":…}` → `{"ok":true,"result":{"encrypted":…,"supported":…,"document":"ooxml"|"xls"|"other"}}`
//! - `{"op":"decrypt","source":…,"target":…,"password":…}` → `{"ok":true,"result":{"document":"ooxml"|"xls"}}`
//! - `{"op":"encrypt","source":…,"target":…,"password":…}` → `{"ok":true,"result":{}}`
//!
//! A failure answers `{"ok":false,"error":{"code":…,"message":…}}` with one
//! of the `CODE_*` codes below. `target` must not exist yet; on failure no
//! target file is left behind.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Cursor, Write};
use std::path::{Path, PathBuf};

use msoffice_crypto::{Document, Error as CryptoError, IntegrityPolicy, classify};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::cfb_fat::{is_cfb, normalize_fat};
use crate::path_guard::{PATH_OUTSIDE_WORK_FOLDER, is_within};

/// The password does not open the file: ask again.
pub const CODE_WRONG_PASSWORD: &str = "wrong_password";
/// The file is encrypted in a way this app cannot open (rights management,
/// an unknown cipher, not an Office file).
pub const CODE_UNSUPPORTED: &str = "unsupported";
/// The file is encrypted, but its integrity check failed (changed or damaged).
pub const CODE_DAMAGED: &str = "damaged";
/// A decrypt request for a file that is not encrypted.
pub const CODE_NOT_ENCRYPTED: &str = "not_encrypted";
/// Reading or writing a file failed.
pub const CODE_IO: &str = "io";
/// The request itself is malformed or names a path outside the work folder.
pub const CODE_INVALID_REQUEST: &str = "invalid_request";

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum CryptoRequest {
    Probe {
        path: PathBuf,
    },
    Decrypt {
        source: PathBuf,
        target: PathBuf,
        password: String,
    },
    Encrypt {
        source: PathBuf,
        target: PathBuf,
        password: String,
    },
}

impl CryptoRequest {
    fn paths(&self) -> Vec<&Path> {
        match self {
            Self::Probe { path } => vec![path],
            Self::Decrypt { source, target, .. } | Self::Encrypt { source, target, .. } => {
                vec![source, target]
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

impl Failure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        Self::new(CODE_IO, error.to_string())
    }
}

fn from_crypto(error: CryptoError) -> Failure {
    let code = match &error {
        CryptoError::WrongPassword => CODE_WRONG_PASSWORD,
        CryptoError::IntegrityCheckFailed
        | CryptoError::IntegrityElementMissing
        | CryptoError::IntegrityUnavailable(_) => CODE_DAMAGED,
        CryptoError::NotEncrypted => CODE_NOT_ENCRYPTED,
        CryptoError::Io(_) => CODE_IO,
        _ => CODE_UNSUPPORTED,
    };
    Failure::new(code, error.to_string())
}

/// What a probe found.
#[derive(Debug, PartialEq, Eq)]
pub struct Probe {
    pub encrypted: bool,
    /// Encrypted and this app can decrypt it (only meaningful when encrypted).
    pub supported: bool,
    /// `ooxml` (an encrypted package), `xls` (Excel 97-2003) or `other`.
    pub document: &'static str,
}

fn document_name(document: Document) -> &'static str {
    match document {
        Document::OoxmlPackage | Document::ZipArchive => "ooxml",
        Document::ExcelBinary => "xls",
        _ => "other",
    }
}

/// A compound file read into memory with its FAT fixed up (see `cfb_fat`).
fn read_compound_file(path: &Path) -> Result<Vec<u8>, Failure> {
    let mut bytes = fs::read(path)?;
    normalize_fat(&mut bytes);
    Ok(bytes)
}

fn starts_with_cfb_magic(path: &Path) -> Result<bool, Failure> {
    use std::io::Read;
    let mut head = [0u8; 8];
    let mut file = File::open(path)?;
    let mut read = 0;
    while read < head.len() {
        let n = file.read(&mut head[read..])?;
        if n == 0 {
            break;
        }
        read += n;
    }
    Ok(is_cfb(&head[..read]))
}

pub fn probe(path: &Path) -> Result<Probe, Failure> {
    // A ZIP package (any plain .xlsx) or a CSV is never encrypted; only a
    // compound file is read further.
    if !starts_with_cfb_magic(path)? {
        return Ok(Probe {
            encrypted: false,
            supported: false,
            document: "other",
        });
    }
    let bytes = read_compound_file(path)?;
    let class = classify(&bytes);
    let encrypted = class.is_encrypted();
    Ok(Probe {
        encrypted,
        supported: encrypted && class.is_supported(),
        document: document_name(class.document),
    })
}

fn create_target(target: &Path) -> Result<File, Failure> {
    Ok(OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(target)?)
}

/// Runs `write` on a fresh `target`, deleting it again when anything fails.
fn with_target<T>(
    target: &Path,
    write: impl FnOnce(File) -> Result<T, Failure>,
) -> Result<T, Failure> {
    let file = create_target(target)?;
    let result = write(file);
    if result.is_err() {
        let _ = fs::remove_file(target);
    }
    result
}

/// Decrypts `source` into the new file `target`. Answers which kind of
/// document came out (`ooxml`: an .xlsx/.xlsm package; `xls`: the plain
/// Excel 97-2003 file, still to be converted for the engine).
pub fn decrypt(source: &Path, target: &Path, password: &str) -> Result<&'static str, Failure> {
    if !starts_with_cfb_magic(source)? {
        return Err(Failure::new(
            CODE_NOT_ENCRYPTED,
            "The file is not password protected.",
        ));
    }
    let bytes = read_compound_file(source)?;
    let class = classify(&bytes);
    if !class.is_encrypted() {
        return Err(Failure::new(
            CODE_NOT_ENCRYPTED,
            "The file is not password protected.",
        ));
    }
    match class.document {
        Document::ExcelBinary => {
            let plain =
                msoffice_crypto::decrypt_binary_office(&bytes, password).map_err(from_crypto)?;
            with_target(target, |file| {
                let mut writer = BufWriter::new(file);
                writer.write_all(&plain)?;
                writer.flush()?;
                Ok("xls")
            })
        }
        Document::OoxmlPackage => with_target(target, |file| {
            let mut writer = BufWriter::new(file);
            msoffice_crypto::decrypt_ooxml_to(
                Cursor::new(&bytes[..]),
                &mut writer,
                password,
                IntegrityPolicy::default(),
            )
            .map_err(from_crypto)?;
            writer.flush()?;
            Ok("ooxml")
        }),
        _ => Err(Failure::new(
            CODE_UNSUPPORTED,
            "This kind of encrypted file cannot be opened.",
        )),
    }
}

/// Encrypts the plain workbook package `source` into the new file `target`
/// (ECMA-376 agile, the desktop's parameters).
pub fn encrypt(source: &Path, target: &Path, password: &str) -> Result<(), Failure> {
    let reader = File::open(source)?;
    with_target(target, |file| {
        msoffice_crypto::encrypt_ooxml_to(reader, file, password).map_err(from_crypto)?;
        Ok(())
    })
}

fn failure_value(failure: &Failure) -> Value {
    json!({ "ok": false, "error": { "code": failure.code, "message": failure.message } })
}

/// Answers one crypto request line (see the module docs). `work_root`, when
/// set, is the folder every path must lie inside.
pub fn handle_crypto_line(work_root: Option<&Path>, line: &str) -> String {
    let request: CryptoRequest = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return failure_value(&Failure::new(
                CODE_INVALID_REQUEST,
                format!("Invalid crypto request: {error}"),
            ))
            .to_string();
        }
    };
    if let Some(root) = work_root {
        if !request
            .paths()
            .into_iter()
            .all(|path| is_within(root, path))
        {
            return failure_value(&Failure::new(
                CODE_INVALID_REQUEST,
                PATH_OUTSIDE_WORK_FOLDER,
            ))
            .to_string();
        }
    }
    let answer = match request {
        CryptoRequest::Probe { path } => probe(&path).map(|found| {
            json!({
                "encrypted": found.encrypted,
                "supported": found.supported,
                "document": found.document,
            })
        }),
        CryptoRequest::Decrypt {
            source,
            target,
            password,
        } => decrypt(&source, &target, &password).map(|document| json!({ "document": document })),
        CryptoRequest::Encrypt {
            source,
            target,
            password,
        } => encrypt(&source, &target, &password).map(|()| json!({})),
    };
    match answer {
        Ok(result) => json!({ "ok": true, "result": result }).to_string(),
        Err(failure) => failure_value(&failure).to_string(),
    }
}
