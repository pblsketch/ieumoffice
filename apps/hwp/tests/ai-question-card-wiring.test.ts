/** @vitest-environment jsdom */
// The HWP AI panel and the question card (a2ui spec 4, 5.1, 5.2): the model's
// `ask_questions` call shows the card, its activity is kept with both its input
// and output, and a reopened chat draws it read-only where the tool step was.
// Question tags in a reopened reply never show as raw text. The model is a fake
// transport; no provider is ever reached.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentStreamCallbacks, AgentStreamRequest } from '@genoffice/agent-core'
import { defaultAiSettings, type AiSettings } from '@genoffice/ai-provider'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'
import { fakeProjectFolder } from './fake-project-folder'

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'report-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'tone'] },
      { id: 'title', component: 'Text', text: 'Pick the report tone' },
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

function keySettings(): AiSettings {
  const settings = defaultAiSettings()
  return {
    ...settings,
    provider: 'openai',
    providers: { ...settings.providers, openai: { apiKey: 'sk-test', model: 'some-model' } },
  }
}

interface StoredTool {
  name: string
  summary: string
  input?: string
  output?: string
}

function hwpApiStub() {
  return {
    getAiSettings: async () => keySettings(),
    setAiSettings: async () => undefined,
    onAiSettingsChanged: () => () => undefined,
    openAiModelSettings: async () => undefined,
    setAiPanelPrefs: async () => ({}),
    pickAttachments: async () => ({ accepted: [], rejected: [] }),
    addAttachmentPaths: async () => ({ accepted: [], rejected: [] }),
    addPastedImage: async () => ({ accepted: [], rejected: [] }),
    getPathForFile: () => '',
    readAttachmentImage: async () => ({ ok: false }),
    aiToolCapabilities: async () => ({ imageGeneration: { available: false } }),
  }
}

/** an editor that is not there: every call fails, the panel swallows it */
const NO_EDITOR = new Proxy({} as AgentBridge, {
  get: () => () => Promise.reject(new Error('no editor in this test')),
})

function projectApiStub(stored: unknown[] = []) {
  return {
    resolveChat: vi.fn(async () => ({ projectId: 'doc-store', chatId: 'doc-chat' })),
    loadChat: vi.fn(async () => stored),
    appendChat: vi.fn(async (_message: { role: string; tools?: StoredTool[] }) => undefined),
    rebindChat: vi.fn(async () => null),
  }
}

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollTo = () => undefined
  model.turns = 0
  model.tools.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
  for (const key of ['hwpApi', 'projectApi', 'projectFolderApi']) {
    delete (window as unknown as Record<string, unknown>)[key]
  }
  vi.unstubAllGlobals()
})

async function settle(turns = 10): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount(stored: unknown[] = []) {
  const projectApi = projectApiStub(stored)
  Object.assign(window, {
    hwpApi: hwpApiStub(),
    projectApi,
    projectFolderApi: fakeProjectFolder(null).api,
  })
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(AiPanel, { bridge: NO_EDITOR, filePath: null, onCollapse: () => undefined }),
    )
  })
  await settle()
  return projectApi
}

const card = () => container.querySelector<HTMLElement>('[data-testid="ai-question-card"]')

describe('hwp AI panel: question card', () => {
  it('asks with the card, then keeps the call with its input and output', async () => {
    const projectApi = await mount()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ai-starter')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ai-send-btn:not(.ai-stop-btn)')!.click()
    })
    await settle()

    expect(model.tools[0]).toContain('ask_questions')
    expect(card()?.dataset.status).toBe('open')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ai-qcard-btn-secondary')!.click()
    })
    await settle()

    expect(card()?.dataset.status).toBe('skipped')
    const reply = projectApi.appendChat.mock.calls
      .map(([message]) => message)
      .find((message) => message.role === 'assistant')
    const asked = reply?.tools?.find((tool) => tool.name === 'ask_questions')
    expect(JSON.parse(asked!.input!)).toEqual(SURFACE)
    expect(JSON.parse(asked!.output!)).toMatchObject({
      action: { surfaceId: 'report-scope' },
    })
  })

  it('draws a reopened question call read-only and hides question tags', async () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    await mount([
      { role: 'user', text: 'Write the report' },
      {
        role: 'assistant',
        text: 'Here it is.',
        tools: [
          { name: 'get_document_text', summary: 'Read the document' },
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

    const cards = container.querySelectorAll<HTMLElement>('[data-testid="ai-question-card"]')
    expect(cards.length).toBe(2)
    expect(cards[0]!.dataset.status).toBe('submitted')
    expect(cards[0]!.textContent).toContain('Casual')
    expect(container.querySelector('.ai-qcard button')).toBeNull()
    expect(container.textContent).not.toContain('<a2ui-json>')
    expect(container.textContent).toContain('Pick the report tone')
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('hwp AI panel: question cards follow the conversation (a2ui spec 4)', () => {
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
