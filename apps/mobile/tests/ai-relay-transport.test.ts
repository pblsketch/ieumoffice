import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage, AgentStreamRequest, AgentToolCall } from '@genoffice/agent-core'
import {
  createMobileAgentTransport,
  preloadMobileKeyProviderProtocols,
  type MobileStreamErrorDetail,
} from '@genoffice/mobile-bridge/ai-bridge'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAiStreamChunk,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { mobileAiFetchPlugin } from '../config/tracks/ai'
import { setAiTransientRetryDelays } from '../src/renderer/ai/net/providerFetch'

// The key-provider route of the mobile AI transport: PC's protocol code runs in
// the webview and its requests go through a fake of Rust's sealed relay that
// answers with scripted provider SSE. Nothing here reaches a network or holds a
// key: the only key the webview ever has is the `__sealed__:<id>` placeholder.

interface RelayStart {
  readonly requestId: string
  readonly url: string
  readonly method: string
  readonly headers: Array<[string, string]>
  readonly body?: string
}

type Reply =
  | {
      readonly status: number
      readonly headers?: Array<[string, string]>
      readonly body: string
      /** leave the stream open after the body (a long answer still on its way) */
      readonly hang?: boolean
    }
  | { readonly networkError: true }
  | { readonly refuse: { readonly code: string; readonly messageKey: string } }

const SSE: Array<[string, string]> = [['content-type', 'text/event-stream']]
const JSON_HEADERS: Array<[string, string]> = [['content-type', 'application/json']]

function sse(events: readonly unknown[], done = false): string {
  const lines = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)
  return lines.join('') + (done ? 'data: [DONE]\n\n' : '')
}

function freeOpenRouter(
  model = 'meta-llama/llama-3.3-70b-instruct:free',
): MobileAiSettingsSnapshot {
  return {
    selectedProvider: 'openrouter',
    modelByProvider: { openrouter: model },
    configuredProviders: { openrouter: { hasKey: true, freeOnly: true, models: [model] } },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
}

function keyProvider(provider: string, model: string): MobileAiSettingsSnapshot {
  return {
    selectedProvider: provider,
    modelByProvider: { [provider]: model },
    configuredProviders: { [provider]: { hasKey: true, models: [] } },
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
}

function makeFakeRust(options: {
  snapshot: MobileAiSettingsSnapshot
  replies?: Reply[]
  customEndpoint?: { baseUrl: string | null; hasKey: boolean; model: string | null }
}) {
  const commands: string[] = []
  const relayStarts: RelayStart[] = []
  const relayCancels: string[] = []
  const streamStarts: Array<Record<string, unknown>> = []
  const replies = [...(options.replies ?? [])]
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const emit = (event: string, payload: unknown) => {
    for (const handler of listeners.get(event) ?? []) handler(payload)
  }
  const hanging = new Map<string, (reason: unknown) => void>()

  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      commands.push(command)
      switch (command) {
        case 'mobile_get_ai_settings':
          return options.snapshot as T
        case 'mobile_chatgpt_status':
          return { state: 'hidden' } as T
        case 'mobile_ai_get_custom_endpoint':
          return { models: [], ...options.customEndpoint } as T
        case 'mobile_ai_relay_start': {
          const start = args as unknown as RelayStart
          relayStarts.push(start)
          const reply = replies.shift()
          if (!reply) throw { code: 'INTERNAL_ERROR', messageKey: 'test.noReply' }
          if ('refuse' in reply) throw reply.refuse
          let seq = 0
          const send = (body: Record<string, unknown>) =>
            emit('mobile:ai-relay-event', { requestId: start.requestId, seq: seq++, ...body })
          return new Promise<T>((resolve, reject) => {
            setTimeout(() => {
              if ('networkError' in reply) {
                const error = { code: 'NETWORK_ERROR', messageKey: 'mobile.ai.networkError' }
                send({ type: 'error', ...error })
                reject(error)
                return
              }
              send({ type: 'head', status: reply.status, headers: reply.headers ?? SSE })
              // the body arrives in uneven pieces, as the network splits it
              const bytes = Buffer.from(reply.body, 'utf8')
              for (let at = 0; at < bytes.length; at += 37) {
                send({ type: 'chunk', dataBase64: bytes.subarray(at, at + 37).toString('base64') })
              }
              if (reply.hang) {
                hanging.set(start.requestId, (reason) => {
                  send({ type: 'error', code: 'USER_CANCELLED', messageKey: 'mobile.ai.cancelled' })
                  reject(reason)
                })
                return
              }
              send({ type: 'end' })
              resolve({ ok: true } as T)
            }, 0)
          })
        }
        case 'mobile_ai_relay_cancel': {
          const requestId = String((args as { requestId: string }).requestId)
          relayCancels.push(requestId)
          hanging.get(requestId)?.({ code: 'USER_CANCELLED', messageKey: 'mobile.ai.cancelled' })
          // a late chunk after the cancel must be ignored by the webview
          emit('mobile:ai-relay-event', {
            requestId,
            seq: 999,
            type: 'chunk',
            dataBase64: Buffer.from('data: {"late":true}\n\n').toString('base64'),
          })
          return { ok: true } as T
        }
        case 'mobile_ai_stream_start': {
          streamStarts.push(args ?? {})
          const requestId = String((args as { requestId: string }).requestId)
          setTimeout(() => {
            const chunk = (c: Omit<MobileAiStreamChunk, 'requestId'>) =>
              emit('mobile:ai-stream-chunk', { requestId, ...c })
            chunk({ type: 'delta', text: 'From ChatGPT' })
            chunk({ type: 'done', stopReason: 'end_turn' })
          }, 0)
          return { ok: true } as T
        }
        default:
          return { ok: true } as T
      }
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(handler as (payload: unknown) => void)
      listeners.set(event, set)
      return () => set.delete(handler as (payload: unknown) => void)
    },
  }
  return {
    client: createMobileClient(transport),
    commands,
    relayStarts,
    relayCancels,
    streamStarts,
  }
}

interface TurnResult {
  readonly deltas: string[]
  readonly reasoning: string[]
  readonly toolCalls: AgentToolCall[]
  readonly stopReasons: string[]
  readonly usage: Array<{ inputTokens?: number; outputTokens?: number }>
  readonly streamErrors: MobileStreamErrorDetail[]
  readonly outcome: 'done' | 'error'
  readonly error?: string
}

function runTurn(
  client: ReturnType<typeof createMobileClient>,
  request: Partial<AgentStreamRequest> = {},
  onFirstDelta?: (cancel: () => void) => void,
): Promise<TurnResult> {
  const result = {
    deltas: [] as string[],
    reasoning: [] as string[],
    toolCalls: [] as AgentToolCall[],
    stopReasons: [] as string[],
    usage: [] as Array<{ inputTokens?: number; outputTokens?: number }>,
    streamErrors: [] as MobileStreamErrorDetail[],
  }
  const transport = createMobileAgentTransport(client, {
    maxTokens: 4096,
    onStreamError: (detail) => result.streamErrors.push(detail),
  })
  return new Promise((resolve) => {
    let ended = false
    const end = (outcome: 'done' | 'error', error?: string) => {
      if (ended) throw new Error('the turn settled twice')
      ended = true
      // let any late event arrive before the result is read
      setTimeout(() => resolve({ ...result, outcome, ...(error ? { error } : {}) }), 20)
    }
    const handle = transport.stream(
      {
        system: 'You edit documents.',
        messages: [{ role: 'user', text: 'Replace a with b' }],
        tools: [],
        ...request,
      },
      {
        onDelta: (text) => {
          result.deltas.push(text)
          if (result.deltas.length === 1) onFirstDelta?.(() => handle.cancel())
        },
        onReasoning: (text) => result.reasoning.push(text),
        onToolCall: (call) => result.toolCalls.push(call),
        onStopReason: (reason) => result.stopReasons.push(reason),
        onUsage: (usage) => result.usage.push(usage),
        onDone: () => end('done'),
        onError: (error) => end('error', error),
      },
    )
  })
}

const REPLACE_TOOL = {
  name: 'replace_text',
  description: 'Replace text in the document',
  inputSchema: {
    type: 'object',
    properties: { find: { type: 'string' }, with: { type: 'string' } },
    required: ['find', 'with'],
  },
}

const HISTORY: AgentMessage[] = [
  { role: 'user', text: 'Replace a with b' },
  {
    role: 'assistant',
    text: '',
    toolCalls: [{ id: 'call_0', name: 'replace_text', input: { find: 'x', with: 'y' } }],
  },
  { role: 'tool', results: [{ id: 'call_0', name: 'replace_text', output: 'replaced 1' }] },
  { role: 'user', text: 'Now replace a with b' },
]

function headerOf(start: RelayStart, name: string): string | undefined {
  return start.headers.find(([n]) => n.toLowerCase() === name)?.[1]
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  // the first load of the PC protocol code is slow on a cold test run
  await preloadMobileKeyProviderProtocols()
}, 60_000)

beforeEach(() => {
  setAiTransientRetryDelays([0])
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no real network in tests'))
})

afterEach(() => {
  // the protocol code went through the relay, never the webview's own fetch
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
  setAiTransientRetryDelays(null)
})

describe('the key-provider route over the sealed relay', () => {
  it('runs an OpenAI-compatible turn: text deltas and a streamed tool call', async () => {
    const rust = makeFakeRust({
      snapshot: freeOpenRouter(),
      replies: [
        {
          status: 200,
          body: sse(
            [
              { choices: [{ delta: { content: 'On ' } }] },
              { choices: [{ delta: { content: 'it.' } }] },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_1',
                          function: { name: 'replace_text', arguments: '{"find":' },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [{ index: 0, function: { arguments: '"a","with":"b"}' } }],
                    },
                  },
                ],
              },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
              { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
            ],
            true,
          ),
        },
      ],
    })
    const turn = await runTurn(rust.client, { messages: HISTORY, tools: [REPLACE_TOOL] })

    expect(turn.outcome).toBe('done')
    expect(turn.deltas.join('')).toBe('On it.')
    expect(turn.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'replace_text',
        input: { find: 'a', with: 'b' },
        inputError: undefined,
      },
    ])
    expect(turn.usage).toEqual([{ inputTokens: 12, outputTokens: 5 }])
    expect(turn.streamErrors).toEqual([])

    expect(rust.relayStarts).toHaveLength(1)
    const [start] = rust.relayStarts
    expect(start.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(start.method).toBe('POST')
    // the placeholder sits in the key position; nothing else carries a key
    expect(headerOf(start, 'authorization')).toBe('Bearer __sealed__:openrouter')
    expect(JSON.stringify(start)).not.toMatch(/sk-|__sealed__:(?!openrouter)/)

    const body = JSON.parse(start.body!)
    expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct:free')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(4096)
    expect(body.messages).toEqual([
      { role: 'system', content: 'You edit documents.' },
      { role: 'user', content: 'Replace a with b' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_0',
            type: 'function',
            function: { name: 'replace_text', arguments: '{"find":"x","with":"y"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_0', content: 'replaced 1' },
      { role: 'user', content: 'Now replace a with b' },
    ])
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'replace_text',
          description: 'Replace text in the document',
          parameters: REPLACE_TOOL.inputSchema,
        },
      },
    ])
    // the ChatGPT stream command is not part of this route
    expect(rust.streamStarts).toHaveLength(0)
  })

  it('runs an Anthropic turn: text and a tool_use block', async () => {
    const rust = makeFakeRust({
      snapshot: keyProvider('anthropic', 'claude-sonnet-4-5'),
      replies: [
        {
          status: 200,
          body: sse([
            { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure.' } },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'tool_use', id: 'toolu_1', name: 'replace_text', input: {} },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '{"find":"a",' },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '"with":"b"}' },
            },
            { type: 'content_block_stop', index: 1 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'tool_use' },
              usage: { output_tokens: 20 },
            },
            { type: 'message_stop' },
          ]),
        },
      ],
    })
    const turn = await runTurn(rust.client, { messages: HISTORY, tools: [REPLACE_TOOL] })

    expect(turn.outcome).toBe('done')
    expect(turn.deltas.join('')).toBe('Sure.')
    expect(turn.toolCalls).toEqual([
      {
        id: 'toolu_1',
        name: 'replace_text',
        input: { find: 'a', with: 'b' },
        inputError: undefined,
      },
    ])
    expect(turn.stopReasons).toEqual(['tool_use'])

    const [start] = rust.relayStarts
    expect(start.url).toBe('https://api.anthropic.com/v1/messages')
    expect(headerOf(start, 'x-api-key')).toBe('__sealed__:anthropic')
    expect(headerOf(start, 'authorization')).toBeUndefined()
    const body = JSON.parse(start.body!)
    expect(body.model).toBe('claude-sonnet-4-5')
    // tool results go back as a user message of tool_result blocks
    // (the last two messages also carry the official API's cache marker)
    expect(body.messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_0', content: 'replaced 1' }],
    })
    expect(body.messages[1].content).toEqual([
      { type: 'tool_use', id: 'call_0', name: 'replace_text', input: { find: 'x', with: 'y' } },
    ])
    expect(body.tools[0]).toEqual({
      name: 'replace_text',
      description: 'Replace text in the document',
      input_schema: REPLACE_TOOL.inputSchema,
    })
  })

  it('runs a Gemini turn: text and a functionCall part', async () => {
    const rust = makeFakeRust({
      snapshot: keyProvider('gemini', 'gemini-2.5-flash'),
      replies: [
        {
          status: 200,
          body: sse([
            { candidates: [{ content: { role: 'model', parts: [{ text: 'Looking.' }] } }] },
            {
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [
                      { functionCall: { name: 'replace_text', args: { find: 'a', with: 'b' } } },
                    ],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
            },
          ]),
        },
      ],
    })
    const turn = await runTurn(rust.client, { tools: [REPLACE_TOOL] })

    expect(turn.outcome).toBe('done')
    expect(turn.deltas.join('')).toBe('Looking.')
    expect(turn.toolCalls).toHaveLength(1)
    expect(turn.toolCalls[0]).toMatchObject({
      name: 'replace_text',
      input: { find: 'a', with: 'b' },
    })

    const [start] = rust.relayStarts
    expect(start.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    )
    expect(headerOf(start, 'x-goog-api-key')).toBe('__sealed__:gemini')
    const body = JSON.parse(start.body!)
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Replace a with b' }] }])
    expect(body.tools[0].functionDeclarations[0].name).toBe('replace_text')
  })

  it('sends a self-hosted server without a key no auth header, to its saved address', async () => {
    const rust = makeFakeRust({
      snapshot: {
        selectedProvider: 'custom',
        modelByProvider: { custom: 'qwen3:8b' },
        configuredProviders: { custom: { hasKey: false, models: ['qwen3:8b'] } },
        chatgptVisible: false,
        subscriptionNoticeVersion: 0,
      },
      customEndpoint: { baseUrl: 'https://llm.home.example/v1', hasKey: false, model: 'qwen3:8b' },
      replies: [
        {
          status: 200,
          body: sse([{ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }], true),
        },
      ],
    })
    const turn = await runTurn(rust.client)
    expect(turn.outcome).toBe('done')
    expect(turn.deltas.join('')).toBe('Hi')
    const [start] = rust.relayStarts
    expect(start.url).toBe('https://llm.home.example/v1/chat/completions')
    expect(headerOf(start, 'authorization')).toBeUndefined()
    expect(JSON.stringify(start)).not.toContain('__sealed__')
    expect(JSON.parse(start.body!).model).toBe('qwen3:8b')
  })

  it('cancels the relay request and ignores what arrives after the cancel', async () => {
    const rust = makeFakeRust({
      snapshot: freeOpenRouter(),
      replies: [
        { status: 200, body: sse([{ choices: [{ delta: { content: 'Partial' } }] }]), hang: true },
      ],
    })
    const turn = await runTurn(rust.client, {}, (cancel) => cancel())
    expect(turn.outcome).toBe('done')
    expect(turn.deltas).toEqual(['Partial'])
    expect(turn.streamErrors).toEqual([])
    expect(rust.relayCancels).toEqual([rust.relayStarts[0].requestId])
  })

  it('keeps the ChatGPT route on Rust stream command', async () => {
    const rust = makeFakeRust({
      snapshot: {
        selectedProvider: 'auto',
        modelByProvider: {},
        configuredProviders: {},
        chatgptVisible: true,
        subscriptionNoticeVersion: 0,
      },
    })
    const turn = await runTurn(rust.client)
    expect(turn.outcome).toBe('done')
    expect(turn.deltas).toEqual(['From ChatGPT'])
    expect(rust.streamStarts).toHaveLength(1)
    expect(rust.relayStarts).toHaveLength(0)
  })
})

describe('error kinds of a key-provider turn', () => {
  const failing = async (snapshot: MobileAiSettingsSnapshot, replies: Reply[]) => {
    const rust = makeFakeRust({ snapshot, replies })
    const turn = await runTurn(rust.client)
    expect(turn.outcome).toBe('error')
    expect(turn.streamErrors).toHaveLength(1)
    return { ...turn.streamErrors[0], starts: rust.relayStarts.length }
  }

  it('reads a 429 of the used-up free allowance as free-limit, with its reset time, and does not resend', async () => {
    const resetAt = 1_893_456_000_000
    const detail = await failing(freeOpenRouter(), [
      {
        status: 429,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: {
            message:
              'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
            code: 429,
            metadata: { headers: { 'X-RateLimit-Reset': String(resetAt) } },
          },
        }),
      },
    ])
    expect(detail.errorCode).toBe('free-limit')
    expect(detail.errorResetsAt).toBe(resetAt)
    expect(detail.errorProvider).toBe('openrouter')
    expect(detail.starts).toBe(1)
  })

  it('reads a free-tier quota of 0 as free-tier-model', async () => {
    const detail = await failing(keyProvider('gemini', 'gemini-4-argon'), [
      {
        status: 429,
        headers: JSON_HEADERS,
        body: '{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-4-argon","status":"RESOURCE_EXHAUSTED"}}',
      },
    ])
    expect(detail.errorCode).toBe('free-tier-model')
    expect(detail.starts).toBe(1)
  })

  it('reads a 402 as credits', async () => {
    const detail = await failing(keyProvider('openrouter', 'openai/gpt-5'), [
      {
        status: 402,
        headers: JSON_HEADERS,
        body: '{"error":{"message":"Insufficient credits","code":402}}',
      },
    ])
    expect(detail.errorCode).toBe('credits')
  })

  it('resends a 503 the way PC does, then reports overloaded', async () => {
    const busy: Reply = { status: 503, headers: JSON_HEADERS, body: '{"error":"high demand"}' }
    const detail = await failing(keyProvider('gemini', 'gemini-2.5-flash'), [busy, busy])
    expect(detail.errorCode).toBe('overloaded')
    // one resend for each configured wait ([0] here)
    expect(detail.starts).toBe(2)
  })

  it('does not wait out a Retry-After longer than PC does', async () => {
    const detail = await failing(keyProvider('gemini', 'gemini-2.5-flash'), [
      {
        status: 429,
        headers: [...JSON_HEADERS, ['retry-after', '120']],
        body: '{"error":"rate limited"}',
      },
    ])
    expect(detail.errorCode).toBe('overloaded')
    expect(detail.starts).toBe(1)
  })

  it('succeeds when the resend after a busy answer goes through', async () => {
    const rust = makeFakeRust({
      snapshot: freeOpenRouter(),
      replies: [
        { status: 503, headers: JSON_HEADERS, body: '{"error":"busy"}' },
        {
          status: 200,
          body: sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }], true),
        },
      ],
    })
    const turn = await runTurn(rust.client)
    expect(turn.outcome).toBe('done')
    expect(turn.deltas).toEqual(['ok'])
    expect(rust.relayStarts).toHaveLength(2)
  })

  it('reads 401 and 403 as auth', async () => {
    for (const status of [401, 403]) {
      const detail = await failing(keyProvider('anthropic', 'claude-sonnet-4-5'), [
        { status, headers: JSON_HEADERS, body: '{"error":{"message":"invalid x-api-key"}}' },
      ])
      expect(detail.errorCode).toBe('auth')
    }
  })

  it('reads a relay network failure as network, and a missing sealed key as auth', async () => {
    const network = await failing(freeOpenRouter(), [{ networkError: true }])
    expect(network.errorCode).toBe('network')
    const missing = await failing(freeOpenRouter(), [
      { refuse: { code: 'AUTH_NOT_CONFIGURED', messageKey: 'mobile.ai.missingKey' } },
    ])
    expect(missing.errorCode).toBe('auth')
  })

  it('refuses a paid model on the free OpenRouter connection without calling the relay', async () => {
    const rust = makeFakeRust({ snapshot: freeOpenRouter('openai/gpt-5'), replies: [] })
    const turn = await runTurn(rust.client)
    expect(turn.outcome).toBe('error')
    expect(turn.streamErrors[0]?.errorCode).toBe('free-tier-model')
    expect(rust.relayStarts).toHaveLength(0)
  })

  it('reads a key provider without a key as auth, sending nothing', async () => {
    const rust = makeFakeRust({
      snapshot: {
        ...keyProvider('anthropic', 'claude-sonnet-4-5'),
        configuredProviders: {},
      },
    })
    const turn = await runTurn(rust.client)
    expect(turn.streamErrors[0]?.errorCode).toBe('auth')
    expect(rust.relayStarts).toHaveLength(0)
  })
})

describe('the fetch swap of the track build', () => {
  it('swaps only an ai-provider import that resolves to its fetch module', async () => {
    const plugin = mobileAiFetchPlugin()
    const root = process
      .cwd()
      .replace(/\\/g, '/')
      .replace(/\/apps\/mobile$/, '')
    const pcFetch = `${root}/packages/ai-provider/src/fetch.ts`
    const resolveId = plugin.resolveId as unknown as (
      this: unknown,
      source: string,
      importer: string | undefined,
      options: Record<string, unknown>,
    ) => Promise<string | null>
    const ctx = { resolve: async () => ({ id: pcFetch }) }
    const swapped = await resolveId.call(
      ctx,
      '../fetch',
      `${root}/packages/ai-provider/src/protocols/gemini.ts`,
      {},
    )
    expect(swapped).toMatch(/apps\/mobile\/src\/renderer\/ai\/net\/providerFetch\.ts$/)
    // the stand-in itself, and anything outside ai-provider, keeps the PC module
    expect(
      await resolveId.call(
        ctx,
        '../../../../../../packages/ai-provider/src/fetch',
        `${root}/apps/mobile/src/renderer/ai/net/providerFetch.ts`,
        {},
      ),
    ).toBeNull()
    // another module named fetch inside ai-provider is left alone
    const other = {
      resolve: async () => ({ id: `${root}/packages/ai-provider/src/chatgpt/fetch.ts` }),
    }
    expect(
      await resolveId.call(other, './fetch', `${root}/packages/ai-provider/src/chatgpt/x.ts`, {}),
    ).toBeNull()
  })
})
