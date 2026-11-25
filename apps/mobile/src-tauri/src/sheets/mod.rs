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
pub use workspace::{SheetsWorkspace, WORK_DIR_NAME};

/// Managed Tauri state for track T1.
pub struct SheetsState {
    pub engine: SheetsEngine,
    pub workspace: SheetsWorkspace,
}

impl SheetsState {
    /// Builds the state on `cache_dir` (the app cache directory): the work
    /// folder lives at `<cache_dir>/ieum-sheets` and is emptied, since no
    /// workbook can be open yet when the app starts.
    pub fn new(cache_dir: &Path) -> std::io::Result<Self> {
        let workspace = SheetsWorkspace::new(cache_dir.join(WORK_DIR_NAME))?;
        workspace
            .clear()
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let engine = SheetsEngine::new(Some(workspace.root()))?;
        Ok(Self { engine, workspace })
    }

    /// Setup-time constructor: resolves the app cache directory, points the
    /// process temp directory at it on Android, and builds the state.
    pub fn for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::io::Result<Arc<Self>> {
        use tauri::Manager;
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("ieumoffice-mobile-cache"));
        std::fs::create_dir_all(&cache_dir)?;
        use_as_temp_dir(&cache_dir);
        Ok(Arc::new(Self::new(&cache_dir)?))
    }
}

/// The engine keeps each open workbook's session cache under
/// `std::env::temp_dir()` (the library's own std reads the same process
/// environment). On Android that falls back to `/data/local/tmp`, which an
/// app cannot write, so the app cache directory takes its place. iOS already
/// gives the app a writable sandbox `TMPDIR`.
#[cfg(target_os = "android")]
fn use_as_temp_dir(cache_dir: &Path) {
    // SAFETY: called once from the Tauri `setup` hook on the main thread,
    // before the WebView can invoke any command (so before any engine call or
    // other app code that could read the environment runs on another thread).
    // The runtime's idle worker threads do not touch the environment.
    unsafe {
        std::env::set_var("TMPDIR", cache_dir);
    }
}

#[cfg(not(target_os = "android"))]
fn use_as_temp_dir(_cache_dir: &Path) {}
