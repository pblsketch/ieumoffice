//! The app's side of the engine library's C ABI (`engine-lib/src/lib.rs`).
//! `build.rs` builds that library and links it; these declarations are all
//! this crate knows about it.

use std::ffi::c_void;
use std::io;
use std::path::Path;
use std::ptr::NonNull;

/// The ABI this code was written against (`ABI_VERSION` in the library).
const EXPECTED_ABI_VERSION: u32 = 2;

const NO_ANSWER: &str = r#"{"version":1,"requestId":"","ok":false,"error":{"code":"workbook_error","message":"The spreadsheet engine could not process this request."}}"#;

unsafe extern "C" {
    fn ieum_sheets_engine_abi_version() -> u32;
    fn ieum_sheets_engine_new(work_root_ptr: *const u8, work_root_len: usize) -> *mut c_void;
    fn ieum_sheets_engine_handle_line(
        engine: *const c_void,
        line_ptr: *const u8,
        line_len: usize,
        out_len: *mut usize,
    ) -> *mut u8;
    fn ieum_sheets_engine_crypto_line(
        engine: *const c_void,
        line_ptr: *const u8,
        line_len: usize,
        out_len: *mut usize,
    ) -> *mut u8;
    fn ieum_sheets_engine_free_response(ptr: *mut u8, len: usize);
    fn ieum_sheets_engine_free(engine: *mut c_void);
}

/// One engine instance (the desktop's sidecar process). Thread-safe: the
/// library serializes requests itself, as the sidecar's request loop does.
pub struct SheetsEngine {
    raw: NonNull<c_void>,
}

// SAFETY: the library's engine handle is safe to use from several threads at
// once (it holds its own locks) and to drop from any thread.
unsafe impl Send for SheetsEngine {}
unsafe impl Sync for SheetsEngine {}

impl SheetsEngine {
    /// An engine whose requests may only name paths inside `work_root`
    /// (`None`: no folder rule).
    pub fn new(work_root: Option<&Path>) -> io::Result<Self> {
        // SAFETY: takes no arguments.
        let abi = unsafe { ieum_sheets_engine_abi_version() };
        if abi != EXPECTED_ABI_VERSION {
            return Err(io::Error::other(format!(
                "sheets engine library ABI {abi}, expected {EXPECTED_ABI_VERSION}"
            )));
        }
        let root = match work_root {
            Some(root) => root
                .to_str()
                .ok_or_else(|| io::Error::other("sheets work folder is not valid UTF-8"))?,
            None => "",
        };
        // SAFETY: a valid byte slice for the duration of the call.
        let raw = unsafe { ieum_sheets_engine_new(root.as_ptr(), root.len()) };
        NonNull::new(raw)
            .map(|raw| Self { raw })
            .ok_or_else(|| io::Error::other("sheets engine library could not start"))
    }

    /// Answers one protocol line (the JSON object the desktop client writes
    /// to the sidecar's stdin) with the JSON text of the response (what the
    /// sidecar writes to stdout, without the newline). Engine failures,
    /// including a panic inside the engine, come back as `ok: false`
    /// responses. Blocks: call it off the async runtime.
    pub fn handle_line(&self, line: &str) -> String {
        let mut len = 0usize;
        // SAFETY: a live engine, a valid byte slice and a writable length.
        let ptr = unsafe {
            ieum_sheets_engine_handle_line(self.raw.as_ptr(), line.as_ptr(), line.len(), &mut len)
        };
        if ptr.is_null() {
            // Only for a null engine or length pointer, which cannot happen
            // here; answer in the protocol's shape rather than abort.
            return NO_ANSWER.to_owned();
        }
        take_answer(ptr, len)
    }

    /// Answers one password request (probe, decrypt, encrypt; see the
    /// library's `crypto.rs`) with its JSON answer text. Paths must lie inside
    /// the work folder. Blocks: call it off the async runtime.
    pub fn crypto_line(&self, line: &str) -> String {
        let mut len = 0usize;
        // SAFETY: a live engine, a valid byte slice and a writable length.
        let ptr = unsafe {
            ieum_sheets_engine_crypto_line(self.raw.as_ptr(), line.as_ptr(), line.len(), &mut len)
        };
        if ptr.is_null() {
            return NO_CRYPTO_ANSWER.to_owned();
        }
        take_answer(ptr, len)
    }
}

const NO_CRYPTO_ANSWER: &str = r#"{"ok":false,"error":{"code":"unsupported","message":"The spreadsheet engine could not process this request."}}"#;

/// Copies an answer the library handed out and frees it.
fn take_answer(ptr: *mut u8, len: usize) -> String {
    // SAFETY: the library returned `len` bytes at `ptr`; it is valid UTF-8
    // JSON text.
    let text = unsafe { std::slice::from_raw_parts(ptr, len) };
    let answer = String::from_utf8_lossy(text).into_owned();
    // SAFETY: the pair just returned, freed once.
    unsafe { ieum_sheets_engine_free_response(ptr, len) };
    answer
}

impl Drop for SheetsEngine {
    fn drop(&mut self) {
        // SAFETY: created by `new`, freed once; `&mut self` means no call is
        // still running on it.
        unsafe { ieum_sheets_engine_free(self.raw.as_ptr()) };
    }
}
