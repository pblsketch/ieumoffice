//! Formula-engine state, mirrored from `RecalcWorker` in the engine's
//! `src/main.rs`.
//!
//! The desktop sidecar runs `recalc_cells` on its own thread so a cold
//! IronCalc import (minutes on a formula-heavy workbook) never blocks the
//! request loop. Here every call already runs on a blocking worker thread,
//! so the recalculation simply runs outside the request-loop lock. Only one
//! runs at a time; an overlapping one is answered at once with the same
//! `recalc_busy` sentence the desktop uses (the grid recognises
//! "busy with another recalculation" and does not count it as a failure).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use xlsx_sidecar::recalc::{RecalcCache, RecalcEdit, RecalcRead, recalc_cells_reporting};

use crate::dispatch::{Response, to_json_value};

pub(crate) struct RecalcWorker {
    cache: Arc<Mutex<RecalcCache>>,
    /// Purges that arrive while a recalc holds the cache lock; applied at the
    /// next recalc (recalc_cells re-imports on mtime+size mismatch anyway).
    pending_purges: Arc<Mutex<Vec<PathBuf>>>,
    busy: Arc<AtomicBool>,
}

/// Clears the busy flag even when recalc_cells panics mid-import.
struct BusyReset(Arc<AtomicBool>);

impl Drop for BusyReset {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// A recalculation that won the busy flag; `run` executes it and releases
/// the flag before handing back the response.
pub(crate) struct RecalcJob {
    worker: RecalcWorker,
    reset: BusyReset,
    request_id: String,
    path: PathBuf,
    edits: Vec<RecalcEdit>,
    reads: Vec<RecalcRead>,
    report_stale: bool,
}

impl RecalcJob {
    pub(crate) fn run(self) -> Response {
        let Self {
            worker,
            reset,
            request_id,
            path,
            edits,
            reads,
            report_stale,
        } = self;
        let response = worker.run(request_id, &path, &edits, &reads, report_stale);
        // Clear busy before replying: a sequential caller issues its next
        // recalc the moment the response lands.
        drop(reset);
        response
    }
}

impl RecalcWorker {
    pub(crate) fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(RecalcCache::new())),
            pending_purges: Arc::new(Mutex::new(Vec::new())),
            busy: Arc::new(AtomicBool::new(false)),
        }
    }

    fn handle(&self) -> Self {
        Self {
            cache: Arc::clone(&self.cache),
            pending_purges: Arc::clone(&self.pending_purges),
            busy: Arc::clone(&self.busy),
        }
    }

    pub(crate) fn queue_purge(&self, path: &PathBuf) {
        self.pending_purges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(path.clone());
    }

    /// Close reclaims the resident model right away when the cache is free,
    /// and falls back to the queue while a recalc holds it.
    pub(crate) fn purge_now_or_queue(&self, path: &PathBuf) {
        match self.cache.try_lock() {
            Ok(mut cache) => cache.purge(path),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner().purge(path),
            Err(std::sync::TryLockError::WouldBlock) => self.queue_purge(path),
        }
    }

    fn drain_purges(&self, cache: &mut RecalcCache) {
        let purges: Vec<PathBuf> = self
            .pending_purges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
            .collect();
        for purge in &purges {
            cache.purge(purge);
        }
    }

    pub(crate) fn run(
        &self,
        request_id: String,
        path: &PathBuf,
        edits: &[RecalcEdit],
        reads: &[RecalcRead],
        report_stale: bool,
    ) -> Response {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.drain_purges(&mut cache);
        let response = match recalc_cells_reporting(&mut cache, path, edits, reads, report_stale)
            .and_then(to_json_value)
        {
            Ok(value) => Response::success(request_id, value),
            Err(error) => Response::from_error(request_id, error),
        };
        // A Close racing this recalc queued its purge after the drain above;
        // apply it before releasing the lock.
        self.drain_purges(&mut cache);
        response
    }

    /// Takes the busy flag for a new recalculation, or answers at once with
    /// `recalc_busy` when one is already in flight.
    pub(crate) fn dispatch(
        &self,
        request_id: String,
        path: PathBuf,
        edits: Vec<RecalcEdit>,
        reads: Vec<RecalcRead>,
        report_stale: bool,
    ) -> Result<RecalcJob, Response> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(Response::failure(
                request_id,
                "recalc_busy",
                "Formula engine is busy with another recalculation.".into(),
            ));
        }
        Ok(RecalcJob {
            worker: self.handle(),
            reset: BusyReset(Arc::clone(&self.busy)),
            request_id,
            path,
            edits,
            reads,
            report_stale,
        })
    }

    #[cfg(test)]
    pub(crate) fn pending_purge_count(&self) -> usize {
        self.pending_purges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len()
    }

    #[cfg(test)]
    pub(crate) fn is_busy_for_test(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }

    #[cfg(test)]
    pub(crate) fn lock_cache_for_test(&self) -> std::sync::MutexGuard<'_, RecalcCache> {
        self.cache.lock().unwrap()
    }
}
