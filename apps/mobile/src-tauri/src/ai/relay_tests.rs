//! Tests for the sealed relay and the self-hosted server settings.
//!
//! Every network test talks to a loopback server started here; the relay only
//! reaches it through a route injected with `allow_test_route`, which exists in
//! test builds only. No test touches the outside network or a real key.

use crate::ai::relay::{
    MobileAiRelay, MobileAiRelayEvent, MobileAiRelayEventKind, MobileAiRelayRequest,
    provider_relay_hosts,
};
use crate::ai::settings::{
    MobileAiCustomEndpointPatch, MobileAiSettingsPatch, MobileAiSettingsStore, ModelPatch,
    ProviderKeyPatch, validate_custom_base_url,
};
use crate::error::{MobileError, MobileErrorCode};
use crate::secrets::SealedVault;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri_plugin_ieum_mobile::auth::HostAuthBridge;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const OPENAI_KEY: &str = "sk-test-openai-0123456789abcdef";
const ANTHROPIC_KEY: &str = "sk-ant-test-0123456789abcdef";
const GEMINI_KEY: &str = "AIzaTestGemini0123456789abcdef";
const OPENROUTER_KEY: &str = "sk-or-v1-test-0123456789abcdef";
const CUSTOM_KEY: &str = "custom-test-key-0123456789abcdef";

/// What the loopback server answers.
#[derive(Clone)]
enum Reply {
    /// A complete response with a body.
    Full {
        status: u16,
        headers: Vec<(String, String)>,
        body: String,
    },
    /// Sends the head and one body piece, then keeps the connection open.
    Hang { first: String },
}

struct MockServer {
    origin: String,
    hits: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<String>>>,
}

async fn spawn_mock(reply: Reply) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let (hits_c, req_c) = (hits.clone(), requests.clone());
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            hits_c.fetch_add(1, Ordering::SeqCst);
            let reply = reply.clone();
            let req_c = req_c.clone();
            tokio::spawn(async move {
                let raw = read_request(&mut sock).await;
                req_c.lock().unwrap().push(raw);
                match reply {
                    Reply::Full {
                        status,
                        headers,
                        body,
                    } => {
                        let mut head = format!(
                            "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n",
                            body.len()
                        );
                        for (k, v) in headers {
                            head.push_str(&format!("{k}: {v}\r\n"));
                        }
                        head.push_str("\r\n");
                        let _ = sock.write_all(head.as_bytes()).await;
                        let _ = sock.write_all(body.as_bytes()).await;
                        let _ = sock.shutdown().await;
                    }
                    Reply::Hang { first } => {
                        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
                        let _ = sock.write_all(head.as_bytes()).await;
                        let piece = format!("{:x}\r\n{first}\r\n", first.len());
                        let _ = sock.write_all(piece.as_bytes()).await;
                        let _ = sock.flush().await;
                        tokio::time::sleep(Duration::from_secs(60)).await;
                    }
                }
            });
        }
    });
    MockServer {
        origin: format!("http://{addr}"),
        hits,
        requests,
    }
}

/// Reads one HTTP/1.1 request: the head and a Content-Length body.
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

struct Fixture {
    _tmp: tempfile::TempDir,
    store: Arc<MobileAiSettingsStore>,
    relay: MobileAiRelay,
}

fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let auth = Arc::new(HostAuthBridge::default());
    let vault = Arc::new(SealedVault::new(tmp.path().to_path_buf(), auth));
    let store = Arc::new(MobileAiSettingsStore::new(tmp.path().to_path_buf(), vault));
    let relay = MobileAiRelay::new(store.clone());
    Fixture {
        _tmp: tmp,
        store,
        relay,
    }
}

fn set_key(store: &MobileAiSettingsStore, provider: &str, key: &str, free_only: Option<bool>) {
    store
        .set_settings(
            MobileAiSettingsPatch {
                provider_key_patch: Some(ProviderKeyPatch {
                    provider: provider.into(),
                    api_key: Some(key.into()),
                    free_only,
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap();
}

fn all_keys() -> [&'static str; 5] {
    [
        OPENAI_KEY,
        ANTHROPIC_KEY,
        GEMINI_KEY,
        OPENROUTER_KEY,
        CUSTOM_KEY,
    ]
}

fn request(url: &str, headers: &[(&str, &str)], body: Option<&str>) -> MobileAiRelayRequest {
    MobileAiRelayRequest {
        request_id: "req-1".into(),
        url: url.into(),
        method: if body.is_some() { "POST" } else { "GET" }.into(),
        headers: headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        body: body.map(ToString::to_string),
    }
}

async fn run(
    relay: &MobileAiRelay,
    req: MobileAiRelayRequest,
) -> (Result<(), MobileError>, Vec<MobileAiRelayEvent>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let res = relay
        .run(req, move |ev| sink.lock().unwrap().push(ev))
        .await;
    let evs = events.lock().unwrap().clone();
    (res, evs)
}

fn body_of(events: &[MobileAiRelayEvent]) -> String {
    let mut out = Vec::new();
    for ev in events {
        if let MobileAiRelayEventKind::Chunk { data_base64 } = &ev.event {
            out.extend(STANDARD.decode(data_base64).unwrap());
        }
    }
    String::from_utf8(out).unwrap()
}

fn assert_no_key(text: &str) {
    for key in all_keys() {
        assert!(!text.contains(key), "a key leaked into: {text}");
    }
}

fn assert_refused(res: &Result<(), MobileError>, events: &[MobileAiRelayEvent], key: &str) {
    let err = res.as_ref().expect_err("relay must refuse");
    assert_eq!(err.message_key, key, "unexpected refusal {err:?}");
    assert!(events.is_empty(), "a refusal must not emit events");
    assert_no_key(&serde_json::to_string(err).unwrap());
    assert_no_key(&err.to_string());
}

#[test]
fn official_host_allowlist_matches_the_pc_adapter_base_urls() {
    let expected: &[(&str, &[&str])] = &[
        ("openai", &["api.openai.com"]),
        ("anthropic", &["api.anthropic.com"]),
        ("gemini", &["generativelanguage.googleapis.com"]),
        ("openrouter", &["openrouter.ai"]),
        ("deepseek", &["api.deepseek.com"]),
        ("xai", &["api.x.ai"]),
        ("mistral", &["api.mistral.ai"]),
        ("kimi", &["api.moonshot.ai"]),
        ("glm", &["open.bigmodel.cn"]),
        ("qwen", &["dashscope.aliyuncs.com"]),
        ("upstage", &["api.upstage.ai"]),
        ("exaone", &["api.exaone.ai"]),
    ];
    for (provider, hosts) in expected {
        assert_eq!(provider_relay_hosts(provider), *hosts, "{provider}");
    }
    assert!(provider_relay_hosts("chatgpt").is_empty());
    assert!(provider_relay_hosts("custom").is_empty());
    assert!(provider_relay_hosts("claude-code").is_empty());
}

#[tokio::test]
async fn plan_accepts_official_hosts_and_refuses_everything_else_without_network() {
    let f = fixture();
    set_key(&f.store, "openai", OPENAI_KEY, None);
    set_key(&f.store, "anthropic", ANTHROPIC_KEY, None);

    // The official host with its own placeholder is accepted and the key goes into the header.
    let planned = f
        .relay
        .plan(&request(
            "https://api.openai.com/v1/chat/completions",
            &[("Authorization", "Bearer __sealed__:openai")],
            Some(r#"{"model":"gpt-5"}"#),
        ))
        .unwrap();
    assert_eq!(planned.provider.as_deref(), Some("openai"));
    assert!(
        planned
            .headers
            .iter()
            .any(|(k, v)| k.as_str() == "authorization"
                && v.to_str().unwrap() == format!("Bearer {OPENAI_KEY}"))
    );

    // No placeholder is fine on a provider host (the relay attaches nothing).
    let planned = f
        .relay
        .plan(&request("https://api.anthropic.com/v1/models", &[], None))
        .unwrap();
    assert_eq!(planned.provider, None);

    let cases: &[(&str, &[(&str, &str)], &str)] = &[
        // Plain http, even to the official host.
        (
            "http://api.openai.com/v1/chat/completions",
            &[("Authorization", "Bearer __sealed__:openai")],
            "mobile.ai.httpsOnly",
        ),
        // A host no provider owns, with or without a placeholder.
        (
            "https://evil.example/v1/chat/completions",
            &[("Authorization", "Bearer __sealed__:openai")],
            "mobile.ai.relayHostNotAllowed",
        ),
        (
            "https://evil.example/v1/chat/completions",
            &[],
            "mobile.ai.relayHostNotAllowed",
        ),
        // A look-alike host and a non-default port are not the official host.
        (
            "https://api.openai.com.evil.example/v1/models",
            &[],
            "mobile.ai.relayHostNotAllowed",
        ),
        (
            "https://api.openai.com:8443/v1/models",
            &[],
            "mobile.ai.relayHostNotAllowed",
        ),
        // Another provider's placeholder on this host.
        (
            "https://api.openai.com/v1/chat/completions",
            &[("x-api-key", "__sealed__:anthropic")],
            "mobile.ai.relayProviderHostMismatch",
        ),
        // Two different providers in one request.
        (
            "https://api.openai.com/v1/chat/completions",
            &[
                ("Authorization", "Bearer __sealed__:openai"),
                ("x-api-key", "__sealed__:anthropic"),
            ],
            "mobile.ai.relayMixedPlaceholders",
        ),
        // A placeholder outside the header values and the query.
        (
            "https://api.openai.com/v1/__sealed__:openai/models",
            &[],
            "mobile.ai.relayPlaceholderPosition",
        ),
        // A marker the relay cannot read.
        (
            "https://api.openai.com/v1/models",
            &[("Authorization", "Bearer __sealed__")],
            "mobile.ai.relayPlaceholderMalformed",
        ),
        // Credentials in the address.
        (
            "https://user:pass@api.openai.com/v1/models",
            &[],
            "mobile.ai.invalidUrl",
        ),
        ("not a url", &[], "mobile.ai.invalidUrl"),
    ];
    for (url, headers, key) in cases {
        let err = f.relay.plan(&request(url, headers, None)).unwrap_err();
        assert_eq!(err.message_key, *key, "{url}");
        assert_no_key(&serde_json::to_string(&err).unwrap());
    }

    // A provider without a saved key is refused.
    let err = f
        .relay
        .plan(&request(
            "https://generativelanguage.googleapis.com/v1beta/models",
            &[("x-goog-api-key", "__sealed__:gemini")],
            None,
        ))
        .unwrap_err();
    assert_eq!(err.code, MobileErrorCode::AuthNotConfigured);
    assert_eq!(err.message_key, "mobile.ai.missingKey");

    // Only GET and POST are relayed.
    let mut put = request("https://api.openai.com/v1/models", &[], Some("{}"));
    put.method = "PUT".into();
    assert_eq!(
        f.relay.plan(&put).unwrap_err().message_key,
        "mobile.ai.relayMethod"
    );
}

#[tokio::test]
async fn placeholder_is_replaced_in_headers_and_query_and_response_is_streamed() {
    let f = fixture();
    set_key(&f.store, "gemini", GEMINI_KEY, None);
    let server = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![
            ("Content-Type".into(), "text/event-stream".into()),
            ("x-echo".into(), format!("key={GEMINI_KEY}")),
            ("Set-Cookie".into(), "session=abc".into()),
            ("x-request-id".into(), "abc-123".into()),
        ],
        body: format!("data: {{\"text\":\"hello\"}}\n\ndata: echo {GEMINI_KEY}\n\n"),
    })
    .await;
    f.relay.allow_test_route("gemini", &server.origin);

    let url = format!(
        "{}/v1beta/models/m:streamGenerateContent?alt=sse&key=__sealed__:gemini",
        server.origin
    );
    let (res, events) = run(
        &f.relay,
        request(
            &url,
            &[
                ("x-goog-api-key", "__sealed__:gemini"),
                ("content-type", "application/json"),
            ],
            Some(r#"{"contents":[]}"#),
        ),
    )
    .await;
    res.unwrap();

    // The server saw the real key in the header and in the query, never the placeholder.
    let seen = server.requests.lock().unwrap().join("\n");
    assert!(seen.contains(&format!("x-goog-api-key: {GEMINI_KEY}")));
    assert!(seen.contains(&format!("key={GEMINI_KEY}")));
    assert!(!seen.contains("__sealed__"));
    assert!(seen.contains(r#"{"contents":[]}"#));

    // Events: head first, then chunks in order, then end; sequence numbers rise by one.
    assert!(matches!(
        events.first().map(|e| &e.event),
        Some(MobileAiRelayEventKind::Head { status: 200, .. })
    ));
    assert!(matches!(
        events.last().map(|e| &e.event),
        Some(MobileAiRelayEventKind::End)
    ));
    for (i, ev) in events.iter().enumerate() {
        assert_eq!(ev.seq, i as u64);
        assert_eq!(ev.request_id, "req-1");
    }
    let MobileAiRelayEventKind::Head { headers, .. } = &events[0].event else {
        unreachable!()
    };
    assert!(
        headers
            .iter()
            .any(|(k, v)| k == "x-request-id" && v == "abc-123")
    );
    assert!(!headers.iter().any(|(k, _)| k == "set-cookie"));
    assert!(!headers.iter().any(|(k, _)| k == "x-echo"));

    // The body arrives intact except that an echoed key is masked.
    let body = body_of(&events);
    assert!(body.contains("data: {\"text\":\"hello\"}"));
    assert!(body.contains("data: echo [redacted]"));

    // Nothing the webview receives carries a key.
    assert_no_key(&serde_json::to_string(&events).unwrap());
}

#[tokio::test]
async fn provider_error_bodies_reach_the_webview_for_classification() {
    let f = fixture();
    set_key(&f.store, "openai", OPENAI_KEY, None);
    let server = spawn_mock(Reply::Full {
        status: 429,
        headers: vec![("retry-after".into(), "3".into())],
        body: r#"{"error":{"code":"rate_limit_exceeded"}}"#.into(),
    })
    .await;
    f.relay.allow_test_route("openai", &server.origin);
    let (res, events) = run(
        &f.relay,
        request(
            &format!("{}/v1/chat/completions", server.origin),
            &[("Authorization", "Bearer __sealed__:openai")],
            Some(r#"{"model":"gpt-5"}"#),
        ),
    )
    .await;
    res.unwrap();
    assert!(matches!(
        &events[0].event,
        MobileAiRelayEventKind::Head { status: 429, .. }
    ));
    assert!(body_of(&events).contains("rate_limit_exceeded"));
}

#[tokio::test]
async fn refusals_do_not_reach_the_network() {
    let f = fixture();
    set_key(&f.store, "openai", OPENAI_KEY, None);
    set_key(&f.store, "anthropic", ANTHROPIC_KEY, None);
    let allowed = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![],
        body: "ok".into(),
    })
    .await;
    let foreign = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![],
        body: "ok".into(),
    })
    .await;
    f.relay.allow_test_route("openai", &allowed.origin);

    // The openai placeholder may not travel to a host the relay does not know.
    let (res, events) = run(
        &f.relay,
        request(
            &format!("{}/v1/chat/completions", foreign.origin),
            &[("Authorization", "Bearer __sealed__:openai")],
            Some("{}"),
        ),
    )
    .await;
    assert_refused(&res, &events, "mobile.ai.relayHostNotAllowed");

    // The relay is not a general proxy: no placeholder, foreign host, still refused.
    let (res, events) = run(
        &f.relay,
        request(&format!("{}/anything", foreign.origin), &[], None),
    )
    .await;
    assert_refused(&res, &events, "mobile.ai.relayHostNotAllowed");

    // The anthropic placeholder may not go to the openai host.
    let (res, events) = run(
        &f.relay,
        request(
            &format!("{}/v1/messages", allowed.origin),
            &[("x-api-key", "__sealed__:anthropic")],
            Some("{}"),
        ),
    )
    .await;
    assert_refused(&res, &events, "mobile.ai.relayProviderHostMismatch");

    assert_eq!(allowed.hits.load(Ordering::SeqCst), 0);
    assert_eq!(foreign.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn redirects_are_not_followed() {
    let f = fixture();
    set_key(&f.store, "openai", OPENAI_KEY, None);
    let target = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![],
        body: "should never be read".into(),
    })
    .await;
    let redirector = spawn_mock(Reply::Full {
        status: 302,
        headers: vec![("Location".into(), format!("{}/stolen", target.origin))],
        body: String::new(),
    })
    .await;
    f.relay.allow_test_route("openai", &redirector.origin);
    f.relay.allow_test_route("openai", &target.origin);

    let (res, events) = run(
        &f.relay,
        request(
            &format!("{}/v1/chat/completions", redirector.origin),
            &[("Authorization", "Bearer __sealed__:openai")],
            Some("{}"),
        ),
    )
    .await;
    let err = res.unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.relayRedirect");
    assert_eq!(target.hits.load(Ordering::SeqCst), 0);
    assert_eq!(events.len(), 1);
    assert!(matches!(
        &events[0].event,
        MobileAiRelayEventKind::Error { message_key, .. } if message_key == "mobile.ai.relayRedirect"
    ));
    assert_no_key(&serde_json::to_string(&events).unwrap());
    assert_no_key(&serde_json::to_string(&err).unwrap());
}

#[tokio::test]
async fn cancel_aborts_a_running_request() {
    let f = Arc::new(fixture());
    set_key(&f.store, "openai", OPENAI_KEY, None);
    let server = spawn_mock(Reply::Hang {
        first: "data: {\"x\":1}\n\n".into(),
    })
    .await;
    f.relay.allow_test_route("openai", &server.origin);

    let events = Arc::new(Mutex::new(Vec::<MobileAiRelayEvent>::new()));
    let sink = events.clone();
    let f2 = f.clone();
    let url = format!("{}/v1/chat/completions", server.origin);
    let task = tokio::spawn(async move {
        f2.relay
            .run(
                request(
                    &url,
                    &[("Authorization", "Bearer __sealed__:openai")],
                    Some("{}"),
                ),
                move |ev| sink.lock().unwrap().push(ev),
            )
            .await
    });
    // Wait until the first body piece is in, then cancel.
    for _ in 0..200 {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e.event, MobileAiRelayEventKind::Chunk { .. }))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    f.relay.cancel("req-1");
    let res = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("cancel must end the request promptly")
        .unwrap();
    let err = res.unwrap_err();
    assert_eq!(err.code, MobileErrorCode::UserCancelled);
    let evs = events.lock().unwrap().clone();
    assert!(matches!(
        evs.last().map(|e| &e.event),
        Some(MobileAiRelayEventKind::Error {
            code: MobileErrorCode::UserCancelled,
            ..
        })
    ));
    assert!(body_of(&evs).contains("\"x\":1"));
}

#[tokio::test]
async fn cancel_that_arrives_before_start_still_wins() {
    let f = fixture();
    set_key(&f.store, "openai", OPENAI_KEY, None);
    let server = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![],
        body: "ok".into(),
    })
    .await;
    f.relay.allow_test_route("openai", &server.origin);
    f.relay.cancel("req-1");
    let (res, events) = run(
        &f.relay,
        request(&format!("{}/v1/models", server.origin), &[], None),
    )
    .await;
    assert_eq!(res.unwrap_err().code, MobileErrorCode::UserCancelled);
    assert!(events.is_empty());
    assert_eq!(server.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn openrouter_free_only_refuses_paid_models_in_the_relay() {
    let f = fixture();
    set_key(&f.store, "openrouter", OPENROUTER_KEY, Some(true));
    let server = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![],
        body: "ok".into(),
    })
    .await;
    f.relay.allow_test_route("openrouter", &server.origin);
    let url = format!("{}/api/v1/chat/completions", server.origin);
    let auth = [("Authorization", "Bearer __sealed__:openrouter")];

    for body in [
        r#"{"model":"openai/gpt-5","stream":true}"#,
        r#"{"stream":true}"#,
        r#"{"model":"google/gemma-3-27b-it:free","models":["openai/gpt-5"]}"#,
        "not json",
    ] {
        let (res, events) = run(&f.relay, request(&url, &auth, Some(body))).await;
        assert_refused(&res, &events, "mobile.ai.openrouterFreeOnly");
    }
    assert_eq!(server.hits.load(Ordering::SeqCst), 0);

    // A :free model goes through, and so does reading the model list.
    let (res, _) = run(
        &f.relay,
        request(
            &url,
            &auth,
            Some(r#"{"model":"google/gemma-3-27b-it:free"}"#),
        ),
    )
    .await;
    res.unwrap();
    let (res, _) = run(
        &f.relay,
        request(&format!("{}/api/v1/models", server.origin), &auth, None),
    )
    .await;
    res.unwrap();
    assert_eq!(server.hits.load(Ordering::SeqCst), 2);

    // With a paid (BYOK) key the same model is allowed.
    set_key(&f.store, "openrouter", OPENROUTER_KEY, Some(false));
    let (res, _) = run(
        &f.relay,
        request(&url, &auth, Some(r#"{"model":"openai/gpt-5"}"#)),
    )
    .await;
    res.unwrap();
}

#[test]
fn custom_base_url_validation() {
    assert_eq!(
        validate_custom_base_url("https://llm.home.example:8443/v1#frag").unwrap(),
        "https://llm.home.example:8443/v1"
    );
    assert!(validate_custom_base_url("https://192.168.1.50/v1").is_ok());
    let cases = [
        ("http://192.168.1.50:11434/v1", "mobile.ai.customHttpsOnly"),
        ("ftp://llm.home.example/v1", "mobile.ai.customHttpsOnly"),
        ("", "mobile.ai.customInvalidUrl"),
        ("   ", "mobile.ai.customInvalidUrl"),
        ("llm.home.example/v1", "mobile.ai.customInvalidUrl"),
        ("https://", "mobile.ai.customInvalidUrl"),
        (
            "https://user:secret@llm.home.example/v1",
            "mobile.ai.customCredentials",
        ),
        (
            "https://llm.home.example/v1?k=__sealed__:openai",
            "mobile.ai.customInvalidUrl",
        ),
    ];
    for (raw, key) in cases {
        let err = validate_custom_base_url(raw).unwrap_err();
        assert_eq!(err.code, MobileErrorCode::InvalidArgument, "{raw}");
        assert_eq!(err.message_key, key, "{raw}");
        assert!(!err.to_string().contains("secret"));
    }
    let long = format!("https://llm.home.example/{}", "a".repeat(2100));
    assert_eq!(
        validate_custom_base_url(&long).unwrap_err().message_key,
        "mobile.ai.customInvalidUrl"
    );
}

#[test]
fn custom_endpoint_settings_store_url_key_and_model_without_returning_the_key() {
    let f = fixture();

    // Not configured: cannot be selected, nothing listed.
    let err = f
        .store
        .set_settings(
            MobileAiSettingsPatch {
                selected_provider: Some("custom".into()),
                ..Default::default()
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.customNotConfigured");
    let ep = f.store.get_custom_endpoint().unwrap();
    assert_eq!(ep.base_url, None);
    assert!(!ep.has_key);

    // http is not saved.
    let err = f
        .store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "http://llm.home.example/v1".into(),
            api_key: Some(CUSTOM_KEY.into()),
            model: Some("llama".into()),
            models: None,
        })
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.customHttpsOnly");
    assert_eq!(f.store.get_custom_endpoint().unwrap().base_url, None);
    assert_eq!(f.store.get_api_key("custom").unwrap(), None);

    // A key is optional; the base URL alone makes it configured.
    let ep = f
        .store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://llm.home.example/v1".into(),
            api_key: None,
            model: Some("llama-4".into()),
            models: Some(vec!["llama-4".into(), "qwen-3".into()]),
        })
        .unwrap();
    assert_eq!(ep.base_url.as_deref(), Some("https://llm.home.example/v1"));
    assert!(!ep.has_key);
    assert_eq!(ep.model.as_deref(), Some("llama-4"));
    let snap = f.store.get_snapshot(false).unwrap();
    assert!(!snap.configured_providers["custom"].has_key);
    assert_eq!(
        snap.configured_providers["custom"].models,
        vec!["llama-4", "qwen-3"]
    );
    assert_eq!(snap.model_by_provider["custom"], "llama-4");

    // With a key: stored sealed, never returned.
    let ep = f
        .store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://llm.home.example/v1".into(),
            api_key: Some(CUSTOM_KEY.into()),
            model: None,
            models: None,
        })
        .unwrap();
    assert!(ep.has_key);
    assert_eq!(ep.model.as_deref(), Some("llama-4"));
    assert_no_key(&serde_json::to_string(&ep).unwrap());
    let snap = f
        .store
        .set_settings(
            MobileAiSettingsPatch {
                selected_provider: Some("custom".into()),
                model_patch: Some(ModelPatch {
                    provider: "custom".into(),
                    model: "qwen-3".into(),
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap();
    assert_eq!(snap.selected_provider, "custom");
    assert_eq!(snap.model_by_provider["custom"], "qwen-3");
    assert!(snap.configured_providers["custom"].has_key);
    assert_no_key(&serde_json::to_string(&snap).unwrap());
    let meta_disk = std::fs::read_to_string(f._tmp.path().join("ai-settings.json")).unwrap();
    assert_no_key(&meta_disk);

    // The custom key is set through the custom endpoint command only.
    let err = f
        .store
        .set_settings(
            MobileAiSettingsPatch {
                provider_key_patch: Some(ProviderKeyPatch {
                    provider: "custom".into(),
                    api_key: Some("other".into()),
                    free_only: None,
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.useCustomEndpoint");

    // Moving to another server drops the old key unless a new one is given.
    let ep = f
        .store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://other.home.example/v1".into(),
            api_key: None,
            model: None,
            models: None,
        })
        .unwrap();
    assert!(!ep.has_key);
    assert_eq!(f.store.get_api_key("custom").unwrap(), None);

    // An empty key removes it; clearing removes everything and leaves custom unselected.
    f.store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://other.home.example/v1".into(),
            api_key: Some(CUSTOM_KEY.into()),
            model: None,
            models: None,
        })
        .unwrap();
    let ep = f
        .store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://other.home.example/v1".into(),
            api_key: Some("  ".into()),
            model: None,
            models: None,
        })
        .unwrap();
    assert!(!ep.has_key);
    let ep = f.store.clear_custom_endpoint().unwrap();
    assert_eq!(ep.base_url, None);
    let snap = f.store.get_snapshot(false).unwrap();
    assert_eq!(snap.selected_provider, "auto");
    assert!(!snap.configured_providers.contains_key("custom"));
    assert!(!snap.model_by_provider.contains_key("custom"));
}

#[tokio::test]
async fn custom_host_is_the_saved_base_url_host() {
    let f = fixture();
    f.store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://llm.home.example:8443/v1".into(),
            api_key: Some(CUSTOM_KEY.into()),
            model: None,
            models: None,
        })
        .unwrap();
    let auth = [("Authorization", "Bearer __sealed__:custom")];

    let planned = f
        .relay
        .plan(&request(
            "https://llm.home.example:8443/v1/chat/completions",
            &auth,
            Some("{}"),
        ))
        .unwrap();
    assert_eq!(planned.provider.as_deref(), Some("custom"));
    // Any path on the saved host and port is allowed (model list, chat).
    f.relay
        .plan(&request("https://llm.home.example:8443/models", &[], None))
        .unwrap();

    for url in [
        "https://llm.home.example/v1/chat/completions",
        "https://other.home.example:8443/v1/chat/completions",
    ] {
        let err = f.relay.plan(&request(url, &auth, Some("{}"))).unwrap_err();
        assert_eq!(err.message_key, "mobile.ai.relayHostNotAllowed", "{url}");
    }
    let err = f
        .relay
        .plan(&request(
            "http://llm.home.example:8443/v1/chat/completions",
            &auth,
            Some("{}"),
        ))
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.httpsOnly");
    // The custom key may not go to an official host.
    let err = f
        .relay
        .plan(&request(
            "https://api.openai.com/v1/chat/completions",
            &auth,
            Some("{}"),
        ))
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.relayProviderHostMismatch");

    // Without a saved key the custom placeholder is refused (send no auth header instead).
    f.store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://llm.home.example:8443/v1".into(),
            api_key: Some(String::new()),
            model: None,
            models: None,
        })
        .unwrap();
    let err = f
        .relay
        .plan(&request(
            "https://llm.home.example:8443/v1/chat/completions",
            &auth,
            Some("{}"),
        ))
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.missingKey");
    let planned = f
        .relay
        .plan(&request(
            "https://llm.home.example:8443/v1/chat/completions",
            &[],
            Some("{}"),
        ))
        .unwrap();
    assert_eq!(planned.provider, None);
}

#[tokio::test]
async fn custom_key_is_attached_on_the_wire() {
    let f = fixture();
    f.store
        .set_custom_endpoint(MobileAiCustomEndpointPatch {
            base_url: "https://llm.home.example/v1".into(),
            api_key: Some(CUSTOM_KEY.into()),
            model: None,
            models: None,
        })
        .unwrap();
    let server = spawn_mock(Reply::Full {
        status: 200,
        headers: vec![],
        body: r#"{"data":[{"id":"llama-4"}]}"#.into(),
    })
    .await;
    f.relay.allow_test_route("custom", &server.origin);
    let (res, events) = run(
        &f.relay,
        request(
            &format!("{}/v1/models", server.origin),
            &[("Authorization", "Bearer __sealed__:custom")],
            None,
        ),
    )
    .await;
    res.unwrap();
    let seen = server.requests.lock().unwrap().join("\n");
    assert!(seen.contains(&format!("authorization: Bearer {CUSTOM_KEY}")));
    assert!(body_of(&events).contains("llama-4"));
}

#[tokio::test]
async fn the_old_stream_command_no_longer_sends_key_provider_requests() {
    use crate::ai::{ChatGptService, MobileAiStreamManager, MobileAiStreamRequest};
    let tmp = tempfile::tempdir().unwrap();
    let auth = Arc::new(HostAuthBridge::default());
    let vault = Arc::new(SealedVault::new(tmp.path().to_path_buf(), auth.clone()));
    let store = Arc::new(MobileAiSettingsStore::new(
        tmp.path().to_path_buf(),
        vault.clone(),
    ));
    let chatgpt = Arc::new(ChatGptService::new(vault, auth));
    store
        .set_settings(
            MobileAiSettingsPatch {
                selected_provider: Some("openai".into()),
                provider_key_patch: Some(ProviderKeyPatch {
                    provider: "openai".into(),
                    api_key: Some(OPENAI_KEY.into()),
                    free_only: None,
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap();
    let streams = MobileAiStreamManager::new(store, chatgpt);
    let mut events = Vec::new();
    let err = streams
        .run_stream(
            MobileAiStreamRequest {
                request_id: "s-1".into(),
                system: String::new(),
                messages: vec![],
                tools: vec![],
                max_tokens: None,
            },
            |ev| events.push(ev),
        )
        .await
        .unwrap_err();
    assert_eq!(err.message_key, "mobile.ai.useRelay");
    assert!(events.is_empty());
    assert_no_key(&serde_json::to_string(&err).unwrap());
}
