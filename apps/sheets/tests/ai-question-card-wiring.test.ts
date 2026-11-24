/** @vitest-environment jsdom */
/**
 * The Excel AI panel and the question card (a2ui spec 4, 5.1, 5.2). App.tsx
 * owns the loop and the shared question hook and hands the hook to the panel;
 * the first part drives the real hook and the real panel (the tool card, a
 * reopened chat's read-only cards, no raw question tags). The second pins
 * App.tsx's wiring, whose workbook runtime cannot be mounted here.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSettings } from '@genoffice/ai-provider/browser'
import type { ToolExecution } from '@genoffice/agent-core'
import { useAiInlineQuestions, type AiInlineQuestions } from '@genoffice/ui'
import {
  AiChatPanel,
  type AiChatMessage,
  type AiPanelSubscription,
} from '../src/renderer/ai/AiChatPanel'

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'sheet-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'chart'] },
      { id: 'title', component: 'Text', text: 'Pick the chart' },
      {
        id: 'chart',
        component: 'ChoicePicker',
        label: 'Which chart?',
        variant: 'mutuallyExclusive',
        options: [
          { label: 'Bars', value: 'bars' },
          { label: 'Lines', value: 'lines' },
        ],
        value: { '@path': '/chart' },
      },
    ],
    dataModel: { chart: [] },
  },
}

const subscription: AiPanelSubscription = {
  settings: null as AiSettings | null,
  statuses: {},
  connectChoice: null,
  connectAttention: 0,
  noticeDue: false,
  admitQueued: () => true,
  busy: false,
  actions: {
    onInstall: vi.fn(),
    onLogin: vi.fn(),
    onRecheck: vi.fn(),
    onAcceptMetered: vi.fn(),
    onOpenInstallHelp: vi.fn(),
  },
  refresh: vi.fn(),
  usage: [],
  inputTruncated: false,
  onDismissTruncated: vi.fn(),
  onAcknowledgeNotice: vi.fn(),
  onContinueWith: vi.fn(),
}

let host: HTMLDivElement
let root: Root
let questionsNow: AiInlineQuestions | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Element.prototype.scrollTo = () => undefined
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  questionsNow = null
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

/** App.tsx's side, reduced to the question hook, handed to the real panel */
function Harness({
  chat,
  historicChat,
  aiBusy = false,
}: {
  chat: readonly AiChatMessage[]
  historicChat?: readonly AiChatMessage[]
  aiBusy?: boolean
}): React.JSX.Element {
  const inlineQuestions = useAiInlineQuestions()
  useEffect(() => {
    questionsNow = inlineQuestions
  })
  return createElement(AiChatPanel, {
    isOpen: true,
    hasContent: true,
    chat,
    ...(historicChat ? { historicChat } : {}),
    attachments: [],
    attachNotice: null,
    onPickAttachments: () => undefined,
    onAddAttachmentPaths: () => undefined,
    onAddPastedImage: () => undefined,
    onRemoveAttachment: () => undefined,
    prompt: '',
    preview: null,
    aiBusy,
    subscription,
    onPromptChange: () => undefined,
    onSend: () => undefined,
    onStop: () => undefined,
    onNewChat: () => undefined,
    onRevertChanges: async () => undefined,
    onClearMarks: () => undefined,
    scopeRange: null,
    scopeColumns: null,
    scopeLocked: false,
    onScopeDismiss: () => undefined,
    onCitation: () => undefined,
    onExpand: () => undefined,
    onCollapse: () => undefined,
    inlineQuestions,
  })
}

const card = () => host.querySelector<HTMLElement>('[data-testid="ai-question-card"]')

describe('sheets AI panel: question card', () => {
  it('draws the tool card App.tsx asks with, and skipping answers the tool', async () => {
    const streaming: AiChatMessage = { role: 'assistant', text: '', tools: [], streaming: true }
    act(() => root.render(createElement(Harness, { chat: [streaming], aiBusy: true })))
    let result: ToolExecution | Promise<ToolExecution> | null = null
    act(() => {
      result = questionsNow!.askQuestionsSkill.executeTool({
        id: 'q1',
        name: 'ask_questions',
        input: SURFACE,
      })
    })
    expect(card()?.dataset.status).toBe('open')
    expect(questionsNow!.waitingForPerson).toBe(true)

    act(() => host.querySelector<HTMLButtonElement>('.ai-qcard-btn-secondary')!.click())
    const execution = await result!
    expect(card()?.dataset.status).toBe('skipped')
    expect(questionsNow!.waitingForPerson).toBe(false)
    expect(JSON.parse(execution.output)).toMatchObject({ action: { surfaceId: 'sheet-scope' } })
  })

  it('draws reopened question calls read-only and hides question tags', () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { chart: 'Lines' } })
    const asked: AiChatMessage = {
      role: 'assistant',
      text: 'Here it is.',
      restored: true,
      tools: [
        { name: 'read_range', summary: 'Read A1:B5', isError: false },
        {
          name: 'ask_questions',
          summary: 'Asked',
          isError: false,
          input: JSON.stringify({
            title: 'Confirm the chart',
            questions: [{ id: 'chart', label: 'Chart', type: 'radio', options: ['Bars', 'Lines'] }],
          }),
          output,
        },
      ],
    }
    const tagged: AiChatMessage = {
      role: 'assistant',
      text: `First:\n<a2ui-json>${JSON.stringify([SURFACE])}</a2ui-json>`,
      tools: [],
      restored: true,
    }
    act(() =>
      root.render(createElement(Harness, { chat: [asked, tagged], historicChat: [asked, tagged] })),
    )
    const cards = host.querySelectorAll<HTMLElement>('[data-testid="ai-question-card"]')
    expect(cards.length).toBe(4)
    expect(cards[0]!.dataset.status).toBe('submitted')
    expect(cards[0]!.textContent).toContain('Lines')
    expect(host.querySelector('.ai-qcard button')).toBeNull()
    expect(host.textContent).not.toContain('<a2ui-json>')
    expect(host.textContent).toContain('Pick the chart')
  })
})

describe('sheets App wiring of the question card', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
  const shell = readFileSync(resolve(process.cwd(), 'src/renderer/ExcelShell.tsx'), 'utf8')

  it('puts the ask-questions skill in the loop and hands the hook to the panel', () => {
    expect(app).toContain('const inlineQuestions = useAiInlineQuestions()')
    const start = app.indexOf('agentLoopRef.current = new AgentLoop({')
    const loop = app.slice(start, app.indexOf('events: {', start))
    expect(loop).toContain('inlineQuestions.askQuestionsSkill')
    expect(app).toContain('aiQuestions={inlineQuestions}')
    expect(shell).toContain('inlineQuestions={aiQuestions}')
    // a new message closes a card still open and gives the run its one card
    expect(app).toContain('inlineQuestions.supersedeOpen()')
  })

  it('keeps a question call whole when a stored chat is shown again', () => {
    const mapper = app.slice(
      app.indexOf('function storedChatMessageOf'),
      app.indexOf('function storedChatMessageOf') + 1500,
    )
    expect(mapper).toContain('isQuestionToolActivity(t)')
    expect(mapper).toContain('input: t.input')
    expect(mapper).toContain('restored: true')
  })
})

/** the source of one function of a panel, from its opening line to its closing brace */
function panelSection(file: string, start: string, end = '\n  }\n'): string {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(start)
  if (at < 0) throw new Error(`${start} not found in ${file}`)
  return src.slice(at, src.indexOf(end, at))
}

describe('sheets AI panel: question cards follow the conversation (a2ui spec 4)', () => {
  it('a message queued while a card waits closes it without a second card in that run', () => {
    const queue = panelSection('../src/renderer/ai/AiChatPanel.tsx', 'const enqueueWith = ')
    expect(queue).toContain('inlineQuestions.closeOpenCard()')
    expect(queue).not.toContain('supersedeOpen')
  })

  it('new chat and an opened chat drop the cards and reset the one-card limit', () => {
    expect(panelSection('../src/renderer/App.tsx', 'function resetConversation(')).toContain(
      'inlineQuestions.resetConversation()',
    )
  })
})
