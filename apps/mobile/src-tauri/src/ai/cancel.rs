//! Cancel handles for streamed AI requests (relay, search and public requests).

use crate::error::{MobileError, MobileErrorCode, MobileResult};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;
use tokio::sync::oneshot;

/// Cancels that arrive before their start are remembered briefly (bounded bookkeeping, not content).
const EARLY_CANCEL_MEMORY: usize = 64;

#[derive(Default)]
struct CancelBook {
    active: BTreeMap<String, oneshot::Sender<()>>,
    early: VecDeque<String>,
}

/// Running requests by id, plus cancels whose start has not arrived yet.
#[derive(Default)]
pub(crate) struct CancelRegistry {
    book: Mutex<CancelBook>,
}

pub(crate) fn cancelled() -> MobileError {
    MobileError::new(MobileErrorCode::UserCancelled, "mobile.ai.cancelled")
}

impl CancelRegistry {
    /// Cancels a running request, or one whose start has not arrived yet.
    /// Request ids must be unique per request (a late cancel is remembered briefly).
    pub(crate) fn cancel(&self, request_id: &str) {
        let mut book = self.book.lock().unwrap();
        if let Some(tx) = book.active.remove(request_id) {
            let _ = tx.send(());
            return;
        }
        if !book.early.iter().any(|id| id == request_id) {
            if book.early.len() >= EARLY_CANCEL_MEMORY {
                book.early.pop_front();
            }
            book.early.push_back(request_id.to_string());
        }
    }

    /// Registers a cancel handle; refuses an id that was already cancelled
    /// (`mobile.ai.cancelled`) or is running (`duplicate_key`).
    pub(crate) fn register(
        &self,
        request_id: &str,
        duplicate_key: &'static str,
    ) -> MobileResult<oneshot::Receiver<()>> {
        let mut book = self.book.lock().unwrap();
        if let Some(pos) = book.early.iter().position(|id| id == request_id) {
            book.early.remove(pos);
            return Err(cancelled());
        }
        if book.active.contains_key(request_id) {
            return Err(MobileError::new(
                MobileErrorCode::InvalidArgument,
                duplicate_key,
            ));
        }
        let (tx, rx) = oneshot::channel();
        book.active.insert(request_id.to_string(), tx);
        Ok(rx)
    }

    /// Forgets a finished request.
    pub(crate) fn finish(&self, request_id: &str) {
        self.book.lock().unwrap().active.remove(request_id);
    }
}
