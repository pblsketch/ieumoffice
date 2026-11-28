import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeCustomEndpoint,
  customEndpointLabel,
  ollamaEndpointLabel,
  prettyModelName,
  removeCustomEndpoint,
  resolveCustomEndpoints,
  selectCustomEndpoint,
  upsertCustomEndpoint,
} from '../src/custom-endpoints'
import { streamOpenAiCompatible } from '../src/protocols/openai-compatible'
import { okResponse, sseStream } from './test-utils'
import { sanitizeAiSettings } from '../src/ai-settings-guard'
import { isKeyProviderConfigured } from '../src/provider-selection'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'
import { normalizeAiSettings } from '../src/legacy-settings'
import { normalizeOllamaServers, ollamaBaseUrl } from '../src/ollama-servers'
import { showOllamaModel } from '../src/custom-models'
import { jsonResponse } from './test-utils'
import { explainOllamaSystemError, isOllamaOrCustomRequest } from '../src/ollama-friendly-error'
import type { AiCustomEndpoint, AiLocalModelProfile } from '../src/types'

const ollama: AiCustomEndpoint = {
  id: 'a',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3',
}
const gateway: AiCustomEndpoint = {
  id: 'b',
  name: '',
  baseUrl: 'https://gw.example.com/v1',
  apiKey: 'k',
  model: 'gpt-x',
  models: ['gpt-x', 'gpt-y'],
}

describe('Ollama server persistence', () => {
  const server = {
    id: 'local',
    name: 'Local',
    baseUrl: ollama.baseUrl,
    apiKey: '',
    endpointIds: ['a'],
  }

  it('round-trips servers with and without models through IPC and file normalization', () => {
    const settings = {
      ...defaultAiSettings(),
      customEndpoints: [ollama, gateway],
      customEndpoint: gateway.id,
      ollamaServers: [server, { ...server, id: 'empty', endpointIds: [] }],
    }
    const saved = sanitizeAiSettings(settings)
    const read = normalizeAiSettings(JSON.parse(JSON.stringify(saved)))
    expect(read.ollamaServers).toEqual(settings.ollamaServers)
    expect(read.customEndpoints).toEqual(settings.customEndpoints)
    expect(read.customEndpoint).toBe('b')
    expect(read.providers.custom.baseUrl).toBe(gateway.baseUrl)
    const removed = normalizeAiSettings(sanitizeAiSettings({ ...read, ollamaServers: [] }))
    expect(removed.ollamaServers).toEqual([])
  })

  it('rejects malformed metadata and prevents duplicate server or endpoint ownership', () => {
    const raw = [
      null,
      [],
      123,
      {},
      { ...server, baseUrl: 'file:///secret' },
      { ...server, baseUrl: 'http://user:password@localhost/v1' },
      server,
      { ...server, name: 'duplicate' },
      { ...server, id: 'second', endpointIds: ['a', 'b', 'b', null] },
    ]
    const expected = [server, { ...server, id: 'second', endpointIds: ['b'] }]
    expect(normalizeOllamaServers(raw)).toEqual(expected)
    expect(
      sanitizeAiSettings({ ...defaultAiSettings(), ollamaServers: raw })?.ollamaServers,
    ).toEqual(expected)
    expect(normalizeAiSettings({ providers: {}, ollamaServers: raw }).ollamaServers).toEqual(
      expected,
    )
    expect(ollamaBaseUrl(' http://localhost:11434/v1/ ')).toBe(ollama.baseUrl)
    expect(ollamaBaseUrl('javascript:alert(1)')).toBeUndefined()
  })
})

describe('resolveCustomEndpoints', () => {
  it('seeds the list from a pre-list custom slot and mirrors it back', () => {
    const settings = defaultAiSettings()
    settings.providers.custom = { apiKey: 'k', model: 'm', baseUrl: 'http://h/v1' }
    const next = resolveCustomEndpoints(settings)
    expect(next.customEndpoints).toHaveLength(1)
    expect(next.customEndpoints![0]).toMatchObject({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'http://h/v1',
    })
    expect(next.customEndpoint).toBe(next.customEndpoints![0]!.id)
    expect(next.providers.custom).toEqual({ apiKey: 'k', model: 'm', baseUrl: 'http://h/v1' })
  })

  it('leaves an unconfigured file without a list', () => {
    const next = resolveCustomEndpoints(defaultAiSettings())
    expect(next.customEndpoints).toBeUndefined()
    expect(next.customEndpoint).toBeUndefined()
  })

  it('falls back to the first entry when the active id is stale', () => {
    const next = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [ollama, gateway],
      customEndpoint: 'gone',
    })
    expect(next.customEndpoint).toBe('a')
    expect(next.providers.custom.baseUrl).toBe(ollama.baseUrl)
  })

  it('drops duplicate and id-less entries', () => {
    const next = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [ollama, { ...gateway, id: 'a' }, { ...gateway, id: '' }],
    })
    expect(next.customEndpoints!.map((e) => e.id)).toEqual(['a'])
  })

  it('runs as part of resolveAiSettings', () => {
    const stored = {
      provider: 'custom',
      providers: { custom: { apiKey: '', model: 'old', baseUrl: 'http://old/v1' } },
      customEndpoints: [ollama, gateway],
      customEndpoint: 'b',
    }
    const settings = resolveAiSettings(stored, defaultAiSettings())
    expect(settings.providers.custom).toEqual({
      apiKey: 'k',
      model: 'gpt-x',
      baseUrl: gateway.baseUrl,
    })
    expect(activeCustomEndpoint(settings)?.id).toBe('b')
  })
})

describe('select / upsert / remove', () => {
  const base = resolveCustomEndpoints({
    ...defaultAiSettings(),
    customEndpoints: [ollama, gateway],
    customEndpoint: 'a',
  })

  it('switching the active endpoint swaps the slot', () => {
    const next = selectCustomEndpoint(base, 'b')
    expect(next.providers.custom.model).toBe('gpt-x')
    expect(base.providers.custom.model).toBe('llama3')
  })

  it('upsert edits in place and appends new ids as active', () => {
    const edited = upsertCustomEndpoint(base, { ...ollama, model: 'mistral' })
    expect(edited.customEndpoints!.map((e) => e.model)).toEqual(['mistral', 'gpt-x'])
    expect(edited.providers.custom.model).toBe('mistral')
    const added = upsertCustomEndpoint(base, { ...gateway, id: 'c', name: 'Third' })
    expect(added.customEndpoints).toHaveLength(3)
    expect(added.customEndpoint).toBe('c')
  })

  it('removing the active entry activates the next one, removing the last clears the slot', () => {
    const one = removeCustomEndpoint(base, 'a')
    expect(one.customEndpoint).toBe('b')
    expect(one.providers.custom.baseUrl).toBe(gateway.baseUrl)
    const none = removeCustomEndpoint(one, 'b')
    expect(none.customEndpoints).toBeUndefined()
    expect(none.providers.custom).toEqual({ apiKey: '', model: '', baseUrl: '' })
  })

  it('labels fall back to the host', () => {
    expect(customEndpointLabel(ollama, 'Custom')).toBe('Ollama')
    expect(customEndpointLabel(gateway, 'Custom')).toBe('gw.example.com')
    expect(customEndpointLabel({ ...gateway, baseUrl: '' }, 'Custom')).toBe('Custom')
  })
})

describe('sanitizeAiSettings', () => {
  it('keeps the endpoint list, drops bad base URLs and oversized ids', () => {
    const out = sanitizeAiSettings({
      provider: 'custom',
      providers: {},
      customEndpoints: [
        gateway,
        { ...ollama, id: 'x'.repeat(100), baseUrl: 'javascript:alert(1)' },
        { name: 'no id' },
      ],
      customEndpoint: 'b',
    })
    expect(out?.customEndpoints).toHaveLength(2)
    expect(out?.customEndpoints![0]).toEqual(gateway)
    expect(out?.customEndpoints![1]!.id).toHaveLength(64)
    expect(out?.customEndpoints![1]!.baseUrl).toBe('')
    expect(out?.customEndpoint).toBe('b')
  })

  it('omits the list when nothing survives', () => {
    const out = sanitizeAiSettings({ provider: 'custom', providers: {}, customEndpoints: 'nope' })
    expect(out?.customEndpoints).toBeUndefined()
  })

  it('preserves effort on custom endpoints and providers.custom', () => {
    const withEffort: AiCustomEndpoint = {
      ...ollama,
      effort: 'high',
    }
    const out = sanitizeAiSettings({
      provider: 'custom',
      providers: { custom: { apiKey: '', model: 'm', effort: 'high' } },
      customEndpoints: [withEffort],
      customEndpoint: withEffort.id,
    })
    expect(out?.customEndpoints?.[0]?.effort).toBe('high')
    expect(out?.providers.custom.effort).toBe('high')

    const resolved = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [withEffort],
      customEndpoint: withEffort.id,
    })
    expect(resolved.providers.custom.effort).toBe('high')
  })
})

describe('connect timeout', () => {
  const server = {
    id: 'local',
    name: 'Local',
    baseUrl: ollama.baseUrl,
    apiKey: '',
    endpointIds: ['a'],
  }

  it('mirrors the endpoint timeout into the slot, with a 5-minute floor for Ollama-owned entries', () => {
    const legacy = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [ollama],
      customEndpoint: 'a',
      ollamaServers: [server],
    })
    expect(legacy.providers.custom.connectTimeoutMs).toBe(300_000)

    const timed = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [{ ...ollama, connectTimeoutMs: 120_000 }],
      customEndpoint: 'a',
      ollamaServers: [server],
    })
    expect(timed.providers.custom.connectTimeoutMs).toBe(120_000)

    const plain = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [gateway],
      customEndpoint: 'b',
    })
    expect(plain.providers.custom.connectTimeoutMs).toBeUndefined()
  })

  it('round-trips the timeout on endpoints and servers through the guard', () => {
    const withTimeout = {
      ...defaultAiSettings(),
      customEndpoints: [{ ...ollama, connectTimeoutMs: 480_000 }, gateway],
      customEndpoint: 'a',
      ollamaServers: [{ ...server, connectTimeoutMs: 480_000 }],
    }
    const saved = sanitizeAiSettings(withTimeout)
    expect(saved?.customEndpoints?.[0]?.connectTimeoutMs).toBe(480_000)
    expect(saved?.customEndpoints?.[1]?.connectTimeoutMs).toBeUndefined()
    expect(saved?.ollamaServers?.[0]?.connectTimeoutMs).toBe(480_000)
    const read = normalizeAiSettings(JSON.parse(JSON.stringify(saved)))
    expect(read.customEndpoints?.[0]?.connectTimeoutMs).toBe(480_000)
    expect(read.ollamaServers?.[0]?.connectTimeoutMs).toBe(480_000)
    expect(read.providers.custom.connectTimeoutMs).toBe(480_000)

    const weird = sanitizeAiSettings({
      ...withTimeout,
      customEndpoints: [
        { ...ollama, connectTimeoutMs: 'abc' },
        { ...gateway, connectTimeoutMs: 9_000_000 },
      ],
    })
    expect(weird?.customEndpoints?.[0]?.connectTimeoutMs).toBeUndefined()
    expect(weird?.customEndpoints?.[1]?.connectTimeoutMs).toBe(600_000)
  })
})

describe('showOllamaModel', () => {
  it('reads vision from /api/show capabilities and fails safe', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse({ capabilities: ['completion', 'thinking', 'vision'] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const info = await showOllamaModel('http://localhost:11434/v1', 'gemma3')
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://localhost:11434/api/show')
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ model: 'gemma3' })
    expect(info).toEqual({ vision: true, capabilities: ['completion', 'thinking', 'vision'] })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ capabilities: ['completion'] })),
    )
    expect((await showOllamaModel('http://localhost:11434/v1', 'llama3')).vision).toBe(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({})),
    )
    expect(await showOllamaModel('http://localhost:11434/v1', 'x')).toEqual({
      vision: false,
      capabilities: [],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('down'))),
    )
    expect(await showOllamaModel('http://localhost:11434/v1', 'x')).toEqual({
      vision: false,
      capabilities: [],
    })
    expect(await showOllamaModel('not a url', 'x')).toEqual({ vision: false, capabilities: [] })
    vi.unstubAllGlobals()
  })
})

describe('streamOpenAiCompatible vision gating and friendly Ollama explanations', () => {
  it('limits friendly system-error conversion to custom or local Ollama endpoints', () => {
    expect(isOllamaOrCustomRequest('https://api.openai.com/v1')).toBe(false)
    expect(isOllamaOrCustomRequest('https://custom.example/v1', true)).toBe(true)
    expect(isOllamaOrCustomRequest('http://localhost:11434/v1')).toBe(true)
  })

  it('explains known Ollama system errors and leaves unknown errors unclassified', () => {
    const config = { apiKey: '', model: 'llama3' }
    const cases = [
      ['CUDA error: out of memory', /GPU\/메모리 부족/],
      ['HTTP 404: model "llama3" not found', /모델.*찾을 수 없습니다/],
      ['prompt is too long for the model context', /입력 길이를 초과/],
      ['fetch failed: ECONNREFUSED', /Ollama 서버에 연결할 수 없습니다/],
    ] as const
    for (const [message, expected] of cases) {
      expect(
        explainOllamaSystemError(new Error(message), config, [{ role: 'user', text: '요청' }]),
      ).toMatch(expected)
    }
    expect(explainOllamaSystemError(new Error('invalid API key'), config)).toBeNull()
  })

  it('answers with a friendly explanation instead of throwing or calling fetch when vision is false', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const deltas: string[] = []
    let stopReason: string | undefined
    await streamOpenAiCompatible(
      'http://localhost:11434/v1',
      { apiKey: '', model: 'llama3', vision: false },
      'sys',
      [
        {
          role: 'user',
          text: '이 슬라이드 꾸며줘',
          images: [{ mime: 'image/png', base64: 'aGk=' }],
        },
      ],
      [],
      100,
      {
        signal: new AbortController().signal,
        onDelta: (t) => deltas.push(t),
        onToolCall: () => {},
        onStopReason: (r) => {
          stopReason = r
        },
      },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(deltas.join('')).toMatch(/이미지를 인식하지 못하는|cannot recognize images/i)
    expect(deltas.join('')).toContain('llama3')
    expect(stopReason).toBe('end_turn')
  })

  it('converts server multimodal rejection and timeout errors into friendly assistant replies for Ollama', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message:
                  'Multimodal data provided, but model does not support multimodal requests.',
              },
            }),
            { status: 400 },
          ),
      ),
    )
    const deltas: string[] = []
    await streamOpenAiCompatible(
      'http://localhost:11434/v1',
      { apiKey: '', model: 'gemma4' },
      'sys',
      [{ role: 'user', text: '요약해줘' }],
      [],
      100,
      {
        signal: new AbortController().signal,
        onDelta: (t) => deltas.push(t),
        onToolCall: () => {},
      },
      { isCustomProvider: true },
    )
    expect(deltas.join('')).toContain('이미지를 인식하지 못하는')
    expect(deltas.join('')).toContain('Ollama')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(
          'AI request timed out: no network activity for 300s. Check your connection and try again.',
        )
      }),
    )
    const timeoutDeltas: string[] = []
    await streamOpenAiCompatible(
      'http://localhost:11434/v1',
      { apiKey: '', model: 'qwen3:32b', connectTimeoutMs: 300_000 },
      'sys',
      [{ role: 'user', text: '분석해줘' }],
      [],
      100,
      {
        signal: new AbortController().signal,
        onDelta: (t) => timeoutDeltas.push(t),
        onToolCall: () => {},
      },
      { isCustomProvider: true },
    )
    expect(timeoutDeltas.join('')).toContain('응답 대기 시간이 초과')
    expect(timeoutDeltas.join('')).toContain('첫 응답 대기 시간')
  })

  it('still sends images when vision is true or unchecked', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(JSON.stringify(body.messages)).toContain('image_url')
      return okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
          'data: [DONE]',
        ]),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    for (const vision of [true, undefined]) {
      await streamOpenAiCompatible(
        'http://localhost:11434/v1',
        { apiKey: '', model: 'qwen-vl', ...(vision !== undefined ? { vision } : {}) },
        'sys',
        [{ role: 'user', text: 'hi', images: [{ mime: 'image/png', base64: 'aGk=' }] }],
        [],
        100,
        { signal: new AbortController().signal, onDelta: () => {}, onToolCall: () => {} },
      )
    }
  })
})

describe('prettyModelName and ollamaEndpointLabel', () => {
  it('formats raw model tags cleanly', () => {
    expect(prettyModelName('gemma-4-e4b-q4-0-it:latest')).toBe('Gemma 4 E4b')
    expect(prettyModelName('qwen2.5:14b')).toBe('Qwen2.5 14b')
    expect(prettyModelName('llama3.2:1b')).toBe('Llama3.2 1b')
    expect(prettyModelName('deepseek-r1:8b')).toBe('Deepseek R1 8b')
    expect(prettyModelName('mistral:latest')).toBe('Mistral')
  })

  it('formats endpoint labels with effort or legacy fallback', () => {
    const epWithEffort: AiCustomEndpoint = {
      ...ollama,
      model: 'gemma-4-e4b-q4-0-it:latest',
      effort: 'medium',
    }
    expect(ollamaEndpointLabel(epWithEffort)).toBe('Gemma 4 E4b medium')

    const epWithoutEffort: AiCustomEndpoint = {
      ...ollama,
      name: 'Local / llama3',
      model: 'llama3:latest',
    }
    expect(ollamaEndpointLabel(epWithoutEffort)).toBe('Local / llama3')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamOpenAiCompatible effort handling', () => {
  it('injects preset temperature and options for low, medium, and high', async () => {
    let sentBody: Record<string, unknown> = {}
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string)
      return okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
          'data: [DONE]',
        ]),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    // low effort
    await streamOpenAiCompatible(
      'http://localhost:11434/v1',
      { apiKey: '', model: 'llama3.2', effort: 'low' },
      'system',
      [{ role: 'user', text: 'hi' }],
      [],
      1000,
      { signal: new AbortController().signal, onDelta: () => {}, onToolCall: () => {} },
    )
    expect(sentBody.temperature).toBe(0.2)
    expect(sentBody.options).toEqual({ num_ctx: 8192, num_predict: 1024 })

    // high effort
    await streamOpenAiCompatible(
      'http://localhost:11434/v1',
      { apiKey: '', model: 'llama3.2', effort: 'high' },
      'system',
      [{ role: 'user', text: 'hi' }],
      [],
      1000,
      { signal: new AbortController().signal, onDelta: () => {}, onToolCall: () => {} },
    )
    expect(sentBody.temperature).toBe(0.8)
    expect(sentBody.options).toEqual({ num_ctx: 32768, num_predict: 3072 })

    // default without effort
    await streamOpenAiCompatible(
      'http://localhost:11434/v1',
      { apiKey: '', model: 'llama3.2' },
      'system',
      [{ role: 'user', text: 'hi' }],
      [],
      1000,
      { signal: new AbortController().signal, onDelta: () => {}, onToolCall: () => {} },
    )
    expect(sentBody.temperature).toBe(0.3)
    expect(sentBody.options).toBeUndefined()
  })
})

// ── local profile data (T1) ────────────────────────────────

const modelProfile: AiLocalModelProfile = {
  contextLength: 32_768,
  maxContextLength: 131_072,
  tools: true,
  vision: false,
  contextSource: 'user',
  toolsSource: 'server',
  visionSource: 'test',
  checkedAt: 1_700_000_000_000,
  notes: 'qwen3:8b · Apache-2.0',
}

const localOllama: AiCustomEndpoint = {
  id: 'loc',
  name: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  model: 'qwen3:8b',
  models: ['qwen3:8b', 'llama3'],
  kind: 'local',
  modelProfiles: { 'qwen3:8b': modelProfile },
  timeoutMs: 300_000,
}

function storedLocal() {
  return {
    provider: 'custom',
    providers: {
      custom: { apiKey: '', model: '', baseUrl: '' },
    },
    customEndpoints: [localOllama],
    customEndpoint: 'loc',
  }
}

describe('local fields', () => {
  it('survives normalize -> sanitize -> normalize', () => {
    const normalized = normalizeAiSettings(storedLocal(), defaultAiSettings())
    expect(normalized.customEndpoints![0]).toMatchObject({
      kind: 'local',
      timeoutMs: 300_000,
    })
    expect(normalized.customEndpoints![0]!.modelProfiles!['qwen3:8b']).toEqual(modelProfile)

    const saved = sanitizeAiSettings(normalized)
    expect(saved).not.toBeNull()
    expect(saved!.customEndpoints![0]!.kind).toBe('local')
    expect(saved!.customEndpoints![0]!.timeoutMs).toBe(300_000)
    expect(saved!.customEndpoints![0]!.modelProfiles!['qwen3:8b']).toEqual(modelProfile)

    const reread = normalizeAiSettings(saved, defaultAiSettings())
    expect(reread.customEndpoints![0]!.kind).toBe('local')
    expect(reread.customEndpoints![0]!.timeoutMs).toBe(300_000)
    expect(reread.customEndpoints![0]!.modelProfiles!['qwen3:8b']).toEqual(modelProfile)
  })

  it('does not classify a server saved before kind existed as local', () => {
    const next = normalizeAiSettings(
      {
        provider: 'custom',
        providers: { custom: { apiKey: 'k', model: 'gpt-x', baseUrl: gateway.baseUrl } },
        customEndpoints: [gateway],
        customEndpoint: 'b',
      },
      defaultAiSettings(),
    )
    expect(next.customEndpoints![0]!.kind).toBeUndefined()
    expect(next.customEndpoints![0]!.modelProfiles).toBeUndefined()
    expect(next.customEndpoints![0]!.timeoutMs).toBeUndefined()
  })

  it('drops malformed local values but keeps the server', () => {
    const next = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [
        {
          ...localOllama,
          kind: 'cloud' as never,
          timeoutMs: 10_000,
          modelProfiles: {
            'qwen3:8b': {
              contextLength: -1,
              maxContextLength: 10_000_001,
              tools: 'yes' as never,
              vision: 1 as never,
              contextSource: 'cloud' as never,
              checkedAt: 1.5,
              notes: `  ${'x'.repeat(600)}  `,
            },
            ['k'.repeat(300)]: { tools: true },
          },
        },
      ],
      customEndpoint: 'loc',
    })
    const entry = next.customEndpoints![0]!
    expect(entry.kind).toBeUndefined()
    expect(entry.timeoutMs).toBeUndefined()
    expect(Object.keys(entry.modelProfiles!)).toEqual(['qwen3:8b'])
    expect(entry.modelProfiles!['qwen3:8b']).toEqual({ notes: 'x'.repeat(500) })
  })

  it('keeps at most 2000 model profiles', () => {
    const many = Object.fromEntries(
      Array.from({ length: 2_005 }, (_, i) => [`m${i}`, { tools: true }]),
    )
    const next = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [{ ...localOllama, modelProfiles: many }],
      customEndpoint: 'loc',
    })
    const profiles = next.customEndpoints![0]!.modelProfiles!
    expect(Object.keys(profiles)).toHaveLength(2_000)
    expect(profiles.m1999).toEqual({ tools: true })
    expect(profiles.m2000).toBeUndefined()
  })

  it('accepts the exact bounds and rejects the ones past them', () => {
    const bounds = [
      { timeoutMs: 59_999, ok: false },
      { timeoutMs: 60_000, ok: true },
      { timeoutMs: 600_000, ok: true },
      { timeoutMs: 600_001, ok: false },
      { timeoutMs: 300_000.5, ok: false },
    ]
    for (const { timeoutMs, ok } of bounds) {
      const next = resolveCustomEndpoints({
        ...defaultAiSettings(),
        customEndpoints: [{ ...localOllama, timeoutMs }],
        customEndpoint: 'loc',
      })
      expect(next.customEndpoints![0]!.timeoutMs).toBe(ok ? timeoutMs : undefined)
    }
  })
})

describe('no active custom server', () => {
  it('an explicit empty id clears the mirror instead of falling back to the first entry', () => {
    const next = resolveCustomEndpoints({
      ...defaultAiSettings(),
      provider: 'custom',
      customEndpoints: [localOllama, gateway],
      customEndpoint: '',
    })
    expect(next.customEndpoint).toBe('')
    expect(activeCustomEndpoint(next)).toBeUndefined()
    expect(next.providers.custom).toEqual({ apiKey: '', model: '', baseUrl: '' })
    expect(isKeyProviderConfigured(next, 'custom')).toBe(false)
  })

  it('a file without the field still falls back to the first entry', () => {
    const next = normalizeAiSettings(
      {
        provider: 'custom',
        providers: { custom: { apiKey: 'k', model: 'gpt-x', baseUrl: gateway.baseUrl } },
        customEndpoints: [localOllama, gateway],
      },
      defaultAiSettings(),
    )
    expect(next.customEndpoint).toBe('loc')
    expect(next.providers.custom.baseUrl).toBe(localOllama.baseUrl)
  })

  it('removeCustomEndpoint keeps the old fallback unless asked not to', () => {
    const base = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [localOllama, gateway],
      customEndpoint: 'loc',
    })
    const fallback = removeCustomEndpoint(base, 'loc')
    expect(fallback.customEndpoint).toBe('b')
    expect(fallback.providers.custom.baseUrl).toBe(gateway.baseUrl)

    const noFallback = removeCustomEndpoint(base, 'loc', { fallback: false })
    expect(noFallback.customEndpoint).toBe('')
    expect(noFallback.customEndpoints!.map((e) => e.id)).toEqual(['b'])
    expect(noFallback.providers.custom).toEqual({ apiKey: '', model: '', baseUrl: '' })
    expect(isKeyProviderConfigured(noFallback, 'custom')).toBe(false)

    const reread = normalizeAiSettings(sanitizeAiSettings(noFallback), defaultAiSettings())
    expect(reread.customEndpoint).toBe('')
    expect(isKeyProviderConfigured(reread, 'custom')).toBe(false)
  })

  it('removing the last entry without fallback leaves an explicit empty selection', () => {
    const base = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [localOllama],
      customEndpoint: 'loc',
    })
    const next = removeCustomEndpoint(base, 'loc', { fallback: false })
    expect(next.customEndpoints).toBeUndefined()
    expect(next.customEndpoint).toBe('')
    expect(next.providers.custom).toEqual({ apiKey: '', model: '', baseUrl: '' })
  })

  it('removing an inactive entry leaves the active one alone', () => {
    const base = resolveCustomEndpoints({
      ...defaultAiSettings(),
      customEndpoints: [localOllama, gateway],
      customEndpoint: 'loc',
    })
    const next = removeCustomEndpoint(base, 'b', { fallback: false })
    expect(next.customEndpoint).toBe('loc')
    expect(next.providers.custom.baseUrl).toBe(localOllama.baseUrl)
  })
})
