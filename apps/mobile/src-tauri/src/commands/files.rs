use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::hwp::{HwpFixPayload, TabSpot};
use crate::storage::{
    HwpBackupEntry, MobileDocFormat, MobileDocSession, MobileFileService, MobileShareMode,
    ReadFileBytesResult, RecentDocEntry, RecoveryEntry, RestoreBackupResult, RestoreTarget,
    SaveFileBytesResult,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct OkResult {
    pub ok: bool,
}

async fn run_blocking_file_op<T, F>(op: F) -> MobileResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> MobileResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(op)
        .await
        .map_err(|e| MobileError::with_detail(MobileErrorCode::InternalError, "mobile.internalError", e.to_string()))?
}

#[tauri::command]
pub fn mobile_create_untitled_session(
    state: State<'_, Arc<MobileFileService>>,
    format: MobileDocFormat,
) -> MobileResult<MobileDocSession> {
    state.create_untitled_session(format)
}

#[tauri::command]
pub async fn mobile_pick_open_file(
    state: State<'_, Arc<MobileFileService>>,
    exts: Vec<String>,
) -> MobileResult<MobileDocSession> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || svc.pick_open_file(&exts)).await
}

#[tauri::command]
pub async fn mobile_open_recent_doc(
    state: State<'_, Arc<MobileFileService>>,
    id: String,
) -> MobileResult<MobileDocSession> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || svc.open_recent_doc(&id)).await
}

#[tauri::command]
pub fn mobile_consume_pending_open_intent(
    state: State<'_, Arc<MobileFileService>>,
) -> MobileResult<Option<MobileDocSession>> {
    state.consume_pending_open_intent()
}

#[tauri::command]
pub async fn mobile_read_file_bytes(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
) -> MobileResult<ReadFileBytesResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || svc.read_file_bytes(&session_id)).await
}

#[tauri::command]
pub async fn mobile_hwp_new_tabs(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
    bytes_base64: String,
    format: MobileDocFormat,
) -> MobileResult<Vec<TabSpot>> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || svc.hwp_new_tabs(&session_id, &bytes_base64, format)).await
}

#[tauri::command]
pub async fn mobile_save_file_bytes(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
    bytes_base64: String,
    hwp_fix: Option<HwpFixPayload>,
) -> MobileResult<SaveFileBytesResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || svc.save_file_bytes(&session_id, &bytes_base64, hwp_fix)).await
}

#[tauri::command]
pub async fn mobile_save_as_file_bytes(
    state: State<'_, Arc<MobileFileService>>,
    session_id: Option<String>,
    suggested_name: String,
    format: MobileDocFormat,
    bytes_base64: String,
    hwp_fix: Option<HwpFixPayload>,
) -> MobileResult<MobileDocSession> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || {
        svc.save_as_file_bytes(
            session_id.as_deref(),
            &suggested_name,
            format,
            &bytes_base64,
            hwp_fix,
        )
    })
    .await
}

#[tauri::command]
pub async fn mobile_share_file(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
    suggested_name: String,
    mode: MobileShareMode,
    bytes_base64: Option<String>,
) -> MobileResult<OkResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || {
        svc.share_file(&session_id, &suggested_name, mode, bytes_base64.as_deref())?;
        Ok(OkResult { ok: true })
    })
    .await
}

#[tauri::command]
pub fn mobile_list_recent_docs(
    state: State<'_, Arc<MobileFileService>>,
) -> MobileResult<Vec<RecentDocEntry>> {
    state.list_recent_docs()
}

#[tauri::command]
pub fn mobile_remove_recent_doc(
    state: State<'_, Arc<MobileFileService>>,
    id: String,
) -> MobileResult<OkResult> {
    state.remove_recent_doc(&id)?;
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn mobile_recovery_write(
    state: State<'_, Arc<MobileFileService>>,
    doc_key: String,
    format: MobileDocFormat,
    title: String,
    bytes_base64: String,
) -> MobileResult<OkResult> {
    state.recovery_write(&doc_key, format, &title, &bytes_base64)?;
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn mobile_recovery_list(
    state: State<'_, Arc<MobileFileService>>,
) -> MobileResult<Vec<RecoveryEntry>> {
    state.recovery_list()
}

#[tauri::command]
pub fn mobile_recovery_read(
    state: State<'_, Arc<MobileFileService>>,
    doc_key: String,
) -> MobileResult<String> {
    state.recovery_read(&doc_key)
}

#[tauri::command]
pub fn mobile_recovery_discard(
    state: State<'_, Arc<MobileFileService>>,
    doc_key: String,
) -> MobileResult<OkResult> {
    state.recovery_discard(&doc_key)?;
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn mobile_hwp_backup_list(
    state: State<'_, Arc<MobileFileService>>,
) -> MobileResult<Vec<HwpBackupEntry>> {
    state.hwp_backup_list()
}

#[tauri::command]
pub async fn mobile_hwp_backup_restore(
    state: State<'_, Arc<MobileFileService>>,
    backup_id: String,
    target: RestoreTarget,
) -> MobileResult<RestoreBackupResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || svc.hwp_backup_restore(&backup_id, target)).await
}

#[tauri::command]
pub fn mobile_hwp_backup_delete(
    state: State<'_, Arc<MobileFileService>>,
    backup_id: String,
) -> MobileResult<OkResult> {
    state.hwp_backup_delete(&backup_id)?;
    Ok(OkResult { ok: true })
}
