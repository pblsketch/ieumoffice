/**
 * The Word AI panel's first-send alert and "find sensitive info" button, over a
 * mocked preload bridge (no provider is started). What is checked is what
 * reaches `aiStream`: "Review" sends nothing and keeps the composer text, "Send
 * anyway" sends, the tab is never asked twice, attachments are counted from the
 * hiding-aware reader, a local AI gets its own sentence, and the empty state no
 * longer says this editor cannot hide.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { LANGS } from '@genoffice/i18n'
import { sensitiveInfoText } from '@genoffice/ui'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { getLang } from '../src/renderer/i18n/locale'
import { aiStrings } from '../src/renderer/i18n/strings-ai'
import {
  AI_PROVIDERS,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
} from '../src/shared/ipc'

type ChunkListener = (chunk: AiStreamChunk) => void

function keySettings(): AiSettings {
  return {
    provider: 'gemini',
    providers: Object.fromEntries(
      AI_PROVIDERS.map((p) => [
        p.id,
        { apiKey: p.id === 'gemini' ? 'k' : '', model: p.defaultModel || 'm' },
      ]),
    ) as AiSettings['providers'],
  }
}

function localSettings(): AiSettings {
  const settings = defaultAiSettings() as AiSettings
  settings.provider = 'custom'
  settings.customEndpoint = 'loc'
  settings.customEndpoints = [
    {
      id: 'loc',
      name: 'Local',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'm',
      kind: 'local',
      modelProfiles: { m: { contextLength: 1_000_000 } },
    },
  ]
  return settings
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

interface Harness {
  container: HTMLElement
  requests: AiStreamRequest[]
  readAttachment: ReturnType<typeof vi.fn>
  type(text: string): void
  send(text: string): Promise<void>
  composerText(): string
  click(selector: string, text?: string): Promise<void>
  cleanup(): void
}

async function mountPanel(
  body: string,
  settings: AiSettings = keySettings(),
  attachmentText: Record<string, string> = {},
): Promise<Harness> {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'docParagraph', attrs: { docxIndex: 0 }, content: [{ type: 'text', text: body }] },
      ],
    },
  })
  let listener: ChunkListener | null = null
  const requests: AiStreamRequest[] = []
  const readAttachment = vi.fn(async (path: string, offset: number) => {
    const text = attachmentText[path]
    if (text === undefined) return { ok: false, error: 'no' }
    return { ok: true, text: text.slice(offset), totalChars: text.length, offset }
  })
  const files = Object.keys(attachmentText)
  ;(window as unknown as Record<string, unknown>).desktop = {
    onAiStream: (l: ChunkListener) => {
      listener = l
      return () => {
        listener = null
      }
    },
    aiStream: vi.fn(async (request: AiStreamRequest) => {
      requests.push(request)
      listener?.({ type: 'delta', text: 'ok', requestId: request.requestId } as AiStreamChunk)
      listener?.({ type: 'done', requestId: request.requestId } as AiStreamChunk)
    }),
    aiStreamCancel: vi.fn(async () => {}),
    setAiSettings: vi.fn(async () => {}),
    openAiModelSettings: vi.fn(async () => {}),
    readAttachment,
    readAttachmentImage: vi.fn(async () => ({ ok: false })),
    pickAttachments: vi.fn(async () => ({
      accepted: files.map((path) => ({ path, name: path, ext: 'txt', sizeBytes: 10 })),
      rejected: [],
    })),
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() =>
    root.render(
      createElement(AiPanel, {
        editor,
        blocks: [],
        settings,
        open: true,
        onExpand: () => {},
        onCollapse: () => {},
      }),
    ),
  )
  await settle()
  const textarea = () => container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
  const type = (text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea(), text)
      textarea().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const click = async (selector: string, text?: string) => {
    const el = [...container.querySelectorAll<HTMLElement>(selector)].find(
      (e) => text === undefined || e.textContent === text,
    )
    if (!el) throw new Error(`no ${selector} ${text ?? ''}`)
    act(() => el.click())
    await settle()
  }
  return {
    container,
    requests,
    readAttachment,
    type,
    send: async (text) => {
      type(text)
      act(() => container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
      await settle()
    },
    composerText: () => textarea().value,
    click,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
      editor.destroy()
    },
  }
}

beforeAll(() => {
  let store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        store = {}
      },
    },
  })
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

let harness: Harness | null = null
afterEach(() => {
  harness?.cleanup()
  harness = null
  delete (window as unknown as Record<string, unknown>).desktop
})

const text = (key: Parameters<typeof sensitiveInfoText>[1], params?: Record<string, number>) =>
  sensitiveInfoText(getLang(), key, params)

describe('the first send of a Word document', () => {
  it('"Review" sends nothing, keeps the composer text and opens the list', async () => {
    harness = await mountPanel('담당 전화 010-1234-5678')
    await harness.send('summarize this')
    const alert = harness.container.querySelector('.gs-sens-alert')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain(text('alertCounts', { doc: 1 }))
    expect(alert!.textContent).toContain(text('alertBody'))
    expect(harness.requests).toHaveLength(0)
    await harness.click('.gs-sens-alert button', text('alertReview'))
    expect(harness.requests).toHaveLength(0)
    expect(harness.composerText()).toBe('summarize this')
    expect(harness.container.querySelector('.gs-sens-alert')).toBeNull()
    expect(harness.container.querySelector('.gs-sens-list .gs-sens-value')?.textContent).toBe(
      '010-1234-5678',
    )
    // answered once: the next send goes out without asking
    await harness.send('summarize this')
    expect(harness.container.querySelector('.gs-sens-alert')).toBeNull()
    expect(harness.requests).toHaveLength(1)
  })

  it('"Send anyway" sends, and the tab is not asked again', async () => {
    harness = await mountPanel('메일 hong@example.com')
    await harness.send('first')
    expect(harness.requests).toHaveLength(0)
    await harness.click('.gs-sens-alert button', text('alertSend'))
    expect(harness.requests).toHaveLength(1)
    await harness.send('second')
    expect(harness.container.querySelector('.gs-sens-alert')).toBeNull()
    expect(harness.requests).toHaveLength(2)
  })

  it('a document with nothing found sends at once, with no alert', async () => {
    harness = await mountPanel('EVs market research')
    await harness.send('summarize this')
    expect(harness.container.querySelector('.gs-sens-alert')).toBeNull()
    expect(harness.requests).toHaveLength(1)
  })

  it('counts the attachments of the request from the hiding-aware reader', async () => {
    harness = await mountPanel('담당 전화 010-1234-5678', keySettings(), {
      'C:/a.txt': '연락처 010-2222-3333\n메일 a@b.co',
    })
    await harness.click('.ai-attach-btn')
    await harness.send('compare')
    expect(harness.readAttachment).toHaveBeenCalledWith('C:/a.txt', 0, 48_000)
    expect(harness.container.querySelector('.gs-sens-alert')!.textContent).toContain(
      text('alertCountsAttachments', { doc: 1, att: 2 }),
    )
    expect(harness.requests).toHaveLength(0)
  })

  it('says "the AI on this PC" when the chosen AI is local, and still asks', async () => {
    harness = await mountPanel('담당 전화 010-1234-5678', localSettings())
    await harness.send('summarize this')
    const alert = harness.container.querySelector('.gs-sens-alert')
    expect(alert!.textContent).toContain(text('alertBodyLocal'))
    expect(harness.requests).toHaveLength(0)
  })
})

describe('the panel itself', () => {
  it('has the find button, which opens the list without sending', async () => {
    harness = await mountPanel('담당 전화 010-1234-5678')
    await harness.click('.gs-sens-find', text('findButton'))
    expect(harness.container.querySelector('.gs-sens-list')).not.toBeNull()
    expect(harness.container.querySelectorAll('.gs-sens-row')).toHaveLength(1)
    expect(harness.requests).toHaveLength(0)
  })

  it('no longer says this editor cannot hide, in any language', () => {
    for (const lang of LANGS) {
      expect(Object.keys(aiStrings[lang])).not.toContain('aiNoHidingNote')
    }
  })
})
