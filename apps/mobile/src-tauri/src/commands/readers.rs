//! Track T5 (readers: epub, pptx) Tauri commands: per-document reading positions and the
//! device-wide reader settings, stored in `<app data>/readers/positions.json` (see `store`).
//!
//! Positions and settings arrive as raw JSON so a wrong shape comes back as the shared
//! `INVALID_ARGUMENT` error instead of Tauri's own argument-decoding message.
pub mod store;

use crate::error::MobileResult;
use serde::Serialize;
use serde_json::Value;
use store::{ReaderState, ReaderStore, now_ms, parse_position, parse_settings};
use tauri::State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ReadersOk {
    pub ok: bool,
}

const OK: ReadersOk = ReadersOk { ok: true };

#[tauri::command]
pub fn mobile_readers_get_state(
    state: State<'_, ReaderStore>,
    doc_key: String,
) -> MobileResult<ReaderState> {
    state.get_state(&doc_key)
}

#[tauri::command]
pub fn mobile_readers_set_position(
    state: State<'_, ReaderStore>,
    doc_key: String,
    position: Value,
) -> MobileResult<ReadersOk> {
    let position = parse_position(position)?;
    state.set_position(&doc_key, position, now_ms())?;
    Ok(OK)
}

#[tauri::command]
pub fn mobile_readers_set_settings(
    state: State<'_, ReaderStore>,
    settings: Value,
) -> MobileResult<ReadersOk> {
    let settings = parse_settings(settings)?;
    state.set_settings(settings)?;
    Ok(OK)
}
