use crate::error::{MobileError, MobileErrorCode, MobileResult};
use reqwest::redirect::Policy;
use std::time::Duration;
use url::Url;

/// Enforces HTTPS-only external AI and OAuth endpoints (loopback allowed only in injected unit tests).
pub fn enforce_https_url(raw: &str, allow_test_loopback: bool) -> MobileResult<Url> {
    let parsed = Url::parse(raw).map_err(|_| {
        MobileError::with_detail(
            MobileErrorCode::InvalidArgument,
            "mobile.ai.invalidUrl",
            "invalid endpoint URL",
        )
    })?;
    if parsed.scheme() == "https" {
        return Ok(parsed);
    }
    if allow_test_loopback
        && parsed.scheme() == "http"
        && matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost"))
    {
        return Ok(parsed);
    }
    Err(MobileError::with_detail(
        MobileErrorCode::InvalidArgument,
        "mobile.ai.httpsOnly",
        "only https endpoints are allowed on mobile",
    ))
}

/// Builds an HTTP client with redirects disabled so credentials or user text can never be redirected.
pub fn build_safe_http_client(timeout_secs: u64) -> MobileResult<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| {
            MobileError::with_detail(
                MobileErrorCode::InternalError,
                "mobile.ai.httpClientInit",
                e.to_string(),
            )
        })
}

/// Extracts only safe, machine-readable error identifiers — never echoes raw server validation text.
pub fn extract_safe_error_code(body: &serde_json::Value) -> Option<String> {
    let mut cur = body;
    for _ in 0..4 {
        if let Some(err_obj) = cur.get("error").filter(|v| v.is_object()) {
            cur = err_obj;
        } else if let Some(det_obj) = cur.get("detail").filter(|v| v.is_object()) {
            cur = det_obj;
        } else {
            break;
        }
    }
    let raw = cur
        .get("error")
        .and_then(|v| v.as_str())
        .or_else(|| cur.get("code").and_then(|v| v.as_str()))?;
    if !raw.is_empty()
        && raw.len() <= 100
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
    {
        Some(raw.to_string())
    } else {
        None
    }
}
