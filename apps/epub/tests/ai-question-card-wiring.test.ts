// The EPUB AI panel and the question card (a2ui spec 4, 5.1, 5.2): the
// model's `ask_questions` call shows the card, its activity is kept with both
// its input and output, and a reopened chat draws it read-only where the tool
// step was. Question tags in a reopened reply never show as raw text. The model
// is a fake transport; no provider is ever reached.
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type { SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import type { BookAiHost } from '../src/renderer/ai/book-tools'
import type { EpubApi } from '../src/shared/ipc'

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'book-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'tone'] },
      { id: 'title', component: 'Text', text: 'Pick the chapter tone' },
      {
        id: 'tone',
        component: 'ChoicePicker',
        label: 'Which tone?',
        variant: 'mutuallyExclusive',
        options: [
          { label: 'Formal', value: 'formal' },
          { label: 'Casual', value: 'casual' },
        ],
        value: { '@path': '/tone' },
      },
    ],
    dataModel: { tone: [] },
  },
}

const model = vi.hoisted(() => ({ turns: 0, tools: [] as string[][] }))

vi.mock('../src/renderer/ai/transport', () => ({
  createElectronTransport: () => ({
    stream: (request: AgentStreamRequest, callbacks: AgentStreamCallbacks) => {
      const turn = model.turns++
      model.tools.push(request.tools.map((tool) => tool.name))
      setTimeout(() => {
        if (turn === 0) callbacks.onToolCall({ id: 'q1', name: 'ask_questions', input: SURFACE })
        else callbacks.onDelta('Done.')
        callbacks.onDone()
      }, 0)
      return { cancel: () => undefined }
    },
  }),
}))

const STATUSES = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'ready', meteredAccepted: false },
} as SubscriptionStatusMap

function installEpubApi(): void {
  const api = {
    getLanguage: async () => 'en',
    onLanguageChanged: () => () => {},
    getAiSettings: async () => ({ ...defaultAiSettings(), subscriptionNoticeSeen: true }),
    setAiSettings: async () => {},
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: async () => {},
    aiToolCapabilities: async () => ({}),
    readAttachmentImage: async () => ({ ok: false }),
    subscription: {
      statuses: vi.fn(async () => STATUSES),
      recheck: vi.fn(async () => STATUSES),
      onChanged: () => () => {},
    },
    onAiStream: () => () => {},
    aiStream: async () => {},
    aiStreamCancel: async () => {},
  }
  Object.assign(window, { epubApi: api as unknown as EpubApi })
}

interface StoredMessage {
  role: 'user' | 'assistant'
  text: string
  tools?: { name: string; summary: string; input?: string; output?: string }[]
}

function installDocumentStore(stored: StoredMessage[] = []) {
  const store = {
    resolveChat: vi.fn(async () => ({ projectId: 'doc', chatId: 'doc-chat' })),
    appendChat: vi.fn(async (_args: StoredMessage) => {}),
    loadChat: vi.fn(async () => stored),
    rebindChat: vi.fn(async () => null),
  }
  Object.assign(window, { projectApi: store })
  return store
}

const mounted: Array<{ root: Root; container: HTMLElement }> = []

async function settle(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountPanel(): Promise<HTMLElement> {
  installEpubApi()
  // no book open: the book's own tools have nothing to read, the panel still runs
  const host: BookAiHost = {
    book: () => null,
    readChapter: async () => ({ status: 'unreadable' }) as never,
    editor: () => ({
      isLocked: false,
      flush: async () => {},
      applyEditGroups: async () => ({}) as never,
    }),
    view: () => null,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(AiPanel, {
          host,
          filePath: 'C:/work/report/book.epub',
          onCollapse: () => {},
        }),
      }),
    )
  })
  mounted.push({ root, container })
  await settle()
  return container
}

async function sendMessage(container: HTMLElement, text: string): Promise<void> {
  const composer = container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(composer, text)
    composer.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
  await settle()
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  model.turns = 0
  model.tools.length = 0
})

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  for (const key of ['epubApi', 'projectApi', 'projectFolderApi']) {
    delete (window as unknown as Record<string, unknown>)[key]
  }
  vi.unstubAllGlobals()
})

const cardIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="ai-question-card"]')

describe('EPUB AI panel: question card', () => {
  it('asks with the card, then keeps the call with its input and output', async () => {
    const store = installDocumentStore()
    const container = await mountPanel()
    await sendMessage(container, 'Rewrite the chapter')

    expect(model.tools[0]).toContain('ask_questions')
    expect(cardIn(container)?.dataset.status).toBe('open')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ai-qcard-btn-secondary')!.click()
    })
    await settle()

    expect(cardIn(container)?.dataset.status).toBe('skipped')
    const reply = store.appendChat.mock.calls
      .map(([message]) => message)
      .find((message) => message.role === 'assistant')
    const asked = reply?.tools?.find((tool) => tool.name === 'ask_questions')
    expect(JSON.parse(asked!.input!)).toEqual(SURFACE)
    expect(JSON.parse(asked!.output!)).toMatchObject({ action: { surfaceId: 'book-scope' } })
  })

  it('draws a reopened question call read-only and hides question tags', async () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    installDocumentStore([
      { role: 'user', text: 'Rewrite the chapter' },
      {
        role: 'assistant',
        text: 'Here it is.',
        tools: [
          { name: 'read_chapter', summary: 'Read the chapter' },
          {
            name: 'ask_questions',
            summary: 'Asked',
            input: JSON.stringify({
              title: 'Confirm the tone',
              questions: [
                { id: 'tone', label: 'Tone', type: 'radio', options: ['Formal', 'Casual'] },
              ],
            }),
            output,
          },
        ],
      },
      {
        role: 'assistant',
        text: `Before I start:\n<a2ui-json>${JSON.stringify([SURFACE])}</a2ui-json>`,
      },
    ])
    const container = await mountPanel()

    const cards = container.querySelectorAll<HTMLElement>('[data-testid="ai-question-card"]')
    expect(cards.length).toBe(2)
    expect(cards[0]!.dataset.status).toBe('submitted')
    expect(cards[0]!.textContent).toContain('Casual')
    expect(container.querySelector('.ai-qcard button')).toBeNull()
    expect(container.textContent).not.toContain('<a2ui-json>')
    expect(container.textContent).toContain('Pick the chapter tone')
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('epub AI panel: question cards follow the conversation (a2ui spec 4)', () => {
  it('a message queued while a card waits closes it without a second card in that run', () => {
    const queue = panelSection('../src/renderer/ai/AiPanel.tsx', 'const enqueueWith = ')
    expect(queue).toContain('inlineQuestions.closeOpenCard()')
    expect(queue).not.toContain('supersedeOpen')
  })

  it('a queued message that starts its own run gets its one card', () => {
    const submit = panelSection('../src/renderer/ai/AiPanel.tsx', 'useChatRunQueue<', '\n  })\n')
    expect(submit).toContain('inlineQuestions.supersedeOpen()')
  })

  it('new chat and an opened chat drop the cards and reset the one-card limit', () => {
    expect(panelSection('../src/renderer/ai/AiPanel.tsx', 'const resetConversation = ')).toContain(
      'inlineQuestions.resetConversation()',
    )
  })
})
