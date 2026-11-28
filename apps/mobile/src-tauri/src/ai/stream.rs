use crate::ai::chatgpt::{ChatGptService, ResponsesInputMessage};
use crate::ai::http::{build_safe_http_client, enforce_https_url, extract_safe_error_code};
use crate::ai::settings::{MobileAiSettingsStore, provider_chat_url};
use crate::error::{MobileError, MobileErrorCode, MobileResult};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiStreamRequest {
    pub request_id: String,
    pub system: String,
    pub messages: Vec<serde_json::Value>,
    #[serde(default)]
    pub tools: Vec<serde_json::Value>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAiStreamEvent {
    pub request_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

/// Manages active AI stream requests and cancellation across ChatGPT Direct and HTTPS BYOK providers.
pub struct MobileAiStreamManager {
    settings: Arc<MobileAiSettingsStore>,
    chatgpt: Arc<ChatGptService>,
    cancels: Mutex<BTreeMap<String, oneshot::Sender<()>>>,
}

impl MobileAiStreamManager {
    pub fn new(settings: Arc<MobileAiSettingsStore>, chatgpt: Arc<ChatGptService>) -> Self {
        Self {
            settings,
            chatgpt,
            cancels: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn cancel(&self, request_id: &str) {
        if let Some(tx) = self.cancels.lock().unwrap().remove(request_id) {
            let _ = tx.send(());
        }
    }

    pub async fn run_stream<F>(
        &self,
        req: MobileAiStreamRequest,
        mut emit: F,
    ) -> MobileResult<()>
    where
        F: FnMut(MobileAiStreamEvent) + Send,
    {
        let (tx, mut rx) = oneshot::channel();
        self.cancels.lock().unwrap().insert(req.request_id.clone(), tx);

        let snap = self.settings.get_snapshot(self.chatgpt.is_visible())?;
        let provider = if snap.selected_provider == "auto" {
            // Auto NEVER falls back to paid API-key providers — ChatGPT direct only.
            let status = self.chatgpt.status()?;
            if status.state == "ready" {
                "chatgpt".to_string()
            } else {
                self.cancels.lock().unwrap().remove(&req.request_id);
                return Err(MobileError::new(
                    MobileErrorCode::SignedOut,
                    "mobile.ai.notConnected",
                ));
            }
        } else {
            snap.selected_provider.clone()
        };

        let model = snap
            .model_by_provider
            .get(&provider)
            .cloned()
            .unwrap_or_default();

        let result = if provider == "chatgpt" {
            let chosen_model = if model.is_empty() {
                let models = self.chatgpt.list_models().await?;
                models
                    .first()
                    .map(|m| m.slug.clone())
                    .ok_or_else(|| MobileError::new(MobileErrorCode::NetworkError, "mobile.chatgpt.noModels"))?
            } else {
                model
            };
            let input: Vec<ResponsesInputMessage> = req
                .messages
                .iter()
                .filter_map(|m| {
                    let role = m.get("role")?.as_str()?;
                    let mapped_role = match role {
                        "user" | "assistant" | "developer" => role,
                        _ => "user",
                    };
                    let content = m
                        .get("content")
                        .and_then(|c| c.as_str())
                        .map(ToString::to_string)
                        .unwrap_or_else(|| m.get("content").map(|c| c.to_string()).unwrap_or_default());
                    Some(ResponsesInputMessage {
                        role: mapped_role.to_string(),
                        content,
                    })
                })
                .collect();
            let access_token = self.chatgpt.ensure_valid_access_token_shielded().await?;
            let req_id = req.request_id.clone();
            tokio::select! {
                _ = &mut rx => Err(MobileError::new(MobileErrorCode::UserCancelled, "mobile.ai.cancelled")),
                res = self.chatgpt.stream_responses_with_token(&access_token, &chosen_model, Some(&req.system), &input, |delta| {
                    emit(MobileAiStreamEvent {
                        request_id: req_id.clone(),
                        kind: "delta".to_string(),
                        text: Some(delta.to_string()),
                        error: None,
                        error_code: None,
                        stop_reason: None,
                    });
                }) => {
                    res.map(|_| {
                        emit(MobileAiStreamEvent {
                            request_id: req_id.clone(),
                            kind: "done".to_string(),
                            text: None,
                            error: None,
                            error_code: None,
                            stop_reason: Some("end_turn".to_string()),
                        });
                    })
                }
            }
        } else {
            if provider == "openrouter"
                && self.settings.is_openrouter_free_only()?
                && !model.ends_with(":free")
            {
                self.cancels.lock().unwrap().remove(&req.request_id);
                return Err(MobileError::with_detail(
                    MobileErrorCode::InvalidArgument,
                    "mobile.ai.openrouterFreeOnly",
                    "OpenRouter free-only connection permits only :free models",
                ));
            }
            let api_key = self
                .settings
                .get_api_key(&provider)?
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| MobileError::new(MobileErrorCode::AuthNotConfigured, "mobile.ai.missingKey"))?;
            let endpoint = provider_chat_url(&provider)?;
            let _ = enforce_https_url(endpoint, false)?;
            let client = build_safe_http_client(120)?;
            let mut body = if provider == "anthropic" {
                let mut obj = serde_json::json!({
                    "model": model,
                    "system": req.system,
                    "messages": req.messages,
                    "max_tokens": req.max_tokens.unwrap_or(4096),
                    "stream": true,
                });
                if !req.tools.is_empty() {
                    obj["tools"] = serde_json::json!(req.tools);
                }
                obj
            } else {
                let mut chat_messages = vec![serde_json::json!({ "role": "system", "content": req.system })];
                chat_messages.extend(req.messages.clone());
                let mut obj = serde_json::json!({
                    "model": model,
                    "messages": chat_messages,
                    "stream": true,
                });
                if let Some(max_t) = req.max_tokens {
                    obj["max_tokens"] = serde_json::json!(max_t);
                }
                if !req.tools.is_empty() {
                    obj["tools"] = serde_json::json!(req.tools);
                }
                obj
            };
            let _ = &mut body;
            let mut builder = client
                .post(endpoint)
                .header("accept", "text/event-stream")
                .header("content-type", "application/json")
                .json(&body);
            if provider == "anthropic" {
                builder = builder
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01");
            } else {
                builder = builder.bearer_auth(api_key);
            }
            let req_id = req.request_id.clone();
            tokio::select! {
                _ = &mut rx => Err(MobileError::new(MobileErrorCode::UserCancelled, "mobile.ai.cancelled")),
                send_res = builder.send() => {
                    let resp = send_res.map_err(|_| MobileError::new(MobileErrorCode::NetworkError, "mobile.ai.networkError"))?;
                    let status = resp.status().as_u16();
                    if !(200..300).contains(&status) {
                        let err_body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
                        let code = extract_safe_error_code(&err_body).unwrap_or_else(|| format!("http_{status}"));
                        let err_code = if status == 429 { MobileErrorCode::RateLimited } else if status == 401 || status == 403 { MobileErrorCode::AuthDenied } else { MobileErrorCode::NetworkError };
                        Err(MobileError::with_detail(err_code, "mobile.ai.providerError", code))
                    } else {
                        let mut stream = resp.bytes_stream();
                        let mut buf = String::new();
                        while let Some(chunk) = stream.next().await {
                            let bytes = chunk.map_err(|_| MobileError::new(MobileErrorCode::NetworkError, "mobile.ai.streamInterrupted"))?;
                            buf.push_str(&String::from_utf8_lossy(&bytes));
                            while let Some(pos) = buf.find('\n') {
                                let line = buf[..pos].trim_end_matches('\r').to_string();
                                buf.drain(..=pos);
                                let Some(data) = line.strip_prefix("data:") else { continue };
                                let data = data.trim();
                                if data.is_empty() || data == "[DONE]" { continue; }
                                if let Ok(ev) = serde_json::from_str::<serde_json::Value>(data) {
                                    let delta = ev
                                        .pointer("/choices/0/delta/content")
                                        .or_else(|| ev.pointer("/delta/text"))
                                        .and_then(|v| v.as_str());
                                    if let Some(text) = delta {
                                        emit(MobileAiStreamEvent {
                                            request_id: req_id.clone(),
                                            kind: "delta".to_string(),
                                            text: Some(text.to_string()),
                                            error: None,
                                            error_code: None,
                                            stop_reason: None,
                                        });
                                    }
                                }
                            }
                        }
                        emit(MobileAiStreamEvent {
                            request_id: req_id,
                            kind: "done".to_string(),
                            text: None,
                            error: None,
                            error_code: None,
                            stop_reason: Some("end_turn".to_string()),
                        });
                        Ok(())
                    }
                }
            }
        };

        self.cancels.lock().unwrap().remove(&req.request_id);
        result
    }
}
