import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import type * as ToolsModule from '../src/renderer/ai/tools'
import type {
  MobileAiAttachment,
  MobileAiToolAvailability,
  MobileAiTools,
} from '../src/renderer/ai/tools'
import { createMobileHwpAgent } from '../src/renderer/ai/hwpAgent'
import { WEB_TOOLS } from '../../hwp/src/renderer/ai/hwp-skill'
import {
  JSON_HEADERS,
  PNG_BASE64,
  PNG_BYTES,
  TOOL_SETTINGS_ON,
  makeFakeRust,
} from './ai-tools-fake'

// The Hangul AI's web, picture and photo tools on mobile (spec 3.6): the PC
// skill asks the shared mobile tools whether they can run, and calls them
// through a stand-in `window.hwpApi` that lives only during a run. No network.

const stub = vi.hoisted(() => ({ tools: null as MobileAiTools | null }))

vi.mock('../src/renderer/ai/tools', async (importOriginal) => {
  const real = await importOriginal<typeof ToolsModule>()
  return {
    ...real,
    // a test that sets `stub.tools` answers with it; the others use the real module
    getMobileAiTools: () => stub.tools ?? real.getMobileAiTools(),
  }
})

const ALL_ON: MobileAiToolAvailability = { web: true, imageGeneration: true, pictureAnalysis: true }
const ALL_OFF: MobileAiToolAvailability = {
  web: false,
  imageGeneration: false,
  pictureAnalysis: false,
}

const STAND_IN_METHODS = [
  'webSearch',
  'readUrl',
  'imageSearch',
  'fetchImage',
  'generateImage',
  'analyzeMedia',
  'readAttachmentImage',
] as const

/** Tools whose every answer a test can set; untouched ones answer `unavailable`. */
function fakeTools(availability: MobileAiToolAvailability = ALL_ON) {
  const off = async () => ({ error: 'off in this test', errorCode: 'unavailable' as const })
  let photos: readonly MobileAiAttachment[] = []
  const tools = {
    availability: vi.fn(() => availability),
    webSearch: vi.fn<MobileAiTools['webSearch']>(off),
    imageSearch: vi.fn<MobileAiTools['imageSearch']>(off),
    readUrl: vi.fn<MobileAiTools['readUrl']>(off),
    fetchImage: vi.fn<MobileAiTools['fetchImage']>(off),
    generateImage: vi.fn<MobileAiTools['generateImage']>(off),
    analyzeMedia: vi.fn<MobileAiTools['analyzeMedia']>(off),
    attachments: vi.fn(() => photos),
    setAvailability(next: MobileAiToolAvailability) {
      availability = next
    },
    setPhotos(next: readonly MobileAiAttachment[]) {
      photos = next
    },
  }
  return tools
}

/** The page editor's plugin: what a run reads, and the picture insert path. */
function fakePlugin() {
  const inserted: Array<{ base64: string; ext: string; anchor: string; where: string }> = []
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    foreignChanges: () => 0,
    readText: () => '제목\n본문입니다',
    listFields: () => [],
    listTables: () => ({ count: 0, partial: false, tables: [] }),
    pageCount: () => 1,
    cutCells: () => [],
    readPicture: () => ({ ok: true, base64: PNG_BASE64, mime: 'image/png', bytes: 32 }),
    insertPicture: (anchor, _occurrence, where, base64, _width, _w, _h, ext) => {
      inserted.push({
        anchor: String(anchor),
        where: String(where),
        base64: String(base64),
        ext: String(ext),
      })
      return { ok: true, place: { paragraph: 2 } }
    },
  }
  const call = vi.fn(async (method: string, ...args: unknown[]) => {
    const answer = answers[method]
    if (!answer) throw new Error(`not in this test: ${method}`)
    return answer(...args)
  })
  return { call, inserted }
}

type Host = { hwpApi?: unknown }
const host = window as unknown as Host

function standIn(): Record<(typeof STAND_IN_METHODS)[number], (...args: unknown[]) => unknown> {
  return host.hwpApi as never
}

let tools: ReturnType<typeof fakeTools>

beforeEach(() => {
  tools = fakeTools()
  stub.tools = tools
  delete host.hwpApi
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('the webview must not use its own network')
    }),
  )
})

afterEach(() => {
  stub.tools = null
  delete host.hwpApi
  vi.unstubAllGlobals()
})

describe('availability', () => {
  it('offers the web, picture and photo tools when the shared tools can run them', () => {
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    const names = agent.skill.tools.map((tool) => tool.name)
    for (const name of [...WEB_TOOLS, 'generate_image', 'analyze_picture']) {
      expect(names).toContain(name)
    }
    expect(agent.skill.systemPrompt).not.toContain('generate_image is currently unavailable')
    expect(agent.skill.systemPrompt).not.toContain('this app cannot reach the web')
  })

  it('leaves them out when they cannot, and follows a change at the next look', () => {
    tools.setAvailability(ALL_OFF)
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    const offNames = agent.skill.tools.map((tool) => tool.name)
    for (const name of [...WEB_TOOLS, 'generate_image', 'analyze_picture']) {
      expect(offNames).not.toContain(name)
    }
    expect(agent.skill.systemPrompt).toContain('this app cannot reach the web')

    tools.setAvailability({ web: true, imageGeneration: false, pictureAnalysis: false })
    const webOnly = agent.skill.tools.map((tool) => tool.name)
    expect(webOnly).toEqual(expect.arrayContaining(['web_search', 'read_url', 'image_search']))
    expect(webOnly).toContain('insert_image')
    expect(webOnly).not.toContain('generate_image')
    expect(webOnly).not.toContain('analyze_picture')
  })
})

describe('the window.hwpApi stand-in', () => {
  it('is there only during a run, merged over what was there, and put back after it', async () => {
    const other = { getLanguage: () => 'ko', webSearch: () => 'the original' }
    host.hwpApi = other
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    expect(host.hwpApi).toBe(other)

    await agent.begin()
    expect(host.hwpApi).not.toBe(other)
    for (const name of STAND_IN_METHODS) expect(typeof standIn()[name]).toBe('function')
    // the other members stay reachable
    expect((host.hwpApi as typeof other).getLanguage()).toBe('ko')

    agent.finish()
    expect(host.hwpApi).toBe(other)
  })

  it('leaves no hwpApi behind where there was none', async () => {
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await agent.begin()
    expect(host.hwpApi).toBeDefined()
    agent.finish()
    expect('hwpApi' in host).toBe(false)
  })

  it('is put back after a run whose tool failed', async () => {
    tools.webSearch.mockRejectedValueOnce(new Error('broken'))
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await agent.begin()
    const done = await agent.skill.executeTool({
      id: '1',
      name: 'web_search',
      input: { query: 'x' },
    })
    expect(done.isError).toBe(true)
    agent.finish()
    expect('hwpApi' in host).toBe(false)
  })

  it('is put back when the run is stopped, and a call still on its way then fails', async () => {
    let release!: (value: Awaited<ReturnType<MobileAiTools['generateImage']>>) => void
    tools.generateImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const { call, inserted } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'en')
    await agent.begin()
    const pending = agent.skill.executeTool({
      id: '1',
      name: 'generate_image',
      input: { prompt: 'a cat', where: 'end' },
    })
    await vi.waitFor(() => expect(tools.generateImage).toHaveBeenCalled())
    // the AI sheet's stop: the loop resolves and the editor finishes the run
    agent.finish()
    expect('hwpApi' in host).toBe(false)
    release({ url: 'ai-result://late.png', mime: 'image/png', model: 'm', provider: 'openai' })
    const done = await pending
    expect(done.isError).toBe(true)
    expect(inserted).toHaveLength(0)
    expect(tools.fetchImage).not.toHaveBeenCalled()
  })

  it('undoes a run that never finished at the next begin', async () => {
    const original = { keep: true }
    host.hwpApi = original
    // begin went through, then preparing the run failed: nobody calls finish
    const abandoned = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await abandoned.begin()
    const next = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await next.begin()
    next.finish()
    expect(host.hwpApi).toBe(original)
    // the abandoned run's late finish does not touch what is there now
    abandoned.finish()
    expect(host.hwpApi).toBe(original)
  })

  it('a second run that begins before the first finished keeps the first original', async () => {
    const original = { keep: true }
    host.hwpApi = original
    const first = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await first.begin()
    const second = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await second.begin()
    expect(host.hwpApi).not.toBe(original)
    // the first one's finish does not take the second one's stand-in away
    first.finish()
    expect(host.hwpApi).not.toBe(original)
    expect(typeof standIn().webSearch).toBe('function')
    second.finish()
    expect(host.hwpApi).toBe(original)
  })
})

describe('the stand-in answers in the PC Hangul shapes', () => {
  async function running() {
    const plugin = fakePlugin()
    const agent = createMobileHwpAgent(plugin.call, () => 'en')
    await agent.begin()
    return { agent, plugin }
  }

  it('webSearch: results and method, or method "error" with the reason', async () => {
    await running()
    tools.webSearch.mockResolvedValueOnce({
      results: [{ title: 'T', url: 'https://example.com/', snippet: 'S' }],
      method: 'parallel',
    })
    expect(await standIn().webSearch('cats', 3)).toEqual({
      results: [{ title: 'T', url: 'https://example.com/', snippet: 'S' }],
      method: 'parallel',
    })
    expect(tools.webSearch).toHaveBeenCalledWith('cats', 3)
    tools.webSearch.mockResolvedValueOnce({ error: 'no route', errorCode: 'network' })
    expect(await standIn().webSearch('cats')).toEqual({
      results: [],
      method: 'error',
      error: 'no route',
    })
  })

  it('imageSearch: the PC image fields, or method "error"', async () => {
    await running()
    tools.imageSearch.mockResolvedValueOnce({
      images: [
        {
          title: 'A cat',
          imageUrl: 'https://img.example.com/cat.png',
          sourceUrl: 'https://example.com/cat',
          source: 'example.com',
          width: 640,
          height: 480,
        },
      ],
      method: 'duckduckgo',
    })
    expect(await standIn().imageSearch('cat', 2)).toEqual({
      images: [
        { title: 'A cat', imageUrl: 'https://img.example.com/cat.png', width: 640, height: 480 },
      ],
      method: 'duckduckgo',
    })
    expect(tools.imageSearch).toHaveBeenCalledWith('cat', 2)
    tools.imageSearch.mockResolvedValueOnce({ error: 'off', errorCode: 'unavailable' })
    expect(await standIn().imageSearch('cat')).toEqual({
      images: [],
      method: 'error',
      error: 'off',
    })
  })

  it('readUrl: ok with the page, or ok false with the error and its code', async () => {
    await running()
    const page = {
      url: 'https://example.com/a',
      title: 'A',
      text: 'hello',
      offset: 0,
      totalChars: 5,
      truncated: false,
    }
    tools.readUrl.mockResolvedValueOnce(page)
    expect(await standIn().readUrl('https://example.com/a', 0)).toEqual({ ok: true, ...page })
    expect(tools.readUrl).toHaveBeenCalledWith('https://example.com/a', 0)
    tools.readUrl.mockResolvedValueOnce({ error: 'private address', errorCode: 'blocked' })
    expect(await standIn().readUrl('http://10.0.0.1/')).toEqual({
      ok: false,
      error: 'private address',
      errorCode: 'blocked',
    })
  })

  it('fetchImage: base64 and type, or null', async () => {
    await running()
    tools.fetchImage.mockResolvedValueOnce({ bytes: PNG_BYTES, mime: 'image/png' })
    expect(await standIn().fetchImage('https://img.example.com/cat.png')).toEqual({
      base64: PNG_BASE64,
      mime: 'image/png',
    })
    tools.fetchImage.mockResolvedValueOnce({ error: 'gone', errorCode: 'http_error', status: 404 })
    expect(await standIn().fetchImage('https://img.example.com/gone.png')).toBeNull()
  })

  it('generateImage: the store address as url, or the error and its code', async () => {
    await running()
    tools.generateImage.mockResolvedValueOnce({
      url: 'ai-result://one.png',
      mime: 'image/png',
      model: 'gpt-image-2',
      provider: 'openai',
    })
    expect(
      await standIn().generateImage({ prompt: 'a cat', aspectRatio: '16:9', model: 'gpt-image-2' }),
    ).toEqual({ url: 'ai-result://one.png' })
    expect(tools.generateImage).toHaveBeenCalledWith({
      prompt: 'a cat',
      size: '16:9',
      model: 'gpt-image-2',
    })
    tools.generateImage.mockResolvedValueOnce({ error: 'off', errorCode: 'unavailable' })
    expect(await standIn().generateImage({ prompt: 'a cat' })).toEqual({
      error: 'off',
      errorCode: 'unavailable',
    })
    expect(tools.generateImage).toHaveBeenLastCalledWith({ prompt: 'a cat' })
  })

  it('analyzeMedia: the data URLs become bytes, the answer text or the error', async () => {
    await running()
    tools.analyzeMedia.mockResolvedValueOnce({ text: 'A small square.' })
    expect(
      await standIn().analyzeMedia({
        mediaUrls: [`data:image/png;base64,${PNG_BASE64}`],
        requirements: 'What is it?',
      }),
    ).toEqual({ text: 'A small square.' })
    expect(tools.analyzeMedia).toHaveBeenCalledWith({
      prompt: 'What is it?',
      images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
    })
    tools.analyzeMedia.mockResolvedValueOnce({ error: 'cannot see', errorCode: 'unavailable' })
    expect(
      await standIn().analyzeMedia({
        mediaUrls: [`data:image/png;base64,${PNG_BASE64}`],
        requirements: 'What is it?',
      }),
    ).toEqual({ error: 'cannot see', errorCode: 'unavailable' })
    tools.analyzeMedia.mockResolvedValueOnce({ error: 'refused', errorCode: 'failed' })
    expect(
      await standIn().analyzeMedia({
        mediaUrls: [`data:image/png;base64,${PNG_BASE64}`],
        requirements: 'What is it?',
      }),
    ).toEqual({ error: 'refused' })
    // an address that is not a data URL is not fetched
    const calls = tools.analyzeMedia.mock.calls.length
    const refused = (await standIn().analyzeMedia({
      mediaUrls: ['https://example.com/cat.png'],
      requirements: 'What is it?',
    })) as { text?: string; error?: string }
    expect(refused.text).toBeUndefined()
    expect(refused.error).toEqual(expect.any(String))
    expect(tools.analyzeMedia.mock.calls.length).toBe(calls)
  })

  it('readAttachmentImage: the photo by its id, or ok false', async () => {
    tools.setPhotos([
      { id: 'photo-1', name: 'cat.png', mime: 'image/png', bytes: PNG_BYTES },
      { id: 'photo-2', name: 'notes.txt', mime: 'text/plain', bytes: new Uint8Array([1]) },
    ])
    await running()
    expect(await standIn().readAttachmentImage('photo-1')).toEqual({
      ok: true,
      base64: PNG_BASE64,
      mime: 'image/png',
    })
    expect(await standIn().readAttachmentImage('photo-9')).toMatchObject({ ok: false })
    expect(await standIn().readAttachmentImage('photo-2')).toMatchObject({ ok: false })
  })

  it('never throws: a tool that throws answers in the failure shape', async () => {
    await running()
    tools.fetchImage.mockRejectedValueOnce(new Error('broken'))
    expect(await standIn().fetchImage('https://img.example.com/cat.png')).toBeNull()
    tools.readUrl.mockRejectedValueOnce(new Error('broken'))
    expect(await standIn().readUrl('https://example.com/')).toMatchObject({ ok: false })
    tools.generateImage.mockRejectedValueOnce(new Error('broken'))
    expect(await standIn().generateImage({ prompt: 'x' })).toMatchObject({
      error: expect.any(String),
    })
  })
})

describe('the tools of the skill over the stand-in', () => {
  it('generate_image puts the made picture in through the page editor plugin', async () => {
    tools.generateImage.mockResolvedValueOnce({
      url: 'ai-result://one.png',
      mime: 'image/png',
      model: 'gpt-image-2',
      provider: 'openai',
    })
    tools.fetchImage.mockResolvedValueOnce({ bytes: PNG_BYTES, mime: 'image/png' })
    const { call, inserted } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'en')
    await agent.begin()
    const done = await agent.skill.executeTool({
      id: '1',
      name: 'generate_image',
      input: { prompt: 'a cat', where: 'end' },
    })
    expect(done.isError).toBeFalsy()
    expect(tools.fetchImage).toHaveBeenCalledWith('ai-result://one.png')
    expect(inserted).toEqual([{ anchor: '', where: 'end', base64: PNG_BASE64, ext: 'png' }])
    expect(agent.finish()?.places).toBe(1)
  })

  it('analyze_picture shows the document picture to the shared tool', async () => {
    tools.analyzeMedia.mockResolvedValueOnce({ text: 'A red square.' })
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    await agent.begin()
    const done = await agent.skill.executeTool({
      id: '1',
      name: 'analyze_picture',
      input: { picture: 1, question: 'What colour?' },
    })
    expect(done.output).toBe('A red square.')
    expect(tools.analyzeMedia).toHaveBeenCalledWith({
      prompt: 'What colour?',
      images: [{ bytes: PNG_BYTES, mime: 'image/png' }],
    })
  })

  it('names the attached photos for the model and inserts one by its name', async () => {
    tools.setPhotos([{ id: 'photo-1', name: 'cat.png', mime: 'image/png', bytes: PNG_BYTES }])
    const { call, inserted } = fakePlugin()
    const agent = createMobileHwpAgent(call, () => 'en')
    expect(agent.skill.systemPrompt).toContain('Images attached to this chat: cat.png.')
    await agent.begin()
    const done = await agent.skill.executeTool({
      id: '1',
      name: 'insert_image',
      input: { attachment: 'cat.png', where: 'end' },
    })
    expect(done.isError).toBeFalsy()
    expect(inserted).toEqual([{ anchor: '', where: 'end', base64: PNG_BASE64, ext: 'png' }])

    const missing = await agent.skill.executeTool({
      id: '2',
      name: 'insert_image',
      input: { attachment: 'dog.png', where: 'end' },
    })
    expect(missing.isError).toBe(true)
    expect(missing.output).toContain('there is no file named "dog.png"')
  })

  it('does not name photos it could not insert (insert_image needs the web tools)', () => {
    tools.setPhotos([{ id: 'photo-1', name: 'cat.png', mime: 'image/png', bytes: PNG_BYTES }])
    tools.setAvailability(ALL_OFF)
    const agent = createMobileHwpAgent(fakePlugin().call, () => 'en')
    expect(agent.skill.systemPrompt).not.toContain('Images attached to this chat')
  })
})

describe('over the real shared tools', () => {
  beforeAll(async () => {
    // generateImage runs PC protocol code; warm it once
    await preloadMobileKeyProviderProtocols()
  }, 60_000)

  it('a made picture comes back from the result store through the ai-result address', async () => {
    stub.tools = null
    const real = await vi.importActual<typeof ToolsModule>('../src/renderer/ai/tools')
    const rust = makeFakeRust({
      toolSettings: {
        ...TOOL_SETTINGS_ON,
        imageGeneration: true,
        imageProvider: 'openai',
        imageModel: 'gpt-image-2',
        imageProvidersReady: ['openai'],
      },
      relay: () => ({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
      }),
    })
    const unbind = real.bindMobileAiTools({
      client: rust.client,
      getAiEnabled: () => true,
      getAiSettings: () => rust.aiSettings,
      getChatgptStatus: () => null,
    })
    try {
      await real.refreshMobileAiToolSettings()
      const { call, inserted } = fakePlugin()
      const agent = createMobileHwpAgent(call, () => 'en')
      expect(agent.skill.tools.map((tool) => tool.name)).toContain('generate_image')
      await agent.begin()
      const done = await agent.skill.executeTool({
        id: '1',
        name: 'generate_image',
        input: { prompt: 'a red apple', where: 'end' },
      })
      expect(done.isError).toBeFalsy()
      expect(rust.commands).toContain('mobile_ai_results_put_image')
      expect(rust.commands).toContain('mobile_ai_results_read_image')
      expect(inserted).toEqual([{ anchor: '', where: 'end', base64: PNG_BASE64, ext: 'png' }])
      agent.finish()
      expect('hwpApi' in host).toBe(false)
    } finally {
      unbind()
    }
  })
})
