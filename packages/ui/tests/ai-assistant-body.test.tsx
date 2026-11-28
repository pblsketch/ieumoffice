/** @vitest-environment jsdom */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuestionSurfaceView } from '@genoffice/agent-core'
import { AiAssistantBody } from '../src/AiAssistantBody'
import type { QuestionCardSubmission } from '../src/AiQuestionCard'
import { questionAnswerText } from '../src/question-answer-text'
import { questionCardText } from '../src/strings-question-card'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MESSAGE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'deck-scope',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'audience', 'notes'] },
      { id: 'title', component: 'Text', text: '발표 자료 방향' },
      {
        id: 'audience',
        component: 'ChoicePicker',
        label: '누가 듣나요?',
        options: [
          { label: '학부모', value: 'parents' },
          { label: '동료 교사', value: 'teachers' },
        ],
        value: { '@path': '/audience' },
      },
      { id: 'notes', component: 'TextField', label: '그 밖에', value: { '@path': '/notes' } },
    ],
    dataModel: {},
  },
}

const REPLY = `방향을 먼저 정할게요.\n<a2ui-json>${JSON.stringify([MESSAGE])}</a2ui-json>`

const LEGACY_REPLY = `확인할게요.\n<question-form>${JSON.stringify({
  title: '옛 질문',
  questions: [{ id: 'tone', label: '문체', type: 'radio', options: ['격식체', '보고체'] }],
})}</question-form>`

let root: Root | null = null
let host: HTMLDivElement

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

function card(): HTMLElement | null {
  return host.querySelector('[data-testid="ai-question-card"]')
}

function click(el: Element | null | undefined): void {
  act(() => (el as HTMLElement).click())
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('AiAssistantBody question blocks', () => {
  it('draws a live <a2ui-json> block as an answerable card and hands back the answer', () => {
    const onSubmit = vi.fn<(view: QuestionSurfaceView, answer: QuestionCardSubmission) => void>()
    render(<AiAssistantBody lang="ko" text={REPLY} onQuestionSubmit={onSubmit} />)
    expect(host.textContent).toContain('방향을 먼저 정할게요.')
    expect(host.textContent).not.toContain('a2ui-json')
    expect(card()?.dataset.status).toBe('open')
    const parents = [...host.querySelectorAll('[data-input-id="audience"] button')].find(
      (b) => b.textContent === '학부모',
    )
    click(parents)
    click(host.querySelector('.ai-qcard-btn-primary'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [view, answer] = onSubmit.mock.calls[0]!
    expect(view.surfaceId).toBe('deck-scope')
    expect(answer.answers.audience).toEqual(['parents'])
    // the person's follow-up message: readable lines, no JSON
    const follow = questionAnswerText('ko', view, answer)
    expect(follow.split('\n')).toEqual([
      '[발표 자료 방향]',
      '- 누가 듣나요?: 학부모',
      `- 그 밖에: ${questionCardText('ko', 'noAnswer')}`,
    ])
    expect(follow).not.toMatch(/[{}]/)
  })

  it('hands back a skip with the view', () => {
    const onSkip = vi.fn<(view: QuestionSurfaceView) => void>()
    render(<AiAssistantBody lang="ko" text={REPLY} onQuestionSkip={onSkip} />)
    click(host.querySelector('.ai-qcard-btn-secondary'))
    expect(onSkip).toHaveBeenCalledTimes(1)
    const view = onSkip.mock.calls[0]![0]
    expect(questionAnswerText('ko', view, { kind: 'skip' })).toBe(
      `[발표 자료 방향] ${questionCardText('ko', 'answerSkipped')}`,
    )
  })

  it('shows the closed live card with its state and answer', () => {
    render(
      <AiAssistantBody
        lang="ko"
        text={REPLY}
        questionStatus="submitted"
        questionAnswer={{ kind: 'submit', answers: { notes: '짧게' }, decideForMe: ['audience'] }}
      />,
    )
    expect(card()?.dataset.status).toBe('submitted')
    expect(host.querySelector('.ai-qcard-badge')).not.toBeNull()
    expect(host.textContent).toContain(questionCardText('ko', 'decideForMe'))
    expect(host.querySelector('.ai-qcard-btn-primary')).toBeNull()
  })

  it('draws every block of a restored reply as a read-only card with the questions only', () => {
    render(<AiAssistantBody lang="ko" text={REPLY} restored questionStatus="open" />)
    expect(card()?.dataset.content).toBe('questions')
    expect(card()?.dataset.status).toBe('read-only')
    expect(host.querySelector('.ai-qcard-badge')).toBeNull()
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('누가 듣나요?')
  })

  it('draws an old <question-form> block read-only even in the live conversation', () => {
    const onSubmit = vi.fn()
    render(<AiAssistantBody lang="ko" text={LEGACY_REPLY} onQuestionSubmit={onSubmit} />)
    expect(card()?.dataset.content).toBe('questions')
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelector('.ai-qcard-badge')).toBeNull()
    expect(host.textContent).toContain('문체')
    expect(host.textContent).not.toContain('question-form')
  })

  it('shows the pending card while a block streams in, and hides a partial opening tag', () => {
    render(<AiAssistantBody lang="ko" text={'방향을 정할게요.\n<a2ui-'} streaming />)
    expect(host.textContent?.trim()).toBe('방향을 정할게요.')
    expect(host.querySelector('.ai-qcard-pending')).toBeNull()
    act(() =>
      root!.render(
        <AiAssistantBody lang="ko" text={'방향을 정할게요.\n<a2ui-json>[{"vers'} streaming />,
      ),
    )
    expect(host.querySelector('.ai-qcard-pending')?.textContent).toBe(
      questionCardText('ko', 'preparing'),
    )
    expect(host.textContent).not.toContain('a2ui')
    act(() => root!.render(<AiAssistantBody lang="ko" text={REPLY} streaming />))
    expect(host.querySelector('.ai-qcard-pending')).toBeNull()
    expect(card()?.dataset.status).toBe('open')
  })

  it('shows a broken block as plain text', () => {
    render(<AiAssistantBody lang="ko" text={'앞\n<a2ui-json>[oops]</a2ui-json>'} />)
    expect(card()).toBeNull()
    expect(host.textContent).toContain('<a2ui-json>[oops]</a2ui-json>')
  })

  it('draws model text as plain text in the card', () => {
    const message = JSON.parse(JSON.stringify(MESSAGE)) as typeof MESSAGE
    message.createSurface.components[1] = { id: 'title', component: 'Text', text: '<b>굵게</b>' }
    render(
      <AiAssistantBody lang="ko" text={`<a2ui-json>${JSON.stringify([message])}</a2ui-json>`} />,
    )
    expect(host.querySelector('.ai-qcard-title')?.textContent).toBe('<b>굵게</b>')
    expect(host.querySelector('.ai-qcard-title b')).toBeNull()
  })
})
