use crate::error::{MobileError, MobileErrorCode, MobileResult};
use crate::hwp::{HwpFixPayload, TabSpot};
use crate::storage::{
    HwpBackupEntry, MobileDocFormat, MobileDocSession, MobileFileService, MobileShareMode,
    PdfStageTarget, ReadFileBytesResult, RecentDocEntry, RecoveryEntry, RestoreBackupResult,
    RestoreTarget, SaveFileBytesResult,
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

#[tauri::command]
pub fn mobile_set_openable_formats(
    state: State<'_, Arc<MobileFileService>>,
    exts: Vec<String>,
) -> MobileResult<OkResult> {
    state.set_openable_formats(&exts);
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn mobile_commit_session(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
) -> MobileResult<OkResult> {
    state.commit_session(&session_id);
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn mobile_discard_session(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
) -> MobileResult<OkResult> {
    state.discard_session(&session_id);
    Ok(OkResult { ok: true })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintStageBeginResult {
    pub stage_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintStageAppendResult {
    pub written: usize,
}

#[tauri::command]
pub async fn mobile_print_stage_begin(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
    suggested_name: String,
    target: PdfStageTarget,
    expected_bytes: Option<usize>,
) -> MobileResult<PrintStageBeginResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || {
        let stage_id = svc.print_stage_begin(&session_id, &suggested_name, target, expected_bytes)?;
        Ok(PrintStageBeginResult { stage_id })
    })
    .await
}

#[tauri::command]
pub async fn mobile_print_stage_append(
    state: State<'_, Arc<MobileFileService>>,
    stage_id: String,
    chunk_base64: String,
) -> MobileResult<PrintStageAppendResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || {
        let written = svc.print_stage_append(&stage_id, &chunk_base64)?;
        Ok(PrintStageAppendResult { written })
    })
    .await
}

#[tauri::command]
pub async fn mobile_print_stage_finish(
    state: State<'_, Arc<MobileFileService>>,
    stage_id: String,
    session_id: String,
) -> MobileResult<OkResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || {
        svc.print_stage_finish(&stage_id, &session_id)?;
        Ok(OkResult { ok: true })
    })
    .await
}

#[tauri::command]
pub fn mobile_print_stage_abort(
    state: State<'_, Arc<MobileFileService>>,
    stage_id: String,
) -> MobileResult<OkResult> {
    state.print_stage_abort(&stage_id);
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub async fn mobile_print_session_pdf(
    state: State<'_, Arc<MobileFileService>>,
    session_id: String,
) -> MobileResult<OkResult> {
    let svc = state.inner().clone();
    run_blocking_file_op(move || {
        svc.print_session_pdf(&session_id)?;
        Ok(OkResult { ok: true })
    })
    .await
}
