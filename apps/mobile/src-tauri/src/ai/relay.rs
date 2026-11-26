//! Sealed relay for key-provider AI requests.
//!
//! The webview runs the PC protocol code and hands every outgoing request to
//! this relay. Where the API key belongs it writes the placeholder
//! `__sealed__:<providerId>` (an `Authorization: Bearer …`, `x-api-key` or
//! `x-goog-api-key` header value, or a URL query value). The relay:
//!
//! - sends only `https` requests whose host and port belong to a provider: the
//!   fixed official host of each mobile provider (the base URLs of the PC
//!   adapter table, `packages/ai-provider/src/registry.ts`), or the host and
//!   port of the saved self-hosted (`custom`) base URL. Requests without a
//!   placeholder are held to the same hosts, so this is not a general proxy;
//! - swaps the placeholder for the sealed key of that provider only when the
//!   placeholder names a provider that owns the host, refusing mixed
//!   placeholders, a missing key and placeholders in any other position;
//! - enforces the OpenRouter free-only rule on the request body;
//! - never follows a redirect;
//! - streams the response back as events: `head` (status and response
//!   headers, never the request headers), `chunk` (base64 body pieces in
//!   order), then `end` or `error`.
//!
//! Streaming uses Tauri events rather than `tauri::ipc::Channel` because the
//! mobile bridge transport (`invoke` + `listen`) carries events already and the
//! fake bridge used by webview tests can replay them. Event name:
//! [`RELAY_EVENT_NAME`]; every payload carries `requestId` and a `seq` number
//! that rises by one per event of that request.
//!
//! Errors carry machine codes only. The key never appears in errors, events
//! or response headers, and a key echoed in a response body is masked.

use crate::ai::cancel::{CancelRegistry, cancelled};
use crate::ai::settings::{MobileAiSettingsStore, is_supported_mobile_cloud_provider};
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use reqwest::header::{HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use url::Url;

/// Tauri event that carries [`MobileAiRelayEvent`] payloads to the webview.
pub const RELAY_EVENT_NAME: &str = "mobile:ai-relay-event";

const PLACEHOLDER_MARKER: &str = "__sealed__";
const REDACTED: &[u8] = b"[redacted]";

/// Fixed official hosts per provider, matching the PC adapter table base URLs.
pub fn provider_relay_hosts(provider: &str) -> &'static [&'static str] {
    match provider {
        "openai" => &["api.openai.com"],
        "anthropic" => &["api.anthropic.com"],
        "gemini" => &["generativelanguage.googleapis.com"],
        "openrouter" => &["openrouter.ai"],
        "deepseek" => &["api.deepseek.com"],
        "xai" => &["api.x.ai"],
        "mistral" => &["api.mistral.ai"],
        "kimi" => &["api.moonshot.ai"],
        "glm" => &["open.bigmodel.cn"],
        "qwen" => &["dashscope.aliyuncs.com"],
        "upstage" => &["api.upstage.ai"],
        "exaone" => &["api.exaone.ai"],
        _ => &[],
    }
}

const RELAY_PROVIDERS: &[&str] = &[
    "openai",
    "anthropic",
    "gemini",
    "openrouter",
    "deepseek",
    "xai",
    "mistral",
    "kimi",
    "glm",
    "qwen",
    "upstage",
    "exaone",
];

/// One request handed over by the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiRelayRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    /// `[name, value]` pairs, e.g. `Array.from(new Headers(init.headers))`.
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

/// One step of a relayed exchange.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MobileAiRelayEventKind {
    /// Response status and headers (lower-case names; cookies and anything holding the key dropped).
    Head {
        status: u16,
        headers: Vec<(String, String)>,
    },
    /// A body piece, base64 (standard alphabet) so binary bodies survive.
    Chunk { data_base64: String },
    /// The body finished.
    End,
    /// The exchange stopped after it had started (network failure, redirect, cancel).
    Error {
        code: MobileErrorCode,
        message_key: String,
    },
}

/// Event payload sent on [`RELAY_EVENT_NAME`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiRelayEvent {
    pub request_id: String,
    pub seq: u64,
    #[serde(flatten)]
    pub event: MobileAiRelayEventKind,
}

/// A request that passed every check and is ready to send.
pub struct PlannedRelayRequest {
    /// Provider whose key was attached (`None` when the request carried no placeholder).
    pub provider: Option<String>,
    pub method: reqwest::Method,
    pub url: Url,
    pub headers: Vec<(HeaderName, HeaderValue)>,
    pub body: Option<String>,
    key: Option<String>,
    /// The host matched a loopback route a test injected (test builds only).
    via_test_route: bool,
}

/// Prints no key: the query (which may hold it) and header values are left out.
impl std::fmt::Debug for PlannedRelayRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut shown = self.url.clone();
        shown.set_query(None);
        f.debug_struct("PlannedRelayRequest")
            .field("provider", &self.provider)
            .field("method", &self.method)
            .field("url", &shown.as_str())
            .field(
                "headers",
                &self
                    .headers
                    .iter()
                    .map(|(k, _)| k.as_str())
                    .collect::<Vec<_>>(),
            )
            .field("body_len", &self.body.as_ref().map(String::len))
            .finish()
    }
}

struct Placeholder {
    start: usize,
    end: usize,
    provider: String,
}

#[cfg(test)]
struct TestRoute {
    provider: String,
    scheme: String,
    host: String,
    port: u16,
}

/// Runs relayed requests and keeps their cancel handles.
pub struct MobileAiRelay {
    settings: Arc<MobileAiSettingsStore>,
    client: Mutex<Option<reqwest::Client>>,
    cancels: CancelRegistry,
    #[cfg(test)]
    test_routes: Mutex<Vec<TestRoute>>,
}

fn refuse(key: &str) -> MobileError {
    MobileError::new(MobileErrorCode::InvalidArgument, key)
}

fn find_placeholders(text: &str) -> MobileResult<Vec<Placeholder>> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find(PLACEHOLDER_MARKER) {
        let start = from + rel;
        let after = start + PLACEHOLDER_MARKER.len();
        let rest = &text[after..];
        let sep = if rest.starts_with(':') {
            1
        } else if rest.starts_with("%3A") || rest.starts_with("%3a") {
            3
        } else {
            return Err(refuse("mobile.ai.relayPlaceholderMalformed"));
        };
        let id_start = after + sep;
        let id_len = text[id_start..]
            .bytes()
            .take_while(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
            .count();
        if id_len == 0 {
            return Err(refuse("mobile.ai.relayPlaceholderMalformed"));
        }
        let end = id_start + id_len;
        out.push(Placeholder {
            start,
            end,
            provider: text[id_start..end].to_string(),
        });
        from = end;
    }
    Ok(out)
}

fn replace_placeholders(text: &str, found: &[Placeholder], with: &str) -> String {
    let mut out = String::with_capacity(text.len() + with.len());
    let mut last = 0;
    for p in found {
        out.push_str(&text[last..p.start]);
        out.push_str(with);
        last = p.end;
    }
    out.push_str(&text[last..]);
    out
}

/// Request headers the relay never forwards (transport-owned or credential-bearing for other origins).
pub(crate) fn is_dropped_request_header(name: &str) -> bool {
    matches!(
        name,
        "host"
            | "content-length"
            | "connection"
            | "keep-alive"
            | "transfer-encoding"
            | "te"
            | "trailer"
            | "upgrade"
            | "cookie"
            | "proxy-authorization"
            | "proxy-connection"
    )
}

fn free_only_body_ok(body: Option<&str>) -> bool {
    let Some(value) = body.and_then(|b| serde_json::from_str::<serde_json::Value>(b).ok()) else {
        return false;
    };
    let Some(model) = value.get("model").and_then(|m| m.as_str()) else {
        return false;
    };
    if !model.ends_with(":free") {
        return false;
    }
    match value.get("models") {
        None | Some(serde_json::Value::Null) => true,
        Some(serde_json::Value::Array(list)) => list
            .iter()
            .all(|m| m.as_str().is_some_and(|s| s.ends_with(":free"))),
        Some(_) => false,
    }
}

/// Masks a key inside a streamed body without holding back more than a partial match.
struct Redactor {
    needle: Vec<u8>,
    carry: Vec<u8>,
}

impl Redactor {
    fn new(key: Option<&str>) -> Self {
        Self {
            needle: key.map(|k| k.as_bytes().to_vec()).unwrap_or_default(),
            carry: Vec::new(),
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        if self.needle.is_empty() {
            return chunk.to_vec();
        }
        let mut buf = std::mem::take(&mut self.carry);
        buf.extend_from_slice(chunk);
        let mut out = Vec::with_capacity(buf.len());
        let mut i = 0;
        while i < buf.len() {
            if buf[i..].starts_with(&self.needle) {
                out.extend_from_slice(REDACTED);
                i += self.needle.len();
            } else {
                out.push(buf[i]);
                i += 1;
            }
        }
        // Hold back the longest tail that could still grow into the key.
        let max = self.needle.len().saturating_sub(1).min(out.len());
        let hold = (1..=max)
            .rev()
            .find(|&k| out.ends_with(&self.needle[..k]))
            .unwrap_or(0);
        self.carry = out.split_off(out.len() - hold);
        out
    }

    fn finish(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.carry)
    }
}

impl MobileAiRelay {
    pub fn new(settings: Arc<MobileAiSettingsStore>) -> Self {
        Self {
            settings,
            client: Mutex::new(None),
            cancels: CancelRegistry::default(),
            #[cfg(test)]
            test_routes: Mutex::new(Vec::new()),
        }
    }

    /// Lets tests reach a loopback server as if it were `provider`'s host (http allowed).
    #[cfg(test)]
    pub(crate) fn allow_test_route(&self, provider: &str, origin: &str) {
        let url = Url::parse(origin).expect("test origin");
        self.test_routes.lock().unwrap().push(TestRoute {
            provider: provider.to_string(),
            scheme: url.scheme().to_string(),
            host: url.host_str().unwrap_or_default().to_ascii_lowercase(),
            port: url.port_or_known_default().unwrap_or(0),
        });
    }

    #[cfg(test)]
    fn test_route_providers(&self, scheme: &str, host: &str, port: u16) -> Vec<String> {
        self.test_routes
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.scheme == scheme && r.host == host && r.port == port)
            .map(|r| r.provider.clone())
            .collect()
    }

    #[cfg(not(test))]
    fn test_route_providers(&self, _scheme: &str, _host: &str, _port: u16) -> Vec<String> {
        Vec::new()
    }

    /// Providers that own `url`'s host and port, and whether the match is a test route.
    /// The scheme is checked by the caller so that `http://<official host>` reads as
    /// "https only" rather than "unknown host".
    fn host_providers(&self, url: &Url) -> MobileResult<(BTreeSet<String>, bool)> {
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        let test_owners = self.test_route_providers(
            url.scheme(),
            &host,
            url.port_or_known_default().unwrap_or(0),
        );
        let via_test = !test_owners.is_empty();
        let mut owners: BTreeSet<String> = test_owners.into_iter().collect();
        // Ports are compared as if the request were https (an omitted port means 443).
        let port = url.port().unwrap_or(443);
        if port == 443 {
            for provider in RELAY_PROVIDERS {
                if provider_relay_hosts(provider).contains(&host.as_str()) {
                    owners.insert((*provider).to_string());
                }
            }
        }
        if let Some((c_host, c_port)) = self.settings.custom_origin()?
            && c_host == host
            && c_port == port
        {
            owners.insert("custom".to_string());
        }
        Ok((owners, via_test))
    }

    /// Checks a request and resolves its key. Performs no network access.
    pub fn plan(&self, req: &MobileAiRelayRequest) -> MobileResult<PlannedRelayRequest> {
        let mut url = Url::parse(req.url.trim()).map_err(|_| refuse("mobile.ai.invalidUrl"))?;
        if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
            return Err(refuse("mobile.ai.invalidUrl"));
        }
        let method = match req.method.to_ascii_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            _ => return Err(refuse("mobile.ai.relayMethod")),
        };
        let body = req.body.clone().filter(|b| !b.is_empty());
        if method == reqwest::Method::GET && body.is_some() {
            return Err(refuse("mobile.ai.relayMethod"));
        }

        let (owners, via_test) = self.host_providers(&url)?;
        if owners.is_empty() {
            return Err(refuse("mobile.ai.relayHostNotAllowed"));
        }
        if url.scheme() != "https" && !via_test {
            return Err(refuse("mobile.ai.httpsOnly"));
        }

        // Placeholders are read from the query and header values only.
        let mut without_query = url.clone();
        without_query.set_query(None);
        if without_query.as_str().contains(PLACEHOLDER_MARKER) {
            return Err(refuse("mobile.ai.relayPlaceholderPosition"));
        }
        url.set_fragment(None);
        let query = url.query().map(ToString::to_string);
        let query_found = match &query {
            Some(q) => find_placeholders(q)?,
            None => Vec::new(),
        };
        let mut header_found = Vec::with_capacity(req.headers.len());
        for (name, value) in &req.headers {
            if name.contains(PLACEHOLDER_MARKER) {
                return Err(refuse("mobile.ai.relayPlaceholderPosition"));
            }
            header_found.push(find_placeholders(value)?);
        }
        let named: BTreeSet<&str> = query_found
            .iter()
            .chain(header_found.iter().flatten())
            .map(|p| p.provider.as_str())
            .collect();
        if named.len() > 1 {
            return Err(refuse("mobile.ai.relayMixedPlaceholders"));
        }
        let provider = named.iter().next().map(|p| (*p).to_string());

        let key = match &provider {
            Some(p) => {
                if !owners.contains(p) {
                    return Err(refuse("mobile.ai.relayProviderHostMismatch"));
                }
                if p != "custom" && !is_supported_mobile_cloud_provider(p) {
                    return Err(refuse("mobile.ai.relayProviderHostMismatch"));
                }
                let key = self
                    .settings
                    .get_api_key(p)?
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .ok_or_else(|| {
                        MobileError::new(MobileErrorCode::AuthNotConfigured, "mobile.ai.missingKey")
                    })?;
                Some(key)
            }
            None => None,
        };

        if (owners.contains("openrouter") || provider.as_deref() == Some("openrouter"))
            && method != reqwest::Method::GET
            && self.settings.is_openrouter_free_only()?
            && !free_only_body_ok(body.as_deref())
        {
            return Err(refuse("mobile.ai.openrouterFreeOnly"));
        }

        if let (Some(q), Some(k)) = (&query, &key)
            && !query_found.is_empty()
        {
            let encoded: String = url::form_urlencoded::byte_serialize(k.as_bytes()).collect();
            url.set_query(Some(&replace_placeholders(q, &query_found, &encoded)));
        }

        let mut headers = Vec::with_capacity(req.headers.len());
        for ((name, value), found) in req.headers.iter().zip(header_found.iter()) {
            let lower = name.trim().to_ascii_lowercase();
            if is_dropped_request_header(&lower) {
                continue;
            }
            let header_name = HeaderName::from_bytes(lower.as_bytes())
                .map_err(|_| refuse("mobile.ai.relayInvalidHeader"))?;
            let sensitive = !found.is_empty();
            let text = match (&key, sensitive) {
                (Some(k), true) => replace_placeholders(value, found, k),
                _ => value.clone(),
            };
            let mut header_value =
                HeaderValue::from_str(&text).map_err(|_| refuse("mobile.ai.relayInvalidHeader"))?;
            header_value.set_sensitive(sensitive);
            headers.push((header_name, header_value));
        }

        Ok(PlannedRelayRequest {
            provider,
            method,
            url,
            headers,
            body,
            key,
            via_test_route: via_test,
        })
    }

    fn client(&self) -> MobileResult<reqwest::Client> {
        let mut slot = self.client.lock().unwrap();
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        // No total timeout: long generations stream for minutes. Idle reads still time out.
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| {
                MobileError::new(MobileErrorCode::InternalError, "mobile.ai.httpClientInit")
            })?;
        *slot = Some(client.clone());
        Ok(client)
    }

    /// Cancels a running request, or one whose start has not arrived yet.
    /// Request ids must be unique per request (a late cancel is remembered briefly).
    pub fn cancel(&self, request_id: &str) {
        self.cancels.cancel(request_id);
    }

    /// Relays one request. Refusals return `Err` without emitting events; once the
    /// request is on the network every outcome is also reported as a final
    /// `end` or `error` event, and the result mirrors it.
    pub async fn run<F>(&self, req: MobileAiRelayRequest, mut emit: F) -> MobileResult<()>
    where
        F: FnMut(MobileAiRelayEvent) + Send,
    {
        let mut rx = self
            .cancels
            .register(&req.request_id, "mobile.ai.relayDuplicateId")?;
        let prepared = self.plan(&req).and_then(|p| Ok((p, self.client()?)));
        let (planned, client) = match prepared {
            Ok(ready) => ready,
            Err(err) => {
                self.cancels.finish(&req.request_id);
                return Err(err);
            }
        };

        let request_id = req.request_id.clone();
        let mut seq: u64 = 0;
        let mut send = |event: MobileAiRelayEventKind| {
            emit(MobileAiRelayEvent {
                request_id: request_id.clone(),
                seq,
                event,
            });
            seq += 1;
        };

        let outcome = {
            let exchange = Self::exchange(&client, planned, &mut send);
            tokio::select! {
                _ = &mut rx => Err(cancelled()),
                res = exchange => res,
            }
        };
        self.cancels.finish(&req.request_id);
        match outcome {
            Ok(()) => {
                send(MobileAiRelayEventKind::End);
                Ok(())
            }
            Err(err) => {
                send(MobileAiRelayEventKind::Error {
                    code: err.code,
                    message_key: err.message_key.clone(),
                });
                Err(err)
            }
        }
    }

    async fn exchange<S>(
        client: &reqwest::Client,
        planned: PlannedRelayRequest,
        send: &mut S,
    ) -> MobileResult<()>
    where
        S: FnMut(MobileAiRelayEventKind) + Send,
    {
        let PlannedRelayRequest {
            method,
            url,
            headers,
            body,
            key,
            via_test_route,
            ..
        } = planned;
        // Test builds only ever send to an injected loopback route.
        if cfg!(test) && !via_test_route {
            return Err(MobileError::new(
                MobileErrorCode::NetworkError,
                "mobile.ai.networkError",
            ));
        }
        let mut builder = client.request(method, url);
        for (name, value) in headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = body {
            builder = builder.body(body);
        }
        // reqwest errors can quote the URL (and so a query key): map to codes only.
        let resp = builder.send().await.map_err(|e| {
            let key = if e.is_timeout() {
                "mobile.ai.timeout"
            } else {
                "mobile.ai.networkError"
            };
            MobileError::new(MobileErrorCode::NetworkError, key)
        })?;
        let status = resp.status();
        if status.is_redirection() {
            return Err(MobileError::new(
                MobileErrorCode::NetworkError,
                "mobile.ai.relayRedirect",
            ));
        }
        let mut out_headers = Vec::new();
        for (name, value) in resp.headers() {
            let lower = name.as_str();
            if lower == "set-cookie" || lower == "set-cookie2" {
                continue;
            }
            let Ok(text) = value.to_str() else { continue };
            if key.as_deref().is_some_and(|k| text.contains(k)) {
                continue;
            }
            out_headers.push((lower.to_string(), text.to_string()));
        }
        send(MobileAiRelayEventKind::Head {
            status: status.as_u16(),
            headers: out_headers,
        });

        let mut redactor = Redactor::new(key.as_deref());
        let mut stream = resp.bytes_stream();
        while let Some(piece) = stream.next().await {
            let bytes = piece.map_err(|e| {
                let key = if e.is_timeout() {
                    "mobile.ai.timeout"
                } else {
                    "mobile.ai.streamInterrupted"
                };
                MobileError::new(MobileErrorCode::NetworkError, key)
            })?;
            let clean = redactor.push(&bytes);
            if !clean.is_empty() {
                send(MobileAiRelayEventKind::Chunk {
                    data_base64: STANDARD.encode(clean),
                });
            }
        }
        let tail = redactor.finish();
        if !tail.is_empty() {
            send(MobileAiRelayEventKind::Chunk {
                data_base64: STANDARD.encode(tail),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod redactor_tests {
    use super::Redactor;

    #[test]
    fn masks_a_key_split_across_pieces_and_passes_other_bytes_at_once() {
        let mut r = Redactor::new(Some("SECRETKEY"));
        let mut out = r.push(b"abc SECR");
        assert_eq!(out, b"abc ");
        out.extend(r.push(b"ETKEY def"));
        out.extend(r.push(b" SE"));
        out.extend(r.finish());
        assert_eq!(String::from_utf8(out).unwrap(), "abc [redacted] def SE");
        let mut plain = Redactor::new(None);
        assert_eq!(plain.push(b"SECRETKEY"), b"SECRETKEY");
    }
}
