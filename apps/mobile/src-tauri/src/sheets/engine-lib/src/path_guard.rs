//! The work-folder rule shared by the engine library (request paths) and the
//! app crate (its temp-file commands, which include this file by path). Keep
//! it dependency-free: both crates compile it.

use std::path::{Component, Path};

/// The engine's answer (`invalid_request`) when a request names a path
/// outside the work folder. Mobile only: the desktop sidecar has no such rule.
pub const PATH_OUTSIDE_WORK_FOLDER: &str = "Path is outside the sheets work folder.";

/// True when `path` is an absolute path strictly inside `root`, with no `.`
/// or `..` steps, and (when it already exists) still inside `root` after
/// symlinks are resolved.
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
    match (path.canonicalize(), root.canonicalize()) {
        (Ok(resolved), Ok(resolved_root)) => {
            resolved != resolved_root && resolved.starts_with(&resolved_root)
        }
        // A path that does not exist yet (a save target, a new content file):
        // its lexical position was checked above.
        (Err(_), _) => true,
        (Ok(_), Err(_)) => false,
    }
}
