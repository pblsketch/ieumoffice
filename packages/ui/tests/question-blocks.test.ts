import { describe, expect, it } from 'vitest'
import {
  parseQuestionBlocks,
  questionFormView,
  validateQuestionFormSpec,
  type QuestionBlockSegment,
} from '../src/question-blocks'

const MESSAGE = {
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
      { id: 'notes', component: 'TextField', label: '그 밖에', value: { '@path': '/notes' } },
    ],
    dataModel: { audience: [], notes: '' },
  },
}

const BLOCK = `<a2ui-json>${JSON.stringify([MESSAGE])}</a2ui-json>`

const OTHER_MESSAGE = {
  ...MESSAGE,
  createSurface: {
    ...MESSAGE.createSurface,
    surfaceId: 'second',
    components: [
      { id: 'root', component: 'Column', children: ['ok'] },
      { id: 'ok', component: 'CheckBox', label: '괜찮나요?', value: { '@path': '/ok' } },
    ],
    dataModel: {},
  },
}
const SECOND_BLOCK = `<a2ui-json>${JSON.stringify([OTHER_MESSAGE])}</a2ui-json>`

const LEGACY_JSON = JSON.stringify({
  id: 'brief-1',
  title: '문서 방향 확인',
  questions: [
    {
      id: 'tone',
      label: '문체',
      type: 'radio',
      options: ['격식체', '부드러운 보고체'],
      default: '격식체',
      required: true,
    },
    { id: 'topics', label: '강조할 항목', type: 'checkbox', options: ['일정', '예산'] },
    { id: 'memo', label: '메모', type: 'text' },
  ],
})
const LEGACY_BLOCK = `<question-form>${LEGACY_JSON}</question-form>`

function kinds(segments: readonly QuestionBlockSegment[]): string[] {
  return segments.map((s) => (s.kind === 'card' ? `card:${s.format}` : s.kind))
}

function cardOf(segments: readonly QuestionBlockSegment[]) {
  const card = segments.find((s) => s.kind === 'card')
  if (!card || card.kind !== 'card') throw new Error('no card')
  return card
}

describe('parseQuestionBlocks: <a2ui-json> blocks (spec 3.4)', () => {
  it('turns a complete block into a card checked by the shared validator', () => {
    const segs = parseQuestionBlocks(`먼저 확인할게요.\n${BLOCK}\n그다음 만들게요.`)
    expect(kinds(segs)).toEqual(['text', 'card:a2ui', 'text'])
    expect(segs[0]).toEqual({ kind: 'text', text: '먼저 확인할게요.\n' })
    expect(segs[2]).toEqual({ kind: 'text', text: '\n그다음 만들게요.' })
    const card = cardOf(segs)
    expect(card.view.surfaceId).toBe('deck-scope')
    expect(card.view.title).toBe('발표 자료 방향을 정해 주세요')
    expect(card.view.inputs.map((i) => i.id)).toEqual(['audience', 'notes'])
  })

  it('returns plain text unchanged when there is no block', () => {
    expect(parseQuestionBlocks('그냥 답입니다. a < b')).toEqual([
      { kind: 'text', text: '그냥 답입니다. a < b' },
    ])
    expect(parseQuestionBlocks('')).toEqual([])
  })

  it('accepts exactly what the tool-less guide teaches (no spaces, block at the end)', () => {
    const segs = parseQuestionBlocks(
      `질문이 있어요.\n<a2ui-json>[${JSON.stringify(MESSAGE)}]</a2ui-json>`,
    )
    expect(kinds(segs)).toEqual(['text', 'card:a2ui'])
  })

  it('strips a Markdown code fence inside the tags', () => {
    const fenced = `<a2ui-json>\n\`\`\`json\n${JSON.stringify([MESSAGE], null, 2)}\n\`\`\`\n</a2ui-json>`
    expect(kinds(parseQuestionBlocks(fenced))).toEqual(['card:a2ui'])
  })

  it('strips a Markdown code fence around the block', () => {
    const fenced = `확인할게요.\n\`\`\`xml\n${BLOCK}\n\`\`\`\n끝.`
    const segs = parseQuestionBlocks(fenced)
    expect(kinds(segs)).toEqual(['text', 'card:a2ui', 'text'])
    expect(segs[0]).toEqual({ kind: 'text', text: '확인할게요.\n' })
    expect(segs[2]).toEqual({ kind: 'text', text: '\n끝.' })
  })

  it('does not take the closing fence of an earlier code block for an opening one', () => {
    const text = `코드:\n\`\`\`js\nx()\n\`\`\`\n${BLOCK}`
    const segs = parseQuestionBlocks(text)
    expect(kinds(segs)).toEqual(['text', 'card:a2ui'])
    expect(segs[0]).toEqual({ kind: 'text', text: '코드:\n```js\nx()\n```\n' })
  })

  it('keeps a broken block as plain text', () => {
    const broken = '<a2ui-json>[{broken}]</a2ui-json>'
    expect(parseQuestionBlocks(`앞 ${broken} 뒤`)).toEqual([
      { kind: 'text', text: `앞 ${broken} 뒤` },
    ])
    // a single message not in an array, an invalid surface, more than one message
    for (const body of [
      JSON.stringify(MESSAGE),
      JSON.stringify([{ ...MESSAGE, version: '0.9' }]),
      JSON.stringify([MESSAGE, OTHER_MESSAGE]),
      '[]',
    ]) {
      const block = `<a2ui-json>${body}</a2ui-json>`
      expect(parseQuestionBlocks(block)).toEqual([{ kind: 'text', text: block }])
    }
  })

  it('keeps a fence around a broken block as written', () => {
    const text = '```\n<a2ui-json>[nope]</a2ui-json>\n```'
    expect(parseQuestionBlocks(text)).toEqual([{ kind: 'text', text }])
  })

  it('draws only the first valid block; later blocks stay as text', () => {
    const segs = parseQuestionBlocks(`${BLOCK}\n사이\n${SECOND_BLOCK}`)
    expect(kinds(segs)).toEqual(['card:a2ui', 'text'])
    expect(cardOf(segs).view.surfaceId).toBe('deck-scope')
    expect(segs[1]).toEqual({ kind: 'text', text: `\n사이\n${SECOND_BLOCK}` })
  })

  it('lets a valid block after a broken one become the card', () => {
    const broken = '<a2ui-json>[1]</a2ui-json>'
    const segs = parseQuestionBlocks(`${broken}\n${BLOCK}`)
    expect(kinds(segs)).toEqual(['text', 'card:a2ui'])
    expect(segs[0]).toEqual({ kind: 'text', text: `${broken}\n` })
  })

  it('shows an unclosed block as text once the reply is done', () => {
    const text = '확인\n<a2ui-json>[{"version":"1.0"'
    expect(parseQuestionBlocks(text)).toEqual([{ kind: 'text', text }])
  })
})

describe('parseQuestionBlocks: streaming', () => {
  it('hides every prefix of the opening tag at the end of the reply', () => {
    const tag = '<a2ui-json>'
    for (let n = 1; n < tag.length; n++) {
      expect(parseQuestionBlocks(`답입니다.\n${tag.slice(0, n)}`, true)).toEqual([
        { kind: 'text', text: '답입니다.\n' },
      ])
    }
  })

  it('hides prefixes of the old <question-form> tag too', () => {
    for (const tail of ['<q', '<question-', '<question-form']) {
      expect(parseQuestionBlocks(`답\n${tail}`, true)).toEqual([{ kind: 'text', text: '답\n' }])
    }
  })

  it('keeps a tag-like tail once the reply is done, and keeps other "<" text', () => {
    expect(parseQuestionBlocks('답 <a2', false)).toEqual([{ kind: 'text', text: '답 <a2' }])
    expect(parseQuestionBlocks('a <b', true)).toEqual([{ kind: 'text', text: 'a <b' }])
  })

  it('shows the pending card after the full opening tag until the closing tag arrives', () => {
    for (const partial of [
      '<a2ui-json>',
      '<a2ui-json>[{"version":"1.0","createSurface":{',
      `${BLOCK.slice(0, -3)}`,
    ]) {
      expect(parseQuestionBlocks(`확인 중\n${partial}`, true)).toEqual([
        { kind: 'text', text: '확인 중\n' },
        { kind: 'pending' },
      ])
    }
    expect(parseQuestionBlocks('확인 중\n<question-form>{"title":"미완성', true)).toEqual([
      { kind: 'text', text: '확인 중\n' },
      { kind: 'pending' },
    ])
  })

  it('never lets tag text appear at any point of the stream', () => {
    const full = `먼저 확인할게요.\n${BLOCK}\n끝.`
    for (let n = 0; n <= full.length; n++) {
      const segs = parseQuestionBlocks(full.slice(0, n), true)
      for (const seg of segs) {
        if (seg.kind === 'text') {
          expect(seg.text).not.toContain('<')
        }
      }
    }
    expect(kinds(parseQuestionBlocks(full, true))).toEqual(['text', 'card:a2ui', 'text'])
  })

  it('hides the opening fence before a block being written and the closing fence on its way', () => {
    expect(parseQuestionBlocks('확인\n```json\n<a2ui-json>[', true)).toEqual([
      { kind: 'text', text: '확인\n' },
      { kind: 'pending' },
    ])
    expect(parseQuestionBlocks('확인\n```json\n<a2ui', true)).toEqual([
      { kind: 'text', text: '확인\n' },
    ])
    const segs = parseQuestionBlocks(`확인\n\`\`\`\n${BLOCK}\n\`\``, true)
    expect(kinds(segs)).toEqual(['text', 'card:a2ui'])
  })

  it('shows a later block as text, not as a pending card, once a card is drawn', () => {
    const segs = parseQuestionBlocks(`${BLOCK}\n<a2ui-json>[`, true)
    expect(kinds(segs)).toEqual(['card:a2ui', 'text'])
    expect(segs[1]).toEqual({ kind: 'text', text: '\n<a2ui-json>[' })
  })
})

describe('parseQuestionBlocks: old <question-form> blocks (read-only)', () => {
  it('reads an old block into a question-form card with the old checks', () => {
    const segs = parseQuestionBlocks(`먼저 확인하겠습니다.\n${LEGACY_BLOCK}`)
    expect(kinds(segs)).toEqual(['text', 'card:question-form'])
    const view = cardOf(segs).view
    expect(view.title).toBe('문서 방향 확인')
    expect(view.inputs.map((i) => [i.id, i.kind])).toEqual([
      ['tone', 'ChoicePicker'],
      ['topics', 'ChoicePicker'],
      ['memo', 'TextField'],
    ])
  })

  it('keeps a malformed old block as text', () => {
    expect(parseQuestionBlocks('<question-form>{broken}</question-form>')).toEqual([
      { kind: 'text', text: '<question-form>{broken}</question-form>' },
    ])
  })

  it('counts the old block toward the one-card limit', () => {
    const segs = parseQuestionBlocks(`${LEGACY_BLOCK}\n${BLOCK}`)
    expect(kinds(segs)).toEqual(['card:question-form', 'text'])
  })
})

describe('old <question-form> checks', () => {
  it('rejects out-of-range counts', () => {
    expect(
      validateQuestionFormSpec({
        title: 'Too many',
        questions: Array.from({ length: 6 }, (_, i) => ({
          id: `q${i}`,
          label: `Q${i}`,
          type: 'text',
        })),
      }),
    ).toBeNull()
    expect(
      validateQuestionFormSpec({
        title: 'Too many options',
        questions: [
          {
            id: 'q1',
            label: 'Q1',
            type: 'radio',
            options: ['1', '2', '3', '4', '5', '6', '7', '8'],
          },
        ],
      }),
    ).toBeNull()
  })

  it('maps an old spec to the card view', () => {
    const spec = validateQuestionFormSpec(JSON.parse(LEGACY_JSON))!
    const view = questionFormView(spec)
    expect(view.inputs[0]).toMatchObject({
      kind: 'ChoicePicker',
      variant: 'mutuallyExclusive',
      required: true,
      initial: ['격식체'],
    })
    expect(view.inputs[1]).toMatchObject({ kind: 'ChoicePicker', variant: 'multipleSelection' })
  })
})
