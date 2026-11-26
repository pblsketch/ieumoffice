//! The work-folder rule shared by the engine library (request paths) and the
//! app crate (its temp-file commands, which include this file by path). Keep
//! it dependency-free: both crates compile it.

use std::path::{Component, Path};

/// The engine's answer (`invalid_request`) when a request names a path
/// outside the work folder. Mobile only: the desktop sidecar has no such rule.
pub const PATH_OUTSIDE_WORK_FOLDER: &str = "Path is outside the sheets work folder.";

/// True when `path` is an absolute path strictly inside `root`, with no `.`
/// or `..` steps, and still inside `root` after links are resolved: the path
/// itself when it exists, else its nearest existing folder (a save target
/// that does not exist yet must not sit behind a link that leaves `root`).
pub fn is_within(root: &Path, path: &Path) -> bool {
    if !path.is_absolute() || path == root || !path.starts_with(root) {
        return false;
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return false;
    }
    let Ok(resolved_root) = root.canonicalize() else {
        return false;
    };
    if let Ok(resolved) = path.canonicalize() {
        return resolved != resolved_root && resolved.starts_with(&resolved_root);
    }
    // A path that does not exist yet (a save target, a new content file):
    // the nearest folder above it that exists must resolve inside the root
    // (the root itself included); the steps below it were checked above.
    let mut ancestor = path.parent();
    while let Some(folder) = ancestor {
        if let Ok(resolved) = folder.canonicalize() {
            return resolved.starts_with(&resolved_root);
        }
        if folder == root {
            return false;
        }
        ancestor = folder.parent();
    }
    false
}
