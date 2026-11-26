//! Disk usage and clearing for the storage settings (track T6). Symbolic links are neither
//! followed nor counted.

use std::fs;
use std::path::Path;
use std::time::SystemTime;

/// Total size of the regular files under `path` (0 when it does not exist).
pub(crate) fn tree_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    let Ok(read) = fs::read_dir(path) else {
        return 0;
    };
    read.flatten().map(|item| tree_size(&item.path())).sum()
}

/// Deletes the regular files under `root` last modified before `cutoff` (files changed later
/// may be in use), then the sub folders left empty. `root` itself stays. Returns the bytes freed.
pub(crate) fn clear_tree_older_than(root: &Path, cutoff: SystemTime) -> u64 {
    let Ok(read) = fs::read_dir(root) else {
        return 0;
    };
    let mut freed = 0;
    for item in read.flatten() {
        let path = item.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            freed += clear_tree_older_than(&path, cutoff);
            // A folder made in this run may be about to receive files; older ones go once
            // empty (`remove_dir` fails while anything is left inside).
            if meta.modified().is_ok_and(|m| m < cutoff) {
                let _ = fs::remove_dir(&path);
            }
        } else if meta.is_file()
            && meta.modified().is_ok_and(|m| m < cutoff)
            && fs::remove_file(&path).is_ok()
        {
            freed += meta.len();
        }
    }
    freed
}
