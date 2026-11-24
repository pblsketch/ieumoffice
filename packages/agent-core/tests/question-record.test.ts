import { describe, expect, it } from 'vitest'
import { skipAction, submitAction, validateQuestionSurface } from '../src/a2ui-question-card'
import { parseQuestionAction, readQuestionRecord } from '../src/question-record'
import { specExample } from './question-card-fixtures'

const now = new Date('2026-11-24T09:00:00.000Z')
const STORE_FIELD_MAX = 16_000

function specView() {
  const result = validateQuestionSurface(specExample())
  if (!result.ok) throw new Error('spec example must be valid')
  return result.view
}

describe('readQuestionRecord: new A2UI shape', () => {
  const input = JSON.stringify(specExample())

  it('reads an answered card with its answers and decide-for-me', () => {
    const output = JSON.stringify(
      submitAction(specView(), { length: 12, notes: '사진을 많이' }, ['audience'], now),
    )
    const record = readQuestionRecord({ name: 'ask_questions', input, output })
    expect(record).toEqual({
      kind: 'answered',
      shape: 'a2ui',
      view: specView(),
      answers: {
        audience: { kind: 'decideForMe' },
        length: { kind: 'value', value: 12 },
        notes: { kind: 'value', value: '사진을 많이' },
      },
    })
  })

  it('reads a skipped card', () => {
    const output = JSON.stringify(skipAction(specView(), now))
    expect(readQuestionRecord({ name: 'ask_questions', input, output })).toEqual({
      kind: 'skipped',
      shape: 'a2ui',
      view: specView(),
    })
  })

  it('shows only the answers when the input was cut by the store', () => {
    const big = specExample()
    ;(big.createSurface as Record<string, unknown>).components = [
      ...((big.createSurface as Record<string, unknown>).components as unknown[]),
    ]
    const padded = JSON.stringify(big).replace('발표 자료 방향을 정해 주세요', 'x'.repeat(20_000))
    const output = JSON.stringify(
      submitAction(specView(), { audience: ['parents'], length: 7 }, [], now),
    )
    const record = readQuestionRecord({
      name: 'ask_questions',
      input: padded.slice(0, STORE_FIELD_MAX),
      output,
    })
    expect(record).toEqual({
      kind: 'answers-only',
      shape: 'a2ui',
      lines: [
        { id: 'audience', answer: { kind: 'value', value: ['parents'] } },
        { id: 'length', answer: { kind: 'value', value: 7 } },
        { id: 'notes', answer: { kind: 'value', value: '' } },
      ],
    })
  })

  it('shows decide-for-me lines when only the answers are left', () => {
    const output = JSON.stringify(submitAction(specView(), {}, ['audience'], now))
    const record = readQuestionRecord({ name: 'ask_questions', output })
    expect(record).toMatchObject({
      kind: 'answers-only',
      shape: 'a2ui',
      lines: expect.arrayContaining([{ id: 'audience', answer: { kind: 'decideForMe' } }]),
    })
  })

  it('reads a skip without input as a skipped record without questions', () => {
    const output = JSON.stringify(skipAction(specView(), now))
    expect(readQuestionRecord({ name: 'ask_questions', input: '{"version":"1.', output })).toEqual({
      kind: 'skipped',
      shape: 'a2ui',
    })
  })

  it('draws nothing for format errors, missing output or error results', () => {
    expect(
      readQuestionRecord({
        name: 'ask_questions',
        input,
        output: 'components[2].value: must be {"@path":"/audience"}',
        isError: true,
      }),
    ).toEqual({ kind: 'nothing' })
    expect(readQuestionRecord({ name: 'ask_questions', input })).toEqual({ kind: 'nothing' })
    expect(
      readQuestionRecord({
        name: 'ask_questions',
        input,
        output: JSON.stringify(submitAction(specView(), {}, [], now)),
        isError: true,
      }),
    ).toEqual({ kind: 'nothing' })
  })

  it('reads a double-encoded input', () => {
    const output = JSON.stringify(skipAction(specView(), now))
    expect(
      readQuestionRecord({ name: 'ask_questions', input: JSON.stringify(input), output }),
    ).toMatchObject({ kind: 'skipped', shape: 'a2ui', view: { surfaceId: 'deck-scope' } })
  })
})

describe('readQuestionRecord: old ask_questions shape', () => {
  const oldInput = JSON.stringify({
    id: 'scope',
    title: 'Confirm the scope',
    description: 'Two questions',
    questions: [
      { id: 'tone', label: 'Tone', type: 'radio', options: ['Formal', 'Casual'] },
      {
        id: 'parts',
        label: 'Parts',
        type: 'checkbox',
        options: [
          { label: 'Intro', value: 'intro' },
          { label: 'Summary', value: 'summary' },
        ],
        default: ['intro'],
        required: true,
      },
      { id: 'size', label: 'Size', type: 'select', options: ['S', 'M'] },
      { label: 'Notes', type: 'text', description: 'Anything else' },
    ],
  })

  it('reads the old card and its answers', () => {
    const output = JSON.stringify({
      ok: true,
      submitted: true,
      answers: { tone: 'Casual', parts: ['intro', 'summary'], q4: 'More photos' },
    })
    const record = readQuestionRecord({ name: 'ask_questions', input: oldInput, output })
    expect(record).toEqual({
      kind: 'answered',
      shape: 'ask_questions',
      view: {
        surfaceId: 'scope',
        title: 'Confirm the scope',
        description: 'Two questions',
        inputs: [
          {
            kind: 'ChoicePicker',
            id: 'tone',
            label: 'Tone',
            required: false,
            variant: 'mutuallyExclusive',
            options: [
              { label: 'Formal', value: 'Formal' },
              { label: 'Casual', value: 'Casual' },
            ],
            initial: [],
          },
          {
            kind: 'ChoicePicker',
            id: 'parts',
            label: 'Parts',
            required: true,
            variant: 'multipleSelection',
            options: [
              { label: 'Intro', value: 'intro' },
              { label: 'Summary', value: 'summary' },
            ],
            initial: ['intro'],
          },
          {
            kind: 'ChoicePicker',
            id: 'size',
            label: 'Size',
            required: false,
            variant: 'mutuallyExclusive',
            options: [
              { label: 'S', value: 'S' },
              { label: 'M', value: 'M' },
            ],
            initial: [],
          },
          {
            kind: 'TextField',
            id: 'q4',
            label: 'Notes',
            description: 'Anything else',
            required: false,
            variant: 'shortText',
            initial: '',
          },
        ],
      },
      answers: {
        tone: { kind: 'value', value: ['Casual'] },
        parts: { kind: 'value', value: ['intro', 'summary'] },
        q4: { kind: 'value', value: 'More photos' },
      },
    })
  })

  it('reads an old skip', () => {
    const record = readQuestionRecord({
      name: 'ask_questions',
      input: oldInput,
      output: JSON.stringify({ ok: true, skipped: true }),
    })
    expect(record).toMatchObject({ kind: 'skipped', shape: 'ask_questions' })
    expect(record.kind === 'skipped' && record.view?.title).toBe('Confirm the scope')
  })

  it('shows only the old answers when the input is unreadable', () => {
    const output = JSON.stringify({ ok: true, submitted: true, answers: { tone: 'Casual' } })
    expect(
      readQuestionRecord({ name: 'ask_questions', input: oldInput.slice(0, 30), output }),
    ).toEqual({
      kind: 'answers-only',
      shape: 'ask_questions',
      lines: [{ id: 'tone', answer: { kind: 'value', value: 'Casual' } }],
    })
    expect(
      readQuestionRecord({
        name: 'ask_questions',
        output: JSON.stringify({ ok: true, skipped: true }),
      }),
    ).toEqual({ kind: 'skipped', shape: 'ask_questions' })
  })

  it('draws nothing for old errors', () => {
    expect(
      readQuestionRecord({
        name: 'ask_questions',
        input: oldInput,
        output: JSON.stringify({ ok: false, error: 'title is required' }),
      }),
    ).toEqual({ kind: 'nothing' })
    expect(
      readQuestionRecord({
        name: 'ask_questions',
        input: oldInput,
        output: JSON.stringify({ ok: false, message: 'Already asked once in this turn' }),
      }),
    ).toEqual({ kind: 'nothing' })
  })
})

describe('readQuestionRecord: old ask_clarification shape', () => {
  const clarifyInput = JSON.stringify({
    questions: [
      { id: 'aud', label: 'Audience', options: ['Parents', 'Teachers'] },
      {
        id: 'focus',
        label: 'Focus',
        description: 'Pick any',
        options: ['Data', 'Story'],
        multi: true,
      },
      { id: 'tone', label: 'Tone', options: ['Warm', 'Plain'] },
    ],
  })

  it('reads the HTML output and drops the next-step line meant for the model', () => {
    const output =
      'User answers:\nAudience: Teachers\nFocus: Data、Story\nTone: Let the AI decide\nNow call plan_page with a brief that follows these choices.'
    const record = readQuestionRecord({ name: 'ask_clarification', input: clarifyInput, output })
    expect(record).toEqual({
      kind: 'answered',
      shape: 'ask_clarification',
      view: {
        surfaceId: 'ask_clarification',
        inputs: [
          {
            kind: 'ChoicePicker',
            id: 'aud',
            label: 'Audience',
            required: false,
            variant: 'mutuallyExclusive',
            options: [
              { label: 'Parents', value: 'Parents' },
              { label: 'Teachers', value: 'Teachers' },
            ],
            initial: [],
          },
          {
            kind: 'ChoicePicker',
            id: 'focus',
            label: 'Focus',
            description: 'Pick any',
            required: false,
            variant: 'multipleSelection',
            options: [
              { label: 'Data', value: 'Data' },
              { label: 'Story', value: 'Story' },
            ],
            initial: [],
          },
          {
            kind: 'ChoicePicker',
            id: 'tone',
            label: 'Tone',
            required: false,
            variant: 'mutuallyExclusive',
            options: [
              { label: 'Warm', value: 'Warm' },
              { label: 'Plain', value: 'Plain' },
            ],
            initial: [],
          },
        ],
      },
      answers: {
        aud: { kind: 'value', value: ['Teachers'] },
        focus: { kind: 'value', value: ['Data', 'Story'] },
        tone: { kind: 'text', text: 'Let the AI decide' },
      },
    })
  })

  it('reads the slides output and drops its next-step line', () => {
    const output =
      'User questionnaire answers:\nAudience: Parents\nDecide the Core Hook and style accordingly, then generate with generate_deck.'
    const record = readQuestionRecord({ name: 'ask_clarification', input: clarifyInput, output })
    expect(record).toMatchObject({
      kind: 'answered',
      answers: { aud: { kind: 'value', value: ['Parents'] } },
    })
    if (record.kind === 'answered') expect(Object.keys(record.answers)).toEqual(['aud'])
  })

  it('shows the answer lines as they are when the input is missing', () => {
    const output =
      'User answers:\nAudience: Teachers\nFocus: Data、Story\nNow call plan_page with a brief that follows these choices.'
    expect(readQuestionRecord({ name: 'ask_clarification', output })).toEqual({
      kind: 'answers-only',
      shape: 'ask_clarification',
      lines: [
        { answer: { kind: 'text', text: 'Audience: Teachers' } },
        { answer: { kind: 'text', text: 'Focus: Data、Story' } },
      ],
    })
  })

  it('reads both skip texts', () => {
    for (const output of [
      'The user skipped the questionnaire. Decide the core hook and style yourself, then call plan_page.',
      'The user skipped the questionnaire. Decide the Core Hook and style yourself based on professional judgment and generate directly.',
    ]) {
      expect(
        readQuestionRecord({ name: 'ask_clarification', input: clarifyInput, output }),
      ).toMatchObject({
        kind: 'skipped',
        shape: 'ask_clarification',
        view: { inputs: expect.any(Array) },
      })
      expect(readQuestionRecord({ name: 'ask_clarification', output })).toEqual({
        kind: 'skipped',
        shape: 'ask_clarification',
      })
    }
  })

  it('draws nothing for error texts and empty answers', () => {
    for (const output of [
      'questions must be non-empty and every question needs options',
      'questionnaire cards are not available here; decide sensible defaults and continue',
      'User answers:\nNow call plan_page with a brief that follows these choices.',
      '',
    ]) {
      expect(
        readQuestionRecord({ name: 'ask_clarification', input: clarifyInput, output }),
      ).toEqual({
        kind: 'nothing',
      })
    }
  })

  it('keeps a multi-line free-text answer with its question', () => {
    const output = 'User answers:\nAudience: Teachers\nTone: Warm but\nnot too casual'
    const record = readQuestionRecord({ name: 'ask_clarification', input: clarifyInput, output })
    expect(record).toMatchObject({
      kind: 'answered',
      answers: { tone: { kind: 'text', text: 'Warm but\nnot too casual' } },
    })
  })
})

describe('readQuestionRecord: anything else', () => {
  it('draws nothing for other tools and for garbage', () => {
    expect(readQuestionRecord({ name: 'apply_ops', input: '{}', output: '{}' })).toEqual({
      kind: 'nothing',
    })
    const odd: unknown[] = [undefined, null, 1, 'x', [], {}, { name: 1 }]
    for (const raw of odd) {
      expect(readQuestionRecord(raw as never)).toEqual({ kind: 'nothing' })
    }
    expect(
      readQuestionRecord({ name: 'ask_questions', input: 'not json', output: 'nope' }),
    ).toEqual({ kind: 'nothing' })
    expect(readQuestionRecord({ name: 'ask_questions', output: '{"version":"1.0","act' })).toEqual({
      kind: 'nothing',
    })
  })
})

describe('parseQuestionAction', () => {
  it('reads submit and skip messages from text or objects', () => {
    const submit = submitAction(specView(), { notes: 'hi' }, ['audience'], now)
    expect(parseQuestionAction(JSON.stringify(submit))).toEqual({
      kind: 'submit',
      answers: { length: 10, notes: 'hi' },
      decideForMe: ['audience'],
    })
    expect(parseQuestionAction(skipAction(specView(), now))).toEqual({ kind: 'skip' })
  })

  it('returns null for anything that is not a question action', () => {
    for (const raw of [
      undefined,
      '',
      '{',
      '{"ok":true,"skipped":true}',
      { version: '1.0', action: { name: 'other' } },
      { version: '2.0', action: { name: 'skip' } },
      { version: '1.0', action: { name: 'submit', context: { answers: 3 } } },
    ]) {
      expect(parseQuestionAction(raw)).toBeNull()
    }
  })
})
