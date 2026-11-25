//! The in-process stand-in for the desktop sidecar process.
//!
//! The desktop sidecar has a reader thread (parses lines, answers `cancel`
//! out of band) and a request loop (runs everything else one at a time in
//! arrival order). Here each call to [`SheetsEngine::handle_line`] plays the
//! reader's part on the calling thread, then queues on the request-loop lock.
//! Callers wait on that lock in place of the desktop's bounded queue, so a
//! cancel for a request still waiting is caught by `CancelledRequests` and one
//! for the running `open`/`find_cells` trips the in-flight flag, as before.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use xlsx_sidecar::{SidecarError, WorkbookSessions};

use crate::dispatch::{
    CancelledRequests, Command, Dispatched, InFlightRequest, PROTOCOL_VERSION, Request, Response,
    handle_request,
};
use crate::path_guard::{PATH_OUTSIDE_WORK_FOLDER, is_within};
use crate::recalc_worker::RecalcWorker;

pub struct SheetsEngine {
    sessions: Mutex<WorkbookSessions>,
    pub(crate) recalc: RecalcWorker,
    cancelled: CancelledRequests,
    in_flight: InFlightRequest,
    /// When set, every path a request names must lie inside this folder.
    work_root: Option<PathBuf>,
}

impl SheetsEngine {
    pub fn new(work_root: Option<PathBuf>) -> Self {
        Self {
            sessions: Mutex::new(WorkbookSessions::new()),
            recalc: RecalcWorker::new(),
            cancelled: CancelledRequests::new(),
            in_flight: InFlightRequest::new(),
            work_root,
        }
    }

    /// Answers one protocol line (the JSON object the desktop client writes
    /// to the sidecar's stdin). Blocks: call it off the async runtime.
    pub fn handle_line(&self, line: &str) -> Response {
        let request: Request = match serde_json::from_str(line) {
            Ok(request) => request,
            Err(error) => {
                return Response::failure(
                    String::new(),
                    "invalid_json",
                    format!("Invalid sidecar request: {error}"),
                );
            }
        };
        if let Command::Cancel { target_request_id } = &request.command {
            return if request.version == PROTOCOL_VERSION {
                self.cancelled.insert(target_request_id.clone());
                self.in_flight.cancel(target_request_id);
                Response::success(request.request_id, serde_json::json!({ "cancelled": true }))
            } else {
                Response::failure(
                    request.request_id,
                    "unsupported_version",
                    "Unsupported sidecar protocol version.".into(),
                )
            };
        }
        let dispatched = {
            let mut sessions = self
                .sessions
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            self.in_flight.begin(&request.request_id);
            handle_request(
                request,
                &mut sessions,
                &self.recalc,
                &self.cancelled,
                &self.in_flight,
                &|command| self.check_paths(command),
            )
        };
        match dispatched {
            Dispatched::Done(response) => response,
            Dispatched::Recalc(job) => job.run(),
        }
    }

    fn check_paths(&self, command: &Command) -> Result<(), SidecarError> {
        let Some(root) = self.work_root.as_deref() else {
            return Ok(());
        };
        if command
            .paths()
            .into_iter()
            .all(|path| is_within(root, path))
        {
            Ok(())
        } else {
            Err(SidecarError::InvalidRequest(
                PATH_OUTSIDE_WORK_FOLDER.into(),
            ))
        }
    }

    pub fn work_root(&self) -> Option<&Path> {
        self.work_root.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn in_flight_for_test(&self) -> &InFlightRequest {
        &self.in_flight
    }
}
