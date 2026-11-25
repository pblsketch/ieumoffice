//! Track T1 (sheets): the spreadsheet engine (`xlsx_sidecar`) called in-process.
//!
//! On the desktop the engine runs as a child process that reads one JSON
//! request per stdin line and writes one JSON response per stdout line. The
//! phone starts no process: it passes the same request line to
//! [`SheetsEngine::handle_line`] and gets the same response line back, with
//! the same command names, fields, response shape, error sentences and
//! protocol version.
//!
//! The engine itself lives in `engine-lib/`, a separate crate built in its own
//! cargo workspace by `build.rs` and linked as a native library (see
//! `engine_build.rs`). Two reasons: its dependency features must not unify
//! with this crate's (the engine's zip 9 would switch flate2 to zlib-rs for the
//! whole app and change HWP/HWPX saved bytes), and it must unwind (this app's
//! release profile aborts on panic; the library catches a panic at its C
//! boundary and answers only that request with an error). This module only
//! sees the C ABI (`engine.rs`).

mod engine;
#[cfg_attr(not(test), allow(dead_code))]
#[path = "engine-lib/src/path_guard.rs"]
mod path_guard;
pub mod workspace;

#[cfg(test)]
mod tests;

use std::path::Path;
use std::sync::Arc;

pub use engine::SheetsEngine;
pub use workspace::{ENGINE_DIR_NAME, SheetsWorkspace, TEMP_ROOT_NAME, WORK_DIR_NAME};

/// Managed Tauri state for track T1.
pub struct SheetsState {
    pub engine: SheetsEngine,
    pub workspace: SheetsWorkspace,
}

impl SheetsState {
    /// Builds the state on `cache_dir` (the app cache directory): the work
    /// folder lives at `<cache_dir>/ieum-tmp/sheets` and is emptied, engine
    /// session caches included, since no workbook can be open yet when the
    /// app starts.
    pub fn new(cache_dir: &Path) -> std::io::Result<Self> {
        let workspace = SheetsWorkspace::for_cache_dir(cache_dir)?;
        workspace
            .clear_all()
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let engine = SheetsEngine::new(Some(workspace.root()))?;
        Ok(Self { engine, workspace })
    }

    /// Setup-time constructor: resolves the app cache directory, builds the
    /// state, and on Android points the process temp directory at the
    /// engine's temp directory inside the work folder.
    pub fn for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::io::Result<Arc<Self>> {
        use tauri::Manager;
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("ieumoffice-mobile-cache"));
        std::fs::create_dir_all(&cache_dir)?;
        let state = Self::new(&cache_dir)?;
        use_as_temp_dir(state.workspace.engine_temp_dir());
        Ok(Arc::new(state))
    }
}

/// The engine keeps each open workbook's session cache under
/// `std::env::temp_dir()` (the library's own std reads the same process
/// environment). On Android that falls back to `/data/local/tmp`, which an
/// app cannot write, so the engine's folder under `ieum-tmp/sheets/` takes
/// its place (counted and cleared with the app's other temp files). iOS
/// already gives the app a writable sandbox `TMPDIR`, which is left alone:
/// it is process-wide and WebKit uses it too.
#[cfg(target_os = "android")]
fn use_as_temp_dir(engine_dir: &Path) {
    // SAFETY: called once from the Tauri `setup` hook on the main thread,
    // before the WebView can invoke any command (so before any engine call or
    // other app code that could read the environment runs on another thread).
    // The runtime's idle worker threads do not touch the environment.
    unsafe {
        std::env::set_var("TMPDIR", engine_dir);
    }
}

#[cfg(not(target_os = "android"))]
fn use_as_temp_dir(_engine_dir: &Path) {}
