//! Track T6 (home) Tauri commands (spec 3.20). Arguments arrive under the camelCase names the
//! bridge wrappers in `@genoffice/mobile-bridge/home` send (`fileRef`, `folderId`, ...).

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::storage::{MobileDocSession, ThumbnailPayload};
use crate::storage::home::{
    AppInfo, ClearStorageKind, ClearStorageResult, CountFolderEntriesResult, DeleteFilesResult,
    FavoriteEntry, FavoriteGroup, FileRef, FileRefBytes, FolderEntry, HomeOkResult, HomeService,
    IncomingBatch, LinkedFolder, RecentMetaEntry, StorageUsage, UnlinkFolderResult,
};
use std::sync::Arc;
use tauri::State;

type Home<'a> = State<'a, Arc<HomeService>>;

/// Runs file and folder work off the IPC thread (native pickers and SAF calls block).
async fn blocking<T, F>(state: Home<'_>, op: F) -> MobileResult<T>
where
    T: Send + 'static,
    F: FnOnce(&HomeService) -> MobileResult<T> + Send + 'static,
{
    let svc = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || op(&svc))
        .await
        .map_err(|_| MobileError::new(MobileErrorCode::InternalError, "mobile.internalError"))?
        .map_err(scrub)
}

/// Drops the native detail text before an error reaches the WebView: Android and iOS refusal
/// messages often carry the document location, which spec 5.4 keeps out of the WebView. The
/// code and message key are all the screen uses.
fn scrub(e: MobileError) -> MobileError {
    MobileError::new(e.code, e.message_key)
}

#[tauri::command]
pub async fn mobile_home_list_folders(state: Home<'_>) -> MobileResult<Vec<LinkedFolder>> {
    blocking(state, |s| s.list_folders()).await
}

#[tauri::command]
pub async fn mobile_home_link_folder(
    state: Home<'_>,
    replace_id: Option<String>,
) -> MobileResult<LinkedFolder> {
    blocking(state, move |s| s.link_folder(replace_id.as_deref())).await
}

#[tauri::command]
pub async fn mobile_home_unlink_folder(
    state: Home<'_>,
    id: String,
) -> MobileResult<UnlinkFolderResult> {
    blocking(state, move |s| s.unlink_folder(&id)).await
}

#[tauri::command]
pub fn mobile_home_count_folder_entries(
    state: Home<'_>,
    id: String,
) -> MobileResult<CountFolderEntriesResult> {
    state.count_folder_entries(&id).map_err(scrub)
}

#[tauri::command]
pub async fn mobile_home_list_folder(
    state: Home<'_>,
    folder_id: String,
    path: Vec<String>,
) -> MobileResult<Vec<FolderEntry>> {
    blocking(state, move |s| s.list_folder(&folder_id, &path)).await
}

#[tauri::command]
pub async fn mobile_home_open_folder_entry(
    state: Home<'_>,
    folder_id: String,
    entry_id: String,
) -> MobileResult<MobileDocSession> {
    blocking(state, move |s| s.open_folder_entry(&folder_id, &entry_id)).await
}

/// Not in the spec 3.20 table: opens a favorite that has left the recent list.
#[tauri::command]
pub async fn mobile_home_open_favorite(
    state: Home<'_>,
    doc_key: String,
) -> MobileResult<MobileDocSession> {
    blocking(state, move |s| s.open_favorite(&doc_key)).await
}

#[tauri::command]
pub fn mobile_home_list_favorites(state: Home<'_>) -> MobileResult<Vec<FavoriteEntry>> {
    state.list_favorites().map_err(scrub)
}

#[tauri::command]
pub fn mobile_home_set_favorite(
    state: Home<'_>,
    file_ref: FileRef,
    on: bool,
) -> MobileResult<Vec<FavoriteEntry>> {
    state.set_favorite(&file_ref, on).map_err(scrub)
}

#[tauri::command]
pub fn mobile_home_list_groups(state: Home<'_>) -> MobileResult<Vec<FavoriteGroup>> {
    state.list_groups().map_err(scrub)
}

#[tauri::command]
pub fn mobile_home_save_group(
    state: Home<'_>,
    id: Option<String>,
    name: String,
) -> MobileResult<Vec<FavoriteGroup>> {
    state.save_group(id.as_deref(), &name).map_err(scrub)
}

#[tauri::command]
pub fn mobile_home_delete_group(state: Home<'_>, id: String) -> MobileResult<Vec<FavoriteGroup>> {
    state.delete_group(&id).map_err(scrub)
}

#[tauri::command]
pub fn mobile_home_move_to_group(
    state: Home<'_>,
    refs: Vec<FileRef>,
    group_id: Option<String>,
) -> MobileResult<Vec<FavoriteEntry>> {
    state
        .move_to_group(&refs, group_id.as_deref())
        .map_err(scrub)
}

#[tauri::command]
pub async fn mobile_home_rename(
    state: Home<'_>,
    file_ref: FileRef,
    new_base_name: String,
) -> MobileResult<FileRef> {
    blocking(state, move |s| s.rename(&file_ref, &new_base_name)).await
}

#[tauri::command]
pub async fn mobile_home_duplicate(
    state: Home<'_>,
    file_ref: FileRef,
    copy_suffix: String,
) -> MobileResult<Option<FileRef>> {
    blocking(state, move |s| s.duplicate(&file_ref, &copy_suffix)).await
}

#[tauri::command]
pub async fn mobile_home_delete(
    state: Home<'_>,
    refs: Vec<FileRef>,
) -> MobileResult<DeleteFilesResult> {
    blocking(state, move |s| s.delete(&refs)).await
}

#[tauri::command]
pub async fn mobile_home_share_files(
    state: Home<'_>,
    refs: Vec<FileRef>,
) -> MobileResult<HomeOkResult> {
    blocking(state, move |s| s.share_files(&refs)).await
}

#[tauri::command]
pub async fn mobile_home_read_bytes(
    state: Home<'_>,
    file_ref: FileRef,
) -> MobileResult<FileRefBytes> {
    blocking(state, move |s| s.read_bytes(&file_ref)).await
}

#[tauri::command]
pub fn mobile_home_recent_meta(state: Home<'_>) -> MobileResult<Vec<RecentMetaEntry>> {
    state.recent_meta().map_err(scrub)
}

#[tauri::command]
pub async fn mobile_home_take_incoming(state: Home<'_>) -> MobileResult<Option<IncomingBatch>> {
    blocking(state, |s| s.take_incoming()).await
}

#[tauri::command]
pub async fn mobile_home_open_incoming_entry(
    state: Home<'_>,
    batch_id: String,
    entry_id: String,
) -> MobileResult<MobileDocSession> {
    blocking(state, move |s| s.open_incoming_entry(&batch_id, &entry_id)).await
}

#[tauri::command]
pub fn mobile_home_open_sample(state: Home<'_>, lang: String) -> MobileResult<MobileDocSession> {
    state.open_sample(&lang).map_err(scrub)
}

#[tauri::command]
pub async fn mobile_home_storage_usage(state: Home<'_>) -> MobileResult<StorageUsage> {
    blocking(state, |s| s.storage_usage()).await
}

#[tauri::command]
pub async fn mobile_home_clear_storage(
    state: Home<'_>,
    kind: ClearStorageKind,
    keep_doc_key: Option<String>,
) -> MobileResult<ClearStorageResult> {
    blocking(state, move |s| {
        s.clear_storage(kind, keep_doc_key.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn mobile_home_app_info(state: Home<'_>) -> MobileResult<AppInfo> {
    blocking(state, |s| Ok(s.app_info())).await
}

#[tauri::command]
pub async fn mobile_home_keep_screen_on(state: Home<'_>, on: bool) -> MobileResult<HomeOkResult> {
    blocking(state, move |s| s.keep_screen_on(on)).await
}

#[tauri::command]
pub async fn mobile_home_open_external_url(
    state: Home<'_>,
    url: String,
) -> MobileResult<HomeOkResult> {
    blocking(state, move |s| s.open_external_url(&url)).await
}

#[tauri::command]
pub async fn mobile_home_get_thumbnail(
    state: Home<'_>,
    file_ref: FileRef,
    max_px: Option<u32>,
) -> MobileResult<ThumbnailPayload> {
    blocking(state, move |s| s.get_thumbnail(&file_ref, max_px)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_keeps_code_and_key_but_drops_the_native_detail() {
        let e = MobileError::with_detail(
            MobileErrorCode::PermissionDenied,
            "mobile.home.folderLost",
            "Permission Denial: content://com.android.externalstorage.documents/tree/primary%3ADocs",
        );
        let clean = scrub(e);
        assert_eq!(clean.code, MobileErrorCode::PermissionDenied);
        assert_eq!(clean.message_key, "mobile.home.folderLost");
        assert!(clean.detail.is_none());
        let json = serde_json::to_string(&clean).unwrap();
        assert!(!json.contains("content://"), "{json}");
    }
}
