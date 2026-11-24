import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The shared question card in the slides AI panel (spec 4, 5.1, 5.2): the
// card a run asks, the elapsed count holding while it waits, the call stored
// with its input, and the read-only cards of a reopened conversation. The loop
// is mocked; no provider is ever reached.

const agentHarness = vi.hoisted(() => ({
  events: null as null | {
    onToolExecuted?: (event: {
      call: { id: string; name: string; input: unknown }
      execution: { summary: string; output?: string; isError?: boolean; mutated?: boolean }
    }) => void
    onDone?: (result: { text: string; cancelled: boolean; turnLimit: boolean }) => void
  },
  skill: null as null | {
    tools: Array<{ name: string }>
    executeTool?: (call: { id: string; name: string; input: unknown }) => Promise<{
      output: string
      isError?: boolean
    }>
  },
}))

vi.mock('@genoffice/agent-core', async () => {
  const actual =
    await vi.importActual<typeof import('@genoffice/agent-core')>('@genoffice/agent-core')
  return {
    ...actual,
    AgentLoop: class MockAgentLoop {
      busy = false
      messages = []

      constructor(options: {
        events?: typeof agentHarness.events
        skill?: typeof agentHarness.skill
      }) {
        agentHarness.events = options.events ?? null
        agentHarness.skill = options.skill ?? null
      }

      run() {}
      cancel() {}
      reset() {}
      restore() {}
      appendHistory() {
        return 0
      }
    },
  }
})

vi.mock('../src/renderer/ai/transport', () => ({
  createElectronTransport: () => ({}),
}))

// react-konva's node entry requires the native 'canvas' package; these tests do not draw.
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { submitAction, validateQuestionSurface } from '@genoffice/agent-core'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import {
  installDocumentChatStore,
  projectMessage,
  removeProjectFolderBridge,
} from './helpers/project-folder-fake'

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    // a key provider that can run: the panel starts nothing while no provider is connected
    AI_PROVIDERS.map((provider) => [
      provider.id,
      { apiKey: provider.id === 'anthropic' ? 'test-key' : '', model: provider.defaultModel },
    ]),
  ) as AiSettings['providers'],
}

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'deck-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'audience'] },
      { id: 'title', component: 'Text', text: 'Choose the deck direction' },
      {
        id: 'audience',
        component: 'ChoicePicker',
        label: 'Who is it for?',
        variant: 'mutuallyExclusive',
        options: [
          { label: 'Parents', value: 'parents' },
          { label: 'Colleagues', value: 'colleagues' },
        ],
        value: { '@path': '/audience' },
      },
    ],
    dataModel: { audience: [] },
  },
}

/** the tool output of a submitted card, as the shared skill writes it */
const SUBMIT_OUTPUT = (() => {
  const checked = validateQuestionSurface(SURFACE)
  if (!checked.ok) throw new Error('fixture surface must be valid')
  return JSON.stringify(
    submitAction(checked.view, { audience: ['parents'] }, [], new Date('2026-11-24T09:00:00Z')),
  )
})()

const mounted: Array<{ root: Root; container: HTMLElement }> = []

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    slides: [],
    current: 0,
    selectedIds: [],
    images: new Map<string, HTMLImageElement>(),
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 960,
    settings,
    open: true,
    onExpand: () => {},
    onCollapse: () => {},
    currentFilePath: 'C:/work/deck.pptx',
    ...overrides,
  }
}

/** lets effects and promises run; with fake timers on, advances them by `ms` too */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(ms)
    } else {
      for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

async function mountPanel(overrides: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(AiPanel, panelProps(overrides))))
  mounted.push({ root, container })
  await settle()
  return { root, container }
}

async function send(container: HTMLElement, text: string) {
  const input = container.querySelector<HTMLTextAreaElement>('textarea[data-slides-ai-input]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
  })
  await settle()
}

const elapsedText = (container: HTMLElement) =>
  container.querySelector('.ai-typing-elapsed')?.textContent ?? ''

const cards = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="ai-question-card"]'))

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  agentHarness.events = null
  agentHarness.skill = null
  Object.defineProperty(window, 'slidesApi', {
    configurable: true,
    value: {
      beginHistoryBatch: vi.fn(async () => false),
      endHistoryBatch: vi.fn(async () => null),
      aiLogRunFailure: vi.fn(async () => undefined),
      setAiPanelPrefs: vi.fn(async () => ({})),
    },
  })
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: { readAttachmentImage: vi.fn(async () => ({ ok: false })) },
  })
})

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  removeProjectFolderBridge()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('slides AI panel: the shared question card', () => {
  it('offers ask_questions and no ask_clarification to the run', async () => {
    installDocumentChatStore()
    await mountPanel()
    const names = agentHarness.skill!.tools.map((t) => t.name)
    expect(names).toContain('ask_questions')
    expect(names).not.toContain('ask_clarification')
  })

  it('shows the card a run asks and holds the elapsed count while it waits', async () => {
    vi.useFakeTimers()
    installDocumentChatStore()
    const { container } = await mountPanel()
    await send(container, 'make a deck for the parents meeting')
    await settle(5_000)
    const before = elapsedText(container)
    expect(before).toMatch(/\d+s/)

    let result: Promise<{ output: string }> | undefined
    await act(async () => {
      result = agentHarness.skill!.executeTool!({
        id: 'q1',
        name: 'ask_questions',
        input: SURFACE,
      })
    })
    await settle()
    expect(cards(container).map((c) => c.dataset.status)).toEqual(['open'])
    const waiting = elapsedText(container)
    await settle(10_000)
    expect(elapsedText(container)).toBe(waiting)

    // skipping answers the tool and the count goes on
    const skip = cards(container)[0]!.querySelector<HTMLButtonElement>('.ai-qcard-btn-secondary')!
    act(() => skip.click())
    await settle()
    const out = await result!
    expect(JSON.parse(out.output).action.name).toBe('skip')
    await settle(3_000)
    expect(elapsedText(container)).not.toBe(waiting)
  })

  it('stores the question call with its input and full output', async () => {
    const store = installDocumentChatStore()
    const { container } = await mountPanel()
    await send(container, 'make a deck')
    const longOutput = SUBMIT_OUTPUT + ' '.repeat(3_000)
    await act(async () => {
      agentHarness.events!.onToolExecuted?.({
        call: { id: 'q1', name: 'ask_questions', input: SURFACE },
        execution: { summary: 'Choose the deck direction', output: longOutput },
      })
      agentHarness.events!.onDone?.({
        text: 'Here is the plan',
        cancelled: false,
        turnLimit: false,
      })
    })
    await settle()
    const assistant = store.appendChat.mock.calls
      .map(
        ([m]) =>
          m as { role: string; tools?: Array<{ name: string; input?: string; output?: string }> },
      )
      .find((m) => m.role === 'assistant')!
    const tool = assistant.tools!.find((t) => t.name === 'ask_questions')!
    expect(JSON.parse(tool.input!)).toEqual(SURFACE)
    expect(tool.output).toBe(longOutput)
  })

  it('reopens question calls as read-only cards where the run asked them', async () => {
    installDocumentChatStore([
      projectMessage({ seq: 1, role: 'user', text: 'make a deck', editor: 'slides' }),
      projectMessage({
        seq: 2,
        role: 'assistant',
        text: 'Made it for the parents.',
        editor: 'slides',
        tools: [
          { name: 'web_search', summary: 'Searched the web', output: 'results' },
          {
            name: 'ask_questions',
            summary: 'Choose the deck direction',
            input: JSON.stringify(SURFACE),
            output: SUBMIT_OUTPUT,
          },
          {
            name: 'ask_clarification',
            summary: 'Collected answers',
            input: JSON.stringify({
              questions: [{ id: 'tone', label: 'Tone', options: ['Warm', 'Formal'] }],
            }),
            output:
              'User questionnaire answers:\nTone: Warm\nDecide the Core Hook and style accordingly, then generate with generate_deck.',
          },
          { name: 'generate_deck', summary: 'Generated 6 pages', output: 'ok' },
        ],
      }),
    ])
    const { container } = await mountPanel()
    const historic = container.querySelector('.ai-msg-historic.ai-msg-assistant')!
    const shown = cards(historic as HTMLElement)
    expect(shown).toHaveLength(2)
    expect(shown.every((c) => c.classList.contains('ai-qcard-locked'))).toBe(true)
    expect(shown.some((c) => c.querySelector('button'))).toBe(false)
    expect(shown[0]!.textContent).toContain('Who is it for?')
    expect(shown[0]!.textContent).toContain('Parents')
    expect(shown[1]!.textContent).toContain('Warm')
    // the next-step note written for the model stays hidden
    expect(historic.textContent).not.toContain('generate with generate_deck')
    // the other tools stay work steps
    expect(historic.textContent).toContain('Made it for the parents.')
  })

  it('draws a restored reply with a question block as a read-only card, never as tag text', async () => {
    const block = `<a2ui-json>[${JSON.stringify(SURFACE)}]</a2ui-json>`
    installDocumentChatStore([
      projectMessage({ seq: 1, role: 'user', text: 'make a deck', editor: 'slides' }),
      projectMessage({
        seq: 2,
        role: 'assistant',
        text: `A quick question first.\n\n${block}`,
        editor: 'slides',
      }),
    ])
    const { container } = await mountPanel()
    const historic = container.querySelector('.ai-msg-historic.ai-msg-assistant')!
    expect(historic.textContent).toContain('A quick question first.')
    expect(historic.textContent).not.toContain('a2ui-json')
    const shown = cards(historic as HTMLElement)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.querySelector('button')).toBeNull()
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('slides AI panel: question cards follow the conversation (a2ui spec 4)', () => {
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
