//! Tests for the search requests and the public address requests.
//!
//! No test touches the outside network. Search requests reach a loopback
//! server only through a route injected with `allow_test_search_route`. Public
//! requests resolve names with an injected resolver, and in test builds a
//! checked address is connected only when a test maps it to loopback with
//! `map_test_address`; an unmapped address fails closed.

use crate::ai::web::{
    MobileAiSearchRequest, MobileAiWeb, MobileAiWebEvent, MobileAiWebEventKind,
    MobileAiWebFetchRequest, ResolveFuture, WEB_MAX_BYTES, WEB_MAX_REDIRECTS, WEB_TOTAL_TIMEOUT,
    WebResolver, is_public_address, search_hosts,
};
use crate::error::{MobileError, MobileErrorCode};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use std::collections::BTreeMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// ---------------------------------------------------------------------------
// Loopback server

enum MockReply {
    /// Writes these bytes and closes.
    Raw(Vec<u8>),
    /// Writes these bytes and keeps the connection open.
    Hang(Vec<u8>),
}

type Handler = Arc<dyn Fn(&str) -> MockReply + Send + Sync>;

struct MockServer {
    port: u16,
    hits: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<String>>>,
}

impl MockServer {
    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
    fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
    fn last_request(&self) -> String {
        self.requests
            .lock()
            .unwrap()
            .last()
            .cloned()
            .unwrap_or_default()
    }
}

async fn spawn_server(handler: Handler) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let (hits_c, req_c) = (hits.clone(), requests.clone());
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            hits_c.fetch_add(1, Ordering::SeqCst);
            let handler = handler.clone();
            let req_c = req_c.clone();
            tokio::spawn(async move {
                let raw = read_request(&mut sock).await;
                req_c.lock().unwrap().push(raw.clone());
                match handler(&raw) {
                    MockReply::Raw(bytes) => {
                        let _ = sock.write_all(&bytes).await;
                        let _ = sock.shutdown().await;
                    }
                    MockReply::Hang(bytes) => {
                        let _ = sock.write_all(&bytes).await;
                        let _ = sock.flush().await;
                        tokio::time::sleep(Duration::from_secs(60)).await;
                    }
                }
            });
        }
    });
    MockServer {
        port,
        hits,
        requests,
    }
}

async fn read_request(sock: &mut tokio::net::TcpStream) -> String {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let n = sock.read(&mut tmp).await.unwrap_or(0);
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        let text = String::from_utf8_lossy(&buf).to_string();
        if let Some((head, body)) = text.split_once("\r\n\r\n") {
            let len = head
                .lines()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    k.trim()
                        .eq_ignore_ascii_case("content-length")
                        .then(|| v.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if body.len() >= len {
                break;
            }
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}

fn response(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut head = format!(
        "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(body);
    out
}

fn fixed(
    status: u16,
    headers: &'static [(&'static str, &'static str)],
    body: &'static str,
) -> Handler {
    Arc::new(move |_| MockReply::Raw(response(status, headers, body.as_bytes())))
}

fn request_path(raw: &str) -> String {
    raw.lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_string()
}

fn request_header(raw: &str, name: &str) -> Option<String> {
    let head = raw.split("\r\n\r\n").next().unwrap_or_default();
    head.lines().skip(1).find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim()
            .eq_ignore_ascii_case(name)
            .then(|| v.trim().to_string())
    })
}

// ---------------------------------------------------------------------------
// Injected resolver

#[derive(Default)]
struct MapResolver {
    answers: Mutex<BTreeMap<String, Vec<Vec<IpAddr>>>>,
    calls: AtomicUsize,
}

impl MapResolver {
    /// Each call for `host` takes the next answer; the last answer repeats.
    fn answer(&self, host: &str, answers: &[&[&str]]) {
        self.answers.lock().unwrap().insert(
            host.to_string(),
            answers
                .iter()
                .map(|list| list.iter().map(|a| a.parse().unwrap()).collect())
                .collect(),
        );
    }
    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl WebResolver for MapResolver {
    fn resolve(&self, host: &str) -> ResolveFuture {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut map = self.answers.lock().unwrap();
        let out = match map.get_mut(host) {
            Some(list) if list.len() > 1 => Ok(list.remove(0)),
            Some(list) => Ok(list[0].clone()),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no such host",
            )),
        };
        Box::pin(async move { out })
    }
}

/// A public-looking address that tests map to loopback (never contacted).
const PUBLIC_A: &str = "93.184.216.34";
const PUBLIC_B: &str = "151.101.1.69";

fn web_with(resolver: Arc<MapResolver>) -> MobileAiWeb {
    let web = MobileAiWeb::with_resolver(resolver);
    web.map_test_address(PUBLIC_A.parse().unwrap());
    web.map_test_address(PUBLIC_B.parse().unwrap());
    web
}

fn fetch_req(url: &str, headers: &[(&str, &str)]) -> MobileAiWebFetchRequest {
    MobileAiWebFetchRequest {
        request_id: "web-1".into(),
        url: url.into(),
        method: None,
        headers: headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    }
}

fn search_req(
    url: &str,
    method: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> MobileAiSearchRequest {
    MobileAiSearchRequest {
        request_id: "search-1".into(),
        url: url.into(),
        method: method.into(),
        headers: headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        body: body.map(ToString::to_string),
    }
}

type Outcome = (Result<(), MobileError>, Vec<MobileAiWebEvent>);

async fn fetch(web: &MobileAiWeb, req: MobileAiWebFetchRequest) -> Outcome {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let res = web
        .run_fetch(req, move |ev| sink.lock().unwrap().push(ev))
        .await;
    let out = events.lock().unwrap().clone();
    (res, out)
}

async fn search(web: &MobileAiWeb, req: MobileAiSearchRequest) -> Outcome {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let res = web
        .run_search(req, move |ev| sink.lock().unwrap().push(ev))
        .await;
    let out = events.lock().unwrap().clone();
    (res, out)
}

fn body_of(events: &[MobileAiWebEvent]) -> Vec<u8> {
    let mut out = Vec::new();
    for ev in events {
        if let MobileAiWebEventKind::Chunk { data_base64 } = &ev.event {
            out.extend(STANDARD.decode(data_base64).unwrap());
        }
    }
    out
}

fn head_of(events: &[MobileAiWebEvent]) -> (u16, String, Option<String>, Vec<(String, String)>) {
    events
        .iter()
        .find_map(|ev| match &ev.event {
            MobileAiWebEventKind::Head {
                status,
                url,
                content_type,
                headers,
            } => Some((*status, url.clone(), content_type.clone(), headers.clone())),
            _ => None,
        })
        .expect("head event")
}

fn assert_err(res: &Result<(), MobileError>, code: MobileErrorCode, key: &str) {
    let err = res.as_ref().expect_err("expected a refusal");
    assert_eq!(err.message_key, key, "{err:?}");
    assert_eq!(err.code, code, "{err:?}");
    assert!(
        err.detail.is_none(),
        "errors carry machine codes only: {err:?}"
    );
}

/// A refusal before the network: rejected, no events.
fn assert_refused_early(outcome: &Outcome, key: &str) {
    assert_err(&outcome.0, MobileErrorCode::InvalidArgument, key);
    assert!(outcome.1.is_empty(), "no events for {key}: {:?}", outcome.1);
}

/// A failure once the request has started: rejected, and the last event is the same error.
fn assert_failed(outcome: &Outcome, code: MobileErrorCode, key: &str) {
    assert_err(&outcome.0, code, key);
    match &outcome.1.last().expect("an error event").event {
        MobileAiWebEventKind::Error {
            code: c,
            message_key,
        } => {
            assert_eq!(message_key, key);
            assert_eq!(*c, code);
        }
        other => panic!("last event must be the error, got {other:?}"),
    }
    for (i, ev) in outcome.1.iter().enumerate() {
        assert_eq!(ev.seq, i as u64);
    }
}

// ---------------------------------------------------------------------------
// Address table

#[test]
fn address_table_refuses_every_non_public_range() {
    let refused = [
        // IPv4
        "0.0.0.0",
        "0.1.2.3",
        "10.0.0.1",
        "10.255.255.255",
        "100.64.0.1",
        "100.127.255.254",
        "127.0.0.1",
        "127.1.2.3",
        "169.254.169.254",
        "172.16.0.1",
        "172.31.255.255",
        "192.0.0.8",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.0.1",
        "192.168.255.255",
        "198.18.0.1",
        "198.19.255.255",
        "198.51.100.7",
        "203.0.113.9",
        "224.0.0.1",
        "239.255.255.250",
        "240.0.0.1",
        "255.255.255.255",
        // IPv6
        "::",
        "::1",
        "::127.0.0.1",
        "::8.8.8.8",
        "::ffff:127.0.0.1",
        "::ffff:10.1.2.3",
        "::ffff:169.254.169.254",
        "::ffff:192.168.1.1",
        "::ffff:0.0.0.0",
        "64:ff9b::7f00:1",
        "64:ff9b::a00:1",
        "64:ff9b:1::1",
        "100::1",
        "2001::1",
        "2001:db8::1",
        "2002:7f00:1::",
        "2002:c0a8:101::1",
        "3fff::1",
        "fc00::1",
        "fd12:3456::1",
        "fe80::1",
        "febf::1",
        "fec0::1",
        "ff02::1",
        "ff0e::1",
    ];
    for ip in refused {
        assert!(
            !is_public_address(ip.parse().unwrap()),
            "{ip} must be refused"
        );
    }
    let allowed = [
        "1.1.1.1",
        "8.8.8.8",
        "93.184.216.34",
        "100.63.255.255",
        "100.128.0.1",
        "172.15.255.255",
        "172.32.0.1",
        "192.169.0.1",
        "198.17.255.255",
        "198.20.0.1",
        "223.255.255.255",
        "2606:4700:4700::1111",
        "2a00:1450:4001:80b::200e",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808",
        "2002:808:808::1",
    ];
    for ip in allowed {
        assert!(
            is_public_address(ip.parse().unwrap()),
            "{ip} must be allowed"
        );
    }
}

#[test]
fn limits_match_the_pc_read_url_rules() {
    assert_eq!(WEB_MAX_BYTES, 10 * 1024 * 1024);
    assert_eq!(WEB_TOTAL_TIMEOUT, Duration::from_secs(30));
    assert_eq!(WEB_MAX_REDIRECTS, 5);
    assert_eq!(
        search_hosts(),
        &[
            "search.parallel.ai",
            "html.duckduckgo.com",
            "duckduckgo.com"
        ]
    );
}

// ---------------------------------------------------------------------------
// Search requests

#[test]
fn search_plan_allows_only_the_fixed_hosts_over_https() {
    let web = MobileAiWeb::with_resolver(Arc::new(MapResolver::default()));
    for (url, method, body) in [
        ("https://search.parallel.ai/mcp", "POST", Some("{}")),
        ("https://search.parallel.ai/mcp", "DELETE", None),
        ("https://html.duckduckgo.com/html/?q=a", "GET", None),
        ("https://html.duckduckgo.com/html/", "POST", Some("q=a")),
        ("https://duckduckgo.com/?q=a&iax=images", "GET", None),
        ("https://duckduckgo.com/i.js?q=a&vqd=1", "get", None),
        ("https://DuckDuckGo.com./i.js", "GET", None),
    ] {
        web.plan_search(&search_req(url, method, &[], body))
            .unwrap_or_else(|e| panic!("{url} {method}: {e:?}"));
    }
    let cases: &[(&str, &str, Option<&str>, &str)] = &[
        (
            "http://search.parallel.ai/mcp",
            "POST",
            Some("{}"),
            "mobile.ai.searchHttpsOnly",
        ),
        (
            "https://api.parallel.ai/v1/search",
            "POST",
            Some("{}"),
            "mobile.ai.searchHostNotAllowed",
        ),
        (
            "https://duckduckgo.com.evil.example/",
            "GET",
            None,
            "mobile.ai.searchHostNotAllowed",
        ),
        (
            "https://links.duckduckgo.com/d.js",
            "GET",
            None,
            "mobile.ai.searchHostNotAllowed",
        ),
        (
            "https://duckduckgo.com:8443/",
            "GET",
            None,
            "mobile.ai.searchHostNotAllowed",
        ),
        (
            "https://user:pw@duckduckgo.com/",
            "GET",
            None,
            "mobile.ai.searchInvalidUrl",
        ),
        ("not a url", "GET", None, "mobile.ai.searchInvalidUrl"),
        (
            "https://duckduckgo.com/",
            "PUT",
            Some("x"),
            "mobile.ai.searchMethod",
        ),
        (
            "https://duckduckgo.com/",
            "GET",
            Some("x"),
            "mobile.ai.searchMethod",
        ),
        (
            "https://search.parallel.ai/mcp",
            "DELETE",
            Some("x"),
            "mobile.ai.searchMethod",
        ),
        (
            "https://duckduckgo.com/?k=__sealed__:openai",
            "GET",
            None,
            "mobile.ai.searchSealedNotAllowed",
        ),
        (
            "https://search.parallel.ai/mcp",
            "POST",
            Some("{\"k\":\"__sealed__:gemini\"}"),
            "mobile.ai.searchSealedNotAllowed",
        ),
    ];
    for (url, method, body, key) in cases {
        let err = web
            .plan_search(&search_req(url, method, &[], *body))
            .expect_err(url);
        assert_eq!(err.message_key, *key, "{url} {method}");
        assert_eq!(err.code, MobileErrorCode::InvalidArgument);
    }
    let err = web
        .plan_search(&search_req(
            "https://duckduckgo.com/",
            "GET",
            &[("x-key", "Bearer __sealed__:openai")],
            None,
        ))
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.searchSealedNotAllowed");
    let err = web
        .plan_search(&search_req(
            "https://duckduckgo.com/",
            "GET",
            &[("bad header", "x")],
            None,
        ))
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.searchInvalidHeader");
}

#[tokio::test]
async fn search_refusals_do_not_reach_the_network() {
    let server = spawn_server(fixed(200, &[], "ok")).await;
    let web = MobileAiWeb::with_resolver(Arc::new(MapResolver::default()));
    // The loopback origin is not a search host unless a test route says so.
    let out = search(
        &web,
        search_req(&format!("{}/mcp", server.origin()), "POST", &[], Some("{}")),
    )
    .await;
    assert_refused_early(&out, "mobile.ai.searchHostNotAllowed");
    web.allow_test_search_route(&server.origin());
    let out = search(
        &web,
        search_req(
            &format!("{}/mcp", server.origin()),
            "PATCH",
            &[],
            Some("{}"),
        ),
    )
    .await;
    assert_refused_early(&out, "mobile.ai.searchMethod");
    assert_eq!(server.hits(), 0);
}

#[tokio::test]
async fn search_streams_status_headers_and_sse_body_without_cookies() {
    let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n";
    let server = spawn_server(Arc::new(move |_raw: &str| {
        MockReply::Raw(response(
            200,
            &[
                ("Content-Type", "text/event-stream"),
                ("Mcp-Session-Id", "session-123"),
                ("Set-Cookie", "track=1"),
            ],
            sse.as_bytes(),
        ))
    }))
    .await;
    let web = MobileAiWeb::with_resolver(Arc::new(MapResolver::default()));
    web.allow_test_search_route(&server.origin());
    let url = format!("{}/mcp", server.origin());
    let out = search(
        &web,
        search_req(
            &url,
            "POST",
            &[
                ("Content-Type", "application/json"),
                ("Accept", "application/json, text/event-stream"),
                ("Mcp-Protocol-Version", "2025-06-18"),
                ("Cookie", "a=b"),
                ("Authorization", "Bearer nope"),
                ("Accept-Encoding", "gzip"),
                ("Host", "evil.example"),
            ],
            Some("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}"),
        ),
    )
    .await;
    out.0.as_ref().unwrap();
    let (status, head_url, content_type, headers) = head_of(&out.1);
    assert_eq!(status, 200);
    assert_eq!(head_url, url);
    assert_eq!(content_type.as_deref(), Some("text/event-stream"));
    assert!(
        headers
            .iter()
            .any(|(k, v)| k == "mcp-session-id" && v == "session-123")
    );
    assert!(!headers.iter().any(|(k, _)| k.starts_with("set-cookie")));
    assert_eq!(body_of(&out.1), sse.as_bytes());
    assert!(matches!(
        out.1.last().unwrap().event,
        MobileAiWebEventKind::End
    ));
    for (i, ev) in out.1.iter().enumerate() {
        assert_eq!(ev.seq, i as u64);
        assert_eq!(ev.request_id, "search-1");
    }

    let raw = server.last_request();
    assert!(raw.starts_with("POST /mcp "), "{raw}");
    assert_eq!(
        request_header(&raw, "mcp-protocol-version").as_deref(),
        Some("2025-06-18")
    );
    assert!(request_header(&raw, "cookie").is_none());
    assert!(request_header(&raw, "authorization").is_none());
    assert!(request_header(&raw, "accept-encoding").is_none());
    assert_ne!(
        request_header(&raw, "host").as_deref(),
        Some("evil.example")
    );
    assert!(raw.ends_with("\"method\":\"initialize\"}"));

    // Ending the MCP session.
    let mut del = search_req(&url, "DELETE", &[("Mcp-Session-Id", "session-123")], None);
    del.request_id = "search-2".into();
    let out = search(&web, del).await;
    out.0.as_ref().unwrap();
    let raw = server.last_request();
    assert!(raw.starts_with("DELETE /mcp "), "{raw}");
    assert_eq!(
        request_header(&raw, "mcp-session-id").as_deref(),
        Some("session-123")
    );
}

#[tokio::test]
async fn search_does_not_follow_redirects_and_passes_them_through() {
    let server = spawn_server(fixed(
        302,
        &[("Location", "http://127.0.0.1:1/elsewhere")],
        "",
    ))
    .await;
    let web = MobileAiWeb::with_resolver(Arc::new(MapResolver::default()));
    web.allow_test_search_route(&server.origin());
    let out = search(
        &web,
        search_req(&format!("{}/html/", server.origin()), "GET", &[], None),
    )
    .await;
    out.0.as_ref().unwrap();
    let (status, _, _, headers) = head_of(&out.1);
    assert_eq!(status, 302);
    assert!(headers.iter().any(|(k, _)| k == "location"));
    assert_eq!(server.hits(), 1);
}

#[tokio::test]
async fn search_cancel_stops_a_running_request() {
    let head = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n".to_vec();
    let server = spawn_server(Arc::new(move |_| MockReply::Hang(head.clone()))).await;
    let web = Arc::new(MobileAiWeb::with_resolver(Arc::new(MapResolver::default())));
    web.allow_test_search_route(&server.origin());
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let runner = web.clone();
    let url = format!("{}/mcp", server.origin());
    let task = tokio::spawn(async move {
        runner
            .run_search(search_req(&url, "POST", &[], Some("{}")), move |ev| {
                sink.lock().unwrap().push(ev)
            })
            .await
    });
    for _ in 0..200 {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e.event, MobileAiWebEventKind::Chunk { .. }))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    web.cancel("search-1");
    let res = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    let out = (res, events.lock().unwrap().clone());
    assert_failed(&out, MobileErrorCode::UserCancelled, "mobile.ai.cancelled");
    assert_eq!(body_of(&out.1), b"hello");
}

// ---------------------------------------------------------------------------
// Public address requests

#[tokio::test]
async fn fetch_reads_a_public_page_with_only_the_allowed_headers() {
    let server = spawn_server(fixed(
        200,
        &[
            ("Content-Type", "text/html; charset=utf-8"),
            ("Set-Cookie", "s=1"),
        ],
        "<p>hi</p>",
    ))
    .await;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("site.test", &[&[PUBLIC_A]]);
    let web = web_with(resolver.clone());
    let url = format!("http://site.test:{}/page?x=1#frag", server.port);
    let out = fetch(
        &web,
        fetch_req(
            &url,
            &[
                ("Accept", "text/html"),
                ("Accept-Language", "ko"),
                ("User-Agent", "TestAgent/1"),
                ("Cookie", "a=b"),
                ("Authorization", "Bearer x"),
                ("Referer", "https://inside.example/"),
                ("X-Custom", "1"),
            ],
        ),
    )
    .await;
    out.0.as_ref().unwrap();
    let (status, final_url, content_type, headers) = head_of(&out.1);
    assert_eq!(status, 200);
    assert_eq!(
        final_url,
        format!("http://site.test:{}/page?x=1", server.port)
    );
    assert_eq!(content_type.as_deref(), Some("text/html; charset=utf-8"));
    assert!(!headers.iter().any(|(k, _)| k.starts_with("set-cookie")));
    assert_eq!(body_of(&out.1), b"<p>hi</p>");
    assert!(matches!(
        out.1.last().unwrap().event,
        MobileAiWebEventKind::End
    ));

    let raw = server.last_request();
    assert!(raw.starts_with("GET /page?x=1 "), "{raw}");
    assert_eq!(request_header(&raw, "accept").as_deref(), Some("text/html"));
    assert_eq!(
        request_header(&raw, "accept-language").as_deref(),
        Some("ko")
    );
    assert_eq!(
        request_header(&raw, "user-agent").as_deref(),
        Some("TestAgent/1")
    );
    for dropped in ["cookie", "authorization", "referer", "x-custom"] {
        assert!(
            request_header(&raw, dropped).is_none(),
            "{dropped} must not be sent"
        );
    }
    assert_eq!(resolver.calls(), 1);

    // Without a user agent from the webview a plain one is sent (the PC read_url default).
    let mut req = fetch_req(&format!("http://site.test:{}/", server.port), &[]);
    req.request_id = "web-2".into();
    fetch(&web, req).await.0.unwrap();
    assert_eq!(
        request_header(&server.last_request(), "user-agent").as_deref(),
        Some("Mozilla/5.0")
    );
}

#[tokio::test]
async fn fetch_refuses_names_that_resolve_to_non_public_addresses() {
    let server = spawn_server(fixed(200, &[], "secret")).await;
    for answer in [
        vec!["127.0.0.1"],
        vec!["10.1.2.3"],
        vec!["172.20.0.5"],
        vec!["192.168.0.10"],
        vec!["169.254.169.254"],
        vec!["100.100.100.200"],
        vec!["::1"],
        vec!["fd00::5"],
        vec!["fe80::1"],
        vec!["::ffff:127.0.0.1"],
        vec!["0.0.0.0"],
        vec!["224.0.0.251"],
        // One bad answer among good ones is enough to refuse.
        vec![PUBLIC_A, "10.0.0.1"],
        vec!["::1", PUBLIC_B],
    ] {
        let resolver = Arc::new(MapResolver::default());
        let list: Vec<&str> = answer.clone();
        resolver.answer("inside.test", &[&list]);
        let web = web_with(resolver);
        for ip in &answer {
            // Even when mapped to loopback, a refused address is never connected.
            web.map_test_address(ip.parse().unwrap());
        }
        let out = fetch(
            &web,
            fetch_req(&format!("http://inside.test:{}/", server.port), &[]),
        )
        .await;
        assert_failed(
            &out,
            MobileErrorCode::InvalidArgument,
            "mobile.ai.webAddressNotPublic",
        );
        assert!(
            !out.1
                .iter()
                .any(|e| matches!(e.event, MobileAiWebEventKind::Head { .. }))
        );
    }
    assert_eq!(server.hits(), 0);
}

#[tokio::test]
async fn fetch_allows_a_vpn_fake_ip_answer_for_a_name_but_not_as_a_literal() {
    let server = spawn_server(fixed(200, &[], "ok")).await;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("proxied.test", &[&["198.18.0.7"]]);
    let web = web_with(resolver);
    web.map_test_address("198.18.0.7".parse().unwrap());
    let out = fetch(
        &web,
        fetch_req(&format!("http://proxied.test:{}/", server.port), &[]),
    )
    .await;
    out.0.unwrap();
    let mut req = fetch_req("http://198.18.0.7/", &[]);
    req.request_id = "web-2".into();
    let out = fetch(&web, req).await;
    assert_failed(
        &out,
        MobileErrorCode::InvalidArgument,
        "mobile.ai.webAddressNotPublic",
    );
    assert_eq!(server.hits(), 1);
}

#[tokio::test]
async fn fetch_refuses_literal_and_local_hosts_without_dns() {
    let resolver = Arc::new(MapResolver::default());
    let web = web_with(resolver.clone());
    let cases = [
        "http://127.0.0.1:9/",
        "http://2130706433/",
        "http://0x7f.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:7f00:1]/",
        "http://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[fe80::1]/",
        "http://0.0.0.0/",
        "http://localhost/",
        "http://LOCALHOST./",
        "http://api.localhost/",
        "http://printer.local/",
        "http://metadata.google.internal/",
    ];
    for (i, url) in cases.iter().enumerate() {
        let mut req = fetch_req(url, &[]);
        req.request_id = format!("lit-{i}");
        let out = fetch(&web, req).await;
        assert_failed(
            &out,
            MobileErrorCode::InvalidArgument,
            "mobile.ai.webAddressNotPublic",
        );
    }
    assert_eq!(resolver.calls(), 0);
}

#[tokio::test]
async fn fetch_refuses_bad_urls_methods_and_headers_before_the_network() {
    let web = web_with(Arc::new(MapResolver::default()));
    for (url, key) in [
        ("ftp://site.test/x", "mobile.ai.webSchemeNotAllowed"),
        ("file:///etc/passwd", "mobile.ai.webSchemeNotAllowed"),
        ("data:text/plain,hi", "mobile.ai.webSchemeNotAllowed"),
        ("ai-result://x.png", "mobile.ai.webSchemeNotAllowed"),
        ("http://user:pw@site.test/", "mobile.ai.webInvalidUrl"),
        ("not a url", "mobile.ai.webInvalidUrl"),
    ] {
        let out = fetch(&web, fetch_req(url, &[])).await;
        assert_refused_early(&out, key);
    }
    let mut req = fetch_req("http://site.test/", &[]);
    req.method = Some("POST".into());
    assert_refused_early(&fetch(&web, req).await, "mobile.ai.webMethod");
    let mut req = fetch_req("http://site.test/", &[]);
    req.method = Some("get".into());
    // GET spelled in any case is fine (it fails later only because the name does not resolve).
    let out = fetch(&web, req).await;
    assert_failed(
        &out,
        MobileErrorCode::NetworkError,
        "mobile.ai.webResolveFailed",
    );
    let out = fetch(
        &web,
        fetch_req("http://site.test/", &[("User-Agent", "a\nb")]),
    )
    .await;
    assert_refused_early(&out, "mobile.ai.webInvalidHeader");
}

#[tokio::test]
async fn fetch_reports_dns_failures_as_codes() {
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("empty.test", &[&[]]);
    let web = web_with(resolver);
    let out = fetch(&web, fetch_req("http://missing.test/", &[])).await;
    assert_failed(
        &out,
        MobileErrorCode::NetworkError,
        "mobile.ai.webResolveFailed",
    );
    let mut req = fetch_req("http://empty.test/", &[]);
    req.request_id = "web-2".into();
    let out = fetch(&web, req).await;
    assert_failed(
        &out,
        MobileErrorCode::NetworkError,
        "mobile.ai.webResolveFailed",
    );
}

fn redirect_chain() -> Handler {
    // /r/<n> redirects to /r/<n-1> (relative), /r/0 answers.
    Arc::new(|raw: &str| {
        let path = request_path(raw);
        let n: u32 = path.trim_start_matches("/r/").parse().unwrap_or(0);
        if n == 0 {
            MockReply::Raw(response(200, &[("Content-Type", "text/plain")], b"done"))
        } else {
            let loc = format!("/r/{}", n - 1);
            MockReply::Raw(response(302, &[("Location", &loc)], b""))
        }
    })
}

#[tokio::test]
async fn fetch_follows_up_to_five_redirects_and_refuses_the_sixth() {
    let server = spawn_server(redirect_chain()).await;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("site.test", &[&[PUBLIC_A]]);
    let web = web_with(resolver.clone());

    let out = fetch(
        &web,
        fetch_req(&format!("http://site.test:{}/r/5", server.port), &[]),
    )
    .await;
    out.0.as_ref().unwrap();
    let (status, final_url, _, _) = head_of(&out.1);
    assert_eq!(status, 200);
    assert_eq!(final_url, format!("http://site.test:{}/r/0", server.port));
    assert_eq!(body_of(&out.1), b"done");
    assert_eq!(server.hits(), 6);
    // Every hop is checked again (one resolution per hop).
    assert_eq!(resolver.calls(), 6);

    let mut req = fetch_req(&format!("http://site.test:{}/r/6", server.port), &[]);
    req.request_id = "web-2".into();
    let out = fetch(&web, req).await;
    assert_failed(
        &out,
        MobileErrorCode::NetworkError,
        "mobile.ai.webTooManyRedirects",
    );
    assert!(
        !out.1
            .iter()
            .any(|e| matches!(e.event, MobileAiWebEventKind::Head { .. }))
    );
    assert_eq!(server.hits(), 6 + 6);
}

#[tokio::test]
async fn fetch_checks_every_redirect_target_again() {
    let port_holder = Arc::new(Mutex::new(0u16));
    let ph = port_holder.clone();
    let server = spawn_server(Arc::new(move |raw: &str| {
        let port = *ph.lock().unwrap();
        let loc = match request_path(raw).as_str() {
            "/to-private-name" => format!("http://inside.test:{port}/"),
            "/to-loopback" => format!("http://127.0.0.1:{port}/"),
            "/to-ftp" => "ftp://site.test/file".to_string(),
            "/to-credentials" => format!("http://user:pw@site.test:{port}/"),
            "/to-other-public" => format!("http://other.test:{port}/landing"),
            "/no-location" => return MockReply::Raw(response(302, &[], b"moved")),
            _ => return MockReply::Raw(response(200, &[], b"landed")),
        };
        MockReply::Raw(response(301, &[("Location", &loc)], b""))
    }))
    .await;
    *port_holder.lock().unwrap() = server.port;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("site.test", &[&[PUBLIC_A]]);
    resolver.answer("other.test", &[&[PUBLIC_B]]);
    resolver.answer("inside.test", &[&["192.168.1.20"]]);
    let web = web_with(resolver);
    web.map_test_address("192.168.1.20".parse().unwrap());

    let cases: &[(&str, MobileErrorCode, &str)] = &[
        (
            "/to-private-name",
            MobileErrorCode::InvalidArgument,
            "mobile.ai.webAddressNotPublic",
        ),
        (
            "/to-loopback",
            MobileErrorCode::InvalidArgument,
            "mobile.ai.webAddressNotPublic",
        ),
        (
            "/to-ftp",
            MobileErrorCode::InvalidArgument,
            "mobile.ai.webSchemeNotAllowed",
        ),
        (
            "/to-credentials",
            MobileErrorCode::InvalidArgument,
            "mobile.ai.webInvalidUrl",
        ),
    ];
    for (i, (path, code, key)) in cases.iter().enumerate() {
        let mut req = fetch_req(&format!("http://site.test:{}{path}", server.port), &[]);
        req.request_id = format!("hop-{i}");
        let out = fetch(&web, req).await;
        assert_failed(&out, *code, key);
    }
    // Only the first hop of each refused chain reached the server.
    assert_eq!(server.hits(), cases.len());

    let mut req = fetch_req(
        &format!("http://site.test:{}/to-other-public", server.port),
        &[],
    );
    req.request_id = "hop-ok".into();
    let out = fetch(&web, req).await;
    out.0.as_ref().unwrap();
    assert_eq!(
        head_of(&out.1).1,
        format!("http://other.test:{}/landing", server.port)
    );
    assert_eq!(body_of(&out.1), b"landed");

    // A 3xx without Location is an ordinary response.
    let mut req = fetch_req(
        &format!("http://site.test:{}/no-location", server.port),
        &[],
    );
    req.request_id = "hop-noloc".into();
    let out = fetch(&web, req).await;
    out.0.as_ref().unwrap();
    assert_eq!(head_of(&out.1).0, 302);
}

#[tokio::test]
async fn fetch_connects_to_the_checked_address_without_resolving_again() {
    let server = spawn_server(fixed(200, &[], "pinned")).await;
    let resolver = Arc::new(MapResolver::default());
    // A rebinding name: the first answer is public, every later one private.
    resolver.answer("rebind.test", &[&[PUBLIC_A], &["10.0.0.1"]]);
    let web = web_with(resolver.clone());
    let out = fetch(
        &web,
        fetch_req(&format!("http://rebind.test:{}/", server.port), &[]),
    )
    .await;
    out.0.as_ref().unwrap();
    assert_eq!(body_of(&out.1), b"pinned");
    assert_eq!(resolver.calls(), 1, "the name is resolved once per hop");
}

#[tokio::test]
async fn unmapped_addresses_fail_closed_in_tests() {
    // Guards the test harness itself: a checked public address without a loopback
    // mapping must never be dialled.
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("unmapped.test", &[&["8.8.4.4"]]);
    let web = MobileAiWeb::with_resolver(resolver);
    let out = fetch(&web, fetch_req("http://unmapped.test/", &[])).await;
    assert_failed(
        &out,
        MobileErrorCode::NetworkError,
        "mobile.ai.webNetworkError",
    );
    let mut req = fetch_req("http://8.8.4.4/", &[]);
    req.request_id = "web-2".into();
    let out = fetch(&web, req).await;
    assert_failed(
        &out,
        MobileErrorCode::NetworkError,
        "mobile.ai.webNetworkError",
    );
}

#[tokio::test]
async fn fetch_refuses_bodies_over_the_cap() {
    // Announced too large: refused before any body is passed on.
    let big = WEB_MAX_BYTES + 1;
    let head =
        format!("HTTP/1.1 200 OK\r\nContent-Length: {big}\r\nContent-Type: image/png\r\n\r\n");
    let server = spawn_server(Arc::new(move |_| {
        MockReply::Hang(head.clone().into_bytes())
    }))
    .await;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("site.test", &[&[PUBLIC_A]]);
    let web = web_with(resolver.clone());
    let out = fetch(
        &web,
        fetch_req(&format!("http://site.test:{}/big.png", server.port), &[]),
    )
    .await;
    assert_failed(&out, MobileErrorCode::FileTooLarge, "mobile.ai.webTooLarge");
    assert!(body_of(&out.1).is_empty());

    // Streamed without a length: stops once the cap is passed.
    let chunked = spawn_server(Arc::new(|_| {
        let piece = vec![b'a'; 1500];
        let mut out =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
        out.extend(format!("{:x}\r\n", piece.len()).into_bytes());
        out.extend(&piece);
        out.extend(b"\r\n0\r\n\r\n");
        MockReply::Raw(out)
    }))
    .await;
    let small = web_with(resolver.clone());
    small.set_test_limits(Duration::from_secs(5), 1024);
    let out = fetch(
        &small,
        fetch_req(&format!("http://site.test:{}/stream", chunked.port), &[]),
    )
    .await;
    assert_failed(&out, MobileErrorCode::FileTooLarge, "mobile.ai.webTooLarge");
    assert!(body_of(&out.1).len() <= 1024);

    // Exactly the cap is fine.
    let exact = spawn_server(Arc::new(|_| {
        MockReply::Raw(response(200, &[], &[b'b'; 1024]))
    }))
    .await;
    let mut req = fetch_req(&format!("http://site.test:{}/exact", exact.port), &[]);
    req.request_id = "web-3".into();
    let out = fetch(&small, req).await;
    out.0.as_ref().unwrap();
    assert_eq!(body_of(&out.1).len(), 1024);
}

#[tokio::test]
async fn fetch_stops_at_the_total_time_limit() {
    let head = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n".to_vec();
    let server = spawn_server(Arc::new(move |_| MockReply::Hang(head.clone()))).await;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("slow.test", &[&[PUBLIC_A]]);
    let web = web_with(resolver);
    web.set_test_limits(Duration::from_millis(400), WEB_MAX_BYTES);
    let started = std::time::Instant::now();
    let out = fetch(
        &web,
        fetch_req(&format!("http://slow.test:{}/", server.port), &[]),
    )
    .await;
    assert_failed(&out, MobileErrorCode::NetworkError, "mobile.ai.webTimeout");
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn fetch_cancel_and_duplicate_ids() {
    let head = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhi\r\n".to_vec();
    let server = spawn_server(Arc::new(move |_| MockReply::Hang(head.clone()))).await;
    let resolver = Arc::new(MapResolver::default());
    resolver.answer("site.test", &[&[PUBLIC_A]]);
    let web = Arc::new(web_with(resolver));
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let runner = web.clone();
    let url = format!("http://site.test:{}/", server.port);
    let task = tokio::spawn(async move {
        runner
            .run_fetch(fetch_req(&url, &[]), move |ev| {
                sink.lock().unwrap().push(ev)
            })
            .await
    });
    for _ in 0..200 {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e.event, MobileAiWebEventKind::Chunk { .. }))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    // A second request with the running id is refused.
    let dup = fetch(
        &web,
        fetch_req(&format!("http://site.test:{}/", server.port), &[]),
    )
    .await;
    assert_refused_early(&dup, "mobile.ai.webDuplicateId");
    web.cancel("web-1");
    let res = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    let out = (res, events.lock().unwrap().clone());
    assert_failed(&out, MobileErrorCode::UserCancelled, "mobile.ai.cancelled");

    // A cancel that arrives before its start wins.
    web.cancel("early");
    let mut req = fetch_req("http://site.test/", &[]);
    req.request_id = "early".into();
    let out = fetch(&web, req).await;
    assert_err(
        &out.0,
        MobileErrorCode::UserCancelled,
        "mobile.ai.cancelled",
    );
    assert!(out.1.is_empty());
}

#[test]
fn event_payload_shape() {
    let ev = MobileAiWebEvent {
        request_id: "r".into(),
        seq: 0,
        event: MobileAiWebEventKind::Head {
            status: 200,
            url: "https://a.example/".into(),
            content_type: Some("text/html".into()),
            headers: vec![("content-type".into(), "text/html".into())],
        },
    };
    let json = serde_json::to_value(&ev).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "requestId": "r", "seq": 0, "type": "head", "status": 200,
            "url": "https://a.example/", "contentType": "text/html",
            "headers": [["content-type", "text/html"]]
        })
    );
    let err = MobileAiWebEvent {
        request_id: "r".into(),
        seq: 3,
        event: MobileAiWebEventKind::Error {
            code: MobileErrorCode::FileTooLarge,
            message_key: "mobile.ai.webTooLarge".into(),
        },
    };
    assert_eq!(
        serde_json::to_value(&err).unwrap(),
        serde_json::json!({"requestId": "r", "seq": 3, "type": "error", "code": "FILE_TOO_LARGE", "messageKey": "mobile.ai.webTooLarge"})
    );
    let chunk = MobileAiWebEvent {
        request_id: "r".into(),
        seq: 1,
        event: MobileAiWebEventKind::Chunk {
            data_base64: "aGk=".into(),
        },
    };
    assert_eq!(
        serde_json::to_value(&chunk).unwrap(),
        serde_json::json!({"requestId": "r", "seq": 1, "type": "chunk", "dataBase64": "aGk="})
    );
}
