//! Track T1 (sheets): the spreadsheet engine (`xlsx_sidecar`) behind a C ABI.
//!
//! On the desktop the engine runs as a child process that reads one JSON
//! request per stdin line and writes one JSON response per stdout line. The
//! phone starts no process: the app hands the same request line to
//! [`ieum_sheets_engine_handle_line`] and gets back the same response line,
//! with the same command names, fields, response shape, error sentences and
//! protocol version (see `dispatch.rs`).
//!
//! This crate is built on its own (own workspace and lock file) and linked
//! into the app as a native library, so its dependency features never unify
//! with the app's crates. It is built with `panic = "unwind"`: a panic inside
//! the engine is caught at this boundary and only that request fails, while
//! the app itself keeps `panic = "abort"`.
//!
//! # ABI
//!
//! - [`ieum_sheets_engine_abi_version`] — [`ABI_VERSION`]; the app refuses a
//!   library that answers anything else.
//! - [`ieum_sheets_engine_new`] — an engine whose requests may only name paths
//!   inside the given work folder (UTF-8 bytes; length 0 means no folder
//!   rule). Null when the folder is not valid UTF-8 or setup panicked.
//! - [`ieum_sheets_engine_handle_line`] — answers one request line. Never
//!   null for a non-null engine; the caller frees the answer with
//!   [`ieum_sheets_engine_free_response`]. Thread-safe: calls may overlap.
//! - [`ieum_sheets_engine_free`] — drops the engine.
//!
//! No panic ever crosses these functions.

mod dispatch;
mod engine;
pub mod path_guard;
mod recalc_worker;

#[cfg(test)]
mod tests;

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;

pub use dispatch::{ErrorBody, PROTOCOL_VERSION, Response};
pub use engine::SheetsEngine;
pub use path_guard::PATH_OUTSIDE_WORK_FOLDER;

/// Bumped whenever a signature below changes.
pub const ABI_VERSION: u32 = 1;

/// The answer to a request whose handling panicked. Same code family and
/// sentence style as the engine's own `workbook_error` for an IronCalc
/// import panic ("The formula engine could not process this workbook.").
pub const PANIC_MESSAGE: &str = "The spreadsheet engine could not process this request.";

/// Debug builds only (feature `test-panic`): a request with this command
/// panics inside the engine, so device tests can show the app survives.
#[cfg(any(test, feature = "test-panic"))]
pub const TEST_PANIC_COMMAND: &str = "__ieum_test_panic";

/// Opaque handle the app holds.
pub struct IeumSheetsEngine(SheetsEngine);

/// The request id of a line, read leniently (for answering a panicked one).
fn request_id_of(line: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Id {
        #[serde(rename = "requestId", default)]
        request_id: Option<String>,
    }
    serde_json::from_str::<Id>(line)
        .ok()
        .and_then(|id| id.request_id)
        .unwrap_or_default()
}

#[cfg(any(test, feature = "test-panic"))]
fn panic_if_requested(line: &str) {
    let command = serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|value| value.get("command")?.as_str().map(str::to_owned));
    if command.as_deref() == Some(TEST_PANIC_COMMAND) {
        panic!("test panic requested");
    }
}

/// Answers one line as JSON text, turning a panic into an error response.
pub fn answer_line(engine: &SheetsEngine, line: &str) -> String {
    let answered = catch_unwind(AssertUnwindSafe(|| {
        #[cfg(any(test, feature = "test-panic"))]
        panic_if_requested(line);
        serde_json::to_string(&engine.handle_line(line))
    }));
    match answered {
        Ok(Ok(text)) => text,
        // Serializing a `Response` cannot fail in practice; answer in the
        // protocol's shape anyway.
        Ok(Err(_)) | Err(_) => {
            let request_id = catch_unwind(|| request_id_of(line)).unwrap_or_default();
            let response = Response::failure(request_id, "workbook_error", PANIC_MESSAGE.into());
            serde_json::to_string(&response).unwrap_or_else(|_| {
                format!(
                    r#"{{"version":{PROTOCOL_VERSION},"requestId":"","ok":false,"error":{{"code":"workbook_error","message":"{PANIC_MESSAGE}"}}}}"#
                )
            })
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ieum_sheets_engine_abi_version() -> u32 {
    ABI_VERSION
}

/// # Safety
/// `work_root_ptr` must point to `work_root_len` readable bytes (it may be
/// null when the length is 0).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ieum_sheets_engine_new(
    work_root_ptr: *const u8,
    work_root_len: usize,
) -> *mut IeumSheetsEngine {
    catch_unwind(|| {
        let work_root = if work_root_len == 0 || work_root_ptr.is_null() {
            None
        } else {
            // SAFETY: the caller guarantees the pointer and length.
            let bytes = unsafe { std::slice::from_raw_parts(work_root_ptr, work_root_len) };
            Some(PathBuf::from(std::str::from_utf8(bytes).ok()?))
        };
        Some(Box::into_raw(Box::new(IeumSheetsEngine(
            SheetsEngine::new(work_root),
        ))))
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `engine` must come from [`ieum_sheets_engine_new`] and not be freed yet;
/// `line_ptr` must point to `line_len` readable bytes; `out_len` must be
/// writable. The returned buffer belongs to the caller until it is passed to
/// [`ieum_sheets_engine_free_response`] with the length written to `out_len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ieum_sheets_engine_handle_line(
    engine: *const IeumSheetsEngine,
    line_ptr: *const u8,
    line_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    if engine.is_null() || out_len.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: the caller guarantees a live engine.
    let engine = unsafe { &(*engine).0 };
    let bytes: &[u8] = if line_ptr.is_null() || line_len == 0 {
        &[]
    } else {
        // SAFETY: the caller guarantees the pointer and length.
        unsafe { std::slice::from_raw_parts(line_ptr, line_len) }
    };
    // A line that is not UTF-8 is not JSON either; the engine answers it
    // with `invalid_json` like the desktop reader does.
    let line = String::from_utf8_lossy(bytes);
    let answer = answer_line(engine, &line).into_bytes().into_boxed_slice();
    // SAFETY: checked non-null above.
    unsafe { *out_len = answer.len() };
    Box::into_raw(answer).cast::<u8>()
}

/// # Safety
/// `ptr` and `len` must be a pair returned by
/// [`ieum_sheets_engine_handle_line`], freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ieum_sheets_engine_free_response(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: rebuilds the boxed slice handed out above.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
}

/// # Safety
/// `engine` must come from [`ieum_sheets_engine_new`], freed once, with no
/// call still running on it.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ieum_sheets_engine_free(engine: *mut IeumSheetsEngine) {
    if engine.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: the caller hands back the box created above.
        drop(unsafe { Box::from_raw(engine) });
    }));
}
