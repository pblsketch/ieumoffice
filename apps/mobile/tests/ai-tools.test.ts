import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import {
  addMobileAiAttachment,
  bindMobileAiTools,
  clearMobileAiAttachments,
  getMobileAiTools,
  isMobileAiToolError,
  listMobileAiAttachments,
  mobileAiAttachmentBase64,
  mobileReadUrlModelText,
  refreshMobileAiToolSettings,
  removeMobileAiAttachment,
  resetMobileAiTools,
  type MobileAiToolsBinding,
} from '../src/renderer/ai/tools'
import {
  JSON_HEADERS,
  PNG_BASE64,
  PNG_BYTES,
  SSE_HEADERS,
  TOOL_SETTINGS_ON,
  headerOf,
  keySnapshot,
  makeFakeRust,
  sse,
  type FakeRust,
  type NetReply,
  type NetStart,
} from './ai-tools-fake'

// The shared mobile AI tools (T7.md section 1) over a scripted Rust: web and
// picture search, reading an address, fetching and making pictures, showing
// pictures to the chat model, and the attached photos. No network, no key.

let unbind: (() => void) | null = null
let fetchSpy: ReturnType<typeof vi.fn>

function bind(rust: FakeRust, overrides: Partial<MobileAiToolsBinding> = {}) {
  unbind?.()
  unbind = bindMobileAiTools({
    client: rust.client,
    getAiEnabled: () => true,
    getAiSettings: () => rust.aiSettings,
    getChatgptStatus: () => null,
    ...overrides,
  })
}

beforeAll(async () => {
  // analyzeMedia and generateImage run PC protocol code; warm it once
  await preloadMobileKeyProviderProtocols()
}, 60_000)

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the webview must not use its own network')
  })
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  unbind?.()
  unbind = null
  resetMobileAiTools()
  clearMobileAiAttachments()
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

function rpcOf(start: NetStart): { method?: string; id?: number; params?: unknown } {
  return start.body ? (JSON.parse(start.body) as { method?: string }) : {}
}

const PARALLEL_RESULTS = {
  results: [
    { url: 'https://example.org/a', title: 'A page', excerpts: ['first', 'second'] },
    { url: 'ftp://example.org/skip', title: 'not web' },
    { url: 'https://example.org/b', excerpts: [] },
  ],
}

function parallelScript(
  opts: { sse?: boolean; failInit?: boolean; session?: string | null } = {},
): (start: NetStart) => NetReply {
  const session = opts.session === undefined ? 'sess-1' : opts.session
  return (start) => {
    if (start.method === 'DELETE') return { status: 200, body: '' }
    const rpc = rpcOf(start)
    const reply = (message: unknown): NetReply =>
      opts.sse
        ? {
            status: 200,
            headers: [...SSE_HEADERS, ...(session ? [['mcp-session-id', session]] : [])] as Array<
              [string, string]
            >,
            body: `event: message\n${sse([message])}`,
          }
        : {
            status: 200,
            headers: [...JSON_HEADERS, ...(session ? [['mcp-session-id', session]] : [])] as Array<
              [string, string]
            >,
            body: JSON.stringify(message),
          }
    if (rpc.method === 'initialize') {
      if (opts.failInit) return { status: 503, body: 'busy' }
      return reply({
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'parallel', version: '1' },
        },
      })
    }
    if (rpc.method === 'notifications/initialized') return { status: 202, body: '' }
    if (rpc.method === 'tools/call') {
      return reply({
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: JSON.stringify(PARALLEL_RESULTS) }] },
      })
    }
    return { status: 400, body: 'unexpected' }
  }
}

const DDG_HTML = `<html><body>
<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduck.example%2Fone&amp;rut=x">Duck <b>one</b></a></div>
<div class="result"><a class="result__a" href="https://duck.example/two">Two &amp; more</a></div>
</body></html>`

describe('before binding', () => {
  it('reports nothing available and every tool answers unavailable, with no request', async () => {
    const tools = getMobileAiTools()
    expect(tools.availability()).toEqual({
      web: false,
      imageGeneration: false,
      pictureAnalysis: false,
    })
    const answers = await Promise.all([
      tools.webSearch('cats'),
      tools.imageSearch('cats'),
      tools.readUrl('https://example.org/'),
      tools.fetchImage('https://example.org/a.png'),
      tools.generateImage({ prompt: 'a cat' }),
      tools.analyzeMedia({
        prompt: 'what is it',
        images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
      }),
    ])
    for (const answer of answers) {
      expect(answer).toMatchObject({ errorCode: 'unavailable' })
      expect(typeof (answer as { error: string }).error).toBe('string')
    }
    expect(tools.attachments()).toEqual([])
  })
})

describe('availability', () => {
  it('web needs AI on and the internet switch on', async () => {
    const rust = makeFakeRust()
    let aiOn = true
    bind(rust, { getAiEnabled: () => aiOn })
    const tools = getMobileAiTools()
    // nothing read yet: off until Rust answers
    expect(tools.availability().web).toBe(false)
    await refreshMobileAiToolSettings()
    expect(tools.availability().web).toBe(true)
    aiOn = false
    expect(tools.availability().web).toBe(false)
    aiOn = true
    rust.toolSettings = { ...TOOL_SETTINGS_ON, internetTools: false }
    await refreshMobileAiToolSettings()
    expect(tools.availability().web).toBe(false)
    // an unreadable setting is off
    rust.toolSettings = null
    await refreshMobileAiToolSettings()
    expect(tools.availability().web).toBe(false)
  })

  it('picture making needs the switch, an image provider of 1.0 and its key', async () => {
    const rust = makeFakeRust()
    bind(rust)
    const tools = getMobileAiTools()
    const cases: Array<[Partial<typeof TOOL_SETTINGS_ON>, boolean]> = [
      [{ imageGeneration: false, imageProvider: 'openai', imageProvidersReady: ['openai'] }, false],
      [
        {
          imageGeneration: true,
          imageProvider: 'openai',
          imageModel: 'gpt-image-2',
          imageProvidersReady: ['openai'],
        },
        true,
      ],
      [
        {
          imageGeneration: true,
          imageProvider: 'gemini',
          imageModel: 'gemini-2.5-flash-image',
          imageProvidersReady: ['openai'],
        },
        false,
      ],
      [
        {
          imageGeneration: true,
          imageProvider: 'openrouter' as never,
          imageModel: 'x',
          imageProvidersReady: ['openrouter' as never],
        },
        false,
      ],
    ]
    for (const [patch, expected] of cases) {
      rust.toolSettings = { ...TOOL_SETTINGS_ON, ...patch }
      await refreshMobileAiToolSettings()
      expect(tools.availability().imageGeneration, JSON.stringify(patch)).toBe(expected)
    }
  })

  it('picture analysis follows the selected chat model (PC modelLacksVision)', () => {
    const rust = makeFakeRust({
      aiSettings: keySnapshot('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', true),
    })
    bind(rust)
    const tools = getMobileAiTools()
    expect(tools.availability().pictureAnalysis).toBe(true)
    rust.aiSettings = keySnapshot('openrouter', 'deepseek/deepseek-v4-flash:free', true)
    expect(tools.availability().pictureAnalysis).toBe(false)
    // no connected chat model: nothing can look at a picture
    rust.aiSettings = { ...rust.aiSettings, selectedProvider: 'auto', configuredProviders: {} }
    expect(tools.availability().pictureAnalysis).toBe(false)
  })
})

describe('webSearch', () => {
  it('runs Parallel MCP as JSON-RPC over the search request and ends the session', async () => {
    const rust = makeFakeRust({ search: parallelScript() })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().webSearch('cats and dogs')
    expect(answer).toEqual({
      method: 'parallel',
      results: [
        { title: 'A page', url: 'https://example.org/a', snippet: 'first\nsecond' },
        { title: 'https://example.org/b', url: 'https://example.org/b', snippet: '' },
      ],
    })
    const steps = rust.starts.map((s) => `${s.method} ${rpcOf(s).method ?? ''}`.trim())
    expect(steps).toEqual([
      'POST initialize',
      'POST notifications/initialized',
      'POST tools/call',
      'DELETE',
    ])
    for (const start of rust.starts) {
      expect(start.command).toBe('mobile_ai_search_start')
      expect(start.url).toBe('https://search.parallel.ai/mcp')
    }
    const [init, initialized, call, end] = rust.starts as [NetStart, NetStart, NetStart, NetStart]
    expect(headerOf(init, 'accept')).toBe('application/json, text/event-stream')
    expect(headerOf(init, 'mcp-session-id')).toBeUndefined()
    expect(headerOf(initialized, 'mcp-session-id')).toBe('sess-1')
    expect(headerOf(call, 'mcp-session-id')).toBe('sess-1')
    expect(headerOf(call, 'mcp-protocol-version')).toBe('2025-06-18')
    expect(rpcOf(call).params).toEqual({
      name: 'web_search',
      arguments: { objective: 'cats and dogs', search_queries: ['cats and dogs'] },
    })
    expect(headerOf(end, 'mcp-session-id')).toBe('sess-1')
  })

  it('reads SSE answers and the structured result', async () => {
    const rust = makeFakeRust({ search: parallelScript({ sse: true }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().webSearch('cats', 1)
    expect(answer).toEqual({
      method: 'parallel',
      results: [{ title: 'A page', url: 'https://example.org/a', snippet: 'first\nsecond' }],
    })
  })

  it('falls back to DuckDuckGo HTML when Parallel fails, like PC', async () => {
    const parallel = parallelScript({ failInit: true })
    const rust = makeFakeRust({
      search: (start) =>
        start.url.startsWith('https://html.duckduckgo.com/')
          ? { status: 200, headers: [['content-type', 'text/html']], body: DDG_HTML }
          : parallel(start),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().webSearch('ducks')
    expect(answer).toEqual({
      method: 'duckduckgo',
      results: [
        { title: 'Duck one', url: 'https://duck.example/one', snippet: '' },
        { title: 'Two & more', url: 'https://duck.example/two', snippet: '' },
      ],
    })
    const ddg = rust.starts.at(-1)!
    expect(ddg.url).toBe('https://html.duckduckgo.com/html/?q=ducks')
    expect(ddg.method).toBe('GET')
    // no session was opened, so none is ended
    expect(rust.starts.some((s) => s.method === 'DELETE')).toBe(false)
  })

  it('answers a network error when both backends fail, and unavailable when web is off', async () => {
    const rust = makeFakeRust({
      search: () => ({ fail: { code: 'NETWORK_ERROR', messageKey: 'mobile.ai.webNetworkError' } }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    expect(await getMobileAiTools().webSearch('x')).toMatchObject({ errorCode: 'network' })

    rust.starts.length = 0
    rust.toolSettings = { ...TOOL_SETTINGS_ON, internetTools: false }
    await refreshMobileAiToolSettings()
    expect(await getMobileAiTools().webSearch('x')).toMatchObject({ errorCode: 'unavailable' })
    expect(rust.starts).toEqual([])
  })
})

describe('imageSearch', () => {
  it('takes the vqd token, reads i.js and filters like PC filterUsableImages', async () => {
    const rust = makeFakeRust({
      search: (start) => {
        if (start.url.startsWith('https://duckduckgo.com/?q=')) {
          return { status: 200, body: '<script>vqd="4-1234567890"</script>' }
        }
        if (start.url.startsWith('https://duckduckgo.com/i.js')) {
          return {
            status: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify({
              results: [
                {
                  image: 'https://img.example/big.jpg',
                  title: 'Big',
                  url: 'https://site.example/p',
                  width: 800,
                  height: 600,
                },
                { image: 'https://img.example/icon.png', title: 'Icon', width: 32, height: 32 },
                { image: 'https://media.gettyimages.com/x.jpg', title: 'Stock' },
                { image: 'https://img.example/nodims.png', title: 'No size' },
              ],
            }),
          }
        }
        return { status: 404, body: '' }
      },
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().imageSearch('sunset')
    expect(answer).toEqual({
      method: 'duckduckgo',
      images: [
        {
          title: 'Big',
          imageUrl: 'https://img.example/big.jpg',
          sourceUrl: 'https://site.example/p',
          source: 'site.example',
          width: 800,
          height: 600,
        },
        { title: 'No size', imageUrl: 'https://img.example/nodims.png', sourceUrl: '', source: '' },
      ],
    })
    const ijs = rust.starts.at(-1)!
    expect(ijs.url).toBe('https://duckduckgo.com/i.js?l=us-en&o=json&q=sunset&vqd=4-1234567890')
    expect(headerOf(ijs, 'referer')).toBe('https://duckduckgo.com/')
  })

  it('answers an error when there is no token', async () => {
    const rust = makeFakeRust({ search: () => ({ status: 200, body: '<html></html>' }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    expect(await getMobileAiTools().imageSearch('x')).toMatchObject({ errorCode: 'network' })
  })
})

describe('readUrl', () => {
  it('turns HTML into text with PC htmlToText and pages it by 50,000 characters', async () => {
    const long = 'word '.repeat(12_000) // 60,000 characters
    const rust = makeFakeRust({
      web: () => ({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        url: 'https://final.example/page',
        body: `<html><head><title>Long page</title><script>x()</script></head><body><p>${long}</p><a href="/next">next</a></body></html>`,
      }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const first = await getMobileAiTools().readUrl('https://start.example/page')
    if (isMobileAiToolError(first)) throw new Error(first.error)
    expect(first.url).toBe('https://final.example/page')
    expect(first.title).toBe('Long page')
    expect(first.offset).toBe(0)
    expect(first.text.length).toBe(50_000)
    expect(first.truncated).toBe(true)
    expect(first.nextOffset).toBe(50_000)
    expect(first.text).not.toContain('x()')
    const second = await getMobileAiTools().readUrl('https://start.example/page', 50_000)
    if (isMobileAiToolError(second)) throw new Error(second.error)
    expect(second.offset).toBe(50_000)
    expect(second.truncated).toBe(false)
    expect(second.nextOffset).toBeUndefined()
    expect(second.text).toContain('[next](https://final.example/next)')
    expect(second.totalChars).toBe(first.totalChars)
    // the continuation came from memory, like PC's page cache
    expect(rust.starts).toHaveLength(1)
    expect(rust.starts[0]!.command).toBe('mobile_ai_web_fetch_start')
    expect(mobileReadUrlModelText(second)).toMatch(
      /^Long page — characters 50000\.\.\d+ of \d+ \(end\)\nhttps:\/\/final\.example\/page\n\n/,
    )
  })

  it('passes text types through and refuses downloads', async () => {
    const rust = makeFakeRust({
      web: (start) =>
        start.url.endsWith('.txt')
          ? { status: 200, contentType: 'text/plain', body: 'plain <b>text</b>' }
          : start.url.endsWith('.json')
            ? { status: 200, contentType: 'application/json', body: '{"a":1}' }
            : { status: 200, contentType: 'application/pdf', body: '%PDF-1.7' },
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const tools = getMobileAiTools()
    expect(await tools.readUrl('https://x.example/a.txt')).toMatchObject({
      text: 'plain <b>text</b>',
    })
    expect(await tools.readUrl('https://x.example/a.json')).toMatchObject({ text: '{"a":1}' })
    expect(await tools.readUrl('https://x.example/a.pdf')).toMatchObject({
      errorCode: 'unsupported_type',
    })
  })

  it('passes the public-address refusal, HTTP errors and bad addresses through as codes', async () => {
    const rust = makeFakeRust({
      web: (start) =>
        start.url.includes('internal')
          ? { fail: { code: 'INVALID_ARGUMENT', messageKey: 'mobile.ai.webAddressNotPublic' } }
          : start.url.includes('slow')
            ? { fail: { code: 'NETWORK_ERROR', messageKey: 'mobile.ai.webTimeout' } }
            : start.url.includes('huge')
              ? { fail: { code: 'FILE_TOO_LARGE', messageKey: 'mobile.ai.webTooLarge' } }
              : { status: 404, contentType: 'text/html', body: 'missing' },
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const tools = getMobileAiTools()
    expect(await tools.readUrl('http://internal.example/')).toMatchObject({ errorCode: 'blocked' })
    expect(await tools.readUrl('https://slow.example/')).toMatchObject({ errorCode: 'timeout' })
    expect(await tools.readUrl('https://huge.example/')).toMatchObject({ errorCode: 'too_large' })
    expect(await tools.readUrl('https://gone.example/')).toMatchObject({
      errorCode: 'http_error',
      status: 404,
    })
    expect(await tools.readUrl('file:///etc/passwd')).toMatchObject({ errorCode: 'invalid_url' })
    expect(await tools.readUrl('not a url')).toMatchObject({ errorCode: 'invalid_url' })
  })

  it('reads a GitHub blob from raw.githubusercontent.com, as PC does without a token', async () => {
    const rust = makeFakeRust({
      web: () => ({ status: 200, contentType: 'text/plain', body: '# readme' }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    await getMobileAiTools().readUrl('https://github.com/o/r/blob/main/docs/README.md')
    expect(rust.starts[0]!.url).toBe('https://raw.githubusercontent.com/o/r/main/docs/README.md')
  })
})

describe('fetchImage', () => {
  it('reads a result-store address and a public picture address', async () => {
    const rust = makeFakeRust({
      web: (start) =>
        start.url.endsWith('.png')
          ? { status: 200, contentType: 'application/octet-stream', body: PNG_BYTES }
          : { status: 200, contentType: 'text/html', body: '<html>not a picture</html>' },
    })
    const address = 'ai-result://00000000-0000-4000-8000-000000000001.png'
    rust.stored.set(address, { dataBase64: PNG_BASE64, mime: 'image/png' })
    bind(rust)
    await refreshMobileAiToolSettings()
    const tools = getMobileAiTools()

    const stored = await tools.fetchImage(address)
    expect(stored).toEqual({ bytes: PNG_BYTES, mime: 'image/png' })
    const web = await tools.fetchImage('https://img.example/a.png')
    expect(web).toEqual({ bytes: PNG_BYTES, mime: 'image/png' })
    expect(await tools.fetchImage('https://img.example/page')).toMatchObject({
      errorCode: 'unsupported_type',
    })
    expect(
      await tools.fetchImage('ai-result://00000000-0000-4000-8000-000000000009.png'),
    ).toMatchObject({ errorCode: 'not_found' })
    expect(rust.starts.every((s) => s.command === 'mobile_ai_web_fetch_start')).toBe(true)
  })

  it('reads the result store even with the internet switch off, but not the web', async () => {
    const rust = makeFakeRust({ toolSettings: { ...TOOL_SETTINGS_ON, internetTools: false } })
    const address = 'ai-result://00000000-0000-4000-8000-000000000001.png'
    rust.stored.set(address, { dataBase64: PNG_BASE64, mime: 'image/png' })
    bind(rust)
    await refreshMobileAiToolSettings()
    expect(await getMobileAiTools().fetchImage(address)).toMatchObject({ mime: 'image/png' })
    expect(await getMobileAiTools().fetchImage('https://img.example/a.png')).toMatchObject({
      errorCode: 'unavailable',
    })
  })
})

describe('generateImage', () => {
  const openaiOn = {
    ...TOOL_SETTINGS_ON,
    imageGeneration: true,
    imageProvider: 'openai' as const,
    imageModel: 'gpt-image-2',
    imageProvidersReady: ['openai' as const],
  }
  const geminiOn = {
    ...TOOL_SETTINGS_ON,
    imageGeneration: true,
    imageProvider: 'gemini' as const,
    imageModel: 'gemini-2.5-flash-image',
    imageProvidersReady: ['gemini' as const],
  }

  it('makes a picture with OpenAI over the sealed relay and stores it', async () => {
    const rust = makeFakeRust({
      toolSettings: openaiOn,
      relay: () => ({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
      }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().generateImage({ prompt: 'a red apple', size: '16:9' })
    expect(answer).toMatchObject({ mime: 'image/png', model: 'gpt-image-2', provider: 'openai' })
    const url = (answer as { url: string }).url
    expect(url).toMatch(/^ai-result:\/\//)
    expect(rust.stored.get(url)).toEqual({ dataBase64: PNG_BASE64, mime: 'image/png' })
    const [request] = rust.starts
    expect(rust.starts).toHaveLength(1)
    expect(request!.command).toBe('mobile_ai_relay_start')
    expect(request!.url).toBe('https://api.openai.com/v1/images/generations')
    expect(headerOf(request!, 'authorization')).toBe('Bearer __sealed__:openai')
    expect(JSON.parse(request!.body!)).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'a red apple',
      size: '1536x1024',
    })
    // the stored copy reads back through fetchImage
    expect(await getMobileAiTools().fetchImage(url)).toEqual({
      bytes: PNG_BYTES,
      mime: 'image/png',
    })
  })

  it('makes a picture with Gemini, a catalog model named by the AI', async () => {
    const rust = makeFakeRust({
      toolSettings: geminiOn,
      relay: () => ({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_BASE64 } }] } },
          ],
        }),
      }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().generateImage({
      prompt: 'a cat',
      model: 'GEMINI-3-PRO-IMAGE',
    })
    expect(answer).toMatchObject({ mime: 'image/png', model: 'gemini-3-pro-image' })
    const [request] = rust.starts
    expect(request!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
    )
    expect(headerOf(request!, 'x-goog-api-key')).toBe('__sealed__:gemini')
  })

  it('answers unavailable for an answer that is an address, without fetching it', async () => {
    const rust = makeFakeRust({
      toolSettings: openaiOn,
      relay: (start) =>
        start.url.startsWith('https://api.openai.com/')
          ? {
              status: 200,
              headers: JSON_HEADERS,
              body: JSON.stringify({ data: [{ url: 'https://files.example/pic.png' }] }),
            }
          : { status: 200, body: PNG_BYTES },
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    expect(await getMobileAiTools().generateImage({ prompt: 'x' })).toMatchObject({
      errorCode: 'unavailable',
    })
    expect(rust.starts.map((s) => s.url)).toEqual(['https://api.openai.com/v1/images/generations'])
    expect(rust.stored.size).toBe(0)
  })

  it('refuses a model outside the catalog and the saved model, before any request', async () => {
    const rust = makeFakeRust({ toolSettings: openaiOn })
    bind(rust)
    await refreshMobileAiToolSettings()
    const other = await getMobileAiTools().generateImage({
      prompt: 'x',
      model: 'gemini-2.5-flash-image',
    })
    expect(other).toMatchObject({ errorCode: 'invalid_model' })
    expect((other as { error: string }).error).toContain('belongs to Gemini')
    expect(await getMobileAiTools().generateImage({ prompt: 'x', model: 'made-up' })).toMatchObject(
      { errorCode: 'invalid_model' },
    )
    expect(rust.starts).toEqual([])
  })

  it('answers unavailable while picture making is off', async () => {
    const rust = makeFakeRust({ toolSettings: { ...openaiOn, imageGeneration: false } })
    bind(rust)
    await refreshMobileAiToolSettings()
    expect(await getMobileAiTools().generateImage({ prompt: 'x' })).toMatchObject({
      errorCode: 'unavailable',
    })
    expect(rust.starts).toEqual([])
  })
})

describe('analyzeMedia', () => {
  it('shows the pictures to the selected chat model in one turn without tools', async () => {
    const rust = makeFakeRust({
      relay: () => ({
        status: 200,
        headers: SSE_HEADERS,
        body: sse(
          [
            { choices: [{ delta: { content: 'A red ' } }] },
            { choices: [{ delta: { content: 'apple.' }, finish_reason: 'stop' }] },
          ],
          true,
        ),
      }),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().analyzeMedia({
      prompt: 'What is in the picture?',
      images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
    })
    expect(answer).toEqual({ text: 'A red apple.' })
    const request = rust.starts[0]!
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(request.body!) as { messages: unknown[]; tools?: unknown[] }
    expect(JSON.stringify(body.messages)).toContain(`data:image/png;base64,${PNG_BASE64}`)
    expect(JSON.stringify(body.messages)).toContain('What is in the picture?')
    expect(body.tools ?? []).toEqual([])
  })

  it('does not send when the model cannot see pictures, or for video and audio', async () => {
    const rust = makeFakeRust({
      aiSettings: keySnapshot('openrouter', 'deepseek/deepseek-v4-flash:free', true),
    })
    bind(rust)
    await refreshMobileAiToolSettings()
    const tools = getMobileAiTools()
    expect(
      await tools.analyzeMedia({ prompt: 'x', images: [{ bytes: PNG_BYTES, mime: 'image/png' }] }),
    ).toMatchObject({ errorCode: 'unavailable' })
    rust.aiSettings = keySnapshot('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', true)
    expect(
      await tools.analyzeMedia({ prompt: 'x', images: [{ bytes: PNG_BYTES, mime: 'video/mp4' }] }),
    ).toMatchObject({ errorCode: 'unavailable' })
    expect(await tools.analyzeMedia({ prompt: 'x', images: [] })).toMatchObject({
      errorCode: 'invalid_input',
    })
    expect(rust.starts).toEqual([])
  })

  it('answers an error when the turn fails', async () => {
    const rust = makeFakeRust({ relay: () => ({ status: 401, headers: JSON_HEADERS, body: '{}' }) })
    bind(rust)
    await refreshMobileAiToolSettings()
    const answer = await getMobileAiTools().analyzeMedia({
      prompt: 'x',
      images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
    })
    expect(answer).toMatchObject({ errorCode: 'failed' })
  })
})

describe('never throws', () => {
  it('turns a broken bridge into error answers', async () => {
    const broken = makeFakeRust()
    const client = {
      ...broken.client,
      transport: {
        invoke: () => {
          throw new Error('bridge gone')
        },
        listen: () => {
          throw new Error('bridge gone')
        },
      },
    }
    unbind = bindMobileAiTools({
      client,
      getAiEnabled: () => {
        throw new Error('state gone')
      },
      getAiSettings: () => {
        throw new Error('state gone')
      },
      getChatgptStatus: () => null,
    })
    await refreshMobileAiToolSettings()
    const tools = getMobileAiTools()
    expect(tools.availability()).toEqual({
      web: false,
      imageGeneration: false,
      pictureAnalysis: false,
    })
    const answers = await Promise.all([
      tools.webSearch('x'),
      tools.imageSearch('x'),
      tools.readUrl('https://x.example/'),
      tools.fetchImage('ai-result://00000000-0000-4000-8000-000000000001.png'),
      tools.fetchImage('https://x.example/a.png'),
      tools.generateImage({ prompt: 'x' }),
      tools.analyzeMedia({ prompt: 'x', images: [{ bytes: PNG_BYTES, mime: 'image/png' }] }),
      // wrong argument types from a model
      tools.webSearch(42 as unknown as string),
      tools.readUrl(null as unknown as string),
      tools.generateImage(null as never),
      tools.analyzeMedia(undefined as never),
    ])
    for (const answer of answers) expect(isMobileAiToolError(answer)).toBe(true)
  })
})

describe('attached photos', () => {
  it('keeps the photos of this conversation in memory', () => {
    const a = addMobileAiAttachment({ name: 'a.jpg', mime: 'image/jpeg', bytes: PNG_BYTES })
    const b = addMobileAiAttachment({ name: 'b.png', mime: 'image/png', bytes: PNG_BYTES })
    expect(a.id).not.toBe(b.id)
    expect(listMobileAiAttachments().map((x) => x.name)).toEqual(['a.jpg', 'b.png'])
    expect(
      getMobileAiTools()
        .attachments()
        .map((x) => x.id),
    ).toEqual([a.id, b.id])
    removeMobileAiAttachment(a.id)
    expect(listMobileAiAttachments().map((x) => x.id)).toEqual([b.id])
    clearMobileAiAttachments()
    expect(getMobileAiTools().attachments()).toEqual([])
  })

  it('keeps one copy of a photo added as base64: the same string, bytes decoded on demand', () => {
    const sent = `${PNG_BASE64}`
    const photo = addMobileAiAttachment({ name: 'c.png', mime: 'image/png', base64: sent })
    expect(photo.bytes).toEqual(PNG_BYTES)
    // no bytes are held: each read decodes the kept string anew
    expect(photo.bytes).not.toBe(photo.bytes)
    expect(mobileAiAttachmentBase64(photo)).toBe(sent)
    // a photo added as bytes is encoded when asked
    const raw = addMobileAiAttachment({ name: 'd.png', mime: 'image/png', bytes: PNG_BYTES })
    expect(mobileAiAttachmentBase64(raw)).toBe(PNG_BASE64)
  })
})
