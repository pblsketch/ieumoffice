//! Search requests and public address requests for the AI web tools.
//!
//! Two kinds of request leave the app here, both without keys or cookies:
//!
//! - **Search requests** go only to the fixed search hosts ([`search_hosts`])
//!   over https with GET, POST or DELETE (DELETE ends an MCP session). The
//!   webview's request headers are passed on except transport-owned and
//!   credential-bearing ones (the relay's dropped list plus `authorization`
//!   and `accept-encoding`), and nothing may carry a `__sealed__` placeholder.
//!   Redirects are not followed: a 3xx reply reaches the webview as an
//!   ordinary response. The body is streamed as it arrives (SSE replies too).
//! - **Public address requests** (`read_url`, fetching pictures) are http or
//!   https GET only. The host name is resolved once per hop and the request is
//!   sent only when every resolved address is public (see the table below);
//!   the connection is then pinned to exactly those addresses, so a second DNS
//!   answer cannot switch it. Literal IP hosts are checked the same way.
//!   Redirects are followed by hand, at most [`WEB_MAX_REDIRECTS`], and every
//!   hop is checked again. Only `accept`, `accept-language` and `user-agent`
//!   from the webview are sent (`user-agent` defaults to `Mozilla/5.0`, the PC
//!   `read_url` value); everything else is dropped silently. The body may not
//!   pass [`WEB_MAX_BYTES`] (`mobile.ai.webTooLarge`) and the whole exchange,
//!   DNS and redirects included, has [`WEB_TOTAL_TIMEOUT`]
//!   (`mobile.ai.webTimeout`). These are the PC `read_url` limits, except that
//!   the PC follows ten redirects and the mobile rule is five.
//!
//! Both stream on [`WEB_EVENT_NAME`] like the relay: `head` (status, the final
//! URL, content type and response headers without cookies), `chunk` (base64
//! body pieces in order), then `end` or `error`. Checks that need no network
//! (URL form, scheme, method, host allowlist, headers) reject the call with no
//! events; from the address check on, every failure is also the last event.
//! Errors carry machine codes only.
//!
//! Non-public address table (refused for literal hosts and resolved names):
//!
//! | range                | why                                            |
//! | -------------------- | ---------------------------------------------- |
//! | 0.0.0.0/8            | "this network", unspecified                    |
//! | 10.0.0.0/8           | private                                        |
//! | 100.64.0.0/10        | carrier-grade NAT                              |
//! | 127.0.0.0/8          | loopback                                       |
//! | 169.254.0.0/16       | link-local (cloud metadata)                    |
//! | 172.16.0.0/12        | private                                        |
//! | 192.0.0.0/24         | IETF protocol assignments                      |
//! | 192.0.2.0/24         | documentation (TEST-NET-1)                     |
//! | 192.88.99.0/24       | deprecated 6to4 relay anycast                  |
//! | 192.168.0.0/16       | private                                        |
//! | 198.18.0.0/15        | benchmarking (see the fake-ip note)            |
//! | 198.51.100.0/24      | documentation (TEST-NET-2)                     |
//! | 203.0.113.0/24       | documentation (TEST-NET-3)                     |
//! | 224.0.0.0/4          | multicast                                      |
//! | 240.0.0.0/4          | reserved, broadcast                            |
//! | ::/96                | unspecified, loopback, IPv4-compatible         |
//! | ::ffff:0:0/96        | IPv4-mapped: judged by the embedded IPv4       |
//! | ::ffff:0:0:0/96      | IPv4-translated                                |
//! | 64:ff9b::/96         | NAT64: judged by the embedded IPv4             |
//! | 64:ff9b:1::/48       | local-use NAT64                                |
//! | 100::/64             | discard-only                                   |
//! | 2001::/32            | Teredo                                         |
//! | 2001:2::/48          | benchmarking                                   |
//! | 2001:10::/28         | ORCHID                                         |
//! | 2001:db8::/32        | documentation                                  |
//! | 2002::/16            | 6to4: judged by the embedded IPv4              |
//! | 3fff::/20            | documentation                                  |
//! | fc00::/7             | unique local                                   |
//! | fe80::/10            | link-local                                     |
//! | fec0::/10            | deprecated site-local                          |
//! | ff00::/8             | multicast                                      |
//!
//! The names `localhost`, `*.localhost`, `*.local` and `*.internal` are refused
//! without asking DNS. NAT64 addresses are judged by the IPv4 inside rather
//! than refused outright (the PC refuses them) because IPv6-only phone
//! networks answer every IPv4-only site with a 64:ff9b:: address. Like the PC,
//! a resolved name may answer from 198.18.0.0/15: VPN apps in fake-ip mode
//! hand those out for every name and resolve the real host at the tunnel exit;
//! a literal 198.18.x.x host is still refused.

use crate::ai::cancel::{CancelRegistry, cancelled};
use crate::ai::relay::is_dropped_request_header;
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use reqwest::header::{CONTENT_TYPE, HeaderName, HeaderValue, LOCATION};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use url::{Host, Url};

/// Tauri event that carries [`MobileAiWebEvent`] payloads to the webview.
pub const WEB_EVENT_NAME: &str = "mobile:ai-web-event";
/// Largest public response body passed on (the PC `read_url` cap).
pub const WEB_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// Whole budget of one public request: DNS, redirects and body together.
pub const WEB_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
/// Redirects a public request follows; the next one is refused.
pub const WEB_MAX_REDIRECTS: u32 = 5;

const SEARCH_HOSTS: &[&str] = &[
    "search.parallel.ai",
    "html.duckduckgo.com",
    "duckduckgo.com",
];
const PUBLIC_REQUEST_HEADERS: &[&str] = &["accept", "accept-language", "user-agent"];
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0";
const SEALED_MARKER: &str = "__sealed__";
const BLOCKED_NAME_SUFFIXES: &[&str] = &[".localhost", ".local", ".internal"];

/// The only hosts a search request may reach (https, port 443).
pub fn search_hosts() -> &'static [&'static str] {
    SEARCH_HOSTS
}

const BLOCKED_V4: &[([u8; 4], u32)] = &[
    ([0, 0, 0, 0], 8),
    ([10, 0, 0, 0], 8),
    ([100, 64, 0, 0], 10),
    ([127, 0, 0, 0], 8),
    ([169, 254, 0, 0], 16),
    ([172, 16, 0, 0], 12),
    ([192, 0, 0, 0], 24),
    ([192, 0, 2, 0], 24),
    ([192, 88, 99, 0], 24),
    ([192, 168, 0, 0], 16),
    ([198, 18, 0, 0], 15),
    ([198, 51, 100, 0], 24),
    ([203, 0, 113, 0], 24),
    ([224, 0, 0, 0], 4),
    ([240, 0, 0, 0], 4),
];

const BLOCKED_V6: &[([u16; 8], u32)] = &[
    ([0, 0, 0, 0, 0, 0, 0, 0], 96),
    ([0, 0, 0, 0, 0xffff, 0, 0, 0], 96),
    ([0x64, 0xff9b, 1, 0, 0, 0, 0, 0], 48),
    ([0x100, 0, 0, 0, 0, 0, 0, 0], 64),
    ([0x2001, 0, 0, 0, 0, 0, 0, 0], 32),
    ([0x2001, 2, 0, 0, 0, 0, 0, 0], 48),
    ([0x2001, 0x10, 0, 0, 0, 0, 0, 0], 28),
    ([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0], 32),
    ([0x3fff, 0, 0, 0, 0, 0, 0, 0], 20),
    ([0xfc00, 0, 0, 0, 0, 0, 0, 0], 7),
    ([0xfe80, 0, 0, 0, 0, 0, 0, 0], 10),
    ([0xfec0, 0, 0, 0, 0, 0, 0, 0], 10),
    ([0xff00, 0, 0, 0, 0, 0, 0, 0], 8),
];

const NAT64_PREFIX: [u16; 8] = [0x64, 0xff9b, 0, 0, 0, 0, 0, 0];
const SIX_TO_FOUR_PREFIX: [u16; 8] = [0x2002, 0, 0, 0, 0, 0, 0, 0];

fn in_v4(ip: Ipv4Addr, base: [u8; 4], bits: u32) -> bool {
    let mask = if bits == 0 {
        0
    } else {
        u32::MAX << (32 - bits)
    };
    u32::from(ip) & mask == u32::from(Ipv4Addr::from(base)) & mask
}

fn in_v6(ip: Ipv6Addr, base: [u16; 8], bits: u32) -> bool {
    let mask = if bits == 0 {
        0
    } else {
        u128::MAX << (128 - bits)
    };
    u128::from(ip) & mask == u128::from(Ipv6Addr::from(base)) & mask
}

fn v4_public(ip: Ipv4Addr) -> bool {
    !BLOCKED_V4
        .iter()
        .any(|(base, bits)| in_v4(ip, *base, *bits))
}

fn v6_public(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return v4_public(v4);
    }
    let n = u128::from(ip);
    if in_v6(ip, NAT64_PREFIX, 96) {
        return v4_public(Ipv4Addr::from(n as u32));
    }
    if in_v6(ip, SIX_TO_FOUR_PREFIX, 16) {
        return v4_public(Ipv4Addr::from((n >> 80) as u32));
    }
    !BLOCKED_V6
        .iter()
        .any(|(base, bits)| in_v6(ip, *base, *bits))
}

/// True when `ip` is outside every non-public range of the table in the module docs.
pub fn is_public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4_public(v4),
        IpAddr::V6(v6) => v6_public(v6),
    }
}

/// A resolved answer is acceptable when public, or a VPN fake-ip placeholder.
fn resolved_address_ok(ip: IpAddr) -> bool {
    is_public_address(ip) || matches!(ip, IpAddr::V4(v4) if in_v4(v4, [198, 18, 0, 0], 15))
}

/// Future returned by a [`WebResolver`].
pub type ResolveFuture = Pin<Box<dyn Future<Output = std::io::Result<Vec<IpAddr>>> + Send>>;

/// Name resolution for public requests (injected in tests).
pub trait WebResolver: Send + Sync {
    fn resolve(&self, host: &str) -> ResolveFuture;
}

#[cfg(not(test))]
struct SystemResolver;

#[cfg(not(test))]
impl WebResolver for SystemResolver {
    fn resolve(&self, host: &str) -> ResolveFuture {
        let host = host.to_string();
        Box::pin(async move {
            Ok(tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .map(|a| a.ip())
                .collect())
        })
    }
}

/// Test builds never ask the system resolver.
#[cfg(test)]
struct SystemResolver;

#[cfg(test)]
impl WebResolver for SystemResolver {
    fn resolve(&self, _host: &str) -> ResolveFuture {
        Box::pin(async { Err(std::io::Error::other("no system DNS in tests")) })
    }
}

/// One search request handed over by the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiSearchRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

/// One public address request (GET only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiWebFetchRequest {
    pub request_id: String,
    pub url: String,
    /// Absent or `GET` (any case); anything else is refused.
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

/// One step of a search or public exchange.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MobileAiWebEventKind {
    /// Status, final URL (after redirects, no fragment), content type and
    /// response headers (lower-case names, cookies dropped).
    Head {
        status: u16,
        url: String,
        content_type: Option<String>,
        headers: Vec<(String, String)>,
    },
    /// A body piece, base64 (standard alphabet).
    Chunk { data_base64: String },
    /// The body finished.
    End,
    /// The exchange stopped after it had started.
    Error {
        code: MobileErrorCode,
        message_key: String,
    },
}

/// Event payload sent on [`WEB_EVENT_NAME`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiWebEvent {
    pub request_id: String,
    pub seq: u64,
    #[serde(flatten)]
    pub event: MobileAiWebEventKind,
}

/// A search request that passed every check.
#[derive(Debug)]
pub struct PlannedSearch {
    pub method: reqwest::Method,
    pub url: Url,
    pub headers: Vec<(HeaderName, HeaderValue)>,
    pub body: Option<String>,
    via_test_route: bool,
}

struct PlannedFetch {
    url: Url,
    headers: Vec<(HeaderName, HeaderValue)>,
}

/// Addresses a public hop may connect to.
struct CheckedTarget {
    /// The URL host when it is a name (the addresses are pinned to it).
    name: Option<String>,
    addrs: Vec<IpAddr>,
}

#[derive(Clone, Copy)]
struct Limits {
    total: Duration,
    max_bytes: u64,
}

struct EventSink<F> {
    request_id: String,
    seq: u64,
    emit: F,
}

impl<F: FnMut(MobileAiWebEvent) + Send> EventSink<F> {
    fn send(&mut self, event: MobileAiWebEventKind) {
        (self.emit)(MobileAiWebEvent {
            request_id: self.request_id.clone(),
            seq: self.seq,
            event,
        });
        self.seq += 1;
    }

    fn close(&mut self, outcome: MobileResult<()>) -> MobileResult<()> {
        match outcome {
            Ok(()) => {
                self.send(MobileAiWebEventKind::End);
                Ok(())
            }
            Err(err) => {
                self.send(MobileAiWebEventKind::Error {
                    code: err.code,
                    message_key: err.message_key.clone(),
                });
                Err(err)
            }
        }
    }
}

fn refuse(key: &str) -> MobileError {
    MobileError::new(MobileErrorCode::InvalidArgument, key)
}

fn network(key: &str) -> MobileError {
    MobileError::new(MobileErrorCode::NetworkError, key)
}

fn too_large() -> MobileError {
    MobileError::new(MobileErrorCode::FileTooLarge, "mobile.ai.webTooLarge")
}

/// Parses a public address: http or https, a host, no credentials, no fragment.
fn parse_public_url(raw: &str) -> MobileResult<Url> {
    let mut url = Url::parse(raw.trim()).map_err(|_| refuse("mobile.ai.webInvalidUrl"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(refuse("mobile.ai.webSchemeNotAllowed"));
    }
    if !url.username().is_empty() || url.password().is_some() || url.host().is_none() {
        return Err(refuse("mobile.ai.webInvalidUrl"));
    }
    url.set_fragment(None);
    Ok(url)
}

fn response_headers(resp: &reqwest::Response) -> (Option<String>, Vec<(String, String)>) {
    let mut out = Vec::new();
    for (name, value) in resp.headers() {
        let lower = name.as_str();
        if lower == "set-cookie" || lower == "set-cookie2" {
            continue;
        }
        let Ok(text) = value.to_str() else { continue };
        out.push((lower.to_string(), text.to_string()));
    }
    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(ToString::to_string);
    (content_type, out)
}

fn send_error(e: &reqwest::Error) -> MobileError {
    network(if e.is_timeout() {
        "mobile.ai.webTimeout"
    } else {
        "mobile.ai.webNetworkError"
    })
}

async fn stream_body<F>(
    resp: reqwest::Response,
    sink: &mut EventSink<F>,
    max_bytes: Option<u64>,
) -> MobileResult<()>
where
    F: FnMut(MobileAiWebEvent) + Send,
{
    let mut total: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(piece) = stream.next().await {
        let bytes = piece.map_err(|e| {
            network(if e.is_timeout() {
                "mobile.ai.webTimeout"
            } else {
                "mobile.ai.webStreamInterrupted"
            })
        })?;
        total += bytes.len() as u64;
        if max_bytes.is_some_and(|max| total > max) {
            return Err(too_large());
        }
        if !bytes.is_empty() {
            sink.send(MobileAiWebEventKind::Chunk {
                data_base64: STANDARD.encode(&bytes),
            });
        }
    }
    Ok(())
}

/// Runs search and public requests and keeps their cancel handles.
pub struct MobileAiWeb {
    resolver: Arc<dyn WebResolver>,
    search_client: Mutex<Option<reqwest::Client>>,
    cancels: CancelRegistry,
    limits: Mutex<Limits>,
    #[cfg(test)]
    test_search_routes: Mutex<Vec<(String, String, u16)>>,
    #[cfg(test)]
    test_addresses: Mutex<std::collections::BTreeSet<IpAddr>>,
}

impl Default for MobileAiWeb {
    fn default() -> Self {
        Self::new()
    }
}

impl MobileAiWeb {
    pub fn new() -> Self {
        Self::with_resolver(Arc::new(SystemResolver))
    }

    pub fn with_resolver(resolver: Arc<dyn WebResolver>) -> Self {
        Self {
            resolver,
            search_client: Mutex::new(None),
            cancels: CancelRegistry::default(),
            limits: Mutex::new(Limits {
                total: WEB_TOTAL_TIMEOUT,
                max_bytes: WEB_MAX_BYTES,
            }),
            #[cfg(test)]
            test_search_routes: Mutex::new(Vec::new()),
            #[cfg(test)]
            test_addresses: Mutex::new(Default::default()),
        }
    }

    /// Lets tests reach a loopback server as if it were a search host (http allowed).
    #[cfg(test)]
    pub(crate) fn allow_test_search_route(&self, origin: &str) {
        let url = Url::parse(origin).expect("test origin");
        self.test_search_routes.lock().unwrap().push((
            url.scheme().to_string(),
            url.host_str().unwrap_or_default().to_ascii_lowercase(),
            url.port_or_known_default().unwrap_or(0),
        ));
    }

    /// Lets tests connect a checked address on loopback instead (the URL port is kept).
    #[cfg(test)]
    pub(crate) fn map_test_address(&self, ip: IpAddr) {
        self.test_addresses.lock().unwrap().insert(ip);
    }

    #[cfg(test)]
    pub(crate) fn set_test_limits(&self, total: Duration, max_bytes: u64) {
        *self.limits.lock().unwrap() = Limits { total, max_bytes };
    }

    #[cfg(test)]
    fn is_test_search_route(&self, url: &Url) -> bool {
        let key = (
            url.scheme().to_string(),
            url.host_str().unwrap_or_default().to_ascii_lowercase(),
            url.port_or_known_default().unwrap_or(0),
        );
        self.test_search_routes.lock().unwrap().contains(&key)
    }

    #[cfg(not(test))]
    fn is_test_search_route(&self, _url: &Url) -> bool {
        false
    }

    /// The addresses to dial for a checked hop. Test builds dial only mapped
    /// addresses, on loopback, and never a literal host: nothing reaches the network.
    #[cfg(test)]
    fn dial_addresses(&self, target: &CheckedTarget) -> MobileResult<Vec<IpAddr>> {
        let mapped = self.test_addresses.lock().unwrap();
        if target.name.is_none() || target.addrs.iter().any(|ip| !mapped.contains(ip)) {
            return Err(network("mobile.ai.webNetworkError"));
        }
        Ok(target
            .addrs
            .iter()
            .map(|_| IpAddr::V4(Ipv4Addr::LOCALHOST))
            .collect())
    }

    #[cfg(not(test))]
    fn dial_addresses(&self, target: &CheckedTarget) -> MobileResult<Vec<IpAddr>> {
        Ok(target.addrs.clone())
    }

    /// Cancels a running search or public request (or one whose start has not arrived yet).
    pub fn cancel(&self, request_id: &str) {
        self.cancels.cancel(request_id);
    }

    /// Checks a search request. Performs no network access.
    pub fn plan_search(&self, req: &MobileAiSearchRequest) -> MobileResult<PlannedSearch> {
        let mut url =
            Url::parse(req.url.trim()).map_err(|_| refuse("mobile.ai.searchInvalidUrl"))?;
        if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
            return Err(refuse("mobile.ai.searchInvalidUrl"));
        }
        let method = match req.method.to_ascii_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "DELETE" => reqwest::Method::DELETE,
            _ => return Err(refuse("mobile.ai.searchMethod")),
        };
        let body = req.body.clone().filter(|b| !b.is_empty());
        if method != reqwest::Method::POST && body.is_some() {
            return Err(refuse("mobile.ai.searchMethod"));
        }

        let via_test_route = self.is_test_search_route(&url);
        if !via_test_route {
            let host = url
                .host_str()
                .unwrap_or_default()
                .trim_end_matches('.')
                .to_ascii_lowercase();
            if !SEARCH_HOSTS.contains(&host.as_str()) || url.port().is_some_and(|p| p != 443) {
                return Err(refuse("mobile.ai.searchHostNotAllowed"));
            }
            if url.scheme() != "https" {
                return Err(refuse("mobile.ai.searchHttpsOnly"));
            }
            // Send the name without a trailing dot so TLS checks the plain host name.
            url.set_host(Some(&host))
                .map_err(|_| refuse("mobile.ai.searchInvalidUrl"))?;
        }
        url.set_fragment(None);

        // No keys travel this way: a placeholder anywhere is refused.
        if url.as_str().contains(SEALED_MARKER)
            || body.as_deref().is_some_and(|b| b.contains(SEALED_MARKER))
            || req
                .headers
                .iter()
                .any(|(k, v)| k.contains(SEALED_MARKER) || v.contains(SEALED_MARKER))
        {
            return Err(refuse("mobile.ai.searchSealedNotAllowed"));
        }

        let mut headers = Vec::with_capacity(req.headers.len());
        for (name, value) in &req.headers {
            let lower = name.trim().to_ascii_lowercase();
            if is_dropped_request_header(&lower)
                || lower == "authorization"
                || lower == "accept-encoding"
            {
                continue;
            }
            let header_name = HeaderName::from_bytes(lower.as_bytes())
                .map_err(|_| refuse("mobile.ai.searchInvalidHeader"))?;
            let header_value = HeaderValue::from_str(value)
                .map_err(|_| refuse("mobile.ai.searchInvalidHeader"))?;
            headers.push((header_name, header_value));
        }

        Ok(PlannedSearch {
            method,
            url,
            headers,
            body,
            via_test_route,
        })
    }

    fn search_client(&self) -> MobileResult<reqwest::Client> {
        let mut slot = self.search_client.lock().unwrap();
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|_| {
                MobileError::new(MobileErrorCode::InternalError, "mobile.ai.httpClientInit")
            })?;
        *slot = Some(client.clone());
        Ok(client)
    }

    /// Runs one search request. Refusals return `Err` without events; once the
    /// request is on its way every outcome is also the final `end` or `error` event.
    pub async fn run_search<F>(&self, req: MobileAiSearchRequest, emit: F) -> MobileResult<()>
    where
        F: FnMut(MobileAiWebEvent) + Send,
    {
        let mut rx = self
            .cancels
            .register(&req.request_id, "mobile.ai.webDuplicateId")?;
        let prepared = self
            .plan_search(&req)
            .and_then(|p| Ok((p, self.search_client()?)));
        let (planned, client) = match prepared {
            Ok(ready) => ready,
            Err(err) => {
                self.cancels.finish(&req.request_id);
                return Err(err);
            }
        };
        let mut sink = EventSink {
            request_id: req.request_id.clone(),
            seq: 0,
            emit,
        };
        let outcome = {
            let exchange = Self::search_exchange(&client, planned, &mut sink);
            tokio::select! {
                _ = &mut rx => Err(cancelled()),
                res = exchange => res,
            }
        };
        self.cancels.finish(&req.request_id);
        sink.close(outcome)
    }

    async fn search_exchange<F>(
        client: &reqwest::Client,
        planned: PlannedSearch,
        sink: &mut EventSink<F>,
    ) -> MobileResult<()>
    where
        F: FnMut(MobileAiWebEvent) + Send,
    {
        // Test builds only ever send to an injected loopback route.
        if cfg!(test) && !planned.via_test_route {
            return Err(network("mobile.ai.webNetworkError"));
        }
        let shown_url = planned.url.to_string();
        let mut builder = client.request(planned.method, planned.url);
        for (name, value) in planned.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = planned.body {
            builder = builder.body(body);
        }
        let resp = builder.send().await.map_err(|e| send_error(&e))?;
        let (content_type, headers) = response_headers(&resp);
        sink.send(MobileAiWebEventKind::Head {
            status: resp.status().as_u16(),
            url: shown_url,
            content_type,
            headers,
        });
        stream_body(resp, sink, None).await
    }

    fn plan_fetch(&self, req: &MobileAiWebFetchRequest) -> MobileResult<PlannedFetch> {
        if req
            .method
            .as_deref()
            .is_some_and(|m| !m.trim().eq_ignore_ascii_case("GET"))
        {
            return Err(refuse("mobile.ai.webMethod"));
        }
        let url = parse_public_url(&req.url)?;
        let mut headers = Vec::new();
        for (name, value) in &req.headers {
            let lower = name.trim().to_ascii_lowercase();
            if !PUBLIC_REQUEST_HEADERS.contains(&lower.as_str()) {
                continue;
            }
            let header_name = HeaderName::from_bytes(lower.as_bytes())
                .map_err(|_| refuse("mobile.ai.webInvalidHeader"))?;
            let header_value =
                HeaderValue::from_str(value).map_err(|_| refuse("mobile.ai.webInvalidHeader"))?;
            headers.push((header_name, header_value));
        }
        if !headers.iter().any(|(k, _)| k.as_str() == "user-agent") {
            headers.push((
                HeaderName::from_static("user-agent"),
                HeaderValue::from_static(DEFAULT_USER_AGENT),
            ));
        }
        Ok(PlannedFetch { url, headers })
    }

    /// Resolves (once) and checks the host of one hop.
    async fn check_target(&self, url: &Url) -> MobileResult<CheckedTarget> {
        let not_public = || refuse("mobile.ai.webAddressNotPublic");
        match url.host() {
            Some(Host::Ipv4(ip)) => {
                if !is_public_address(IpAddr::V4(ip)) {
                    return Err(not_public());
                }
                Ok(CheckedTarget {
                    name: None,
                    addrs: vec![IpAddr::V4(ip)],
                })
            }
            Some(Host::Ipv6(ip)) => {
                if !is_public_address(IpAddr::V6(ip)) {
                    return Err(not_public());
                }
                Ok(CheckedTarget {
                    name: None,
                    addrs: vec![IpAddr::V6(ip)],
                })
            }
            Some(Host::Domain(raw)) => {
                let name = raw.trim_end_matches('.').to_ascii_lowercase();
                if name.is_empty() {
                    return Err(refuse("mobile.ai.webInvalidUrl"));
                }
                if name == "localhost" || BLOCKED_NAME_SUFFIXES.iter().any(|s| name.ends_with(s)) {
                    return Err(not_public());
                }
                let addrs = self
                    .resolver
                    .resolve(&name)
                    .await
                    .map_err(|_| network("mobile.ai.webResolveFailed"))?;
                if addrs.is_empty() {
                    return Err(network("mobile.ai.webResolveFailed"));
                }
                if !addrs.iter().all(|ip| resolved_address_ok(*ip)) {
                    return Err(not_public());
                }
                Ok(CheckedTarget {
                    name: Some(raw.to_string()),
                    addrs,
                })
            }
            None => Err(refuse("mobile.ai.webInvalidUrl")),
        }
    }

    /// A client for one hop whose name resolves only to the checked addresses.
    fn hop_client(&self, target: &CheckedTarget) -> MobileResult<reqwest::Client> {
        let dial = self.dial_addresses(target)?;
        let mut builder = reqwest::Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(15));
        if let Some(name) = &target.name {
            // Port 0: the URL's port (or the scheme default) is used.
            let addrs: Vec<SocketAddr> = dial.iter().map(|ip| SocketAddr::new(*ip, 0)).collect();
            builder = builder.resolve_to_addrs(name, &addrs);
        }
        builder.build().map_err(|_| {
            MobileError::new(MobileErrorCode::InternalError, "mobile.ai.httpClientInit")
        })
    }

    /// Runs one public request. Pre-network refusals return `Err` without
    /// events; from the address check on every outcome is also the final event.
    pub async fn run_fetch<F>(&self, req: MobileAiWebFetchRequest, emit: F) -> MobileResult<()>
    where
        F: FnMut(MobileAiWebEvent) + Send,
    {
        let mut rx = self
            .cancels
            .register(&req.request_id, "mobile.ai.webDuplicateId")?;
        let planned = match self.plan_fetch(&req) {
            Ok(p) => p,
            Err(err) => {
                self.cancels.finish(&req.request_id);
                return Err(err);
            }
        };
        let limits = *self.limits.lock().unwrap();
        let mut sink = EventSink {
            request_id: req.request_id.clone(),
            seq: 0,
            emit,
        };
        let outcome = {
            let exchange = tokio::time::timeout(
                limits.total,
                self.fetch_exchange(planned, limits.max_bytes, &mut sink),
            );
            tokio::select! {
                _ = &mut rx => Err(cancelled()),
                res = exchange => res.unwrap_or_else(|_| Err(network("mobile.ai.webTimeout"))),
            }
        };
        self.cancels.finish(&req.request_id);
        sink.close(outcome)
    }

    async fn fetch_exchange<F>(
        &self,
        planned: PlannedFetch,
        max_bytes: u64,
        sink: &mut EventSink<F>,
    ) -> MobileResult<()>
    where
        F: FnMut(MobileAiWebEvent) + Send,
    {
        let PlannedFetch { mut url, headers } = planned;
        let mut redirects: u32 = 0;
        loop {
            let target = self.check_target(&url).await?;
            let client = self.hop_client(&target)?;
            let mut builder = client.get(url.clone());
            for (name, value) in &headers {
                builder = builder.header(name.clone(), value.clone());
            }
            let resp = builder.send().await.map_err(|e| send_error(&e))?;
            let status = resp.status().as_u16();
            if matches!(status, 301 | 302 | 303 | 307 | 308)
                && let Some(location) = resp.headers().get(LOCATION)
            {
                if redirects >= WEB_MAX_REDIRECTS {
                    return Err(network("mobile.ai.webTooManyRedirects"));
                }
                redirects += 1;
                let location = location
                    .to_str()
                    .map_err(|_| refuse("mobile.ai.webInvalidUrl"))?;
                let next = url
                    .join(location)
                    .map_err(|_| refuse("mobile.ai.webInvalidUrl"))?;
                url = parse_public_url(next.as_str())?;
                continue;
            }
            if resp.content_length().is_some_and(|len| len > max_bytes) {
                return Err(too_large());
            }
            let (content_type, out_headers) = response_headers(&resp);
            sink.send(MobileAiWebEventKind::Head {
                status,
                url: url.to_string(),
                content_type,
                headers: out_headers,
            });
            return stream_body(resp, sink, Some(max_bytes)).await;
        }
    }
}
