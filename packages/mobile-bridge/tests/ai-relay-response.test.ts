import { describe, expect, it } from 'vitest'
import {
  MOBILE_AI_RELAY_EVENT,
  MOBILE_AI_WEB_EVENT,
  SEALED_CUSTOM_BASE_URL,
  cancelMobileAiRelay,
  cancelMobileAiWeb,
  classifyMobileKeyProviderError,
  clearMobileAiCustomEndpoint,
  clearMobileAiResults,
  getMobileAiCustomEndpoint,
  getMobileAiResultsSize,
  getMobileAiToolSettings,
  mobileRelayFetch,
  mobileSearchFetch,
  mobileWebFetch,
  nextMobileAiRequestId,
  projectMobileAiSettings,
  putMobileAiResultImage,
  readMobileAiResultImage,
  responseFromMobileStream,
  sealedKeyOf,
  selectMobileAiProvider,
  setMobileAiCustomEndpoint,
  setMobileAiToolSettings,
  startMobileAiRelay,
  startMobileAiSearch,
  startMobileAiWebFetch,
  type MobileAiNetEvent,
} from '../src/ai-bridge'
import {
  MobileCommandError,
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileTransport,
} from '../src/transport'

// The webview side of track T7's Rust commands: typed wrappers, and a streamed
// request turned into a WHATWG Response. A fake transport plays Rust; nothing
// here touches a network.

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

function fakeRust(invoke: Invoke = async () => ({ ok: true })) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      return (await invoke(command, args)) as T
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler as (payload: unknown) => void)
      listeners.set(event, set)
      return () => set.delete(handler as (payload: unknown) => void)
    },
  }
  const emit = (event: string, payload: Partial<MobileAiNetEvent> & Record<string, unknown>) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler(payload)
  }
  const listening = (event: string) => listeners.get(event)?.size ?? 0
  return { client: createMobileClient(transport), calls, emit, listening }
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('command wrappers of the AI track', () => {
  it('sends every AI-T1 and AI-T2 command by its Rust name and camelCase arguments', async () => {
    const rust = fakeRust()
    const c = rust.client
    const headers = [['accept', 'text/event-stream']] as const
    await startMobileAiRelay(c, {
      requestId: 'r1',
      url: 'https://openrouter.ai/x',
      method: 'POST',
      headers,
      body: '{}',
    })
    await cancelMobileAiRelay(c, 'r1')
    await startMobileAiSearch(c, {
      requestId: 's1',
      url: 'https://search.parallel.ai/mcp',
      method: 'DELETE',
    })
    await startMobileAiWebFetch(c, { requestId: 'w1', url: 'https://example.com/' })
    await cancelMobileAiWeb(c, 'w1')
    await getMobileAiCustomEndpoint(c)
    await setMobileAiCustomEndpoint(c, {
      baseUrl: 'https://llm.example/v1',
      apiKey: null,
      models: ['m'],
    })
    await clearMobileAiCustomEndpoint(c)
    await getMobileAiToolSettings(c)
    await setMobileAiToolSettings(c, { imageGeneration: true, imageProvider: 'gemini' })
    await getMobileAiResultsSize(c)
    await clearMobileAiResults(c)
    await putMobileAiResultImage(c, { dataBase64: 'iVBORw0KGgo=', mime: 'image/png' })
    await readMobileAiResultImage(c, 'ai-result://0f8fad5b-d9cb-469f-a165-70867728950e.png')

    expect(rust.calls).toEqual([
      {
        command: 'mobile_ai_relay_start',
        args: {
          requestId: 'r1',
          url: 'https://openrouter.ai/x',
          method: 'POST',
          headers: [['accept', 'text/event-stream']],
          body: '{}',
        },
      },
      { command: 'mobile_ai_relay_cancel', args: { requestId: 'r1' } },
      {
        command: 'mobile_ai_search_start',
        args: { requestId: 's1', url: 'https://search.parallel.ai/mcp', method: 'DELETE' },
      },
      {
        command: 'mobile_ai_web_fetch_start',
        args: { requestId: 'w1', url: 'https://example.com/' },
      },
      { command: 'mobile_ai_web_cancel', args: { requestId: 'w1' } },
      { command: 'mobile_ai_get_custom_endpoint', args: undefined },
      {
        command: 'mobile_ai_set_custom_endpoint',
        args: { baseUrl: 'https://llm.example/v1', apiKey: null, models: ['m'] },
      },
      { command: 'mobile_ai_clear_custom_endpoint', args: undefined },
      { command: 'mobile_ai_get_tool_settings', args: undefined },
      {
        command: 'mobile_ai_set_tool_settings',
        args: { imageGeneration: true, imageProvider: 'gemini' },
      },
      { command: 'mobile_ai_results_size', args: undefined },
      { command: 'mobile_ai_results_clear', args: undefined },
      {
        command: 'mobile_ai_results_put_image',
        args: { dataBase64: 'iVBORw0KGgo=', mime: 'image/png' },
      },
      {
        command: 'mobile_ai_results_read_image',
        args: { address: 'ai-result://0f8fad5b-d9cb-469f-a165-70867728950e.png' },
      },
    ])
  })

  it('turns a Rust refusal into a MobileCommandError with its messageKey', async () => {
    const rust = fakeRust(async () => {
      throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.ai.relayHostNotAllowed' }
    })
    await expect(
      startMobileAiRelay(rust.client, {
        requestId: 'x',
        url: 'https://evil.example/',
        method: 'GET',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      messageKey: 'mobile.ai.relayHostNotAllowed',
    })
  })

  it('makes request ids that never repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, () => nextMobileAiRequestId('relay')))
    expect(ids.size).toBe(200)
  })
})

describe('a streamed request as a Response', () => {
  it('builds status, headers, url and body from head and chunks, in seq order, for its own id only', async () => {
    const rust = fakeRust(async (command, args) => {
      if (command !== 'mobile_ai_relay_start') return { ok: true }
      const requestId = String(args?.requestId)
      setTimeout(() => {
        // another request's events on the same channel are not this answer
        rust.emit(MOBILE_AI_RELAY_EVENT, {
          requestId: 'someone-else',
          seq: 0,
          type: 'chunk',
          dataBase64: b64('NO'),
        })
        rust.emit(MOBILE_AI_RELAY_EVENT, {
          requestId,
          seq: 0,
          type: 'head',
          status: 201,
          headers: [
            ['content-type', 'text/plain'],
            ['x-request-id', 'abc'],
          ],
        })
        // seq 2 arrives before seq 1: the body still comes in order
        rust.emit(MOBILE_AI_RELAY_EVENT, {
          requestId,
          seq: 2,
          type: 'chunk',
          dataBase64: b64('world'),
        })
        rust.emit(MOBILE_AI_RELAY_EVENT, {
          requestId,
          seq: 1,
          type: 'chunk',
          dataBase64: b64('hello '),
        })
        rust.emit(MOBILE_AI_RELAY_EVENT, { requestId, seq: 3, type: 'end' })
      }, 0)
      return { ok: true }
    })
    const response = await mobileRelayFetch(rust.client, 'https://api.openai.com/v1/x', {
      method: 'post',
      headers: { Authorization: `Bearer ${sealedKeyOf('openai')}` },
      body: '{"a":1}',
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBe('abc')
    expect(response.url).toBe('https://api.openai.com/v1/x')
    expect(await response.text()).toBe('hello world')
    expect(rust.calls[0]).toMatchObject({
      command: 'mobile_ai_relay_start',
      args: {
        url: 'https://api.openai.com/v1/x',
        method: 'POST',
        headers: [['Authorization', 'Bearer __sealed__:openai']],
        body: '{"a":1}',
      },
    })
    // the subscription ends with the answer
    expect(rust.listening(MOBILE_AI_RELAY_EVENT)).toBe(0)
  })

  it('subscribes before it starts', async () => {
    const order: string[] = []
    const transport: MobileTransport = {
      async invoke<T>(command: string): Promise<T> {
        order.push(command)
        return { ok: true } as T
      },
      async listen() {
        order.push('listen')
        return () => {}
      },
    }
    const pending = mobileRelayFetch(createMobileClient(transport), 'https://openrouter.ai/x')
    await tick()
    expect(order).toEqual(['listen', 'mobile_ai_relay_start'])
    void pending.catch(() => {})
  })

  it('rejects with the Rust refusal when the start is refused before any network work', async () => {
    const rust = fakeRust(async (command) => {
      if (command === 'mobile_ai_relay_start') {
        throw { code: 'AUTH_NOT_CONFIGURED', messageKey: 'mobile.ai.missingKey' }
      }
      return { ok: true }
    })
    const failure = await mobileRelayFetch(
      rust.client,
      'https://api.anthropic.com/v1/messages',
    ).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(MobileCommandError)
    expect(failure).toMatchObject({
      code: 'AUTH_NOT_CONFIGURED',
      messageKey: 'mobile.ai.missingKey',
    })
    expect(rust.listening(MOBILE_AI_RELAY_EVENT)).toBe(0)
  })

  it('errors the body when the network fails after the head', async () => {
    const rust = fakeRust(async (command, args) => {
      if (command !== 'mobile_ai_relay_start') return { ok: true }
      const requestId = String(args?.requestId)
      return new Promise((_resolve, reject) => {
        setTimeout(() => {
          rust.emit(MOBILE_AI_RELAY_EVENT, {
            requestId,
            seq: 0,
            type: 'head',
            status: 200,
            headers: [],
          })
          rust.emit(MOBILE_AI_RELAY_EVENT, {
            requestId,
            seq: 1,
            type: 'chunk',
            dataBase64: b64('part'),
          })
          const error = { code: 'NETWORK_ERROR', messageKey: 'mobile.ai.streamInterrupted' }
          rust.emit(MOBILE_AI_RELAY_EVENT, { requestId, seq: 2, type: 'error', ...error })
          reject(error)
        }, 0)
      })
    })
    const response = await mobileRelayFetch(rust.client, 'https://openrouter.ai/x')
    await expect(response.text()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      messageKey: 'mobile.ai.streamInterrupted',
    })
  })

  it('sends the cancel command on abort and ignores events after it', async () => {
    let requestId = ''
    const rust = fakeRust(async (command, args) => {
      if (command === 'mobile_ai_relay_start') {
        requestId = String(args?.requestId)
        setTimeout(() => {
          rust.emit(MOBILE_AI_RELAY_EVENT, {
            requestId,
            seq: 0,
            type: 'head',
            status: 200,
            headers: [],
          })
          rust.emit(MOBILE_AI_RELAY_EVENT, {
            requestId,
            seq: 1,
            type: 'chunk',
            dataBase64: b64('first'),
          })
        }, 0)
        return new Promise(() => {})
      }
      return { ok: true }
    })
    const controller = new AbortController()
    const response = await mobileRelayFetch(rust.client, 'https://openrouter.ai/x', {
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
    controller.abort()
    // late events of the cancelled request change nothing
    rust.emit(MOBILE_AI_RELAY_EVENT, { requestId, seq: 2, type: 'chunk', dataBase64: b64('late') })
    rust.emit(MOBILE_AI_RELAY_EVENT, { requestId, seq: 3, type: 'end' })
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    expect(rust.calls.filter((c) => c.command === 'mobile_ai_relay_cancel')).toEqual([
      { command: 'mobile_ai_relay_cancel', args: { requestId } },
    ])
    expect(rust.listening(MOBILE_AI_RELAY_EVENT)).toBe(0)
  })

  it('does not start at all when the signal is already aborted', async () => {
    const rust = fakeRust()
    const controller = new AbortController()
    controller.abort()
    await expect(
      mobileRelayFetch(rust.client, 'https://openrouter.ai/x', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(rust.calls).toEqual([])
  })

  it('cancels the request when the reader drops the body', async () => {
    const rust = fakeRust(async (command, args) => {
      if (command === 'mobile_ai_relay_start') {
        const requestId = String(args?.requestId)
        setTimeout(() => {
          rust.emit(MOBILE_AI_RELAY_EVENT, {
            requestId,
            seq: 0,
            type: 'head',
            status: 503,
            headers: [],
          })
        }, 0)
        return new Promise(() => {})
      }
      return { ok: true }
    })
    const response = await mobileRelayFetch(rust.client, 'https://openrouter.ai/x')
    await response.body!.cancel()
    expect(rust.calls.map((c) => c.command)).toContain('mobile_ai_relay_cancel')
  })

  it('takes the final address of a public request from its head, over the web channel', async () => {
    const rust = fakeRust(async (command, args) => {
      if (command !== 'mobile_ai_web_fetch_start') return { ok: true }
      const requestId = String(args?.requestId)
      setTimeout(() => {
        rust.emit(MOBILE_AI_WEB_EVENT, {
          requestId,
          seq: 0,
          type: 'head',
          status: 200,
          url: 'https://example.com/final',
          contentType: 'text/html',
          headers: [],
        })
        rust.emit(MOBILE_AI_WEB_EVENT, {
          requestId,
          seq: 1,
          type: 'chunk',
          dataBase64: b64('<p>hi</p>'),
        })
        rust.emit(MOBILE_AI_WEB_EVENT, { requestId, seq: 2, type: 'end' })
      }, 0)
      return { ok: true }
    })
    const response = await mobileWebFetch(rust.client, 'https://example.com/start')
    expect(response.url).toBe('https://example.com/final')
    expect(response.headers.get('content-type')).toBe('text/html')
    expect(await response.text()).toBe('<p>hi</p>')
    expect(rust.calls[0]).toMatchObject({
      command: 'mobile_ai_web_fetch_start',
      args: { url: 'https://example.com/start', method: 'GET' },
    })
  })

  it('sends search requests to the search command and cancels them with the web cancel', async () => {
    const rust = fakeRust(async (command) => {
      if (command === 'mobile_ai_search_start') return new Promise(() => {})
      return { ok: true }
    })
    const controller = new AbortController()
    const pending = mobileSearchFetch(rust.client, 'https://search.parallel.ai/mcp', {
      method: 'POST',
      body: '{"jsonrpc":"2.0"}',
      signal: controller.signal,
    })
    await tick()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(rust.calls.map((c) => c.command)).toEqual([
      'mobile_ai_search_start',
      'mobile_ai_web_cancel',
    ])
  })

  it('refuses a body that is not text', async () => {
    const rust = fakeRust()
    await expect(
      mobileRelayFetch(rust.client, 'https://api.openai.com/v1/x', {
        method: 'POST',
        body: new Uint8Array([1, 2]),
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(rust.calls).toEqual([])
  })

  it('settles a stream whose start is used directly', async () => {
    let started = false
    const listeners: Array<(e: MobileAiNetEvent) => void> = []
    const response = responseFromMobileStream({
      requestId: 'direct',
      listen: async (handler) => {
        listeners.push(handler)
        return () => {}
      },
      start: async () => {
        started = true
        setTimeout(() => {
          for (const l of listeners) {
            l({ requestId: 'direct', seq: 0, type: 'head', status: 204, headers: [] })
            l({ requestId: 'direct', seq: 1, type: 'end' })
          }
        }, 0)
        return { ok: true }
      },
      cancel: async () => ({ ok: true }),
      url: 'https://x.example/',
    })
    const result = await response
    expect(started).toBe(true)
    expect(result.status).toBe(204)
    expect(result.body).toBeNull()
  })
})

describe('error kinds of the key-provider route', () => {
  const relay = (code: string, messageKey: string) =>
    new MobileCommandError({ code: code as 'NETWORK_ERROR', messageKey })

  it('maps the PC kinds and HTTP statuses onto the mobile set', () => {
    expect(
      classifyMobileKeyProviderError(new Error('HTTP 429: x'), { errorCode: 'free-limit' }),
    ).toBe('free-limit')
    expect(
      classifyMobileKeyProviderError(new Error('Gemini HTTP 429: x'), {
        errorCode: 'free-tier-model',
      }),
    ).toBe('free-tier-model')
    expect(classifyMobileKeyProviderError(new Error('notice'), { errorCode: 'credits' })).toBe(
      'credits',
    )
    expect(classifyMobileKeyProviderError(new Error('HTTP 402: no money'))).toBe('credits')
    expect(
      classifyMobileKeyProviderError(new Error('HTTP 503: x'), { errorCode: 'overloaded' }),
    ).toBe('overloaded')
    expect(classifyMobileKeyProviderError(new Error('HTTP 401: bad key'))).toBe('auth')
    expect(classifyMobileKeyProviderError(new Error('Claude HTTP 403: nope'))).toBe('auth')
    for (const kind of ['network', 'proxy-error', 'cert-error', 'network-unreachable', 'timeout']) {
      expect(classifyMobileKeyProviderError(new Error('x'), { errorCode: kind })).toBe('network')
    }
    expect(classifyMobileKeyProviderError(new Error('HTTP 400: bad request'))).toBe('unknown')
  })

  it('reads relay errors by their code, through a wrapping error', () => {
    const wrapped = new Error('Claude fetch failed', {
      cause: relay('NETWORK_ERROR', 'mobile.ai.networkError'),
    })
    expect(classifyMobileKeyProviderError(wrapped)).toBe('network')
    expect(
      classifyMobileKeyProviderError(relay('AUTH_NOT_CONFIGURED', 'mobile.ai.missingKey')),
    ).toBe('auth')
    expect(
      classifyMobileKeyProviderError(relay('INVALID_ARGUMENT', 'mobile.ai.openrouterFreeOnly')),
    ).toBe('free-tier-model')
    expect(
      classifyMobileKeyProviderError(relay('INVALID_ARGUMENT', 'mobile.ai.relayHostNotAllowed')),
    ).toBe('unknown')
  })
})

describe('projection of a saved self-hosted server', () => {
  it('lets a saved server count as connected without its address or key in the webview', () => {
    const snapshot: MobileAiSettingsSnapshot = {
      selectedProvider: 'custom',
      modelByProvider: { custom: 'qwen3:8b' },
      configuredProviders: { custom: { hasKey: false, models: [] } },
      chatgptVisible: false,
      subscriptionNoticeVersion: 0,
    }
    expect(projectMobileAiSettings(snapshot).providers.custom.baseUrl).toBe(SEALED_CUSTOM_BASE_URL)
    expect(selectMobileAiProvider(snapshot, { state: 'hidden' })).toEqual({
      connected: true,
      provider: 'custom',
      metered: false,
    })
    // no saved server: not connected
    const unsaved = { ...snapshot, configuredProviders: {} }
    expect(projectMobileAiSettings(unsaved).providers.custom.baseUrl).toBeUndefined()
    expect(selectMobileAiProvider(unsaved, { state: 'hidden' }).connected).toBe(false)
  })
})
