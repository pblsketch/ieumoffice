/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { skipAction, submitAction, validateQuestionSurface } from '@genoffice/agent-core'
import {
  AiQuestionReceipt,
  isQuestionToolActivity,
  questionToolActivities,
  type QuestionToolActivity,
} from '../src/AiQuestionReceipt'
import { questionCardText } from '../src/strings-question-card'
import * as ui from '../src/index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const now = new Date('2026-11-24T09:00:00.000Z')
const STORE_FIELD_MAX = 16_000

const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'deck-scope',
    catalogId: 'ieumoffice.com:question-card/v1',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'audience', 'notes'] },
      { id: 'title', component: 'Text', text: '발표 자료 방향을 정해 주세요' },
      {
        id: 'audience',
        component: 'ChoicePicker',
        label: '누가 듣나요?',
        variant: 'mutuallyExclusive',
        options: [
          { label: '학부모', value: 'parents' },
          { label: '동료 교사', value: 'teachers' },
        ],
        value: { '@path': '/audience' },
      },
      {
        id: 'notes',
        component: 'TextField',
        label: '그 밖에 바라는 점',
        variant: 'longText',
        value: { '@path': '/notes' },
      },
    ],
    dataModel: { audience: [], notes: '' },
  },
}

function surfaceView() {
  const checked = validateQuestionSurface(SURFACE)
  if (!checked.ok) throw new Error('fixture surface must be valid')
  return checked.view
}

const OLD_INPUT = JSON.stringify({
  id: 'scope',
  title: 'Confirm the scope',
  questions: [{ id: 'tone', label: 'Tone', type: 'radio', options: ['Formal', 'Casual'] }],
})

const CLARIFY_INPUT = JSON.stringify({
  questions: [{ id: 'aud', label: 'Audience', options: ['Parents', 'Teachers'] }],
})

let root: Root | null = null
let host: HTMLDivElement

function render(activity: QuestionToolActivity): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<AiQuestionReceipt lang="ko" activity={activity} />))
}

function card(): HTMLElement | null {
  return host.querySelector('[data-testid="ai-question-card"]')
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

describe('isQuestionToolActivity', () => {
  it('accepts only the two question tools', () => {
    expect(isQuestionToolActivity({ name: 'ask_questions' })).toBe(true)
    expect(isQuestionToolActivity({ name: 'ask_clarification' })).toBe(true)
    expect(isQuestionToolActivity({ name: 'insert_table' })).toBe(false)
    expect(isQuestionToolActivity({ name: 'plan_page', summary: 'ask_questions' })).toBe(false)
    expect(isQuestionToolActivity({ name: '' })).toBe(false)
  })

  it('picks the question activities of a list in order', () => {
    const list = [
      { name: 'read_document', summary: 'a' },
      { name: 'ask_clarification', summary: 'b' },
      { name: 'insert_table', summary: 'c' },
      { name: 'ask_questions', summary: 'd' },
    ]
    expect(questionToolActivities(list).map((a) => a.summary)).toEqual(['b', 'd'])
    expect(questionToolActivities(undefined)).toEqual([])
    expect(questionToolActivities([])).toEqual([])
  })

  it('is exported from the package entry', () => {
    expect(ui.AiQuestionReceipt).toBe(AiQuestionReceipt)
    expect(ui.isQuestionToolActivity).toBe(isQuestionToolActivity)
    expect(ui.questionToolActivities).toBe(questionToolActivities)
  })
})

describe('AiQuestionReceipt: new A2UI shape', () => {
  const input = JSON.stringify(SURFACE)

  it('draws an answered card with its questions and answers, without buttons', () => {
    const output = JSON.stringify(
      submitAction(surfaceView(), { audience: ['teachers'], notes: '사진을 많이' }, [], now),
    )
    render({ name: 'ask_questions', summary: 'asked', input, output })
    expect(card()?.dataset.status).toBe('submitted')
    expect(card()?.dataset.content).toBe('answered')
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('발표 자료 방향을 정해 주세요')
    expect(host.textContent).toContain('누가 듣나요?')
    expect(host.textContent).toContain('동료 교사')
    expect(host.textContent).toContain('사진을 많이')
  })

  it('draws a skipped card', () => {
    render({ name: 'ask_questions', input, output: JSON.stringify(skipAction(surfaceView(), now)) })
    expect(card()?.dataset.status).toBe('skipped')
    expect(host.textContent).toContain(questionCardText('ko', 'statusSkipped'))
    expect(host.textContent).toContain('누가 듣나요?')
  })

  it('draws only the answers when the input is missing', () => {
    const output = JSON.stringify(submitAction(surfaceView(), { notes: '짧게' }, ['audience'], now))
    render({ name: 'ask_questions', output })
    expect(card()?.dataset.content).toBe('answers-only')
    expect(host.textContent).toContain(questionCardText('ko', 'answersOnlyTitle'))
    expect(host.textContent).toContain('짧게')
  })

  it('draws only the answers when the store cut the input', () => {
    const padded = input.replace('발표 자료 방향을 정해 주세요', 'x'.repeat(20_000))
    const output = JSON.stringify(submitAction(surfaceView(), { notes: '짧게' }, [], now))
    render({ name: 'ask_questions', input: padded.slice(0, STORE_FIELD_MAX), output })
    expect(card()?.dataset.content).toBe('answers-only')
    expect(host.textContent).toContain('짧게')
    expect(host.textContent).not.toContain('누가 듣나요?')
  })

  it('draws nothing for an error result or a call without an answer', () => {
    render({ name: 'ask_questions', input, output: 'components[2]: bad', isError: true })
    expect(host.innerHTML).toBe('')
    act(() =>
      root!.render(<AiQuestionReceipt lang="ko" activity={{ name: 'ask_questions', input }} />),
    )
    expect(host.innerHTML).toBe('')
  })
})

describe('AiQuestionReceipt: old ask_questions shape', () => {
  it('draws an answered card', () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    render({ name: 'ask_questions', input: OLD_INPUT, output })
    expect(card()?.dataset.status).toBe('submitted')
    expect(host.textContent).toContain('Confirm the scope')
    expect(host.textContent).toContain('Tone')
    expect(host.textContent).toContain('Casual')
  })

  it('draws a skipped card with and without its questions', () => {
    const output = JSON.stringify({ ok: true, skipped: true })
    render({ name: 'ask_questions', input: OLD_INPUT, output })
    expect(card()?.dataset.status).toBe('skipped')
    expect(host.textContent).toContain('Confirm the scope')
    act(() =>
      root!.render(<AiQuestionReceipt lang="ko" activity={{ name: 'ask_questions', output }} />),
    )
    expect(card()?.dataset.status).toBe('skipped')
    expect(host.textContent).toContain(questionCardText('ko', 'untitled'))
  })

  it('draws only the answers when the input is unreadable', () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    render({ name: 'ask_questions', input: OLD_INPUT.slice(0, 30), output })
    expect(card()?.dataset.content).toBe('answers-only')
    expect(host.textContent).toContain('Casual')
  })

  it('draws nothing for an old error output', () => {
    render({
      name: 'ask_questions',
      input: OLD_INPUT,
      output: JSON.stringify({ ok: false, error: 'title is required' }),
    })
    expect(host.innerHTML).toBe('')
  })
})

describe('AiQuestionReceipt: old ask_clarification shape', () => {
  const output = 'User answers:\nAudience: Teachers\nNow call plan_page with a brief.'

  it('draws an answered card and hides the next-step line meant for the model', () => {
    render({ name: 'ask_clarification', input: CLARIFY_INPUT, output })
    expect(card()?.dataset.status).toBe('submitted')
    expect(host.textContent).toContain('Audience')
    expect(host.textContent).toContain('Teachers')
    expect(host.textContent).not.toContain('plan_page')
  })

  it('shows the answer lines as written when the input is missing', () => {
    render({ name: 'ask_clarification', output })
    expect(card()?.dataset.content).toBe('answers-only')
    expect(host.textContent).toContain('Audience: Teachers')
    expect(host.textContent).not.toContain('plan_page')
  })

  it('draws nothing without an output', () => {
    render({ name: 'ask_clarification', input: CLARIFY_INPUT })
    expect(host.innerHTML).toBe('')
  })
})

describe('AiQuestionReceipt: other tools', () => {
  it('ignores a tool that is not a question tool, even with a question-shaped record', () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    render({ name: 'insert_table', summary: 'Inserted', input: OLD_INPUT, output })
    expect(host.innerHTML).toBe('')
  })
})
