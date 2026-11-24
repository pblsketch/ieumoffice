// The PDF AI panel and the question card (a2ui spec 4, 5.1, 5.2): the
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
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import type { PdfAppDeps } from '../src/renderer/ai/tools'
import {
  installDocumentChatStore,
  projectMessage,
  removeProjectFolderBridge,
} from './helpers/project-folder-fake'

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'pdf-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'tone'] },
      { id: 'title', component: 'Text', text: 'Pick the summary tone' },
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

const READY: SubscriptionStatusMap = {
  'claude-code': {
    provider: 'claude-code',
    state: 'ready',
    meteredAccepted: false,
    loginMethod: 'subscription',
  },
  codex: { provider: 'codex', state: 'not-installed', meteredAccepted: false },
}

/** a key provider the person chose: the send gate lets it run (the transport is fake) */
function installEditorBridge(): void {
  const base = normalizeAiSettings({})
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
    onLanguageChanged: () => () => {},
    setAiPanelPrefs: vi.fn(async () => ({})),
    openSourcePath: vi.fn(async () => {}),
    subscription: {
      statuses: vi.fn(async () => READY),
      recheck: vi.fn(async () => READY),
      login: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      setMeteredAccepted: vi.fn(async () => ({ ok: true, statuses: READY })),
      onChanged: () => () => {},
      openInstallHelp: vi.fn(async () => {}),
    },
    imageGenerationAvailable: vi.fn(async () => false),
    aiStream: vi.fn(async () => {}),
    aiStreamCancel: vi.fn(async () => {}),
    onAiStream: () => () => {},
  }
  vi.stubGlobal('pdfApi', api)
}

const APP_DEPS = new Proxy(
  {
    fileName: () => 'doc.pdf',
    pageCount: () => 3,
    currentPage: () => 1,
    readOnly: () => false,
    selection: () => null,
    pendingSummary: () => '',
    annotationSummary: () => '',
    metadata: () => ({}),
    outline: () => null,
  } as Record<string, unknown>,
  {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return () => {
        throw new Error(`unexpected deps call: ${prop}`)
      }
    },
  },
) as unknown as PdfAppDeps

const mounted: Array<{ root: Root; container: HTMLElement }> = []

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mountPanel(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(AiPanel, {
          api: APP_DEPS,
          filePath: 'C:/work/doc.pdf',
          onCollapse: () => {},
        }),
      ),
    ),
  )
  mounted.push({ root, container })
  await settle()
  return container
}

async function sendMessage(container: HTMLElement, text: string): Promise<void> {
  const input = container.querySelector<HTMLTextAreaElement>('.ai-composer textarea')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
  })
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

describe('PDF AI panel: question card', () => {
  it('asks with the card, then keeps the call with its input and output', async () => {
    installEditorBridge()
    const store = installDocumentChatStore()
    const container = await mountPanel()
    await sendMessage(container, 'Summarize the paper')

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
    expect(JSON.parse(asked!.output!)).toMatchObject({ action: { surfaceId: 'pdf-scope' } })
  })

  it('draws a reopened question call read-only and hides question tags', async () => {
    installEditorBridge()
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    installDocumentChatStore([
      projectMessage({ role: 'user', text: 'Summarize the paper', editor: 'pdf' }),
      projectMessage({
        seq: 2,
        role: 'assistant',
        text: 'Here it is.',
        editor: 'pdf',
        tools: [
          { name: 'read_pages', summary: 'Read the pages' },
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
        editor: 'pdf',
      }),
    ])
    const container = await mountPanel()

    const cards = container.querySelectorAll<HTMLElement>('[data-testid="ai-question-card"]')
    expect(cards.length).toBe(2)
    expect(cards[0]!.dataset.status).toBe('submitted')
    expect(cards[0]!.textContent).toContain('Casual')
    expect(container.querySelector('.ai-qcard button')).toBeNull()
    expect(container.textContent).not.toContain('<a2ui-json>')
    expect(container.textContent).toContain('Pick the summary tone')
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('pdf AI panel: question cards follow the conversation (a2ui spec 4)', () => {
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
