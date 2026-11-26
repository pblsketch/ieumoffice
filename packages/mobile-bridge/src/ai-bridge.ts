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
  DEFAULT_MAX_OUTPUT_TOKENS,
  isOpenRouterFreeModel,
  isSubscriptionProvider,
  offSubscriptionStatus,
  providerSelectionOf,
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
  MOBILE_ERROR_CODES,
  MobileCommandError,
  invokeMobileCommand,
  parseMobileCommandError,
  type ConfiguredProviderSummary,
  type MobileAiSettingsSnapshot,
  type MobileChatGptStatus,
  type MobileClient,
  type MobileErrorCode,
  type MobileUnlisten,
} from './transport'

/**
 * In-memory placeholder placed only inside the projected `AiSettings` object when
 * Rust reports `hasKey === true`, so `isKeyProviderConfigured` works without ever
 * sending raw API keys to the WebView.
 */
export const SEALED_KEY_PLACEHOLDER = '__sealed__'

/**
 * The key value the webview hands a PC protocol for one provider: Rust's relay
 * swaps it for the sealed key, only on a request to that provider's own host.
 */
export function sealedKeyOf(provider: string): string {
  return `${SEALED_KEY_PLACEHOLDER}:${provider}`
}

/**
 * Stands in for the self-hosted server's base URL in the projected settings, so
 * `isKeyProviderConfigured('custom')` holds once Rust reports a saved server
 * (`configuredProviders.custom`). Never sent: a run reads the saved address
 * with `mobile_ai_get_custom_endpoint`.
 */
export const SEALED_CUSTOM_BASE_URL = 'https://custom-endpoint.invalid/'

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
      ...(meta.id === 'custom' && configured ? { baseUrl: SEALED_CUSTOM_BASE_URL } : {}),
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

// ---------------------------------------------------------------------------
// Request ids
// ---------------------------------------------------------------------------

let requestCounter = 0

/**
 * A request id no other request of this app run shares: Rust refuses a running
 * id and remembers early cancels by id, so ids are never reused.
 */
export function nextMobileAiRequestId(kind = 'ai'): string {
  requestCounter += 1
  const salt = Math.random().toString(36).slice(2, 8)
  return `mobile-${kind}-${Date.now().toString(36)}-${requestCounter}-${salt}`
}

// ---------------------------------------------------------------------------
// Rust commands of the AI track (AI-T1 relay, AI-T2 search, public requests,
// tool settings, result store). Thin typed wrappers over invokeMobileCommand.
// ---------------------------------------------------------------------------

/** The part of the client these wrappers use. */
export type MobileAiCommandClient = Pick<MobileClient, 'transport'>

/** Header list as Rust takes and sends it (names lower-case on the way back). */
export type MobileHeaderPairs = ReadonlyArray<readonly [string, string]>

export const MOBILE_AI_RELAY_EVENT = 'mobile:ai-relay-event'
export const MOBILE_AI_WEB_EVENT = 'mobile:ai-web-event'

export interface MobileAiRelayStartRequest {
  readonly requestId: string
  readonly url: string
  /** Rust takes GET and POST (a GET with a body is refused). */
  readonly method: string
  readonly headers?: MobileHeaderPairs
  readonly body?: string
}

export interface MobileAiSearchStartRequest {
  readonly requestId: string
  readonly url: string
  /** GET, POST or DELETE (MCP session end); a body only with POST. */
  readonly method: string
  readonly headers?: MobileHeaderPairs
  readonly body?: string
}

export interface MobileAiWebFetchStartRequest {
  readonly requestId: string
  readonly url: string
  /** GET only; absent means GET. */
  readonly method?: string
  /** Only accept, accept-language and user-agent are passed on. */
  readonly headers?: MobileHeaderPairs
}

export interface MobileAiOk {
  readonly ok: true
}

/** One event of a streamed request, as Rust emits it (ordered by `seq` from 0). */
export type MobileAiNetEventBody =
  | {
      readonly type: 'head'
      readonly status: number
      readonly headers: MobileHeaderPairs
      /** public requests only: the final address after redirects */
      readonly url?: string
      /** public requests only */
      readonly contentType?: string | null
    }
  | { readonly type: 'chunk'; readonly dataBase64: string }
  | { readonly type: 'end' }
  | { readonly type: 'error'; readonly code: string; readonly messageKey: string }

export type MobileAiNetEvent = {
  readonly requestId: string
  readonly seq: number
} & MobileAiNetEventBody

/** `mobile_ai_get_custom_endpoint` and friends: never the key itself. */
export interface MobileAiCustomEndpoint {
  readonly baseUrl: string | null
  readonly hasKey: boolean
  readonly model: string | null
  readonly models: readonly string[]
}

export interface MobileAiCustomEndpointPatch {
  /** https only; Rust checks the form */
  readonly baseUrl: string
  /** absent keeps the key (dropped when the host or port changes), empty removes it */
  readonly apiKey?: string | null
  /** absent keeps, empty removes */
  readonly model?: string | null
  /** absent keeps (cleared when the host changes) */
  readonly models?: readonly string[] | null
}

export type MobileAiImageProvider = 'openai' | 'gemini'

export interface MobileAiToolSettings {
  readonly internetTools: boolean
  readonly imageGeneration: boolean
  readonly imageProvider: MobileAiImageProvider | null
  readonly imageModel: string | null
  /** image providers whose key is in the vault (order gemini, openai) */
  readonly imageProvidersReady: readonly MobileAiImageProvider[]
}

export interface MobileAiToolSettingsPatch {
  readonly internetTools?: boolean
  readonly imageGeneration?: boolean
  /** '' clears */
  readonly imageProvider?: string
  /** '' clears */
  readonly imageModel?: string
}

export interface MobileAiResultsSize {
  readonly bytes: number
  readonly files: number
}

export interface MobileAiResultImage {
  /** `ai-result://<uuid>.<png|jpg|webp|gif>` */
  readonly address: string
  readonly mime: string
  readonly bytes: number
}

export interface MobileAiResultImageData {
  readonly dataBase64: string
  readonly mime: string
  readonly bytes: number
}

const argsOf = <T extends object>(value: T): Record<string, unknown> =>
  ({ ...value }) as Record<string, unknown>

function withPairs<T extends { readonly headers?: MobileHeaderPairs }>(
  request: T,
): Record<string, unknown> {
  const { headers, ...rest } = request
  return { ...rest, ...(headers ? { headers: headers.map(([n, v]) => [n, v]) } : {}) }
}

export function startMobileAiRelay(
  client: MobileAiCommandClient,
  request: MobileAiRelayStartRequest,
): Promise<MobileAiOk> {
  return invokeMobileCommand(client.transport, 'mobile_ai_relay_start', withPairs(request))
}

export function cancelMobileAiRelay(
  client: MobileAiCommandClient,
  requestId: string,
): Promise<MobileAiOk> {
  return invokeMobileCommand(client.transport, 'mobile_ai_relay_cancel', { requestId })
}

export function onMobileAiRelayEvent(
  client: MobileAiCommandClient,
  handler: (event: MobileAiNetEvent) => void,
): Promise<MobileUnlisten> {
  return client.transport.listen<MobileAiNetEvent>(MOBILE_AI_RELAY_EVENT, handler)
}

export function startMobileAiSearch(
  client: MobileAiCommandClient,
  request: MobileAiSearchStartRequest,
): Promise<MobileAiOk> {
  return invokeMobileCommand(client.transport, 'mobile_ai_search_start', withPairs(request))
}

export function startMobileAiWebFetch(
  client: MobileAiCommandClient,
  request: MobileAiWebFetchStartRequest,
): Promise<MobileAiOk> {
  return invokeMobileCommand(client.transport, 'mobile_ai_web_fetch_start', withPairs(request))
}

/** Cancels a search or a public address request (one command for both). */
export function cancelMobileAiWeb(
  client: MobileAiCommandClient,
  requestId: string,
): Promise<MobileAiOk> {
  return invokeMobileCommand(client.transport, 'mobile_ai_web_cancel', { requestId })
}

export function onMobileAiWebEvent(
  client: MobileAiCommandClient,
  handler: (event: MobileAiNetEvent) => void,
): Promise<MobileUnlisten> {
  return client.transport.listen<MobileAiNetEvent>(MOBILE_AI_WEB_EVENT, handler)
}

export function getMobileAiCustomEndpoint(
  client: MobileAiCommandClient,
): Promise<MobileAiCustomEndpoint> {
  return invokeMobileCommand(client.transport, 'mobile_ai_get_custom_endpoint')
}

export function setMobileAiCustomEndpoint(
  client: MobileAiCommandClient,
  patch: MobileAiCustomEndpointPatch,
): Promise<MobileAiCustomEndpoint> {
  const { models, ...rest } = patch
  return invokeMobileCommand(client.transport, 'mobile_ai_set_custom_endpoint', {
    ...rest,
    ...(models !== undefined ? { models: models === null ? null : [...models] } : {}),
  })
}

export function clearMobileAiCustomEndpoint(
  client: MobileAiCommandClient,
): Promise<MobileAiCustomEndpoint> {
  return invokeMobileCommand(client.transport, 'mobile_ai_clear_custom_endpoint')
}

export function getMobileAiToolSettings(
  client: MobileAiCommandClient,
): Promise<MobileAiToolSettings> {
  return invokeMobileCommand(client.transport, 'mobile_ai_get_tool_settings')
}

export function setMobileAiToolSettings(
  client: MobileAiCommandClient,
  patch: MobileAiToolSettingsPatch,
): Promise<MobileAiToolSettings> {
  return invokeMobileCommand(client.transport, 'mobile_ai_set_tool_settings', argsOf(patch))
}

export function getMobileAiResultsSize(
  client: MobileAiCommandClient,
): Promise<MobileAiResultsSize> {
  return invokeMobileCommand(client.transport, 'mobile_ai_results_size')
}

/** Empties the result store. The caller blocks this while a run is going (spec 3.5). */
export function clearMobileAiResults(client: MobileAiCommandClient): Promise<MobileAiResultsSize> {
  return invokeMobileCommand(client.transport, 'mobile_ai_results_clear')
}

export function putMobileAiResultImage(
  client: MobileAiCommandClient,
  image: { readonly dataBase64: string; readonly mime: string },
): Promise<MobileAiResultImage> {
  return invokeMobileCommand(client.transport, 'mobile_ai_results_put_image', argsOf(image))
}

export function readMobileAiResultImage(
  client: MobileAiCommandClient,
  address: string,
): Promise<MobileAiResultImageData> {
  return invokeMobileCommand(client.transport, 'mobile_ai_results_read_image', { address })
}

// ---------------------------------------------------------------------------
// A streamed Rust request as a WHATWG Response
// ---------------------------------------------------------------------------

/** One streamed request: how to subscribe, start and cancel it. */
export interface MobileStreamedRequest {
  readonly requestId: string
  /** subscribes to the event stream; called (and awaited) before `start` */
  listen(handler: (event: MobileAiNetEvent) => void): Promise<MobileUnlisten>
  /** sends the start command; its rejection before `head` rejects the Response */
  start(): Promise<unknown>
  /** sends the cancel command (on abort, or when the body is cancelled) */
  cancel(): Promise<unknown>
  readonly signal?: AbortSignal | null | undefined
  /** `response.url` when the head event names none (the relay) */
  readonly url?: string | undefined
}

/** Statuses a Response cannot carry a body with. */
const NULL_BODY_STATUSES = new Set([204, 205, 304])

function abortErrorOf(signal: AbortSignal | null | undefined): unknown {
  const reason: unknown = signal?.reason
  if (reason instanceof Error) return reason
  return new DOMException('This operation was aborted', 'AbortError')
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The error a Rust `error` event (or a rejected start) stands for, its messageKey kept. */
export function mobileNetError(code: string, messageKey: string): MobileCommandError {
  const known = (MOBILE_ERROR_CODES as readonly string[]).includes(code)
  return new MobileCommandError({
    code: (known ? code : 'INTERNAL_ERROR') as MobileErrorCode,
    messageKey,
    detail: `AI request failed (${messageKey})`,
  })
}

function responseOf(
  head: Extract<MobileAiNetEventBody, { type: 'head' }>,
  body: ReadableStream<Uint8Array>,
  fallbackUrl: string | undefined,
): Response {
  const headers = new Headers()
  for (const [name, value] of head.headers ?? []) {
    try {
      headers.append(name, value)
    } catch {
      // a header the Headers class refuses is dropped, never the whole answer
    }
  }
  if (head.contentType && !headers.has('content-type')) {
    headers.set('content-type', head.contentType)
  }
  const response = new Response(NULL_BODY_STATUSES.has(head.status) ? null : body, {
    status: head.status,
    headers,
  })
  const url = head.url ?? fallbackUrl
  if (url) Object.defineProperty(response, 'url', { value: url, configurable: true })
  return response
}

/**
 * Turns a start command and its event stream into a Response: the promise
 * settles on `head` (status, headers, url) and the body streams the base64
 * chunks as they arrive. Subscribes before starting, keeps only this request
 * id, orders events by `seq`, ignores everything after a cancel, and turns an
 * abort of `signal` (or a cancelled body) into the cancel command.
 */
export async function responseFromMobileStream(request: MobileStreamedRequest): Promise<Response> {
  const { signal } = request
  if (signal?.aborted) throw abortErrorOf(signal)

  let state: 'waiting' | 'streaming' | 'done' = 'waiting'
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let unlisten: MobileUnlisten | null = null
  let cancelSent = false
  let nextSeq = 0
  const pending = new Map<number, MobileAiNetEventBody>()
  let resolveHead!: (response: Response) => void
  let rejectHead!: (error: unknown) => void
  const head = new Promise<Response>((resolve, reject) => {
    resolveHead = resolve
    rejectHead = reject
  })

  const isSettled = () => state === 'done'
  const release = () => {
    state = 'done'
    pending.clear()
    signal?.removeEventListener('abort', onAbort)
    const off = unlisten
    unlisten = null
    off?.()
  }
  const fail = (error: unknown) => {
    if (state === 'done') return
    const streaming = state === 'streaming'
    release()
    if (streaming) controller?.error(error)
    else rejectHead(error)
  }
  const sendCancel = () => {
    if (cancelSent) return
    cancelSent = true
    void request.cancel().catch(() => {})
  }
  function onAbort() {
    if (state === 'done') return
    sendCancel()
    fail(abortErrorOf(signal))
  }

  const apply = (event: MobileAiNetEventBody) => {
    if (state === 'done') return
    switch (event.type) {
      case 'head': {
        if (state !== 'waiting') return
        if (!Number.isInteger(event.status) || event.status < 200 || event.status > 599) {
          sendCancel()
          fail(mobileNetError('NETWORK_ERROR', 'mobile.ai.unexpectedStatus'))
          return
        }
        state = 'streaming'
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
          },
          cancel() {
            // the reader dropped the answer (a resend after a busy refusal): stop the request
            if (state === 'done') return
            sendCancel()
            release()
          },
        })
        resolveHead(responseOf(event, body, request.url))
        return
      }
      case 'chunk':
        if (state === 'streaming' && event.dataBase64) {
          controller?.enqueue(decodeBase64(event.dataBase64))
        }
        return
      case 'end':
        if (state === 'streaming') {
          const c = controller
          release()
          c?.close()
        } else {
          fail(mobileNetError('NETWORK_ERROR', 'mobile.ai.streamInterrupted'))
        }
        return
      case 'error':
        fail(
          cancelSent && event.code === 'USER_CANCELLED'
            ? abortErrorOf(signal)
            : mobileNetError(event.code, event.messageKey),
        )
        return
    }
  }

  const onEvent = (event: MobileAiNetEvent) => {
    if (!event || event.requestId !== request.requestId || state === 'done') return
    const seq = typeof event.seq === 'number' && Number.isInteger(event.seq) ? event.seq : nextSeq
    if (seq < nextSeq || pending.has(seq)) return
    pending.set(seq, event)
    for (let next = pending.get(nextSeq); next; next = pending.get(nextSeq)) {
      pending.delete(nextSeq)
      nextSeq += 1
      apply(next)
    }
  }

  const off = await request.listen(onEvent)
  // defensive: nothing should settle the request before its start is sent
  if (isSettled()) {
    off()
    return head
  }
  unlisten = off
  if (signal?.aborted) {
    release()
    throw abortErrorOf(signal)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  // the start resolves only after `end` (events may still be on their way); a
  // rejection carries the same code as the `error` event, or a refusal before
  // any network work (no events at all)
  request.start().then(
    () => {},
    (err: unknown) => fail(cancelSent ? abortErrorOf(signal) : parseMobileCommandError(err)),
  )
  return head
}

/** What the fetch-like helpers accept from a RequestInit. */
export interface MobileFetchInit {
  readonly method?: string | undefined
  readonly headers?: HeadersInit | undefined
  readonly body?: BodyInit | null | undefined
  readonly signal?: AbortSignal | null | undefined
}

/** Header pairs from any HeadersInit shape (a record keeps the caller's spelling). */
export function mobileHeaderPairs(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) return []
  const out: Array<[string, string]> = []
  if (headers instanceof Headers) headers.forEach((value, name) => out.push([name, value]))
  else if (Array.isArray(headers)) for (const [name, value] of headers) out.push([name, value])
  else for (const [name, value] of Object.entries(headers)) out.push([name, String(value)])
  return out
}

function textBodyOf(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  throw new TypeError('The mobile AI requests send text bodies only.')
}

/**
 * fetch over the sealed relay (`mobile_ai_relay_start`): only a key
 * provider's own host, the key only as the `__sealed__:<id>` placeholder.
 */
export async function mobileRelayFetch(
  client: MobileAiCommandClient,
  url: string,
  init: MobileFetchInit = {},
): Promise<Response> {
  const requestId = nextMobileAiRequestId('relay')
  const method = (init.method ?? 'GET').toUpperCase()
  const body = textBodyOf(init.body)
  const headers = mobileHeaderPairs(init.headers)
  return responseFromMobileStream({
    requestId,
    url,
    signal: init.signal,
    listen: (handler) => onMobileAiRelayEvent(client, handler),
    start: () =>
      startMobileAiRelay(client, {
        requestId,
        url,
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      }),
    cancel: () => cancelMobileAiRelay(client, requestId),
  })
}

/** fetch over Rust's search request (fixed search hosts only, no keys, no redirects followed). */
export async function mobileSearchFetch(
  client: MobileAiCommandClient,
  url: string,
  init: MobileFetchInit = {},
): Promise<Response> {
  const requestId = nextMobileAiRequestId('search')
  const method = (init.method ?? 'GET').toUpperCase()
  const body = textBodyOf(init.body)
  const headers = mobileHeaderPairs(init.headers)
  return responseFromMobileStream({
    requestId,
    url,
    signal: init.signal,
    listen: (handler) => onMobileAiWebEvent(client, handler),
    start: () =>
      startMobileAiSearch(client, {
        requestId,
        url,
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      }),
    cancel: () => cancelMobileAiWeb(client, requestId),
  })
}

/**
 * GET over Rust's public address request (address check on every hop, five
 * redirects, 10 MB, 30 s); `response.url` is the final address.
 */
export async function mobileWebFetch(
  client: MobileAiCommandClient,
  url: string,
  init: Omit<MobileFetchInit, 'body'> = {},
): Promise<Response> {
  const requestId = nextMobileAiRequestId('web')
  const headers = mobileHeaderPairs(init.headers)
  return responseFromMobileStream({
    requestId,
    url,
    signal: init.signal,
    listen: (handler) => onMobileAiWebEvent(client, handler),
    start: () =>
      startMobileAiWebFetch(client, {
        requestId,
        url,
        method: (init.method ?? 'GET').toUpperCase(),
        headers,
      }),
    cancel: () => cancelMobileAiWeb(client, requestId),
  })
}

// ---------------------------------------------------------------------------
// The relay the PC protocol code reaches through `aiFetch`
// ---------------------------------------------------------------------------

let relayClient: MobileAiCommandClient | null = null

/**
 * Names the client whose relay the mobile `aiFetch` (the stand-in for
 * `packages/ai-provider/src/fetch.ts`, apps/mobile/src/renderer/ai/net/providerFetch.ts)
 * sends through. The key-provider transport binds it before each turn; other
 * callers of PC protocol code (picture making) bind it the same way.
 */
export function bindMobileAiRelay(client: MobileAiCommandClient | null): void {
  relayClient = client
}

/** fetch through the bound client's relay; never the webview's own network. */
export function mobileAiRelayFetch(url: string, init: MobileFetchInit = {}): Promise<Response> {
  const client = relayClient
  if (!client) {
    return Promise.reject(mobileNetError('INTERNAL_ERROR', 'mobile.ai.relayNotBound'))
  }
  return mobileRelayFetch(client, url, init)
}

// ---------------------------------------------------------------------------
// Error kinds of a key-provider turn
// ---------------------------------------------------------------------------

/**
 * `errorCode` of `onStreamError` on the key-provider route (spec 3.1 table):
 * - `free-limit`: today's free allowance is used up (OpenRouter `:free`, Gemini free tier); `errorResetsAt` when known
 * - `free-tier-model`: the model is not served on the free connection (Gemini quota 0, or a non-`:free`
 *   OpenRouter model refused by the webview or by Rust)
 * - `credits`: the provider says the credits ran out (PC `AiCreditsError`, or an HTTP 402)
 * - `overloaded`: busy or rate-limited (429 not of the free allowance, 503, 529) after PC's retries
 * - `auth`: HTTP 401/403, or no usable key or server saved (Rust `missingKey`, a key provider not set up)
 * - `network`: relay network failure, timeout, proxy, certificate or unreachable host
 * - `unknown`: anything else (the message is shown as a connection error)
 * The ChatGPT route keeps Rust's own codes (`rate-limit`, `signed-out`, ...).
 */
export type MobileAiStreamErrorCode =
  'free-limit' | 'free-tier-model' | 'credits' | 'overloaded' | 'auth' | 'network' | 'unknown'

export const MOBILE_AI_STREAM_ERROR_CODES: readonly MobileAiStreamErrorCode[] = [
  'free-limit',
  'free-tier-model',
  'credits',
  'overloaded',
  'auth',
  'network',
  'unknown',
]

/** What PC's `aiStreamErrorFields` reported for the error (run-error.ts). */
export interface PcStreamErrorFields {
  readonly errorCode?: string | undefined
  readonly errorResetsAt?: number | undefined
}

const PC_NETWORK_KINDS = new Set([
  'network',
  'proxy-error',
  'cert-error',
  'network-unreachable',
  'timeout',
])

function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth += 1) {
    chain.push(current)
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined
  }
  return chain
}

function mobileCommandErrorIn(err: unknown): MobileCommandError | undefined {
  return causeChain(err).find((e): e is MobileCommandError => e instanceof MobileCommandError)
}

/** The HTTP status the PC protocols put into their error text ("HTTP 401: …", "Claude HTTP 403: …"). */
function httpStatusIn(err: unknown): number | undefined {
  for (const e of causeChain(err)) {
    const text = typeof e === 'string' ? e : (e as { message?: unknown }).message
    if (typeof text !== 'string') continue
    const match = /\bHTTP (\d{3})\b/.exec(text)
    if (match) return Number(match[1])
  }
  return undefined
}

/** Sorts a failed key-provider turn into one of `MobileAiStreamErrorCode`. */
export function classifyMobileKeyProviderError(
  err: unknown,
  pcFields: PcStreamErrorFields = {},
): MobileAiStreamErrorCode {
  const relay = mobileCommandErrorIn(err)
  if (relay) {
    if (relay.messageKey === 'mobile.ai.openrouterFreeOnly') return 'free-tier-model'
    if (relay.code === 'AUTH_NOT_CONFIGURED' || relay.messageKey === 'mobile.ai.missingKey') {
      return 'auth'
    }
    if (relay.code === 'NETWORK_ERROR') return 'network'
    return 'unknown'
  }
  const kind = pcFields.errorCode
  if (kind === 'free-limit' || kind === 'free-tier-model' || kind === 'credits') return kind
  const status = httpStatusIn(err)
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'credits'
  if (kind === 'overloaded') return 'overloaded'
  if (kind && PC_NETWORK_KINDS.has(kind)) return 'network'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// PC protocol code, loaded the first time a key provider runs
// ---------------------------------------------------------------------------

async function importKeyProviderProtocols() {
  const [
    openAiCompatible,
    openAiResponses,
    anthropic,
    gemini,
    registry,
    outputCap,
    runError,
    effort,
  ] = await Promise.all([
    import('../../ai-provider/src/protocols/openai-compatible'),
    import('../../ai-provider/src/protocols/openai-responses'),
    import('../../ai-provider/src/protocols/anthropic'),
    import('../../ai-provider/src/protocols/gemini'),
    import('../../ai-provider/src/registry'),
    import('../../ai-provider/src/output-cap'),
    import('../../ai-provider/src/run-error'),
    import('../../ai-provider/src/key-effort'),
  ])
  return {
    streamOpenAiCompatible: openAiCompatible.streamOpenAiCompatible,
    streamOpenAiResponses: openAiResponses.streamOpenAiResponses,
    streamAnthropic: anthropic.streamAnthropic,
    streamGemini: gemini.streamGemini,
    getProviderAdapter: registry.getProviderAdapter,
    withOutputCapFallback: outputCap.withOutputCapFallback,
    aiStreamErrorFields: runError.aiStreamErrorFields,
    keyEffortBody: effort.keyEffortBody,
  }
}

type KeyProviderProtocols = Awaited<ReturnType<typeof importKeyProviderProtocols>>

let protocolsLoading: Promise<KeyProviderProtocols> | null = null

function loadKeyProviderProtocols(): Promise<KeyProviderProtocols> {
  protocolsLoading ??= importKeyProviderProtocols().catch((err: unknown) => {
    protocolsLoading = null
    throw err
  })
  return protocolsLoading
}

/** Loads the PC protocol code ahead of the first key-provider turn (no network). */
export async function preloadMobileKeyProviderProtocols(): Promise<void> {
  await loadKeyProviderProtocols()
}

// ---------------------------------------------------------------------------
// The agent transport
// ---------------------------------------------------------------------------

export interface MobileStreamErrorDetail {
  readonly error: string
  /** key providers: a `MobileAiStreamErrorCode`; ChatGPT: Rust's code */
  readonly errorCode?: string
  /** key providers: the provider id; ChatGPT: the subscription provider Rust named */
  readonly errorProvider?: string
  /** epoch milliseconds: when the free allowance resets (`free-limit`, when known) */
  readonly errorResetsAt?: number
}

export interface MobileAgentTransportOptions {
  readonly maxTokens?: number
  readonly onStreamError?: (detail: MobileStreamErrorDetail) => void
}

/** Thrown inside the key route for a refusal of its own (no provider request made). */
class KeyRouteRefusal extends Error {
  constructor(
    readonly kind: MobileAiStreamErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KeyRouteRefusal'
  }
}

interface TurnContext {
  readonly request: AgentStreamRequest
  readonly callbacks: AgentStreamCallbacks
  readonly options: MobileAgentTransportOptions
  readonly signal: AbortSignal
  /** settles the turn once (running the cleanups first); later calls do nothing */
  finish(fn: () => void): void
  isFinished(): boolean
  /** runs when the turn settles, or at once when it already has */
  addCleanup(fn: () => void): void
}

/**
 * The selected key provider, or null when the turn belongs to Rust's stream
 * command (`auto`, ChatGPT, or a snapshot that cannot be read: Rust serves only
 * ChatGPT there and refuses key providers itself).
 */
async function keyProviderOf(
  client: MobileClient,
): Promise<{ snapshot: MobileAiSettingsSnapshot; provider: AiProviderId } | null> {
  let snapshot: MobileAiSettingsSnapshot
  try {
    snapshot = await client.getAiSettings()
  } catch {
    return null
  }
  if (!snapshot) return null
  const selection = providerSelectionOf({
    provider: snapshot.selectedProvider as AiProviderSelection,
  })
  if (selection === 'auto' || isSubscriptionProvider(selection)) return null
  return { snapshot, provider: selection }
}

/** Rust's stream command (`mobile_ai_stream_start`): the ChatGPT path, unchanged. */
function runRustStream(
  client: MobileClient,
  turn: TurnContext,
  requestId: string,
  started: () => void,
): void {
  const { request, callbacks, options } = turn
  const finish = (fn: () => void) => turn.finish(fn)

  void (async () => {
    try {
      const unlisten = await client.onAiStreamChunk((chunk) => {
        if (chunk.requestId !== requestId || turn.isFinished()) return
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
      turn.addCleanup(unlisten)

      if (turn.signal.aborted) {
        finish(() => callbacks.onDone())
        return
      }

      callbacks.onPhase?.({ kind: 'requesting' })
      started()
      await client.startAiStream({
        requestId,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        maxTokens: options.maxTokens,
      })
    } catch (err) {
      if (turn.signal.aborted) {
        finish(() => callbacks.onDone())
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      finish(() => callbacks.onError(message))
    }
  })()
}

/** The provider config a key-provider turn hands the PC protocol: placeholder key, saved model. */
async function keyProviderConfig(
  client: MobileClient,
  snapshot: MobileAiSettingsSnapshot,
  provider: AiProviderId,
): Promise<AiProviderConfig> {
  const projected = projectMobileAiSettings(snapshot)
  const choice = selectAiProvider(projected, projectMobileSubscriptionStatuses({ state: 'hidden' }))
  if (!choice.connected || choice.provider !== provider) {
    throw new KeyRouteRefusal('auth', `The AI connection "${provider}" is not set up.`)
  }
  const stored = projected.providers[provider]
  if (provider !== 'custom') {
    return {
      apiKey: sealedKeyOf(provider),
      model: stored.model,
      ...(stored.models ? { models: stored.models } : {}),
    }
  }
  const endpoint = await getMobileAiCustomEndpoint(client)
  if (!endpoint.baseUrl) {
    throw new KeyRouteRefusal('auth', 'No self-hosted AI server is saved.')
  }
  return {
    // no key saved: no auth header goes out (the placeholder would be refused)
    apiKey: endpoint.hasKey ? sealedKeyOf('custom') : '',
    model: endpoint.model?.trim() || stored.model,
    baseUrl: endpoint.baseUrl,
    ...(endpoint.models.length ? { models: [...endpoint.models] } : {}),
  }
}

/**
 * One key-provider turn on PC's protocol code (as PC stream.ts routes it), its
 * network calls going through the sealed relay (the mobile `aiFetch`).
 */
function runKeyProviderStream(
  client: MobileClient,
  turn: TurnContext,
  snapshot: MobileAiSettingsSnapshot,
  provider: AiProviderId,
): void {
  const { request, callbacks, options, signal } = turn
  let pc: KeyProviderProtocols | null = null

  void (async () => {
    try {
      callbacks.onPhase?.({ kind: 'requesting' })
      let config = await keyProviderConfig(client, snapshot, provider)
      // the free connection takes `:free` models only (Rust refuses the rest too)
      assertValidMobileModelSelection(
        provider,
        config.model,
        snapshot.configuredProviders[provider],
      )
      pc = await loadKeyProviderProtocols()
      if (turn.isFinished()) return
      bindMobileAiRelay(client)

      const endpoint = pc.getProviderAdapter(provider).resolveEndpoint(config)
      const { baseUrl } = endpoint
      // read before the wire id replaces the model: the table is by the listed id
      const effortBody = pc.keyEffortBody(provider, config, endpoint.protocol)
      if (endpoint.model) config = { ...config, model: endpoint.model }
      const maxTokens = options.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
      let stopReason: string | undefined
      const cb = {
        signal,
        onDelta: (text: string) => {
          if (turn.isFinished() || !text) return
          callbacks.onPhase?.({ kind: 'responding' })
          callbacks.onDelta(text)
        },
        onReasoningDelta: (text: string) => {
          if (turn.isFinished() || !text) return
          callbacks.onPhase?.({ kind: 'thinking' })
          callbacks.onReasoning?.(text)
        },
        onToolCall: (call: Parameters<AgentStreamCallbacks['onToolCall']>[0]) => {
          if (!turn.isFinished()) callbacks.onToolCall(call)
        },
        onStopReason: (reason: string) => {
          stopReason = reason
        },
        onUsage: (usage: { inputTokens?: number; outputTokens?: number }) => {
          if (!turn.isFinished()) {
            callbacks.onUsage?.({
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            })
          }
        },
      }
      const messages = request.messages
      const tools = request.tools
      const protocols = pc
      await protocols.withOutputCapFallback(baseUrl, config.model, maxTokens, (cap) => {
        switch (endpoint.protocol) {
          case 'anthropic':
            return protocols.streamAnthropic(
              config,
              request.system,
              messages,
              tools,
              cap,
              cb,
              baseUrl,
              effortBody,
            )
          case 'gemini':
            return protocols.streamGemini(
              config,
              request.system,
              messages,
              tools,
              cap,
              cb,
              baseUrl,
              { omitTemperature: endpoint.omitTemperature },
            )
          case 'openai-compatible':
            return protocols.streamOpenAiCompatible(
              baseUrl,
              config,
              request.system,
              messages,
              tools,
              cap,
              cb,
              {
                omitTemperature: endpoint.omitTemperature,
                useMaxCompletionTokens: endpoint.useMaxCompletionTokens,
                bodyExtras: effortBody
                  ? { ...endpoint.bodyExtras, ...effortBody }
                  : endpoint.bodyExtras,
              },
            )
          case 'openai-responses':
            return protocols.streamOpenAiResponses(
              baseUrl,
              config,
              request.system,
              messages,
              tools,
              cap,
              cb,
              { bodyExtras: endpoint.bodyExtras },
            )
          default:
            throw new KeyRouteRefusal('unknown', `"${provider}" does not run on mobile.`)
        }
      })
      if (stopReason) callbacks.onStopReason?.(stopReason)
      turn.finish(() => callbacks.onDone())
    } catch (err) {
      if (turn.isFinished()) return
      if (signal.aborted) {
        turn.finish(() => callbacks.onDone())
        return
      }
      const pcFields: PcStreamErrorFields = pc ? pc.aiStreamErrorFields(err) : {}
      const errorCode =
        err instanceof KeyRouteRefusal ? err.kind : classifyMobileKeyProviderError(err, pcFields)
      const message = err instanceof Error ? err.message : String(err)
      options.onStreamError?.({
        error: message,
        errorCode,
        errorProvider: provider,
        ...(errorCode === 'free-limit' && pcFields.errorResetsAt !== undefined
          ? { errorResetsAt: pcFields.errorResetsAt }
          : {}),
      })
      turn.finish(() => callbacks.onError(message))
    }
  })()
}

/**
 * Bridges `@genoffice/agent-core`'s `AgentTransport` to the phone.
 *
 * - A selected key provider runs PC's protocol code in the webview
 *   (`packages/ai-provider/src/protocols/*`, routed by `getProviderAdapter` the
 *   way PC stream.ts does), its requests going through Rust's sealed relay with
 *   the `__sealed__:<id>` placeholder in the key position. Failures reach
 *   `onStreamError` with a `MobileAiStreamErrorCode`.
 * - Everything else (`auto`, ChatGPT) goes to Rust's `mobile_ai_stream_start` /
 *   `mobile:ai-stream-chunk` / `mobile_ai_stream_cancel`, as before.
 */
export function createMobileAgentTransport(
  client: MobileClient,
  options: MobileAgentTransportOptions = {},
): AgentTransport {
  return {
    stream(request: AgentStreamRequest, callbacks: AgentStreamCallbacks): AgentStreamHandle {
      const requestId = request.runId
        ? `${request.runId}-${nextMobileAiRequestId()}`
        : nextMobileAiRequestId()
      const controller = new AbortController()
      let finished = false
      let rustStarted = false
      const cleanups: Array<() => void> = []
      const turn: TurnContext = {
        request,
        callbacks,
        options,
        signal: controller.signal,
        finish(fn) {
          if (finished) return
          finished = true
          for (const cleanup of cleanups.splice(0)) cleanup()
          fn()
        },
        isFinished: () => finished,
        addCleanup(fn) {
          if (finished) fn()
          else cleanups.push(fn)
        },
      }

      void (async () => {
        const route = await keyProviderOf(client)
        if (finished) return
        if (route) runKeyProviderStream(client, turn, route.snapshot, route.provider)
        else {
          runRustStream(client, turn, requestId, () => {
            rustStarted = true
          })
        }
      })()

      return {
        cancel() {
          if (finished || controller.signal.aborted) return
          controller.abort()
          if (rustStarted) void client.cancelAiStream(requestId).catch(() => {})
          turn.finish(() => callbacks.onDone())
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
