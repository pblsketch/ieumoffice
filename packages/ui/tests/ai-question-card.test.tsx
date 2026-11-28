// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type { QuestionInput, QuestionSurfaceView } from '@genoffice/agent-core'
import { AiQuestionCard, AiQuestionCardReadOnly } from '../src/AiQuestionCard'
import { QUESTION_CARD_STRINGS, questionCardText } from '../src/strings-question-card'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AUDIENCE: QuestionInput = {
  kind: 'ChoicePicker',
  id: 'audience',
  label: '누가 듣나요?',
  description: '한 가지만 고르세요',
  required: true,
  variant: 'mutuallyExclusive',
  options: [
    { label: '학부모', value: 'parents' },
    { label: '동료 교사', value: 'teachers' },
  ],
  initial: [],
}

const TOPICS: QuestionInput = {
  kind: 'ChoicePicker',
  id: 'topics',
  label: '다룰 것',
  required: false,
  variant: 'multipleSelection',
  options: [
    { label: '일정', value: 'schedule' },
    { label: '예산', value: 'budget' },
    { label: '<b>위험</b>', value: 'risk' },
  ],
  initial: ['schedule'],
}

const VIEW: QuestionSurfaceView = {
  surfaceId: 'deck-scope',
  title: '발표 자료 방향',
  description: '세 가지만 정해 주세요',
  footer: '나머지는 AI가 정합니다',
  inputs: [
    AUDIENCE,
    TOPICS,
    { kind: 'CheckBox', id: 'photos', label: '사진 넣기', required: true, initial: false },
    {
      kind: 'TextField',
      id: 'count',
      label: '참석 인원',
      required: false,
      variant: 'number',
      placeholder: '숫자',
      initial: '',
    },
    {
      kind: 'TextField',
      id: 'notes',
      label: '그 밖에',
      required: false,
      variant: 'longText',
      initial: '',
    },
    {
      kind: 'Slider',
      id: 'length',
      label: '장 수',
      required: false,
      min: 5,
      max: 20,
      steps: 15,
      initial: 10,
    },
  ],
}

let root: Root | null = null
let host: HTMLDivElement

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

function field(id: string): HTMLElement {
  return host.querySelector(`[data-input-id="${id}"]`) as HTMLElement
}

function option(id: string, label: string): HTMLButtonElement {
  const buttons = [...field(id).querySelectorAll('button')]
  return buttons.find((b) => b.textContent === label) as HTMLButtonElement
}

function decideButton(id: string): HTMLButtonElement {
  return field(id).querySelector('[data-decide-for-me]') as HTMLButtonElement
}

function sendButton(): HTMLButtonElement {
  return host.querySelector('.ai-qcard-btn-primary') as HTMLButtonElement
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  act(() => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(el: HTMLElement): void {
  act(() => el.click())
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('AiQuestionCard (open)', () => {
  it('lays out title, description, inputs, footer and the two app buttons top to bottom', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    const card = host.querySelector('[data-testid="ai-question-card"]') as HTMLElement
    expect(card.dataset.status).toBe('open')
    expect(card.querySelector('.ai-qcard-title')?.textContent).toBe('발표 자료 방향')
    expect(card.querySelector('.ai-qcard-desc')?.textContent).toBe('세 가지만 정해 주세요')
    expect(card.querySelector('.ai-qcard-footer')?.textContent).toBe('나머지는 AI가 정합니다')
    expect(field('audience').querySelector('.ai-qcard-field-desc')?.textContent).toBe(
      '한 가지만 고르세요',
    )
    const order = [...card.children].map((el) => el.className.split(' ')[0])
    expect(order.indexOf('ai-qcard-desc')).toBeLessThan(order.indexOf('ai-qcard-field'))
    expect(order.indexOf('ai-qcard-footer')).toBeGreaterThan(order.lastIndexOf('ai-qcard-field'))
    expect(order[order.length - 1]).toBe('ai-qcard-actions')
    const buttons = [...card.querySelectorAll('.ai-qcard-actions button')].map((b) => b.textContent)
    expect(buttons).toEqual([questionCardText('ko', 'send'), questionCardText('ko', 'skipLetAi')])
  })

  it('adds a decide-for-me choice at the end of every ChoicePicker only', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    for (const id of ['audience', 'topics']) {
      const buttons = [...field(id).querySelectorAll('button')]
      expect(buttons[buttons.length - 1]?.textContent).toBe(questionCardText('ko', 'decideForMe'))
    }
    for (const id of ['photos', 'count', 'notes', 'length']) {
      expect(field(id).querySelector('[data-decide-for-me]')).toBeNull()
    }
  })

  it('picks one for mutuallyExclusive and many for multipleSelection', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    click(option('audience', '학부모'))
    click(option('audience', '동료 교사'))
    expect(option('audience', '학부모').getAttribute('aria-checked')).toBe('false')
    expect(option('audience', '동료 교사').getAttribute('aria-checked')).toBe('true')
    expect(option('audience', '동료 교사').getAttribute('role')).toBe('radio')

    expect(option('topics', '일정').getAttribute('aria-checked')).toBe('true')
    click(option('topics', '예산'))
    expect(option('topics', '일정').getAttribute('aria-checked')).toBe('true')
    expect(option('topics', '예산').getAttribute('aria-checked')).toBe('true')
    click(option('topics', '일정'))
    expect(option('topics', '일정').getAttribute('aria-checked')).toBe('false')
    expect(option('topics', '예산').getAttribute('role')).toBe('checkbox')
  })

  it('keeps decide-for-me exclusive with the other options', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    click(decideButton('topics'))
    expect(decideButton('topics').getAttribute('aria-checked')).toBe('true')
    expect(option('topics', '일정').getAttribute('aria-checked')).toBe('false')
    click(option('topics', '예산'))
    expect(decideButton('topics').getAttribute('aria-checked')).toBe('false')
    expect(option('topics', '예산').getAttribute('aria-checked')).toBe('true')
  })

  it('locks Send while a required input is empty; decide-for-me unlocks it; CheckBox false is not empty', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    expect(sendButton().disabled).toBe(true)
    click(decideButton('audience'))
    // photos is required but false is an answer
    expect(sendButton().disabled).toBe(false)
    click(option('audience', '학부모'))
    expect(sendButton().disabled).toBe(false)
  })

  it('locks Send for a required empty TextField', () => {
    const view: QuestionSurfaceView = {
      surfaceId: 's',
      inputs: [
        {
          kind: 'TextField',
          id: 'name',
          label: '이름',
          required: true,
          variant: 'shortText',
          initial: '',
        },
        {
          kind: 'Slider',
          id: 'n',
          label: 'n',
          required: true,
          min: 0,
          max: 3,
          initial: 0,
        },
      ],
    }
    render(<AiQuestionCard view={view} status="open" lang="en" />)
    expect(sendButton().disabled).toBe(true)
    typeInto(field('name').querySelector('input') as HTMLInputElement, '진')
    expect(sendButton().disabled).toBe(false)
  })

  it('accepts only numbers in a number TextField, uses a textarea for longText, and keeps Slider steps', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    const count = field('count').querySelector('input') as HTMLInputElement
    expect(count.placeholder).toBe('숫자')
    typeInto(count, '12')
    typeInto(count, '12a')
    expect(count.value).toBe('12')
    expect(field('notes').querySelector('textarea')).not.toBeNull()
    const range = field('length').querySelector('input[type="range"]') as HTMLInputElement
    expect(range.min).toBe('5')
    expect(range.max).toBe('20')
    expect(range.step).toBe('1')
    expect(range.value).toBe('10')
  })

  it('sends a number field holding only a sign or a point as empty', () => {
    const onSubmit = vi.fn()
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" onSubmit={onSubmit} />)
    click(option('audience', '학부모'))
    click(option('topics', '예산'))
    typeInto(field('count').querySelector('input') as HTMLInputElement, '-')
    click(sendButton())
    expect(onSubmit.mock.calls[0]?.[0].answers.count).toBe('')
  })

  it('submits answers for every input not left to the AI, decideForMe in screen order', () => {
    const onSubmit = vi.fn()
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" onSubmit={onSubmit} />)
    click(decideButton('audience'))
    click(option('topics', '예산'))
    click(field('photos').querySelector('input') as HTMLInputElement)
    typeInto(field('count').querySelector('input') as HTMLInputElement, '30')
    typeInto(field('notes').querySelector('textarea') as HTMLTextAreaElement, '짧게')
    const range = field('length').querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(range, '12')
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(sendButton())
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'submit',
      answers: {
        topics: ['schedule', 'budget'],
        photos: true,
        count: '30',
        notes: '짧게',
        length: 12,
      },
      decideForMe: ['audience'],
    })
  })

  it('calls onSkip from the skip button', () => {
    const onSkip = vi.fn()
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" onSkip={onSkip} />)
    click(host.querySelector('.ai-qcard-btn-secondary') as HTMLButtonElement)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('draws model text as plain text with dir="auto"', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    expect(host.querySelector('b')).toBeNull()
    expect(host.textContent).toContain('<b>위험</b>')
    for (const text of [
      '발표 자료 방향',
      '누가 듣나요?',
      '<b>위험</b>',
      '나머지는 AI가 정합니다',
    ]) {
      const el = [...host.querySelectorAll('*')].find(
        (e) => e.textContent === text && e.children.length === 0,
      )
      expect(el?.getAttribute('dir'), text).toBe('auto')
    }
  })

  it('starts over when a new view arrives', () => {
    render(<AiQuestionCard view={VIEW} status="open" lang="ko" />)
    click(option('audience', '학부모'))
    const next: QuestionSurfaceView = { ...VIEW, surfaceId: 'other' }
    act(() => root!.render(<AiQuestionCard view={next} status="open" lang="ko" />))
    expect(option('audience', '학부모').getAttribute('aria-checked')).toBe('false')
  })
})

describe('AiQuestionCard (closed states)', () => {
  it('has no buttons and shows the chosen answers once submitted', () => {
    render(
      <AiQuestionCard
        view={VIEW}
        status="submitted"
        lang="ko"
        answer={{
          kind: 'submit',
          answers: { topics: ['budget'], photos: true, count: '', notes: '', length: 7 },
          decideForMe: ['audience'],
        }}
      />,
    )
    const card = host.querySelector('[data-testid="ai-question-card"]') as HTMLElement
    expect(card.dataset.status).toBe('submitted')
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelector('input, textarea')).toBeNull()
    expect(host.textContent).toContain(questionCardText('ko', 'statusSubmitted'))
    expect(host.textContent).toContain('예산')
    expect(host.textContent).toContain(questionCardText('ko', 'decideForMe'))
    expect(host.textContent).toContain(questionCardText('ko', 'yes'))
  })

  it('shows the skipped and superseded badges without buttons', () => {
    render(<AiQuestionCard view={VIEW} status="skipped" lang="ko" />)
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain(questionCardText('ko', 'statusSkipped'))
    act(() => root!.render(<AiQuestionCard view={VIEW} status="superseded" lang="ko" />))
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain(questionCardText('ko', 'statusSuperseded'))
    expect(
      (host.querySelector('[data-testid="ai-question-card"]') as HTMLElement).dataset.status,
    ).toBe('superseded')
  })
})

describe('AiQuestionCardReadOnly', () => {
  it('draws an answered record with each question and its answer', () => {
    render(
      <AiQuestionCardReadOnly
        lang="ko"
        content={{
          kind: 'answered',
          view: VIEW,
          answers: {
            audience: { kind: 'value', value: ['parents'] },
            notes: { kind: 'text', text: '예전 글 답' },
          },
        }}
      />,
    )
    const card = host.querySelector('[data-testid="ai-question-card"]') as HTMLElement
    expect(card.dataset.status).toBe('submitted')
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('학부모')
    expect(host.textContent).toContain('예전 글 답')
    expect(host.textContent).toContain(questionCardText('ko', 'noAnswer'))
  })

  it('draws a skipped record with or without its questions', () => {
    render(<AiQuestionCardReadOnly lang="ko" content={{ kind: 'skipped' }} />)
    expect(host.textContent).toContain(questionCardText('ko', 'statusSkipped'))
    expect(host.textContent).toContain(questionCardText('ko', 'untitled'))
    act(() =>
      root!.render(<AiQuestionCardReadOnly lang="ko" content={{ kind: 'skipped', view: VIEW }} />),
    )
    expect(host.textContent).toContain('누가 듣나요?')
  })

  it('draws answers left without their questions', () => {
    render(
      <AiQuestionCardReadOnly
        lang="ko"
        content={{
          kind: 'answers-only',
          lines: [
            { answer: { kind: 'text', text: '대상: 학부모' } },
            { id: 'length', answer: { kind: 'value', value: 12 } },
            { id: 'audience', answer: { kind: 'decideForMe' } },
          ],
        }}
      />,
    )
    expect(host.textContent).toContain(questionCardText('ko', 'answersOnlyTitle'))
    expect(host.textContent).toContain(questionCardText('ko', 'answersOnlyNote'))
    expect(host.textContent).toContain('대상: 학부모')
    expect(host.textContent).toContain('12')
    expect(host.textContent).toContain(questionCardText('ko', 'decideForMe'))
  })

  it('draws questions only, with no state badge, for a reopened text block', () => {
    render(<AiQuestionCardReadOnly lang="ko" content={{ kind: 'questions', view: VIEW }} />)
    expect(host.querySelector('.ai-qcard-badge')).toBeNull()
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('누가 듣나요?')
    expect(host.textContent).toContain('학부모')
  })
})

describe('question card strings', () => {
  const NON_LATIN = new Set(['zh', 'zh-TW', 'ja', 'ko', 'th', 'ru', 'ar', 'he', 'hi'])

  it('fills every key in every language with real translations', () => {
    const keys = Object.keys(QUESTION_CARD_STRINGS.zh) as (keyof typeof QUESTION_CARD_STRINGS.zh)[]
    for (const key of [
      'send',
      'skipLetAi',
      'decideForMe',
      'statusSubmitted',
      'statusSkipped',
      'statusSuperseded',
      'answersOnlyTitle',
      'answersOnlyNote',
      'untitled',
      'yes',
      'no',
      'noAnswer',
      'answerSkipped',
      'preparing',
    ]) {
      expect(keys).toContain(key)
    }
    for (const lang of LANGS) {
      expect(Object.keys(QUESTION_CARD_STRINGS[lang]).sort(), lang).toEqual([...keys].sort())
      for (const key of keys) {
        const text = questionCardText(lang, key)
        expect(text, `${lang}.${key}`).toBeTruthy()
        if (NON_LATIN.has(lang)) {
          expect(text, `${lang}.${key}`).not.toBe(questionCardText('en', key))
        }
      }
      if (lang !== 'en') expect(questionCardText(lang, 'send'), lang).not.toBe('Send')
    }
  })

  it('drops the old custom-input and max-selection strings', () => {
    const keys = Object.keys(QUESTION_CARD_STRINGS.zh)
    for (const old of ['customPlaceholder', 'maxSelectionsHint', 'selectPlaceholder']) {
      expect(keys).not.toContain(old)
    }
  })
})
