import { describe, expect, it } from 'vitest'
import type { QuestionRecord, QuestionSurfaceView } from '@genoffice/agent-core'
import {
  questionAnswerText,
  questionAnswerValueText,
  questionCardTitleText,
  questionRecordText,
  recordedAnswerText,
} from '../src/question-answer-text'
import { questionCardText } from '../src/strings-question-card'

const VIEW: QuestionSurfaceView = {
  surfaceId: 'deck-scope',
  title: '발표 자료 방향',
  inputs: [
    {
      kind: 'ChoicePicker',
      id: 'audience',
      label: '누가 듣나요?',
      required: true,
      variant: 'multipleSelection',
      options: [
        { label: '학부모', value: 'parents' },
        { label: '동료 교사', value: 'teachers' },
      ],
      initial: [],
    },
    { kind: 'CheckBox', id: 'photos', label: '사진 넣기', required: false, initial: false },
    {
      kind: 'TextField',
      id: 'notes',
      label: '그 밖에',
      required: false,
      variant: 'longText',
      initial: '',
    },
    { kind: 'Slider', id: 'length', label: '장 수', required: false, min: 5, max: 20, initial: 10 },
  ],
}

describe('question answer text (spec 3.4)', () => {
  it('writes the title line and one "label: answer" line per input', () => {
    const text = questionAnswerText('ko', VIEW, {
      kind: 'submit',
      answers: { audience: ['parents', 'teachers'], photos: true, notes: '사진 많이', length: 12 },
      decideForMe: [],
    })
    expect(text.split('\n')).toEqual([
      '[발표 자료 방향]',
      '- 누가 듣나요?: 학부모, 동료 교사',
      '- 사진 넣기: 예',
      '- 그 밖에: 사진 많이',
      '- 장 수: 12',
    ])
  })

  it('uses the no-answer word for empty values and "no" for an unchecked box', () => {
    const text = questionAnswerText('en', VIEW, {
      kind: 'submit',
      answers: { audience: [], photos: false, notes: '  ', length: 5 },
      decideForMe: [],
    })
    expect(text).toContain(`- 누가 듣나요?: ${questionCardText('en', 'noAnswer')}`)
    expect(text).toContain(`- 사진 넣기: ${questionCardText('en', 'no')}`)
    expect(text).toContain(`- 그 밖에: ${questionCardText('en', 'noAnswer')}`)
    expect(text).toContain('- 장 수: 5')
  })

  it('writes the decide-for-me phrase for an input left to the AI', () => {
    const text = questionAnswerText('ko', VIEW, {
      kind: 'submit',
      answers: { photos: true, notes: '', length: 10 },
      decideForMe: ['audience'],
    })
    expect(text).toContain(`- 누가 듣나요?: ${questionCardText('ko', 'decideForMe')}`)
  })

  it('writes the skipped line after the title', () => {
    expect(questionAnswerText('ko', VIEW, { kind: 'skip' })).toBe(
      `[발표 자료 방향] ${questionCardText('ko', 'answerSkipped')}`,
    )
  })

  it('falls back to the untitled heading when the card has no title', () => {
    const view: QuestionSurfaceView = { ...VIEW, title: undefined } as QuestionSurfaceView
    expect(questionCardTitleText('ja', view)).toBe(questionCardText('ja', 'untitled'))
    expect(questionCardTitleText('ja', undefined)).toBe(questionCardText('ja', 'untitled'))
  })

  it('maps choice values to labels and keeps unknown values as written', () => {
    const picker = VIEW.inputs[0]!
    expect(questionAnswerValueText('ko', picker, ['teachers', 'other'])).toBe('동료 교사, other')
    expect(questionAnswerValueText('ko', undefined, ['a', 'b'])).toBe('a, b')
    expect(questionAnswerValueText('ko', undefined, true)).toBe('예')
    expect(questionAnswerValueText('ko', undefined, 3)).toBe('3')
    expect(questionAnswerValueText('ko', undefined, undefined)).toBe('(답 없음)')
  })

  it('writes recorded answers: value, decide-for-me, verbatim text, missing', () => {
    const picker = VIEW.inputs[0]!
    expect(recordedAnswerText('ko', picker, { kind: 'value', value: ['parents'] })).toBe('학부모')
    expect(recordedAnswerText('ko', picker, { kind: 'decideForMe' })).toBe('알아서 정해 줘')
    expect(recordedAnswerText('ko', picker, { kind: 'text', text: '아무나' })).toBe('아무나')
    expect(recordedAnswerText('ko', picker, undefined)).toBe('(답 없음)')
  })

  it('writes a stored record: answered, skipped, answers-only, nothing', () => {
    const answered: QuestionRecord = {
      kind: 'answered',
      shape: 'a2ui',
      view: VIEW,
      answers: { audience: { kind: 'decideForMe' }, length: { kind: 'value', value: 8 } },
    }
    expect(questionRecordText('ko', answered).split('\n')).toEqual([
      '[발표 자료 방향]',
      '- 누가 듣나요?: 알아서 정해 줘',
      '- 사진 넣기: (답 없음)',
      '- 그 밖에: (답 없음)',
      '- 장 수: 8',
    ])
    expect(questionRecordText('ko', { kind: 'skipped', shape: 'a2ui' })).toBe(
      `[AI의 질문] ${questionCardText('ko', 'answerSkipped')}`,
    )
    expect(
      questionRecordText('ko', {
        kind: 'answers-only',
        shape: 'ask_clarification',
        lines: [
          { answer: { kind: 'text', text: '대상: 학부모' } },
          { id: 'length', answer: { kind: 'value', value: 12 } },
        ],
      }).split('\n'),
    ).toEqual(['[남은 답]', '- 대상: 학부모', '- length: 12'])
    expect(questionRecordText('ko', { kind: 'nothing' })).toBe('')
  })
})
