/**
 * "Find sensitive info" in the deck editor, against a real in-memory deck:
 * the text read off the model, the candidates the shared finder returns, and
 * the text ops a confirm sends — run through the real op executor, saved and
 * reopened, so the mark lands where a typed one would.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addElement,
  addTable,
  createBlankPptx,
  getSlideComments,
  getSlideNotes,
  openPptx,
  savePptx,
  setSlideNotes,
  type OpenedPptx,
  type TableElement,
  type TextElement,
} from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import { deckSensitiveText } from '../src/main/sensitive-text'
import {
  deckHideOps,
  deckLocationText,
  deckPieces,
  deckSpotBlocked,
  paragraphWithCuts,
  type DeckPieceWords,
  type DeckSpotLocation,
} from '../src/renderer/ai/sensitive-deck'
import { countSensitiveText, findSensitive } from '../src/renderer/ai/sensitive-find'

type TxnOps = Parameters<typeof runTxn>[1]['ops']

const WORDS: DeckPieceWords = {
  slide: (n) => `Slide ${n}`,
  notes: 'Notes',
  table: 'Table',
  comment: 'Comment',
}

let opened: OpenedPptx
let boxId: string
let tableId: string

const read = (o: OpenedPptx = opened) =>
  deckSensitiveText(
    o.deck.slides,
    (slide) => getSlideNotes(o.archive, slide.path),
    (slide) => getSlideComments(o.archive, slide.path).map((c) => c.text),
  )

async function find(o: OpenedPptx = opened, isExcluded?: (k: string, v: string) => boolean) {
  const text = read(o)
  const { pieces, existingMarks } = deckPieces(text, WORDS)
  const found = await findSensitive<DeckSpotLocation>({
    pieces,
    existingMarks,
    lang: 'ko',
    locationText: (loc) => deckLocationText(loc, WORDS),
    blocked: (loc, s, e) =>
      deckSpotBlocked(text, loc, s, e) ? { reason: 'unsupported' } : undefined,
    ...(isExcluded ? { isExcluded } : {}),
  })
  return { text, found }
}

beforeEach(async () => {
  opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]!
  addElement(slide, {
    kind: 'textbox',
    offset: { x: 0, y: 0, cx: 4000000, cy: 600000 },
    paragraphs: [
      { runs: [{ text: '담임 ', bold: true }, { text: '연락처 010-1234-5678 입니다' }] },
      { runs: [{ text: '두 번째 줄' }] },
    ],
  })
  tableId = addTable(opened, 0, {
    rows: 2,
    cols: 2,
    offset: { x: 0, y: 1000000, cx: 3000000, cy: 800000 },
  })!.elementId
  const cell = (row: number, col: number, text: string) => ({
    op: 'setTableCell',
    target: { slide: 0, el: tableId },
    row,
    col,
    paragraphs: [{ runs: [{ text }] }],
  })
  const r = runTxn(opened, {
    ops: [cell(0, 0, '성명'), cell(0, 1, '비고'), cell(1, 0, '김민수'), cell(1, 1, '없음')],
  })
  expect(r.applied).toBe(true)
  expect(setSlideNotes(opened, 0, '발표 메모\n문의 hong@example.com')).toBe(true)
  // adding the table re-reads the slide, so the box is looked up afterwards
  boxId = opened.deck.slides[0]!.elements.find((e) => e.type === 'text')!.id
})

describe('reading the deck', () => {
  it('reads shapes, table cells with their column header, notes and comments', () => {
    const text = read()
    const box = text.bodies.find((b) => b.el === boxId)!
    expect(box.paragraphs.map((p) => p.map((r) => r.text).join(''))).toEqual([
      '담임 연락처 010-1234-5678 입니다',
      '두 번째 줄',
    ])
    const name = text.bodies.find((b) => b.el === tableId && b.cell?.row === 1 && b.cell.col === 0)!
    expect(name.header).toBe('성명')
    expect(text.notes[0]).toContain('hong@example.com')
    expect(text.comments).toEqual([[]])
  })
})

describe('finding', () => {
  it('finds the phone in a shape, the name under a name column and the e-mail in the notes', async () => {
    const { found } = await find()
    const byKind = Object.fromEntries(found.rows.map((r) => [r.kind, r]))
    expect(byKind.phone).toMatchObject({
      value: '010-1234-5678',
      hideable: true,
      location: 'Slide 1',
    })
    expect(byKind.phone!.label).toBe('전화-01')
    expect(byKind.name).toMatchObject({
      value: '김민수',
      hideable: true,
      location: 'Slide 1 · Table',
    })
    expect(byKind.email).toMatchObject({
      value: 'hong@example.com',
      hideable: false,
      reasonText: 'Notes',
      location: 'Slide 1 · Notes',
    })
  })

  it('a document without anything sensitive yields nothing', async () => {
    const blank = await openPptx(await createBlankPptx())
    const { found } = await find(blank)
    expect(found.rows).toEqual([])
  })

  it('drops what the reader excluded', async () => {
    const { found } = await find(opened, (kind) => kind === 'phone')
    expect(found.rows.map((r) => r.kind)).not.toContain('phone')
  })

  it('counts the candidates of an attachment text', () => {
    expect(countSensitiveText('이름: 홍길동\n전화 010-9876-5432')).toBeGreaterThanOrEqual(1)
    expect(countSensitiveText('')).toBe(0)
  })
})

describe('hiding a confirmed candidate', () => {
  it('cuts the run, marks only the candidate and keeps everything else', async () => {
    const { text, found } = await find()
    const spots = [...found.spots.values()].filter((s) => s.hideable)
    const nameLabel = found.rows.find((r) => r.value === '김민수')!.label
    expect(nameLabel).toMatch(/^이름-0[0-9]$/)
    const { ops, hidden } = deckHideOps(read(), text, spots)
    expect(hidden.length).toBe(spots.length)
    const r = runTxn(opened, { ops: ops as TxnOps })
    expect(r.applied).toBe(true)

    const box = opened.deck.slides[0]!.elements.find((e) => e.id === boxId) as TextElement
    const runs = box.text!.paragraphs[0]!.runs
    expect(runs.map((x) => x.text).join('')).toBe('담임 연락처 010-1234-5678 입니다')
    expect(runs[0]).toMatchObject({ text: '담임 ', bold: true })
    expect(runs[0]!.redact).toBeUndefined()
    const marked = runs.filter((x) => x.redact)
    expect(marked).toEqual([
      expect.objectContaining({ text: '010-1234-5678', redact: '전화-01', underline: true }),
    ])
    expect(box.text!.paragraphs[1]!.runs.map((x) => x.text).join('')).toBe('두 번째 줄')

    const table = opened.deck.slides[0]!.elements.find((e) => e.id === tableId) as TableElement
    const cellRuns = table.rows[1]![0]!.text!.paragraphs[0]!.runs
    expect(cellRuns).toEqual([
      expect.objectContaining({ text: '김민수', redact: nameLabel, underline: true }),
    ])

    // the mark survives a save and a reopen
    const reopened = await openPptx(await savePptx(opened))
    const again = read(reopened)
    const boxAgain = again.bodies.find((b) => !b.cell)!
    expect(boxAgain.paragraphs[0]!.filter((x) => x.redact).map((x) => x.text)).toEqual([
      '010-1234-5678',
    ])

    // and a hidden spot is never offered again
    const after = await find(reopened)
    expect(after.found.rows.filter((x) => x.hideable)).toEqual([])
    expect(after.found.rows.map((x) => x.kind)).toEqual(['email'])
  })

  it('numbers new labels after the ones the deck already has, same value same label', async () => {
    const first = await find()
    const phone = [...first.found.spots.values()].find((s) => s.kind === 'phone')!
    expect(
      runTxn(opened, { ops: deckHideOps(read(), first.text, [phone]).ops as TxnOps }).applied,
    ).toBe(true)
    const slide = opened.deck.slides[0]!
    addElement(slide, {
      kind: 'textbox',
      offset: { x: 0, y: 2000000, cx: 4000000, cy: 600000 },
      paragraphs: [{ runs: [{ text: '같은 번호 01012345678, 다른 번호 010-2222-3333' }] }],
    })
    const next = await find()
    const phones = next.found.rows.filter((r) => r.kind === 'phone').map((r) => [r.value, r.label])
    expect(phones).toEqual([
      ['01012345678', '전화-01'],
      ['010-2222-3333', '전화-02'],
    ])
  })

  it('skips a spot whose paragraph changed since it was found', async () => {
    const { text, found } = await find()
    const phone = [...found.spots.values()].find((s) => s.kind === 'phone')!
    runTxn(opened, {
      ops: [
        {
          op: 'setText',
          target: { slide: 0, el: boxId },
          paragraphs: [{ runs: [{ text: '바뀐 글' }] }],
        },
      ],
    })
    expect(deckHideOps(read(), text, [phone])).toEqual({ ops: [], hidden: [] })
  })

  it('leaves a field run whole and refuses a spot that touches one', () => {
    const runs = [{ text: 'p.' }, { text: '3', fixed: true as const }, { text: ' 홍길동' }]
    expect(paragraphWithCuts(runs, 0, [{ start: 4, end: 7, label: '이름-01' }])).toEqual({
      srcPara: 0,
      runs: [
        { text: 'p.', srcRun: 0 },
        { text: '3', srcRun: 1 },
        { text: ' ', srcRun: 2 },
        { text: '홍길동', srcRun: 2, redact: '이름-01', underline: true },
      ],
    })
    const text = {
      bodies: [{ slide: 0, el: 'x', paragraphs: [runs] }],
      notes: [''],
      comments: [[]],
    }
    expect(
      deckSpotBlocked(text, { kind: 'text', body: 0, para: 0, slide: 0, table: false }, 1, 3),
    ).toBe(true)
    expect(
      deckSpotBlocked(text, { kind: 'text', body: 0, para: 0, slide: 0, table: false }, 4, 7),
    ).toBe(false)
  })
})
