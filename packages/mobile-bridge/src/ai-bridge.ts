import type {
  AgentMessage,
  AgentStreamCallbacks,
  AgentStreamHandle,
  AgentStreamRequest,
  AgentTransport,
} from '@genoffice/agent-core'
import {
  AI_PROVIDERS,
  AI_SUBSCRIPTION_NOTICE_VERSION,
  isOpenRouterFreeModel,
  offSubscriptionStatus,
  selectAiProvider,
  type AiProviderChoice,
  type AiProviderConfig,
  type AiProviderId,
  type AiProviderSelection,
  type AiSettings,
  type AiSubscriptionLoginFailureReason,
  type AiSubscriptionLoginFailureStep,
  type AiSubscriptionStatus,
  type AiSubscriptionStatuses,
} from '@genoffice/ai-provider/browser'
import { aiSendGate, type AiSendGate } from '@genoffice/ui'
import {
  MobileCommandError,
  type ConfiguredProviderSummary,
  type MobileAiSettingsSnapshot,
  type MobileChatGptStatus,
  type MobileClient,
} from './transport'

/**
 * In-memory placeholder placed only inside the projected `AiSettings` object when
 * Rust reports `hasKey === true`, so `isKeyProviderConfigured` works without ever
 * sending raw API keys to the WebView.
 */
export const SEALED_KEY_PLACEHOLDER = '__sealed__'

/**
 * Projects Rust's key-free `MobileAiSettingsSnapshot` into the shared `AiSettings`
 * shape consumed by `selectAiProvider` and `aiSendGate`.
 */
export function projectMobileAiSettings(snapshot: MobileAiSettingsSnapshot): AiSettings {
  const providers = {} as Record<AiProviderId, AiProviderConfig>
  for (const meta of AI_PROVIDERS) {
    const configured = snapshot.configuredProviders[meta.id]
    const storedModel = snapshot.modelByProvider[meta.id]
    providers[meta.id] = {
      apiKey: configured?.hasKey ? SEALED_KEY_PLACEHOLDER : '',
      model: storedModel?.trim() ? storedModel : meta.defaultModel,
      ...(configured?.models?.length ? { models: [...configured.models] } : {}),
    }
  }

  const noticeVersion = Math.max(0, Math.floor(snapshot.subscriptionNoticeVersion || 0))
  return {
    provider: (snapshot.selectedProvider || 'auto') as AiProviderSelection,
    providers,
    subscriptionOff: {
      'claude-code': true,
      codex: true,
    },
    subscriptionNoticeVersion: noticeVersion,
    subscriptionNoticeSeen: noticeVersion >= AI_SUBSCRIPTION_NOTICE_VERSION,
  }
}

/**
 * Projects mobile subscription status into `AiSubscriptionStatuses`:
 * - Desktop CLIs (`claude-code`, `codex`) are always `off` so `auto` never stalls in `checking`.
 * - ChatGPT `'hidden'` projects to `'signed-out'` for provider selection; UI checks `chatgptVisible` separately.
 */
export function projectMobileSubscriptionStatuses(
  chatgpt: MobileChatGptStatus,
): AiSubscriptionStatuses {
  const chatgptState: AiSubscriptionStatus['state'] =
    chatgpt.state === 'hidden' ? 'signed-out' : chatgpt.state

  const chatgptStatus: AiSubscriptionStatus = {
    provider: 'chatgpt',
    state: chatgptState,
    meteredAccepted: false,
    ...(chatgptState === 'ready' ? { loginMethod: 'subscription' as const } : {}),
    ...(chatgpt.account ? { account: chatgpt.account } : {}),
    ...(chatgpt.loginFailure
      ? {
          loginFailure: {
            reason: chatgpt.loginFailure.reason as AiSubscriptionLoginFailureReason,
            ...(chatgpt.loginFailure.step
              ? { step: chatgpt.loginFailure.step as AiSubscriptionLoginFailureStep }
              : {}),
            ...(typeof chatgpt.loginFailure.httpStatus === 'number'
              ? { httpStatus: chatgpt.loginFailure.httpStatus }
              : {}),
            ...(chatgpt.loginFailure.oauthError
              ? { oauthError: chatgpt.loginFailure.oauthError }
              : {}),
          },
        }
      : {}),
  }

  return {
    'claude-code': offSubscriptionStatus('claude-code'),
    codex: offSubscriptionStatus('codex'),
    chatgpt: chatgptStatus,
  }
}

export function selectMobileAiProvider(
  snapshot: MobileAiSettingsSnapshot,
  chatgpt: MobileChatGptStatus,
): AiProviderChoice {
  return selectAiProvider(
    projectMobileAiSettings(snapshot),
    projectMobileSubscriptionStatuses(chatgpt),
  )
}

export function evaluateMobileAiSendGate(
  snapshot: MobileAiSettingsSnapshot | null | undefined,
  chatgpt: MobileChatGptStatus | null | undefined,
): AiSendGate {
  if (!snapshot) return { kind: 'checking' }
  return aiSendGate(
    projectMobileAiSettings(snapshot),
    chatgpt ? projectMobileSubscriptionStatuses(chatgpt) : null,
  )
}

/**
 * Validates model selection against OpenRouter `freeOnly` guard before sending to Rust.
 */
export function assertValidMobileModelSelection(
  provider: string,
  model: string,
  configured: ConfiguredProviderSummary | undefined,
): void {
  const trimmed = model.trim()
  if (!trimmed) {
    throw new MobileCommandError({
      code: 'INVALID_ARGUMENT',
      messageKey: 'mobile.ai.emptyModel',
      detail: 'Model id must not be empty.',
    })
  }
  if (
    provider === 'openrouter' &&
    configured?.freeOnly === true &&
    !isOpenRouterFreeModel(trimmed)
  ) {
    throw new MobileCommandError({
      code: 'INVALID_ARGUMENT',
      messageKey: 'mobile.ai.openrouterFreeOnly',
      detail: 'OpenRouter free connection only allows :free models.',
    })
  }
}

let requestCounter = 0

function nextRequestId(): string {
  requestCounter += 1
  return `mobile-ai-${Date.now()}-${requestCounter}`
}

export interface MobileAgentTransportOptions {
  readonly maxTokens?: number
  readonly onStreamError?: (detail: {
    readonly error: string
    readonly errorCode?: string
    readonly errorProvider?: string
  }) => void
}

/**
 * Bridges `@genoffice/agent-core`'s `AgentTransport` to Rust's
 * `mobile_ai_stream_start` / `mobile:ai-stream-chunk` / `mobile_ai_stream_cancel`.
 */
export function createMobileAgentTransport(
  client: MobileClient,
  options: MobileAgentTransportOptions = {},
): AgentTransport {
  return {
    stream(request: AgentStreamRequest, callbacks: AgentStreamCallbacks): AgentStreamHandle {
      const requestId = request.runId ? `${request.runId}-${nextRequestId()}` : nextRequestId()
      let finished = false
      let cancelled = false
      let unlisten: (() => void) | null = null

      const finish = (fn: () => void) => {
        if (finished) return
        finished = true
        const off = unlisten
        unlisten = null
        off?.()
        fn()
      }

      void (async () => {
        try {
          unlisten = await client.onAiStreamChunk((chunk) => {
            if (chunk.requestId !== requestId || finished) return
            switch (chunk.type) {
              case 'delta':
                if (chunk.text) {
                  callbacks.onPhase?.({ kind: 'responding' })
                  callbacks.onDelta(chunk.text)
                }
                break
              case 'reasoning':
                if (chunk.text) {
                  callbacks.onPhase?.({ kind: 'thinking' })
                  callbacks.onReasoning?.(chunk.text)
                }
                break
              case 'tool-call':
                if (chunk.toolCall) {
                  callbacks.onToolCall(chunk.toolCall)
                }
                break
              case 'usage':
                if (chunk.usage) {
                  callbacks.onUsage?.({
                    inputTokens: chunk.usage.inputTokens,
                    outputTokens: chunk.usage.outputTokens,
                  })
                }
                break
              case 'done':
                if (chunk.stopReason) callbacks.onStopReason?.(chunk.stopReason)
                finish(() => callbacks.onDone())
                break
              case 'error': {
                const message = chunk.error || chunk.errorCode || 'AI request failed.'
                options.onStreamError?.({
                  error: message,
                  errorCode: chunk.errorCode,
                  errorProvider: chunk.errorProvider,
                })
                finish(() => callbacks.onError(message))
                break
              }
              case 'ping':
              case 'subscription-usage':
              case 'input-truncated':
                break
            }
          })

          if (cancelled) {
            finish(() => callbacks.onDone())
            return
          }

          callbacks.onPhase?.({ kind: 'requesting' })
          await client.startAiStream({
            requestId,
            system: request.system,
            messages: request.messages,
            tools: request.tools,
            maxTokens: options.maxTokens,
          })
        } catch (err) {
          if (cancelled) {
            finish(() => callbacks.onDone())
            return
          }
          const message = err instanceof Error ? err.message : String(err)
          finish(() => callbacks.onError(message))
        }
      })()

      return {
        cancel() {
          if (finished || cancelled) return
          cancelled = true
          void client.cancelAiStream(requestId).catch(() => {})
          finish(() => callbacks.onDone())
        },
      }
    },
  }
}

/**
 * Ephemeral in-memory AI conversation store scoped to the active document only.
 * Cleared immediately when switching documents, closing a document, or leaving the app.
 */
export class MobileAiMemoryStore {
  private docKey: string | null = null
  private messages: AgentMessage[] = []

  getDocKey(): string | null {
    return this.docKey
  }

  getMessages(): readonly AgentMessage[] {
    return this.messages
  }

  setMessages(next: readonly AgentMessage[]): void {
    this.messages = [...next]
  }

  append(message: AgentMessage): void {
    this.messages = [...this.messages, message]
  }

  clear(): void {
    this.messages = []
  }

  resetForDoc(nextDocKey: string | null): void {
    if (this.docKey !== nextDocKey) {
      this.docKey = nextDocKey
      this.messages = []
    } else if (nextDocKey === null) {
      this.messages = []
    }
  }
}

export function createMobileAiMemoryStore(): MobileAiMemoryStore {
  return new MobileAiMemoryStore()
}
