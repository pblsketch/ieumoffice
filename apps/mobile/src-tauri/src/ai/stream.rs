use crate::ai::chatgpt::{ChatGptService, ResponsesInputMessage};
use crate::ai::settings::MobileAiSettingsStore;
use crate::error::{MobileError, MobileErrorCode, MobileResult};
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

/// Manages active ChatGPT Direct stream requests and their cancellation (key providers use the relay).
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
            // Key providers run the PC protocol code in the webview and send through the
            // sealed relay (`mobile_ai_relay_start`); this command serves ChatGPT only.
            Err(MobileError::with_detail(
                MobileErrorCode::InvalidArgument,
                "mobile.ai.useRelay",
                "key providers stream through mobile_ai_relay_start",
            ))
        };

        self.cancels.lock().unwrap().remove(&req.request_id);
        result
    }
}
