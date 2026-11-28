//! Tests for the AI tool settings and the AI result store.

use crate::ai::results::{MobileAiResultStore, RESULTS_DIR_NAME};
use crate::ai::settings::{MobileAiSettingsPatch, MobileAiSettingsStore, ProviderKeyPatch};
use crate::ai::tool_settings::{MobileAiToolSettingsPatch, MobileAiToolSettingsStore};
use crate::error::{MobileError, MobileErrorCode};
use crate::secrets::SealedVault;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use std::sync::Arc;
use tauri_plugin_ieum_mobile::auth::HostAuthBridge;

const OPENAI_KEY: &str = "sk-test-openai-tools-0123456789";
const GEMINI_KEY: &str = "AIzaTestGeminiTools0123456789";
const OPENROUTER_KEY: &str = "sk-or-v1-test-tools-0123456789";

struct Fixture {
    tmp: tempfile::TempDir,
    settings: Arc<MobileAiSettingsStore>,
    tools: MobileAiToolSettingsStore,
}

fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let auth = Arc::new(HostAuthBridge::default());
    let vault = Arc::new(SealedVault::new(tmp.path().to_path_buf(), auth));
    let settings = Arc::new(MobileAiSettingsStore::new(tmp.path().to_path_buf(), vault));
    let tools = MobileAiToolSettingsStore::new(tmp.path().to_path_buf(), settings.clone());
    Fixture {
        tmp,
        settings,
        tools,
    }
}

fn set_key(store: &MobileAiSettingsStore, provider: &str, key: Option<&str>) {
    store
        .set_settings(
            MobileAiSettingsPatch {
                provider_key_patch: Some(ProviderKeyPatch {
                    provider: provider.into(),
                    api_key: key.map(Into::into),
                    free_only: if provider == "openrouter" {
                        Some(true)
                    } else {
                        None
                    },
                }),
                ..Default::default()
            },
            false,
        )
        .unwrap();
}

fn patch() -> MobileAiToolSettingsPatch {
    MobileAiToolSettingsPatch::default()
}

fn refused(res: Result<impl std::fmt::Debug, MobileError>, key: &str) {
    let err = res.expect_err(key);
    assert_eq!(err.message_key, key, "{err:?}");
    assert_eq!(err.code, MobileErrorCode::InvalidArgument, "{err:?}");
}

#[test]
fn tool_settings_defaults() {
    let f = fixture();
    let s = f.tools.get().unwrap();
    assert!(s.internet_tools);
    assert!(!s.image_generation);
    assert_eq!(s.image_provider, None);
    assert_eq!(s.image_model, None);
    assert!(s.image_providers_ready.is_empty());
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "internetTools": true, "imageGeneration": false,
            "imageProvider": null, "imageModel": null, "imageProvidersReady": []
        })
    );
}

#[test]
fn internet_tools_switch_is_saved_next_to_the_ai_settings() {
    let f = fixture();
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            internet_tools: Some(false),
            ..patch()
        })
        .unwrap();
    assert!(!s.internet_tools);
    let reopened = MobileAiToolSettingsStore::new(f.tmp.path().to_path_buf(), f.settings.clone());
    assert!(!reopened.get().unwrap().internet_tools);
    let file = f.tmp.path().join("ai-tool-settings.json");
    assert!(file.exists());
}

#[test]
fn image_provider_is_only_openai_or_gemini() {
    let f = fixture();
    set_key(&f.settings, "openrouter", Some(OPENROUTER_KEY));
    for bad in ["openrouter", "anthropic", "custom", "bfl", "OpenAI ", "x"] {
        refused(
            f.tools.set(MobileAiToolSettingsPatch {
                image_provider: Some(bad.into()),
                ..patch()
            }),
            "mobile.ai.imageProviderNotAllowed",
        );
    }
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_provider: Some("gemini".into()),
            image_model: Some("gemini-2.5-flash-image".into()),
            ..patch()
        })
        .unwrap();
    assert_eq!(s.image_provider.as_deref(), Some("gemini"));
    assert_eq!(s.image_model.as_deref(), Some("gemini-2.5-flash-image"));
    // OpenRouter is never listed as ready, even with a key.
    assert!(s.image_providers_ready.is_empty());
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_provider: Some(String::new()),
            ..patch()
        })
        .unwrap();
    assert_eq!(s.image_provider, None);
    assert_eq!(
        s.image_model, None,
        "clearing the provider clears its model"
    );
}

#[test]
fn turning_image_generation_on_needs_a_provider_with_a_key_and_a_model() {
    let f = fixture();
    refused(
        f.tools.set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            ..patch()
        }),
        "mobile.ai.imageProviderMissing",
    );
    refused(
        f.tools.set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_provider: Some("openai".into()),
            image_model: Some("gpt-image-1".into()),
            ..patch()
        }),
        "mobile.ai.imageProviderNoKey",
    );
    // A refused patch changes nothing.
    assert_eq!(f.tools.get().unwrap().image_provider, None);

    set_key(&f.settings, "openai", Some(OPENAI_KEY));
    refused(
        f.tools.set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_provider: Some("openai".into()),
            ..patch()
        }),
        "mobile.ai.imageModelMissing",
    );
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_provider: Some("openai".into()),
            image_model: Some("gpt-image-1".into()),
            ..patch()
        })
        .unwrap();
    assert!(s.image_generation);
    assert_eq!(s.image_providers_ready, vec!["openai".to_string()]);
    assert!(f.tools.get().unwrap().image_generation);

    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_generation: Some(false),
            ..patch()
        })
        .unwrap();
    assert!(!s.image_generation);
    assert_eq!(
        s.image_model.as_deref(),
        Some("gpt-image-1"),
        "the choice is kept"
    );
}

#[test]
fn removing_the_key_switches_image_generation_off_for_good() {
    let f = fixture();
    set_key(&f.settings, "openai", Some(OPENAI_KEY));
    f.tools
        .set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_provider: Some("openai".into()),
            image_model: Some("gpt-image-1".into()),
            ..patch()
        })
        .unwrap();
    set_key(&f.settings, "openai", None);
    let s = f.tools.get().unwrap();
    assert!(!s.image_generation);
    assert!(s.image_providers_ready.is_empty());
    // Adding the key again does not silently turn paid image generation back on.
    set_key(&f.settings, "openai", Some(OPENAI_KEY));
    let s = f.tools.get().unwrap();
    assert!(!s.image_generation);
    assert_eq!(s.image_provider.as_deref(), Some("openai"));
    assert_eq!(s.image_model.as_deref(), Some("gpt-image-1"));
}

#[test]
fn changing_the_provider_while_on_clears_the_model_and_switches_off_when_not_ready() {
    let f = fixture();
    set_key(&f.settings, "openai", Some(OPENAI_KEY));
    f.tools
        .set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_provider: Some("openai".into()),
            image_model: Some("gpt-image-1".into()),
            ..patch()
        })
        .unwrap();
    // Gemini has no key: generation goes off, the old OpenAI model is dropped.
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_provider: Some("gemini".into()),
            ..patch()
        })
        .unwrap();
    assert!(!s.image_generation);
    assert_eq!(s.image_provider.as_deref(), Some("gemini"));
    assert_eq!(s.image_model, None);

    set_key(&f.settings, "gemini", Some(GEMINI_KEY));
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_model: Some("gemini-2.5-flash-image".into()),
            ..patch()
        })
        .unwrap();
    assert!(s.image_generation);
    assert_eq!(
        s.image_providers_ready,
        vec!["gemini".to_string(), "openai".to_string()]
    );
    // Clearing the model while on switches it off.
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_model: Some(String::new()),
            ..patch()
        })
        .unwrap();
    assert!(!s.image_generation);
}

#[test]
fn image_model_names_are_checked() {
    let f = fixture();
    for bad in [
        "a\nb".to_string(),
        "x".repeat(201),
        "__sealed__:openai".to_string(),
        "tab\tname".to_string(),
    ] {
        refused(
            f.tools.set(MobileAiToolSettingsPatch {
                image_provider: Some("openai".into()),
                image_model: Some(bad),
                ..patch()
            }),
            "mobile.ai.imageModelInvalid",
        );
    }
    let s = f
        .tools
        .set(MobileAiToolSettingsPatch {
            image_provider: Some("openai".into()),
            image_model: Some("  gpt-image-1  ".into()),
            ..patch()
        })
        .unwrap();
    assert_eq!(s.image_model.as_deref(), Some("gpt-image-1"));
}

#[test]
fn tool_settings_file_holds_no_key() {
    let f = fixture();
    set_key(&f.settings, "openai", Some(OPENAI_KEY));
    f.tools
        .set(MobileAiToolSettingsPatch {
            image_generation: Some(true),
            image_provider: Some("openai".into()),
            image_model: Some("gpt-image-1".into()),
            internet_tools: Some(false),
        })
        .unwrap();
    let text = std::fs::read_to_string(f.tmp.path().join("ai-tool-settings.json")).unwrap();
    assert!(!text.contains(OPENAI_KEY));
    let json = serde_json::to_string(&f.tools.get().unwrap()).unwrap();
    assert!(!json.contains(OPENAI_KEY));
}

// ---------------------------------------------------------------------------
// Result store

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDRtest-png";
const JPEG: &[u8] = b"\xff\xd8\xff\xe0\0\x10JFIFtest";
const GIF: &[u8] = b"GIF89a\x01\0\x01\0test";
const WEBP: &[u8] = b"RIFF\x10\0\0\0WEBPVP8 test";

fn store() -> (tempfile::TempDir, MobileAiResultStore) {
    let tmp = tempfile::tempdir().unwrap();
    let store = MobileAiResultStore::new(tmp.path().to_path_buf());
    (tmp, store)
}

fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

fn refused_result<T: std::fmt::Debug>(res: Result<T, MobileError>, key: &str) {
    let err = res.expect_err(key);
    assert_eq!(err.message_key, key, "{err:?}");
}

#[test]
fn result_store_puts_and_reads_images_by_an_opaque_address() {
    let (tmp, store) = store();
    let size = store.size().unwrap();
    assert_eq!((size.bytes, size.files), (0, 0));

    for (bytes, mime, ext) in [
        (PNG, "image/png", "png"),
        (JPEG, "image/jpeg", "jpg"),
        (JPEG, "image/jpg", "jpg"),
        (GIF, "image/gif", "gif"),
        (WEBP, "IMAGE/WEBP", "webp"),
    ] {
        let put = store.put_image(&b64(bytes), mime).unwrap();
        let rest = put
            .address
            .strip_prefix("ai-result://")
            .expect("ai-result address");
        let (id, got_ext) = rest.split_once('.').unwrap();
        assert_eq!(got_ext, ext);
        assert_eq!(uuid::Uuid::parse_str(id).unwrap().to_string(), id);
        assert_eq!(put.bytes, bytes.len() as u64);
        let read = store.read_image(&put.address).unwrap();
        assert_eq!(STANDARD.decode(&read.data_base64).unwrap(), bytes);
        assert_eq!(read.mime, put.mime);
        assert_eq!(read.bytes, bytes.len() as u64);
        assert!(tmp.path().join(RESULTS_DIR_NAME).join(rest).is_file());
    }
    let size = store.size().unwrap();
    assert_eq!(size.files, 5);
    assert_eq!(
        size.bytes,
        (PNG.len() + JPEG.len() * 2 + GIF.len() + WEBP.len()) as u64
    );
    let json = serde_json::to_value(&size).unwrap();
    assert_eq!(json["files"], 5);
}

#[test]
fn result_store_accepts_only_real_images_of_the_allowed_types() {
    let (_tmp, store) = store();
    for mime in [
        "image/svg+xml",
        "text/html",
        "application/octet-stream",
        "",
        "image/bmp",
    ] {
        refused_result(
            store.put_image(&b64(PNG), mime),
            "mobile.ai.resultMimeNotAllowed",
        );
    }
    refused_result(
        store.put_image(&b64(JPEG), "image/png"),
        "mobile.ai.resultImageMismatch",
    );
    refused_result(
        store.put_image(&b64(b"<svg/>"), "image/png"),
        "mobile.ai.resultImageMismatch",
    );
    refused_result(
        store.put_image("not base64!!", "image/png"),
        "mobile.ai.resultInvalidData",
    );
    refused_result(
        store.put_image("", "image/png"),
        "mobile.ai.resultInvalidData",
    );
    assert_eq!(store.size().unwrap().files, 0);
}

#[test]
fn result_addresses_are_validated_strictly() {
    let (tmp, store) = store();
    let put = store.put_image(&b64(PNG), "image/png").unwrap();
    let id = put
        .address
        .strip_prefix("ai-result://")
        .unwrap()
        .split_once('.')
        .unwrap()
        .0
        .to_string();
    std::fs::write(tmp.path().join("ai-settings.json"), b"{}").unwrap();
    let bad = [
        "".to_string(),
        id.clone() + ".png",
        format!("file://{id}.png"),
        format!("ai-result://{}.png", id.to_uppercase()),
        format!("ai-result://{id}.svg"),
        format!("ai-result://{id}.PNG"),
        format!("ai-result://{id}"),
        format!("ai-result://{id}.png/../../ai-settings.json"),
        "ai-result://../ai-settings.json".to_string(),
        "ai-result://..%2fai-settings.json".to_string(),
        format!("ai-result://{id}.png\\..\\x"),
        format!("ai-result://./{id}.png"),
        format!("ai-result://{id}.png?x=1"),
        format!("ai-result://{}.png", id.replace('-', "")),
        format!("ai-result://{{{id}}}.png"),
    ];
    for address in bad {
        refused_result(store.read_image(&address), "mobile.ai.resultAddressInvalid");
    }
    // Well formed but absent (or with another extension than the stored file).
    let absent = format!("ai-result://{}.png", uuid::Uuid::new_v4());
    refused_result(store.read_image(&absent), "mobile.ai.resultNotFound");
    refused_result(
        store.read_image(&format!("ai-result://{id}.jpg")),
        "mobile.ai.resultNotFound",
    );
    // The good address still works.
    store.read_image(&put.address).unwrap();
}

#[test]
fn clear_removes_everything_inside_and_the_store_keeps_working() {
    let (tmp, store) = store();
    store.put_image(&b64(PNG), "image/png").unwrap();
    store.put_image(&b64(GIF), "image/gif").unwrap();
    let dir = tmp.path().join(RESULTS_DIR_NAME);
    std::fs::write(dir.join("stray.bin"), b"12345").unwrap();
    std::fs::create_dir_all(dir.join("sub/deeper")).unwrap();
    std::fs::write(dir.join("sub/deeper/x.png"), b"123").unwrap();
    let size = store.size().unwrap();
    assert_eq!(size.files, 4);
    assert_eq!(size.bytes, (PNG.len() + GIF.len() + 5 + 3) as u64);
    let after = store.clear().unwrap();
    assert_eq!((after.bytes, after.files), (0, 0));
    assert!(dir.is_dir());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    // Files outside the folder are untouched.
    std::fs::write(tmp.path().join("keep.txt"), b"k").unwrap();
    store.clear().unwrap();
    assert!(tmp.path().join("keep.txt").exists());
    let put = store.put_image(&b64(PNG), "image/png").unwrap();
    store.read_image(&put.address).unwrap();
}

#[test]
fn clear_during_puts_never_leaves_a_partial_file() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Arc::new(MobileAiResultStore::new(tmp.path().to_path_buf()));
    let mut big = PNG.to_vec();
    big.extend(std::iter::repeat_n(7u8, 256 * 1024));
    let data = Arc::new(b64(&big));
    let mut handles = Vec::new();
    for _ in 0..4 {
        let store = store.clone();
        let data = data.clone();
        handles.push(std::thread::spawn(move || {
            let mut addrs = Vec::new();
            for _ in 0..10 {
                addrs.push(store.put_image(&data, "image/png").unwrap().address);
            }
            addrs
        }));
    }
    let clearer = {
        let store = store.clone();
        std::thread::spawn(move || {
            for _ in 0..10 {
                store.clear().unwrap();
                std::thread::yield_now();
            }
        })
    };
    let addrs: Vec<String> = handles
        .into_iter()
        .flat_map(|h| h.join().unwrap())
        .collect();
    clearer.join().unwrap();
    for address in &addrs {
        match store.read_image(address) {
            Ok(read) => assert_eq!(read.bytes, big.len() as u64, "a stored image is whole"),
            Err(err) => assert_eq!(err.message_key, "mobile.ai.resultNotFound"),
        }
    }
    let dir = tmp.path().join(RESULTS_DIR_NAME);
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        assert!(!name.ends_with(".tmp"), "no temporary file is left: {name}");
        assert_eq!(std::fs::metadata(&path).unwrap().len(), big.len() as u64);
    }
}
