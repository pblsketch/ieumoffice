import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mobileAiRelayFetch,
  preloadMobileKeyProviderProtocols,
} from '@genoffice/mobile-bridge/ai-bridge'
import {
  abortMobileAiToolCalls,
  bindMobileAiTools,
  clearMobileAiAttachments,
  getMobileAiTools,
  isMobileAiToolError,
  refreshMobileAiToolSettings,
  resetMobileAiTools,
} from '../src/renderer/ai/tools'
import {
  JSON_HEADERS,
  PNG_BASE64,
  PNG_BYTES,
  SSE_HEADERS,
  TOOL_SETTINGS_ON,
  makeFakeRust,
  sse,
  type FakeRust,
} from './ai-tools-fake'

// A Stop cuts the requests the AI tools started (spec 3.4 "stop: that run and
// its Rust requests"), like PC abortMediaCalls: the tool answers `cancelled`,
// Rust gets the cancel command, a picture made after the stop is not stored,
// and the next tool call works as before. No network, no key.

let unbind: (() => void) | null = null

function bind(rust: FakeRust) {
  unbind?.()
  unbind = bindMobileAiTools({
    client: rust.client,
    getAiEnabled: () => true,
    getAiSettings: () => rust.aiSettings,
    getChatgptStatus: () => null,
  })
}

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('the webview must not use its own network')
    }),
  )
})

afterEach(() => {
  unbind?.()
  unbind = null
  resetMobileAiTools()
  clearMobileAiAttachments()
  vi.unstubAllGlobals()
})

/** Waits until the fake Rust saw `count` starts (the request is in flight). */
async function startsReach(rust: FakeRust, count: number): Promise<void> {
  const until = Date.now() + 5000
  while (rust.starts.length < count) {
    if (Date.now() > until) throw new Error('the request never started')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const openaiOn = {
  ...TOOL_SETTINGS_ON,
  imageGeneration: true,
  imageProvider: 'openai' as const,
  imageModel: 'gpt-image-2',
  imageProvidersReady: ['openai' as const],
}

describe('a stop during a tool call', () => {
  it('generateImage: the relay request is cancelled, nothing is stored, the relay binding is back', async () => {
    const rust = makeFakeRust({ toolSettings: openaiOn, relay: () => ({ hang: true }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    const pending = getMobileAiTools().generateImage({ prompt: 'a red apple' })
    await startsReach(rust, 1)
    abortMobileAiToolCalls()
    expect(await pending).toMatchObject({ errorCode: 'cancelled' })
    expect(rust.cancels).toEqual([rust.starts[0]!.requestId])
    expect(rust.stored.size).toBe(0)

    // the picture-only relay client is gone: another host reaches Rust again
    rust.relay = () => ({ status: 200, headers: JSON_HEADERS, body: '{"data":[]}' })
    const models = await mobileAiRelayFetch('https://openrouter.ai/api/v1/models')
    expect(models.status).toBe(200)
    expect(rust.starts.at(-1)!.url).toBe('https://openrouter.ai/api/v1/models')

    // and the next picture is made and stored as usual
    rust.relay = () => ({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
    })
    const made = await getMobileAiTools().generateImage({ prompt: 'a green apple' })
    expect(made).toMatchObject({ mime: 'image/png', provider: 'openai' })
    expect(rust.stored.size).toBe(1)
  })

  it('analyzeMedia: the chat turn is cancelled in Rust', async () => {
    const rust = makeFakeRust({ relay: () => ({ hang: true }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    const pending = getMobileAiTools().analyzeMedia({
      prompt: 'What is in the picture?',
      images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
    })
    await startsReach(rust, 1)
    abortMobileAiToolCalls()
    expect(await pending).toMatchObject({ errorCode: 'cancelled' })
    expect(rust.cancels).toContain(rust.starts[0]!.requestId)

    rust.relay = () => ({
      status: 200,
      headers: SSE_HEADERS,
      body: sse([{ choices: [{ delta: { content: 'An apple.' }, finish_reason: 'stop' }] }], true),
    })
    expect(
      await getMobileAiTools().analyzeMedia({
        prompt: 'And now?',
        images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
      }),
    ).toEqual({ text: 'An apple.' })
  })

  it('readUrl: the public address request is cancelled, the next read works', async () => {
    const rust = makeFakeRust({ web: () => ({ hang: true }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    const pending = getMobileAiTools().readUrl('https://slow.example/page')
    await startsReach(rust, 1)
    abortMobileAiToolCalls()
    expect(await pending).toMatchObject({ errorCode: 'cancelled' })
    expect(rust.cancels).toEqual([rust.starts[0]!.requestId])

    rust.web = () => ({ status: 200, contentType: 'text/plain', body: 'hello' })
    const page = await getMobileAiTools().readUrl('https://slow.example/page')
    if (isMobileAiToolError(page)) throw new Error(page.error)
    expect(page.text).toBe('hello')
  })

  it('webSearch: the search is cancelled without falling back to DuckDuckGo', async () => {
    const rust = makeFakeRust({ search: () => ({ hang: true }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    const pending = getMobileAiTools().webSearch('apples')
    await startsReach(rust, 1)
    abortMobileAiToolCalls()
    expect(await pending).toMatchObject({ errorCode: 'cancelled' })
    await new Promise((r) => setTimeout(r, 20))
    expect(rust.starts).toHaveLength(1)
    expect(rust.cancels).toEqual([rust.starts[0]!.requestId])
  })

  it('a stop with no tool call in flight changes nothing', async () => {
    const rust = makeFakeRust({
      web: () => ({ status: 200, contentType: 'text/plain', body: 'fine' }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    abortMobileAiToolCalls()
    const page = await getMobileAiTools().readUrl('https://ok.example/')
    if (isMobileAiToolError(page)) throw new Error(page.error)
    expect(page.text).toBe('fine')
    expect(rust.cancels).toEqual([])
  })
})
