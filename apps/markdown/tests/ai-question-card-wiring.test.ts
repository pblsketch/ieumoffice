// The markdown AI panel and the question card (a2ui spec 4, 5.1, 5.2): the
// model's `ask_questions` call shows the card, its activity is kept with both
// its input and output, and a reopened chat draws it read-only where the tool
// step was. Question tags in a reopened reply never show as raw text. The model
// is a fake transport; no provider is ever reached.
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import {
  normalizeAiSettings,
  type AiSettings,
  type SubscriptionStatusMap,
} from '@genoffice/ai-provider/browser'
import type { ProjectChatMessage } from '@genoffice/project-store'
import { AiPanel, type MarkdownAiDeps } from '../src/renderer/ai/AiPanel'
import {
  installDocumentChatStore,
  projectMessage,
  removeProjectFolderBridge,
} from './helpers/project-folder-fake'

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'note-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'tone'] },
      { id: 'title', component: 'Text', text: 'Pick the note tone' },
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

const READY = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'not-installed', meteredAccepted: false },
} as SubscriptionStatusMap

/** a key provider the person chose: the send gate lets it run (the transport is fake) */
function installEditorBridge(): void {
  const base = normalizeAiSettings(undefined)
  const settings: AiSettings = {
    ...base,
    subscriptionNoticeSeen: true,
    provider: 'openai',
    providers: { ...base.providers, openai: { apiKey: 'sk-test', model: 'some-model' } },
  }
  const api = {
    getAiSettings: vi.fn(async () => settings),
    setAiSettings: vi.fn(async () => {}),
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: vi.fn(async () => {}),
    setAiPanelPrefs: vi.fn(async () => ({})),
    aiStream: vi.fn(async () => {}),
    aiStreamCancel: vi.fn(async () => {}),
    onAiStream: () => () => {},
    aiSubscription: {
      statuses: vi.fn(async () => READY),
      recheck: vi.fn(async () => READY),
      login: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses: READY })),
      onChanged: vi.fn(() => () => {}),
      openInstallHelp: vi.fn(async () => {}),
    },
    aiToolCapabilities: vi.fn(async () => ({ imageGeneration: { available: false } })),
  }
  Object.defineProperty(window, 'markdownApi', { configurable: true, value: api })
}

const mounted: Array<{ root: Root; container: HTMLElement }> = []

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mountPanel(): Promise<HTMLElement> {
  const deps: MarkdownAiDeps = {
    getEditor: () => null,
    getFrontmatter: () => '',
    setFrontmatter: () => {},
    getSnapshot: () => ({ body: '', frontmatter: '' }),
    restoreSnapshot: () => {},
    onRunDone: () => {},
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(AiPanel, { deps, filePath: null, onCollapse: () => {} })))
  mounted.push({ root, container })
  await settle()
  return container
}

async function sendMessage(container: HTMLElement, text: string): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
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
  removeProjectFolderBridge()
  vi.unstubAllGlobals()
})

const cardIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="ai-question-card"]')

describe('markdown AI panel: question card', () => {
  it('asks with the card, then keeps the call with its input and output', async () => {
    installEditorBridge()
    const store = installDocumentChatStore()
    const container = await mountPanel()
    await sendMessage(container, 'Write the note')

    expect(model.tools[0]).toContain('ask_questions')
    expect(cardIn(container)?.dataset.status).toBe('open')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ai-qcard-btn-secondary')!.click()
    })
    await settle()

    expect(cardIn(container)?.dataset.status).toBe('skipped')
    const reply = store.appendChat.mock.calls
      .map(([message]) => message as { role: string; tools?: ProjectChatMessage['tools'] })
      .find((message) => message.role === 'assistant')
    const asked = reply?.tools?.find((tool) => tool.name === 'ask_questions')
    expect(JSON.parse(asked!.input!)).toEqual(SURFACE)
    expect(JSON.parse(asked!.output!)).toMatchObject({ action: { surfaceId: 'note-scope' } })
  })

  it('draws a reopened question call read-only and hides question tags', async () => {
    installEditorBridge()
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    installDocumentChatStore([
      projectMessage({ role: 'user', text: 'Write the note', editor: 'markdown' }),
      projectMessage({
        seq: 2,
        role: 'assistant',
        text: 'Here it is.',
        editor: 'markdown',
        tools: [
          { name: 'read_document', summary: 'Read the document' },
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
      }),
      projectMessage({
        seq: 3,
        role: 'assistant',
        text: `Before I start:\n<a2ui-json>${JSON.stringify([SURFACE])}</a2ui-json>`,
        editor: 'markdown',
      }),
    ])
    const container = await mountPanel()

    const cards = container.querySelectorAll<HTMLElement>('[data-testid="ai-question-card"]')
    expect(cards.length).toBe(2)
    expect(cards[0]!.dataset.status).toBe('submitted')
    expect(cards[0]!.textContent).toContain('Casual')
    expect(container.querySelector('.ai-qcard button')).toBeNull()
    expect(container.textContent).not.toContain('<a2ui-json>')
    expect(container.textContent).toContain('Pick the note tone')
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('markdown AI panel: question cards follow the conversation (a2ui spec 4)', () => {
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
