//! In-process mirror of the engine executable's request dispatch.
//!
//! Source: `apps/sheets/native/xlsx-engine/src/main.rs` (`Command`, `Request`,
//! `Response`, `CancelledRequests`, `InFlightRequest`, `handle_request`). That
//! file cannot be reused as is (its output is bound to stdout and it is a
//! binary, not part of the library), so this module rebuilds the same dispatch
//! on top of the library's public functions. Keep it 1:1 with the original:
//! same command order, field names, response shape and error sentences, so an
//! upstream command addition can be followed by adding the same arm here.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use xlsx_sidecar::archive::{
    EntryContent, StreamPatchEntry, archive_manifest, read_entries_to_dir, save_archive,
    scan_entries_for_text,
};
use xlsx_sidecar::find::FindCellsRequest;
use xlsx_sidecar::recalc::{RecalcEdit, RecalcRead};
use xlsx_sidecar::{CellRange, SidecarError, WorkbookSessions};

use super::recalc_worker::{RecalcJob, RecalcWorker};

pub const PROTOCOL_VERSION: u8 = 1;

fn default_locale() -> String {
    "zh".to_owned()
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub(crate) enum Command {
    Open {
        path: PathBuf,
        #[serde(default = "default_locale")]
        locale: String,
        #[serde(default, rename = "shortDateFormat")]
        short_date_format: Option<String>,
    },
    ReadRange {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
        range: CellRange,
    },
    Close {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    ReadMedia {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "visualId")]
        visual_id: String,
    },
    ReadFormulaCells {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
    },
    FindCells(FindCellsRequest),
    ReadRowOutline {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
    },
    Cancel {
        #[serde(rename = "targetRequestId")]
        target_request_id: String,
    },
    #[serde(rename_all = "camelCase")]
    ArchiveManifest {
        path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ReadEntries {
        path: PathBuf,
        entries: Vec<String>,
        output_dir: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ScanEntries {
        path: PathBuf,
        entries: Vec<String>,
        needle: String,
    },
    #[serde(rename_all = "camelCase")]
    ConvertWorkbook {
        path: PathBuf,
        target_path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ConvertToOds {
        path: PathBuf,
        target_path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    SaveArchive {
        source_path: PathBuf,
        target_path: PathBuf,
        replacements: Vec<EntryContent>,
        removals: Vec<String>,
        additions: Vec<EntryContent>,
        #[serde(default)]
        stream_patches: Vec<StreamPatchEntry>,
    },
    #[serde(rename_all = "camelCase")]
    RecalcCells {
        path: PathBuf,
        #[serde(default)]
        edits: Vec<RecalcEdit>,
        #[serde(default)]
        reads: Vec<RecalcRead>,
        #[serde(default)]
        report_stale: bool,
    },
    #[serde(rename_all = "camelCase")]
    UpdateExternalLinks {
        path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ReadExternalLinks {
        path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ListExternalLinks {
        path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ReadExternalLinkUsage {
        path: PathBuf,
    },
}

impl Command {
    /// Every file or folder path the command names (mobile only: the app
    /// checks them against its work folder before the engine touches them).
    pub(crate) fn paths(&self) -> Vec<&Path> {
        match self {
            Self::Open { path, .. }
            | Self::ArchiveManifest { path }
            | Self::ScanEntries { path, .. }
            | Self::RecalcCells { path, .. }
            | Self::UpdateExternalLinks { path }
            | Self::ReadExternalLinks { path }
            | Self::ListExternalLinks { path }
            | Self::ReadExternalLinkUsage { path } => vec![path.as_path()],
            Self::ReadEntries {
                path, output_dir, ..
            } => vec![path.as_path(), output_dir.as_path()],
            Self::ConvertWorkbook { path, target_path }
            | Self::ConvertToOds { path, target_path } => {
                vec![path.as_path(), target_path.as_path()]
            }
            Self::SaveArchive {
                source_path,
                target_path,
                replacements,
                additions,
                stream_patches,
                ..
            } => {
                let mut paths = vec![source_path.as_path(), target_path.as_path()];
                paths.extend(
                    replacements
                        .iter()
                        .map(|entry| entry.content_path.as_path()),
                );
                paths.extend(additions.iter().map(|entry| entry.content_path.as_path()));
                paths.extend(
                    stream_patches
                        .iter()
                        .map(|entry| entry.patch_path.as_path()),
                );
                paths
            }
            Self::ReadRange { .. }
            | Self::Close { .. }
            | Self::ReadMedia { .. }
            | Self::ReadFormulaCells { .. }
            | Self::FindCells(_)
            | Self::ReadRowOutline { .. }
            | Self::Cancel { .. } => Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    pub(crate) version: u8,
    pub(crate) request_id: String,
    #[serde(flatten)]
    pub(crate) command: Command,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub version: u8,
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
}

/// Request ids cancelled before their turn came. Same cap and
/// forget-oldest-on-overflow rule as the desktop sidecar.
#[derive(Clone)]
pub(crate) struct CancelledRequests(Arc<Mutex<VecDeque<String>>>);

const MAX_CANCELLED_REQUESTS: usize = 256;

impl CancelledRequests {
    pub(crate) fn new() -> Self {
        Self(Arc::new(Mutex::new(VecDeque::new())))
    }

    pub(crate) fn insert(&self, request_id: String) {
        let mut ids = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if ids.len() >= MAX_CANCELLED_REQUESTS {
            ids.pop_front();
        }
        ids.push_back(request_id);
    }

    pub(crate) fn take(&self, request_id: &str) -> bool {
        let mut ids = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match ids.iter().position(|id| id == request_id) {
            Some(index) => {
                ids.remove(index);
                true
            }
            None => false,
        }
    }
}

/// The request currently executing and the flag a cancel sets to reach it
/// (`open` and `find_cells` poll it at stage boundaries).
#[derive(Clone)]
pub(crate) struct InFlightRequest(Arc<InFlightState>);

struct InFlightState {
    id: Mutex<String>,
    cancelled: Arc<AtomicBool>,
}

impl InFlightRequest {
    pub(crate) fn new() -> Self {
        Self(Arc::new(InFlightState {
            id: Mutex::new(String::new()),
            cancelled: Arc::new(AtomicBool::new(false)),
        }))
    }

    pub(crate) fn begin(&self, request_id: &str) {
        *self
            .0
            .id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = request_id.to_owned();
        self.0.cancelled.store(false, Ordering::Release);
    }

    pub(crate) fn cancel(&self, target_request_id: &str) {
        let id = self
            .0
            .id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *id == target_request_id {
            self.0.cancelled.store(true, Ordering::Release);
        }
    }

    pub(crate) fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.0.cancelled)
    }
}

/// What the request loop hands back: a finished response, or a recalculation
/// that already holds the busy flag and must run after the loop lets go
/// (the desktop sidecar runs it on its `xlsx-recalc` thread instead).
pub(crate) enum Dispatched {
    Done(Response),
    Recalc(RecalcJob),
}

/// Mobile-only hook run after the protocol checks: rejects requests whose
/// paths fall outside the app's work folder.
pub(crate) type PathCheck<'a> = &'a dyn Fn(&Command) -> Result<(), SidecarError>;

pub(crate) fn handle_request(
    request: Request,
    sessions: &mut WorkbookSessions,
    recalc: &RecalcWorker,
    cancelled: &CancelledRequests,
    in_flight: &InFlightRequest,
    path_check: PathCheck<'_>,
) -> Dispatched {
    if cancelled.take(&request.request_id) {
        return Dispatched::Done(Response::failure(
            request.request_id,
            "cancelled",
            "Request was cancelled by the client.".into(),
        ));
    }
    if request.version != PROTOCOL_VERSION {
        return Dispatched::Done(Response::failure(
            request.request_id,
            "unsupported_version",
            "Unsupported sidecar protocol version.".into(),
        ));
    }
    if let Err(error) = path_check(&request.command) {
        return Dispatched::Done(Response::from_error(request.request_id, error));
    }

    let request_id = request.request_id;
    let result = match request.command {
        Command::Open {
            path,
            locale,
            short_date_format,
        } => {
            let in_flight_cancelled = in_flight.flag();
            sessions
                .open_with_locale(
                    &path,
                    &locale,
                    short_date_format.as_deref(),
                    &in_flight_cancelled,
                )
                .and_then(to_json_value)
        }
        Command::ReadRange {
            session_id,
            sheet_id,
            range,
        } => sessions
            .read_range(&session_id, &sheet_id, &range)
            .and_then(to_json_value),
        Command::Close { session_id } => {
            if let Some(path) = sessions.session_path(&session_id) {
                recalc.purge_now_or_queue(&path);
            }
            sessions
                .close(&session_id)
                .and_then(|()| to_json_value(serde_json::json!({ "closed": true })))
        }
        Command::ReadMedia {
            session_id,
            visual_id,
        } => sessions
            .read_media(&session_id, &visual_id)
            .and_then(to_json_value),
        Command::ReadFormulaCells {
            session_id,
            sheet_id,
        } => sessions
            .read_formula_cells(&session_id, &sheet_id)
            .and_then(to_json_value),
        Command::FindCells(request) => sessions
            .find_cells(&request, &in_flight.flag())
            .and_then(to_json_value),
        Command::ReadRowOutline {
            session_id,
            sheet_id,
        } => sessions
            .read_row_outline(&session_id, &sheet_id)
            .and_then(to_json_value),
        // Normally handled before the loop (see `SheetsEngine::handle_line`);
        // through this path it still marks the target for the skip check above.
        Command::Cancel { target_request_id } => {
            cancelled.insert(target_request_id);
            to_json_value(serde_json::json!({ "cancelled": true }))
        }
        Command::ConvertWorkbook { path, target_path } => {
            xlsx_sidecar::convert::convert_to_xlsx(&path, &target_path).and_then(|result| {
                to_json_value(serde_json::json!({
                    "sheets": result.sheets,
                    "cells": result.cells,
                    "formulasDropped": result.formulas_dropped,
                }))
            })
        }
        Command::ConvertToOds { path, target_path } => {
            xlsx_sidecar::ods_export::convert_to_ods(&path, &target_path).and_then(to_json_value)
        }
        Command::ArchiveManifest { path } => archive_manifest(&path)
            .and_then(|entries| to_json_value(serde_json::json!({ "entries": entries }))),
        Command::ReadEntries {
            path,
            entries,
            output_dir,
        } => read_entries_to_dir(&path, &entries, &output_dir)
            .and_then(|extracted| to_json_value(serde_json::json!({ "entries": extracted }))),
        Command::ScanEntries {
            path,
            entries,
            needle,
        } => scan_entries_for_text(&path, &entries, &needle)
            .and_then(|matches| to_json_value(serde_json::json!({ "matches": matches }))),
        Command::SaveArchive {
            source_path,
            target_path,
            replacements,
            removals,
            additions,
            stream_patches,
        } => {
            // Only the target's resident formula model goes stale; the source
            // is read, so its warm model stays (same rule as the desktop).
            recalc.queue_purge(&target_path);
            save_archive(
                &source_path,
                &target_path,
                &replacements,
                &removals,
                &additions,
                &stream_patches,
            )
            .and_then(to_json_value)
        }
        Command::RecalcCells {
            path,
            edits,
            reads,
            report_stale,
        } => {
            return match recalc.dispatch(request_id, path, edits, reads, report_stale) {
                Ok(job) => Dispatched::Recalc(job),
                Err(busy) => Dispatched::Done(busy),
            };
        }
        Command::UpdateExternalLinks { path } => {
            xlsx_sidecar::external_links::update_external_link_values(&path).and_then(to_json_value)
        }
        Command::ReadExternalLinks { path } => {
            xlsx_sidecar::external_links::read_external_link_statuses(&path).and_then(to_json_value)
        }
        Command::ListExternalLinks { path } => {
            xlsx_sidecar::external_links::list_external_link_statuses(&path).and_then(to_json_value)
        }
        Command::ReadExternalLinkUsage { path } => {
            xlsx_sidecar::external_links::read_external_link_usage(&path)
                .and_then(|links| to_json_value(serde_json::json!({ "links": links })))
        }
    };
    Dispatched::Done(match result {
        Ok(value) => Response::success(request_id, value),
        Err(error) => Response::from_error(request_id, error),
    })
}

pub(crate) fn to_json_value<T: Serialize>(value: T) -> Result<Value, SidecarError> {
    serde_json::to_value(value).map_err(SidecarError::from)
}

impl Response {
    pub(crate) fn success(request_id: String, result: Value) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub(crate) fn from_error(request_id: String, error: SidecarError) -> Self {
        let code = match error {
            SidecarError::InvalidRequest(_) => "invalid_request",
            SidecarError::Io(_) => "io_error",
            SidecarError::Workbook(_) => "workbook_error",
            SidecarError::Cancelled => "cancelled",
        };
        Self::failure(request_id, code, error.to_string())
    }

    pub(crate) fn failure(request_id: String, code: &'static str, message: String) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            ok: false,
            result: None,
            error: Some(ErrorBody { code, message }),
        }
    }
}
