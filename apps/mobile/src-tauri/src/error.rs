use serde::{Deserialize, Serialize};
use std::fmt;

/// Fixed 16-variant mobile command error code contract shared across Rust and WebView.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MobileErrorCode {
    PermissionDenied,
    ReadOnlyUri,
    FileTooLarge,
    CorruptContainer,
    PasswordProtected,
    BackupFailed,
    UserCancelled,
    AuthNotConfigured,
    AuthDenied,
    AuthNoPlan,
    AuthTimeout,
    NetworkError,
    RateLimited,
    SignedOut,
    InvalidArgument,
    InternalError,
}

/// Structured command failure envelope serialized over Tauri IPC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileError {
    pub code: MobileErrorCode,
    pub message_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl MobileError {
    pub fn new(code: MobileErrorCode, message_key: impl Into<String>) -> Self {
        Self {
            code,
            message_key: message_key.into(),
            detail: None,
        }
    }

    pub fn with_detail(
        code: MobileErrorCode,
        message_key: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message_key: message_key.into(),
            detail: Some(detail.into()),
        }
    }
}

impl fmt::Display for MobileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{:?} ({}): {}", self.code, self.message_key, detail),
            None => write!(f, "{:?} ({})", self.code, self.message_key),
        }
    }
}

impl std::error::Error for MobileError {}

pub type MobileResult<T> = Result<T, MobileError>;
