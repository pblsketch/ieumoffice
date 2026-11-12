/**
 * The looks the plugin gives a document, against the real rhwp engine: the lines of table
 * cells, the looks of a new table, paragraph styles made and applied in one call, a title
 * box, the page number, the header and footer, and the font that stands in for one this PC
 * lacks. The editor's history is modelled by snapshots, as in agent-plugin-doc-settings.test.ts.
 */
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import { installFontPresence } from '../studio-plugin/pc-fonts.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  // what this PC has is not known unless a test says so
  installFontPresence(null as never)
})

const TITLE = '2026학년도 현장체험학습 운영 계획'
const LINES = [
  TITLE,
  '□ 추진 배경',
  '○ 학생의 진로 탐색 기회를 넓히기 위해 운영함',
  '  - 만족도 조사에서 87%가 확대를 희망',
  '□ 세부 일정',
  '○ 참가 동의서는 담임 교사에게 제출',
]

function blank(lines: string[] = LINES): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    doc.insertText(0, index, 0, line)
  })
  return doc
}

function open(start: HwpDocument = blank()) {
  let doc = start
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => history.length }
}

/** The fonts of this PC, as the editor knows them after it looked. */
function pcHas(...fonts: string[]) {
  installFontPresence({
    resolveLocalFont: (name: string) => (fonts.includes(name) ? { family: name } : null),
    records: () => [],
    detected: () => [],
    state: () => ({ source: 'local-font-access' }),
  } as never)
}

interface Line {
  type: number
  width: number
  color: string
}
interface Cell {
  width: number
  height: number
  verticalAlign: number
  borderLeft: Line
  borderRight: Line
  borderTop: Line
  borderBottom: Line
  fillType: string
  fillColor: string
}

/** The first table of body paragraph `para`: its control and the properties of a cell. */
function tableIn(doc: HwpDocument, para: number) {
  for (let control = 0; control < 8; control++) {
    try {
      const dims = JSON.parse(doc.getTableDimensions(0, para, control)) as {
        rowCount?: number
        colCount: number
        cellCount: number
      }
      if (dims.rowCount === undefined) continue
      return {
        control,
        rows: dims.rowCount,
        cols: dims.colCount,
        cells: dims.cellCount,
        cell: (index: number) => JSON.parse(doc.getCellProperties(0, para, control, index)) as Cell,
      }
    } catch {
      // not a table
    }
  }
  throw new Error(`no table in paragraph ${para}`)
}

const ROWS = [
  ['구분', '일시', '장소'],
  ['1학년', '9. 12.(금)', '국립중앙박물관'],
  ['2학년', '9. 19.(금)', '국립과천과학관'],
]

/** A document with a 3 x 3 table after the "세부 일정" line (body paragraph 5). */
function withTable(look: Parameters<ReturnType<typeof open>['plugin']['insertTable']>[4] = true) {
  const opened = open()
  const made = opened.plugin.insertTable('□ 세부 일정', null, 'after', ROWS, look)
  expect(made).toMatchObject({ ok: true, rows: 3, cols: 3 })
  return { ...opened, para: 5 }
}

describe('formatCells: borders', () => {
  it('draws the outline of a block and the lines inside it, the same from both sides', () => {
    const { plugin, doc, steps, para } = withTable()
    const before = steps()
    const result = plugin.formatCells(1, null, {
      borders: [
        { sides: 'all', line: 'solid', width: 0.12 },
        { sides: 'left', line: 'none' },
        { sides: 'right', line: 'none' },
        { sides: 'top', line: 'solid', width: 0.5 },
        { sides: 'bottom', line: 'solid', width: 0.5 },
      ],
    })
    expect(result).toMatchObject({ ok: true, count: 9 })
    expect(steps()).toBe(before + 1)
    const table = tableIn(doc(), para)
    // top left cell: no line at the left, a heavy one above, thin ones inside
    expect(table.cell(0).borderLeft.type).toBe(0)
    expect(table.cell(0).borderTop).toMatchObject({ type: 1, width: 7 })
    expect(table.cell(0).borderRight).toMatchObject({ type: 1, width: 1 })
    expect(table.cell(0).borderBottom).toMatchObject({ type: 1, width: 1 })
    // the line between two rows is one line: both cells name it alike
    expect(table.cell(3).borderTop).toEqual(table.cell(0).borderBottom)
    // bottom right cell: no line at the right, a heavy one below
    expect(table.cell(8).borderRight.type).toBe(0)
    expect(table.cell(8).borderBottom).toMatchObject({ type: 1, width: 7 })
  })

  it('takes a block, and a later rule goes over an earlier one', () => {
    const { plugin, doc, para } = withTable()
    const result = plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 1, toCol: 3 },
      { borders: [{ sides: 'bottom', line: 'double', color: '#1F3864' }], verticalAlign: 'middle' },
    )
    expect(result).toMatchObject({ ok: true, count: 3 })
    const table = tableIn(doc(), para)
    for (const cell of [0, 1, 2]) {
      expect(table.cell(cell).borderBottom).toMatchObject({ type: 8, width: 7, color: '#1f3864' })
      expect(table.cell(cell).verticalAlign).toBe(1)
    }
    // the row below shares that line; the cells further down keep their own
    expect(table.cell(3).borderTop.type).toBe(8)
    expect(table.cell(6).borderTop.type).toBe(1)
  })

  it('keeps the lines and the fill through HWPX and HWP', () => {
    const { plugin, doc, para } = withTable()
    plugin.formatCells(1, [{ row: 2, col: 2 }], {
      background: '#FFF2CC',
      borders: [{ sides: 'outer', line: 'dashed', width: 0.4, color: '#C00000' }],
    })
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const cell = tableIn(new HwpDocument(bytes), para).cell(4)
      expect(cell.fillType).toBe('solid')
      expect(cell.fillColor).toBe('#fff2cc')
      for (const side of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'] as const) {
        expect(cell[side]).toMatchObject({ type: 2, width: 6, color: '#c00000' })
      }
    }
  })

  it('still takes a background alone, as before', () => {
    const { plugin, doc, para } = withTable()
    expect(plugin.formatCells(1, [{ row: 3, col: 1 }], '#DCE6F5')).toMatchObject({
      ok: true,
      count: 1,
    })
    expect(tableIn(doc(), para).cell(6).fillColor).toBe('#dce6f5')
    expect(plugin.formatCells(1, [{ row: 3, col: 1 }], 'none')).toMatchObject({ ok: true })
    expect(tableIn(doc(), para).cell(6).fillType).toBe('none')
  })

  it('refuses a block outside the table and a rule it cannot read, changing nothing', () => {
    const { plugin, steps } = withTable()
    const before = steps()
    expect(
      plugin.formatCells(
        1,
        { fromRow: 1, fromCol: 1, toRow: 4, toCol: 3 },
        { background: '#eeeeee' },
      ),
    ).toMatchObject({ ok: false, reason: 'no_such_cell', rows: 3, cols: 3 })
    expect(() =>
      plugin.formatCells(1, null, { borders: [{ sides: 'diagonal' as never, line: 'solid' }] }),
    ).toThrow(/sides must be one of/)
    expect(() => plugin.formatCells(1, null, {})).toThrow(/name what to change/)
    expect(steps()).toBe(before)
  })
})

describe('insertTable: looks', () => {
  it('makes an open table: no lines at the sides, heavier above and below, a line under the header', () => {
    const { doc, para } = withTable({ header: true, look: 'open', headerColor: '#DCE6F5' })
    const table = tableIn(doc(), para)
    expect(table.cell(0).borderLeft.type).toBe(0)
    expect(table.cell(2).borderRight.type).toBe(0)
    expect(table.cell(0).borderTop).toMatchObject({ type: 1, width: 7 })
    expect(table.cell(8).borderBottom).toMatchObject({ type: 1, width: 7 })
    expect(table.cell(0).borderBottom).toMatchObject({ type: 1, width: 5 })
    expect(table.cell(3).borderTop).toMatchObject({ type: 1, width: 5 })
    expect(table.cell(1).fillColor).toBe('#dce6f5')
    expect(table.cell(4).fillType).not.toBe('solid')
  })

  it('gives the columns their shares of the width and the text its size', () => {
    const { doc, para } = withTable({
      header: true,
      columnWidths: [1, 2, 1],
      align: 'center',
      size: 11,
    })
    const table = tableIn(doc(), para)
    const [narrow, wide, last] = [table.cell(0).width, table.cell(1).width, table.cell(2).width]
    expect(wide / narrow).toBeGreaterThan(1.9)
    expect(wide / narrow).toBeLessThan(2.1)
    expect(Math.abs(last - narrow)).toBeLessThan(60)
    const chars = JSON.parse(doc().getCellCharPropertiesAt(0, para, table.control, 4, 0, 0)) as {
      fontSize: number
    }
    expect(chars.fontSize).toBe(1100)
    const paragraph = JSON.parse(doc().getCellParaPropertiesAt(0, para, table.control, 4, 0)) as {
      alignment: string
    }
    expect(paragraph.alignment).toBe('center')
  })

  it('refuses widths that do not fit the columns', () => {
    const { plugin } = open()
    expect(() =>
      plugin.insertTable('□ 세부 일정', null, 'after', ROWS, { columnWidths: [1, 2] }),
    ).toThrow(/columnWidths must be 3 positive numbers/)
    expect(() =>
      plugin.insertTable('□ 세부 일정', null, 'after', ROWS, { look: 'fancy' as never }),
    ).toThrow(/look must be one of/)
  })
})

const STYLES = [
  {
    name: '중제목',
    format: {
      font: '맑은 고딕',
      size: 15,
      bold: true,
      lineSpacing: 180,
      indent: -21,
      spacingBefore: 10,
    },
  },
  {
    name: '본문항목',
    format: { font: '바탕', size: 13, lineSpacing: 180, marginLeft: 7, indent: -19 },
  },
  {
    name: '세부항목',
    format: { font: '바탕', size: 13, lineSpacing: 180, marginLeft: 20, indent: -13 },
  },
]

const styleOf = (doc: HwpDocument, para: number) =>
  (JSON.parse(doc.getStyleAt(0, para)) as { name: string }).name
const charsOf = (doc: HwpDocument, para: number) =>
  JSON.parse(doc.getCharPropertiesAt(0, para, 0)) as {
    fontFamily: string
    fontSize: number
    bold: boolean
  }

describe('styleParagraphs', () => {
  it('makes the styles and gives each paragraph its style, in one undo step', () => {
    const { plugin, doc, steps } = open()
    const before = steps()
    const result = plugin.styleParagraphs({
      styles: [...STYLES, { name: '문서제목', format: { size: 20, bold: true, align: 'center' } }],
      apply: [
        { style: '문서제목', find: TITLE },
        { style: '중제목', startsWith: '□' },
        { style: '본문항목', startsWith: '○' },
        { style: '세부항목', startsWith: '-' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      made: 4,
      changed: 0,
      paragraphs: 6,
      rules: [
        { style: '문서제목', paragraphs: 1 },
        { style: '중제목', paragraphs: 2 },
        { style: '본문항목', paragraphs: 2 },
        { style: '세부항목', paragraphs: 1 },
      ],
    })
    expect(steps()).toBe(before + 1)
    expect([0, 1, 2, 3, 4, 5].map((para) => styleOf(doc(), para))).toEqual([
      '문서제목',
      '중제목',
      '본문항목',
      '세부항목',
      '중제목',
      '본문항목',
    ])
    expect(charsOf(doc(), 1)).toMatchObject({ fontFamily: '맑은 고딕', fontSize: 1500, bold: true })
    expect(charsOf(doc(), 2)).toMatchObject({ fontFamily: '바탕', fontSize: 1300, bold: false })
    // the styles and what uses them survive both formats
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(styleOf(again, 4)).toBe('중제목')
      expect(charsOf(again, 3).fontSize).toBe(1300)
    }
  })

  it('changes a style the document already has, and its paragraphs with it', () => {
    const { plugin, doc } = open()
    plugin.styleParagraphs({ styles: STYLES, apply: [{ style: '중제목', startsWith: '□' }] })
    const result = plugin.styleParagraphs({ styles: [{ name: '중제목', format: { size: 16 } }] })
    expect(result).toMatchObject({ ok: true, made: 0, changed: 1, paragraphs: 0 })
    expect(charsOf(doc(), 1).fontSize).toBe(1600)
    expect(charsOf(doc(), 4).fontSize).toBe(1600)
  })

  it('takes over formatting a paragraph had of its own', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('□ 추진 배경', null, { size: 30, align: 'right' })
    plugin.styleParagraphs({ styles: STYLES, apply: [{ style: '중제목', startsWith: '□' }] })
    expect(charsOf(doc(), 1).fontSize).toBe(1500)
    expect(charsOf(doc(), 4).fontSize).toBe(1500)
  })

  it('writes a font this PC has in place of one it lacks, and says so', () => {
    pcHas('맑은 고딕', '바탕')
    const { plugin, doc } = open()
    const result = plugin.styleParagraphs({
      styles: [
        { name: '중제목', format: { font: 'HY헤드라인M', size: 15 } },
        { name: '본문항목', format: { font: '휴먼명조', size: 13 } },
      ],
      apply: [
        { style: '중제목', startsWith: '□' },
        { style: '본문항목', startsWith: '○' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      standIn: [
        { asked: 'HY헤드라인M', used: '맑은 고딕' },
        { asked: '휴먼명조', used: '바탕' },
      ],
    })
    // a headline face has no family of its weight on every PC: a gothic in bold stands in
    expect(charsOf(doc(), 1)).toMatchObject({ fontFamily: '맑은 고딕', bold: true })
    expect(charsOf(doc(), 2)).toMatchObject({ fontFamily: '바탕', bold: false })
  })

  it('writes the font as asked when the PC has it, or when its fonts are not known', () => {
    const { plugin, doc } = open()
    const spec = {
      styles: [{ name: '중제목', format: { font: 'HY헤드라인M', size: 15 } }],
      apply: [{ style: '중제목', startsWith: '□' }],
    }
    expect(plugin.styleParagraphs(spec)).not.toHaveProperty('standIn')
    expect(charsOf(doc(), 1).fontFamily).toBe('HY헤드라인M')
    pcHas('HY헤드라인M', '맑은 고딕')
    const other = open()
    expect(other.plugin.styleParagraphs(spec)).not.toHaveProperty('standIn')
    expect(charsOf(other.doc(), 1)).toMatchObject({ fontFamily: 'HY헤드라인M', bold: false })
  })

  it('refuses a rule it cannot place, and changes nothing', () => {
    const { plugin, steps } = open()
    const before = steps()
    expect(
      plugin.styleParagraphs({ styles: STYLES, apply: [{ style: '중제목', find: '없는 글' }] }),
    ).toMatchObject({ ok: false, reason: 'not_found', find: '없는 글' })
    expect(
      plugin.styleParagraphs({ apply: [{ style: '없는 스타일', startsWith: '□' }] }),
    ).toMatchObject({ ok: false, reason: 'no_such_style' })
    expect(() =>
      plugin.styleParagraphs({ apply: [{ style: '바탕글', startsWith: '□', find: '□' }] }),
    ).toThrow(/by startsWith, by numbered or by find/)
    expect(steps()).toBe(before)
  })
})

describe('insertTitleBox', () => {
  it('turns the title paragraph into a box with bands of colour, its words inside', () => {
    const { plugin, doc, steps } = open()
    plugin.formatParagraph(TITLE, null, { size: 20, bold: true })
    const before = steps()
    const result = plugin.insertTitleBox(TITLE, null, {
      look: 'bands',
      color: '#1F3864',
      color2: '#C00000',
    })
    expect(result).toMatchObject({ ok: true, look: 'bands' })
    expect(steps()).toBe(before + 1)
    const table = tableIn(doc(), 0)
    expect([table.rows, table.cols]).toEqual([3, 1])
    expect(table.cell(0)).toMatchObject({ fillType: 'solid', fillColor: '#1f3864', height: 567 })
    expect(table.cell(2)).toMatchObject({ fillType: 'solid', fillColor: '#c00000' })
    for (const cell of [0, 1, 2]) {
      expect(table.cell(cell).borderLeft.type).toBe(0)
      expect(table.cell(cell).borderTop.type).toBe(0)
    }
    // the words moved into the middle cell with the look they had, centred
    expect(doc().getTextInCell(0, 0, table.control, 1, 0, 0, TITLE.length)).toBe(TITLE)
    const chars = JSON.parse(doc().getCellCharPropertiesAt(0, 0, table.control, 1, 0, 0)) as {
      fontSize: number
      bold: boolean
    }
    expect(chars).toMatchObject({ fontSize: 2000, bold: true })
    const paragraph = JSON.parse(doc().getCellParaPropertiesAt(0, 0, table.control, 1, 0)) as {
      alignment: string
    }
    expect(paragraph.alignment).toBe('center')
    // the rest of the document is where it was
    expect(doc().getTextRange(0, 1, 0, 7)).toBe('□ 추진 배경')
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = tableIn(new HwpDocument(bytes), 0)
      expect([again.rows, again.cell(0).fillColor]).toEqual([3, '#1f3864'])
    }
  })

  it('makes the other looks as one cell', () => {
    for (const [look, check] of [
      [
        'lines',
        (cell: Cell) => expect([cell.borderTop.type, cell.borderLeft.type]).toEqual([1, 0]),
      ],
      ['box', (cell: Cell) => expect([cell.borderTop.type, cell.borderLeft.type]).toEqual([1, 1])],
      [
        'shaded',
        (cell: Cell) => expect([cell.fillType, cell.borderTop.type]).toEqual(['solid', 0]),
      ],
    ] as const) {
      const { plugin, doc } = open()
      expect(plugin.insertTitleBox(TITLE, null, { look })).toMatchObject({ ok: true, look })
      const table = tableIn(doc(), 0)
      expect(table.rows).toBe(1)
      check(table.cell(0))
    }
  })

  it('refuses text in a table cell and a look it does not know', () => {
    const { plugin, steps } = withTable()
    const before = steps()
    expect(plugin.insertTitleBox('국립중앙박물관', null, { look: 'box' })).toMatchObject({
      ok: false,
      reason: 'in_table',
    })
    expect(() => plugin.insertTitleBox(TITLE, null, { look: 'ribbon' as never })).toThrow(
      /look must be one of/,
    )
    expect(steps()).toBe(before)
  })
})

describe('page number, header and footer', () => {
  it('numbers the pages and reads the setting back', () => {
    const { plugin, doc, steps } = open()
    expect(plugin.pageLayout()).toMatchObject({
      pageNumber: null,
      header: { exists: false },
      footer: { exists: false },
    })
    const before = steps()
    expect(plugin.setPageNumber({ position: 'bottom_center' })).toMatchObject({
      ok: true,
      pageNumber: { position: 'bottom_center', format: 'digit', dashes: true },
    })
    expect(steps()).toBe(before + 1)
    plugin.setPageNumber({ position: 'bottom_right', format: 'upperRoman', dashes: false })
    expect(plugin.pageLayout().pageNumber).toEqual({
      position: 'bottom_right',
      format: 'upperRoman',
      dashes: false,
    })
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = JSON.parse(new HwpDocument(bytes).getPageNumberPos(0)) as {
        pageNumber: { position: number; format: number; dash: boolean }
      }
      expect(again.pageNumber).toMatchObject({ position: 6, format: 2, dash: false })
    }
    expect(() => plugin.setPageNumber({ position: 'middle' as never })).toThrow(
      /position must be one of/,
    )
  })

  it('writes a header and a footer with the page number, rewrites and removes them', () => {
    const { plugin, doc } = open()
    expect(
      plugin.setHeaderFooter('header', { text: '○○초등학교 교무기획부', align: 'right', size: 9 }),
    ).toMatchObject({
      ok: true,
      kind: 'header',
      removed: false,
    })
    expect(
      plugin.setHeaderFooter('footer', { text: '운영 계획 | {page} / {pages}' }),
    ).toMatchObject({
      ok: true,
      kind: 'footer',
    })
    const layout = plugin.pageLayout()
    expect(layout.header).toEqual({ exists: true, text: '○○초등학교 교무기획부', plain: true })
    expect(layout.footer).toMatchObject({ exists: true, plain: true })
    expect((layout.footer as { text: string }).text).toBe('운영 계획 | {field} / {field}')
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect((JSON.parse(again.getHeaderFooter(0, true, 0)) as { text: string }).text).toBe(
        '○○초등학교 교무기획부',
      )
      expect((JSON.parse(again.getHeaderFooter(0, false, 0)) as { exists: boolean }).exists).toBe(
        true,
      )
    }
    // the same call again replaces the text instead of adding to it
    plugin.setHeaderFooter('header', { text: '교무기획부' })
    expect(plugin.pageLayout().header).toMatchObject({ text: '교무기획부' })
    expect(plugin.setHeaderFooter('header', { text: '' })).toMatchObject({
      ok: true,
      removed: true,
    })
    expect(plugin.pageLayout().header).toEqual({ exists: false })
    expect(plugin.setHeaderFooter('header', { text: '' })).toEqual({
      ok: false,
      reason: 'not_there',
    })
  })

  it('leaves a header someone laid out by hand alone', () => {
    const start = blank()
    start.createHeaderFooter(0, true, 0)
    start.insertTextInHeaderFooter(0, true, 0, 0, 0, '첫 줄')
    start.splitParagraphInHeaderFooter(0, true, 0, 0, 3)
    start.insertTextInHeaderFooter(0, true, 0, 1, 0, '둘째 줄')
    const { plugin, steps } = open(start)
    expect(plugin.pageLayout().header).toMatchObject({ exists: true, plain: false })
    const before = steps()
    expect(plugin.setHeaderFooter('header', { text: '새 머리말' })).toEqual({
      ok: false,
      reason: 'not_plain',
    })
    expect(steps()).toBe(before)
  })
})

describe('documentFonts', () => {
  it('says nothing when the fonts of the PC are not known', () => {
    expect(open().plugin.documentFonts()).toEqual({ known: false, onPc: [], missing: [] })
  })

  it('tells which document fonts the PC has and lacks', () => {
    pcHas('맑은 고딕', '바탕')
    const fonts = open().plugin.documentFonts()
    expect(fonts.known).toBe(true)
    expect(fonts.onPc).toEqual(['맑은 고딕', '바탕'])
    expect(fonts.missing).toContain('HY헤드라인M')
    expect(fonts.missing).toContain('휴먼명조')
  })
})

describe('styleParagraphs: numbered levels and headings that stay with their text', () => {
  const NUMBERED = [
    '운영 계획',
    'Ⅰ. 목적',
    '1. 운영 방향',
    '가. 대상: 2학년 전체',
    '1) 1차: 9. 12.(금)',
    '가) 장소는 추후 안내',
    '2. 2026학년도 일정',
    'Ⅱ. 기대 효과',
    '1.5배로 늘어난 참가 인원',
  ]

  it('gives each numbered level its style by the number it starts with', () => {
    const { plugin, doc } = open(blank(NUMBERED))
    const result = plugin.styleParagraphs({
      styles: [
        { name: '대제목', format: { size: 16, bold: true }, keepWithNext: true },
        { name: '중제목', format: { size: 14, bold: true, marginLeft: 10 } },
        { name: '소제목', format: { size: 13, marginLeft: 20 } },
        { name: '세목', format: { size: 12, marginLeft: 30 } },
        { name: '세세목', format: { size: 12, marginLeft: 40 } },
      ],
      apply: [
        { style: '대제목', numbered: 'Ⅰ' },
        { style: '중제목', numbered: '1.' },
        { style: '소제목', numbered: '가.' },
        { style: '세목', numbered: '1)' },
        { style: '세세목', numbered: '가)' },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      made: 5,
      rules: [
        { style: '대제목', paragraphs: 2 },
        { style: '중제목', paragraphs: 2 },
        { style: '소제목', paragraphs: 1 },
        { style: '세목', paragraphs: 1 },
        { style: '세세목', paragraphs: 1 },
      ],
    })
    expect(NUMBERED.map((_, para) => styleOf(doc(), para))).toEqual([
      '바탕글',
      '대제목',
      '중제목',
      '소제목',
      '세목',
      '세세목',
      '중제목',
      '대제목',
      // a decimal is not the number of a level
      '바탕글',
    ])
    // a heading of the top level stays with the paragraph after it, in both formats
    const keeps = (d: HwpDocument, para: number) =>
      (JSON.parse(d.getParaPropertiesAt(0, para)) as { keepWithNext: boolean }).keepWithNext
    expect(keeps(doc(), 1)).toBe(true)
    expect(keeps(doc(), 2)).toBe(false)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(keeps(again, 7)).toBe(true)
      expect(styleOf(again, 4)).toBe('세목')
    }
  })

  it('lets a style start from one made earlier in the same call', () => {
    const { plugin, doc, steps } = open()
    const before = steps()
    const result = plugin.styleParagraphs({
      styles: [
        { name: '계획 본문', format: { size: 10.5, lineSpacing: 155 } },
        { name: '계획 제목', basedOn: '계획 본문', format: { bold: true } },
      ],
      apply: [
        { style: '계획 본문', startsWith: '○' },
        { style: '계획 제목', startsWith: '□' },
      ],
    })
    expect(result).toMatchObject({ ok: true, made: 2 })
    expect(steps()).toBe(before + 1)
    // the heading has the size of the style it started from, and its own bold
    const heading = JSON.parse(doc().getCharPropertiesAt(0, 1, 0)) as {
      fontSize: number
      bold: boolean
    }
    expect(heading).toMatchObject({ fontSize: 1050, bold: true })
    const body = JSON.parse(doc().getCharPropertiesAt(0, 2, 0)) as { bold: boolean }
    expect(body.bold).toBe(false)
    // a style that comes later in the list, or is nowhere, is still refused
    expect(
      plugin.styleParagraphs({
        styles: [
          { name: '먼저', basedOn: '나중', format: { bold: true } },
          { name: '나중', format: { size: 12 } },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'no_such_style' })
    expect(steps()).toBe(before + 1)
  })

  it('refuses a level it does not know and a rule with two ways to name its paragraphs', () => {
    const { plugin, steps } = open(blank(NUMBERED))
    const before = steps()
    const style = { name: '중제목', format: { size: 14 } }
    expect(() =>
      plugin.styleParagraphs({
        styles: [style],
        apply: [{ style: '중제목', numbered: '2.' as never }],
      }),
    ).toThrow(/numbered must be one of/)
    expect(() =>
      plugin.styleParagraphs({
        styles: [style],
        apply: [{ style: '중제목', numbered: '1.', startsWith: '1.' }],
      }),
    ).toThrow(/one of the three/)
    expect(steps()).toBe(before)
  })
})

describe('columns and breaks', () => {
  const PAPER = ['2026학년도 1학기 중간고사', '국어 (2학년)']
  for (let n = 1; n <= 8; n++) {
    PAPER.push(`${n}. 다음 글을 읽고 물음에 답하시오.`, '① 첫째', '② 둘째', '③ 셋째', '')
  }
  const columnsOf = (doc: HwpDocument) =>
    JSON.parse(doc.getColumnDef(0)) as { columnCount: number; spacing: number }
  const tableProps = (doc: HwpDocument, para: number, control: number) =>
    JSON.parse(doc.getTableProperties(0, para, control)) as {
      treatAsChar: boolean
      tableWidth: number
      horzRelTo: string
      vertRelTo: string
    }

  it('lays the text out in columns, reads them back and takes them away again', () => {
    const { plugin, doc, steps } = open(blank(PAPER))
    const before = steps()
    expect(plugin.pageLayout().columns).toEqual({ count: 1, gapMm: 0 })
    expect(plugin.setColumns({ count: 2 })).toMatchObject({ ok: true, count: 2, gapMm: 8, was: 1 })
    expect(steps()).toBe(before + 1)
    expect(columnsOf(doc()).columnCount).toBe(2)
    expect(plugin.pageLayout()).toMatchObject({ columns: { count: 2, gapMm: 8 } })
    // through both formats
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      expect(columnsOf(new HwpDocument(bytes)).columnCount).toBe(2)
    }
    expect(plugin.setColumns({ count: 1 })).toMatchObject({ ok: true, count: 1, gapMm: 0, was: 2 })
    expect(columnsOf(doc()).columnCount).toBe(1)
    expect(() => plugin.setColumns({ count: 9 })).toThrow(/count must be/)
    expect(() => plugin.setColumns({ count: 2, gapMm: 99 })).toThrow(/gapMm must be/)
  })

  it('makes a table one column wide where the text runs in columns, or lays it across them', () => {
    const { plugin, doc } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    const rows = [
      ['학년', '반', '번호', '이름'],
      ['2', '', '', ''],
    ]
    const paragraphs = doc().getParagraphCount(0)
    const head = plugin.insertTable(PAPER[0]!, null, 'before', rows, {
      header: true,
      acrossColumns: true,
    })
    expect(head).toMatchObject({ ok: true, acrossColumns: true, place: { para: 0 } })
    // the head shares the first paragraph with the first words: no paragraph was added
    expect(doc().getParagraphCount(0)).toBe(paragraphs)
    expect(doc().getTextRange(0, 0, 0, 40)).toContain(PAPER[0]!)
    const inColumn = plugin.insertTable('③ 셋째', 1, 'after', [['보기', '내용']], true)
    expect(inColumn).toMatchObject({ ok: true })
    expect(inColumn).not.toHaveProperty('acrossColumns')
    const wide = tableIn(doc(), 0)
    const narrow = tableIn(doc(), 6)
    const wideProps = tableProps(doc(), 0, wide.control)
    const narrowProps = tableProps(doc(), 6, narrow.control)
    // across: out of the line of text, hung from the top of the page's text area
    expect(wideProps).toMatchObject({ treatAsChar: false, horzRelTo: 'Page', vertRelTo: 'Page' })
    expect(narrowProps.treatAsChar).toBe(true)
    // the text is 425 pt wide and the gap 8 mm: a column is a little under half of it
    expect(wideProps.tableWidth).toBeGreaterThan(41000)
    expect(narrowProps.tableWidth).toBeLessThan(21000)
    expect(narrowProps.tableWidth).toBeGreaterThan(18000)
    for (const bytes of [doc().exportHwpx(), doc().exportHwp()]) {
      const again = new HwpDocument(bytes)
      expect(tableProps(again, 0, tableIn(again, 0).control)).toMatchObject({
        treatAsChar: false,
        vertRelTo: 'Page',
      })
    }
    // a page number or a footer in the first paragraph does not move the head
    const top = () =>
      (JSON.parse(doc().getTableBBox(0, 0, tableIn(doc(), 0).control)) as { y: number }).y
    const before = top()
    plugin.setPageNumber({ position: 'bottom_center' })
    plugin.setHeaderFooter('footer', { text: '꼬리말' })
    expect(top()).toBe(before)
  })

  it('takes a table across the columns only as the head of the document', () => {
    const { plugin, steps } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    const before = steps()
    const rows = [['학년', '반']]
    for (const [anchor, where] of [
      [PAPER[1]!, 'before'],
      [PAPER[0]!, 'after'],
      ['', 'end'],
    ] as const) {
      expect(plugin.insertTable(anchor, null, where, rows, { acrossColumns: true })).toEqual({
        ok: false,
        reason: 'not_at_start',
        count: 1,
      })
    }
    expect(steps()).toBe(before)
    // in one column the word means nothing: the table is made where it was asked for
    plugin.setColumns({ count: 1 })
    expect(
      plugin.insertTable(PAPER[1]!, null, 'after', rows, { acrossColumns: true }),
    ).toMatchObject({ ok: true })
  })

  it('makes a title box one column wide where the text runs in columns', () => {
    const { plugin, doc } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    expect(plugin.insertTitleBox(PAPER[0]!, null, { look: 'lines' })).toMatchObject({ ok: true })
    const box = tableIn(doc(), 0)
    const props = tableProps(doc(), 0, box.control)
    expect(props.treatAsChar).toBe(true)
    expect(props.tableWidth).toBeLessThan(21000)
    expect(props.tableWidth).toBeGreaterThan(18000)
  })

  it('starts a paragraph on a new page or in the next column', () => {
    const { plugin, doc, steps } = open(blank(PAPER))
    plugin.setColumns({ count: 2 })
    const pages = doc().pageCount()
    const before = steps()
    const column = plugin.insertBreak('3. 다음 글을', null, 'column')
    expect(column).toMatchObject({ ok: true, kind: 'column', columns: 2 })
    const page = plugin.insertBreak('5. 다음 글을', null, 'page')
    expect(page).toMatchObject({ ok: true, kind: 'page' })
    expect(steps()).toBe(before + 2)
    expect(doc().pageCount()).toBe(pages + 1)
    // the first paragraph starts its page already
    expect(plugin.insertBreak(PAPER[0]!, null, 'page')).toMatchObject({
      ok: false,
      reason: 'at_start',
    })
    expect(() => plugin.insertBreak('3. 다음 글을', null, 'line' as never)).toThrow(/kind must be/)
    expect(plugin.insertBreak('없는 글', null, 'page')).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('writing into an empty document', () => {
  const empty = () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    return doc
  }

  it('puts the first words into its one empty paragraph, not under an empty line', () => {
    const { plugin, doc } = open(empty())
    const result = plugin.insertParagraphs('', null, 'end', ['제목', '첫 줄'])
    expect(result).toMatchObject({ ok: true, count: 2, place: { para: 0 } })
    expect(doc().getParagraphCount(0)).toBe(2)
    expect(doc().getTextRange(0, 0, 0, 2)).toBe('제목')
    expect(doc().getTextRange(0, 1, 0, 3)).toBe('첫 줄')
    // a document that has words keeps them where they are: more go after them
    expect(plugin.insertParagraphs('', null, 'end', ['둘째 줄'])).toMatchObject({
      ok: true,
      place: { para: 2 },
    })
    expect(doc().getParagraphCount(0)).toBe(3)
  })

  it('lets the head of a test paper lie at the very top, over both columns', () => {
    const { plugin, doc } = open(empty())
    plugin.setColumns({ count: 2 })
    plugin.insertParagraphs('', null, 'end', ['1. 첫 문제', '① 가', '② 나'])
    const head = plugin.insertTable('1. 첫 문제', null, 'before', [['학교', '과목']], {
      acrossColumns: true,
    })
    expect(head).toMatchObject({ ok: true, acrossColumns: true, place: { para: 0 } })
    // the table is in the first paragraph, with the first words: nothing stands above it
    expect(tableIn(doc(), 0).cols).toBe(2)
    expect(doc().getParagraphCount(0)).toBe(3)
    expect(doc().getTextRange(0, 0, 0, 40)).toContain('1. 첫 문제')
  })

  it('keeps the page setup in the first paragraph when words are put before it', () => {
    const { plugin, doc } = open(empty())
    plugin.insertParagraphs('', null, 'end', ['본문 첫 줄'])
    plugin.setPageNumber({ position: 'bottom_center' })
    plugin.setHeaderFooter('footer', { text: '꼬리말' })
    const setup = () =>
      (JSON.parse(doc().getControls()) as { ctrlId: string; list: number; para: number }[])
        .filter((control) => control.list === 0 && control.para === 0)
        .map((control) => control.ctrlId)
        .sort()
    const before = setup()
    expect(before).toEqual(expect.arrayContaining(['cold', 'secd']))
    expect(plugin.insertParagraphs('본문 첫 줄', null, 'before', ['제목'])).toMatchObject({
      ok: true,
      place: { para: 0 },
    })
    expect(setup()).toEqual(before)
    expect(doc().getTextRange(0, 0, 0, 2)).toBe('제목')
    expect(plugin.pageLayout()).toMatchObject({
      pageNumber: { position: 'bottom_center' },
      footer: { exists: true, text: '꼬리말' },
    })
  })
})

describe('more building blocks: borders of paragraphs, character width, cell text, small tables', () => {
  const paraOf = (doc: HwpDocument, para: number) =>
    JSON.parse(doc.getParaPropertiesAt(0, para)) as {
      borderLeft: Line
      borderRight: Line
      borderTop: Line
      borderBottom: Line
      fillType: string
      fillColor: string
      alignment: string
    }
  const widthOf = (doc: HwpDocument, para: number, offset: number) =>
    JSON.parse(doc.getCharPropertiesAt(0, para, offset)) as {
      ratios: number[]
      spacings: number[]
    }

  it('draws a box round paragraphs, a line under a heading and a band beside a note', () => {
    const { plugin, doc, steps } = open()
    const before = steps()
    const result = plugin.styleParagraphs({
      styles: [
        {
          name: '제목밑줄',
          format: { bold: true, border: { sides: 'bottom', width: 0.7, color: '#1F3864' } },
        },
        { name: '보기상자', format: { border: { sides: 'box' }, background: '#F2F2F2' } },
        {
          name: '참고',
          format: {
            border: { sides: 'left', width: 1.5, color: '#1F3864' },
            background: '#EEF3FB',
          },
        },
      ],
      apply: [
        { style: '제목밑줄', startsWith: '□' },
        { style: '보기상자', startsWith: '○' },
        { style: '참고', startsWith: '-' },
      ],
    })
    expect(result).toMatchObject({ ok: true, made: 3 })
    expect(steps()).toBe(before + 1)
    for (const d of [
      doc(),
      new HwpDocument(doc().exportHwpx()),
      new HwpDocument(doc().exportHwp()),
    ]) {
      const heading = paraOf(d, 1)
      // a line under it only: the other sides have none
      expect(heading.borderBottom).toMatchObject({ type: 1, color: '#1f3864' })
      expect(heading.borderTop.type).toBe(0)
      expect(heading.borderLeft.type).toBe(0)
      const boxed = paraOf(d, 2)
      expect(
        [boxed.borderLeft, boxed.borderRight, boxed.borderTop, boxed.borderBottom].map(
          (l) => l.type,
        ),
      ).toEqual([1, 1, 1, 1])
      expect(boxed).toMatchObject({ fillType: 'solid', fillColor: '#f2f2f2' })
      const note = paraOf(d, 3)
      expect(note.borderLeft.type).toBe(1)
      expect(note.borderRight.type).toBe(0)
      expect(note.fillColor).toBe('#eef3fb')
    }
  })

  it('takes a border and a background away again, and refuses what it cannot read', () => {
    const { plugin, doc } = open()
    plugin.formatParagraph('□ 추진 배경', null, { border: { sides: 'box' }, background: '#F2F2F2' })
    expect(paraOf(doc(), 1).borderTop.type).toBe(1)
    plugin.formatParagraph('□ 추진 배경', null, { border: { sides: 'none' }, background: 'none' })
    const cleared = paraOf(doc(), 1)
    expect(
      [cleared.borderLeft, cleared.borderTop, cleared.borderBottom].map((l) => l.type),
    ).toEqual([0, 0, 0])
    expect(cleared.fillType).toBe('none')
    expect(() =>
      plugin.formatParagraph('□ 추진 배경', null, { border: { sides: 'round' as never } }),
    ).toThrow(/border sides must be one of/)
    expect(() => plugin.formatParagraph('□ 추진 배경', null, { background: 'grey' })).toThrow(
      /background must look like/,
    )
    // a border belongs to a paragraph, not to a piece of its text
    expect(() =>
      plugin.formatText('추진', null, false, { border: { sides: 'box' } } as never),
    ).toThrow(/whole paragraph/)
  })

  it('narrows and spaces characters, as official documents do to fit a line', () => {
    const { plugin, doc } = open()
    plugin.formatText('학생의 진로 탐색', null, false, { charWidth: 95, letterSpacing: -5 })
    // the text found starts after the mark of the line
    const narrowed = widthOf(doc(), 2, 4)
    expect(narrowed.ratios).toEqual(Array(7).fill(95))
    expect(narrowed.spacings).toEqual(Array(7).fill(-5))
    const again = new HwpDocument(doc().exportHwp())
    expect(widthOf(again, 2, 4).ratios[0]).toBe(95)
    // the mark in front of it keeps its own width
    expect(widthOf(doc(), 2, 0).ratios[0]).toBe(100)
    expect(() => plugin.formatText('학생의', null, false, { charWidth: 10 })).toThrow(/charWidth/)
    expect(() => plugin.formatText('학생의', null, false, { letterSpacing: 90 })).toThrow(
      /letterSpacing/,
    )
  })

  it('formats the text of a block of cells and sets the height of rows', () => {
    const { plugin, doc, para, steps } = withTable(false)
    const before = steps()
    const result = plugin.formatCells(
      1,
      { fromRow: 1, fromCol: 1, toRow: 3, toCol: 1 },
      {
        text: { bold: true, align: 'center', size: 12 },
        heightMm: 12,
      },
    )
    expect(result).toMatchObject({ ok: true, count: 3 })
    expect(steps()).toBe(before + 1)
    const table = tableIn(doc(), para)
    for (const cell of [0, 3, 6]) {
      const chars = JSON.parse(
        doc().getCellCharPropertiesAt(0, para, table.control, cell, 0, 0),
      ) as {
        bold: boolean
        fontSize: number
      }
      expect(chars).toMatchObject({ bold: true, fontSize: 1200 })
      const paragraph = JSON.parse(
        doc().getCellParaPropertiesAt(0, para, table.control, cell, 0),
      ) as {
        alignment: string
      }
      expect(paragraph.alignment).toBe('center')
      // 12 mm, in the engine's units
      expect(Math.abs(table.cell(cell).height - 3402)).toBeLessThan(40)
    }
    // the cells beside the block keep their text as it was
    const other = JSON.parse(doc().getCellCharPropertiesAt(0, para, table.control, 1, 0, 0)) as {
      bold: boolean
    }
    expect(other.bold).toBe(false)
    // text alone counts the cells it reached
    expect(plugin.formatCells(1, null, { text: { align: 'right' } })).toMatchObject({
      ok: true,
      count: 9,
    })
    expect(() => plugin.formatCells(1, null, { heightMm: 900 })).toThrow(/heightMm/)
    expect(() => plugin.formatCells(1, null, { text: { style: '본문' } as never })).toThrow(
      /a style is not made of other styles/,
    )
  })

  it('makes a small table at the right, as an approval box stands', () => {
    const { plugin, doc } = open()
    const made = plugin.insertTable(
      TITLE,
      null,
      'after',
      [
        ['결재', '담당', '팀장', '교장'],
        ['', '', '', ''],
      ],
      {
        widthPercent: 40,
        place: 'right',
      },
    )
    expect(made).toMatchObject({ ok: true, rows: 2, cols: 4 })
    const table = tableIn(doc(), 1)
    const props = JSON.parse(doc().getTableProperties(0, 1, table.control)) as {
      tableWidth: number
    }
    // 40 percent of a text width of 425 pt
    expect(props.tableWidth).toBeGreaterThan(15500)
    expect(props.tableWidth).toBeLessThan(18500)
    expect(paraOf(doc(), 1).alignment).toBe('right')
    expect(() => plugin.insertTable(TITLE, null, 'after', [['가']], { widthPercent: 5 })).toThrow(
      /widthPercent/,
    )
    expect(() =>
      plugin.insertTable(TITLE, null, 'after', [['가']], { place: 'top' as never }),
    ).toThrow(/place must be one of/)
  })

  it('repeats the header row of a long table on every page', () => {
    const { plugin, doc } = open()
    plugin.insertTable(TITLE, null, 'after', ROWS, { header: true, repeatHeader: true })
    const table = tableIn(doc(), 1)
    const read = (d: HwpDocument) =>
      (JSON.parse(d.getTableProperties(0, 1, table.control)) as { repeatHeader: boolean })
        .repeatHeader
    expect(read(doc())).toBe(true)
    expect(read(new HwpDocument(doc().exportHwpx()))).toBe(true)
  })
})

describe('a title box and the colour of its words', () => {
  const titleColor = (doc: HwpDocument) => {
    const box = tableIn(doc, 0)
    const cell = box.cells === 3 ? 1 : 0
    return (
      JSON.parse(doc.getCellCharPropertiesAt(0, 0, box.control, cell, 0, 0)) as {
        textColor: string
      }
    ).textColor
  }

  it('leaves out a text colour that cannot be told from what is behind the title', () => {
    // white words between two bands stand on the white page
    const bands = open()
    expect(
      bands.plugin.insertTitleBox(TITLE, null, { look: 'bands', textColor: '#FFFFFF' }),
    ).toMatchObject({ ok: true, textColorDropped: true })
    expect(titleColor(bands.doc())).toBe('#000000')
    // and on a pale fill
    const pale = open()
    expect(
      pale.plugin.insertTitleBox(TITLE, null, { look: 'shaded', textColor: '#FFFFFF' }),
    ).toMatchObject({ ok: true, textColorDropped: true })
  })

  it('takes white words on a dark fill, and a dark colour anywhere', () => {
    const dark = open()
    const made = dark.plugin.insertTitleBox(TITLE, null, {
      look: 'shaded',
      color: '#1F3864',
      textColor: '#FFFFFF',
    })
    expect(made).toMatchObject({ ok: true })
    expect(made).not.toHaveProperty('textColorDropped')
    expect(titleColor(dark.doc())).toBe('#ffffff')
    const blue = open()
    const lined = blue.plugin.insertTitleBox(TITLE, null, { look: 'lines', textColor: '#1F3864' })
    expect(lined).not.toHaveProperty('textColorDropped')
    expect(titleColor(blue.doc())).toBe('#1f3864')
  })
})

describe('equations, a diagonal, the page border, tab stops, the size of a picture', () => {
  const textOf = (doc: HwpDocument, para: number) =>
    doc.getTextRange(0, para, 0, doc.getParagraphLength(0, para))
  const equationsOf = (doc: HwpDocument) =>
    (
      JSON.parse(doc.getControls()) as { ctrlId: string; para: number; controlIndex: number }[]
    ).filter((control) => control.ctrlId === 'eqed')
  /** The width of the text of the first section, in the engine's units. */
  const textWidth = (doc: HwpDocument) => {
    const page = JSON.parse(doc.getPageDef(0)) as {
      width: number
      marginLeft: number
      marginRight: number
    }
    return page.width - page.marginLeft - page.marginRight
  }
  const tabsOf = (doc: HwpDocument, para: number) =>
    (
      JSON.parse(doc.getParaPropertiesAt(0, para)) as {
        tabStops: { position: number; type: number; fill: number }[]
      }
    ).tabStops

  /** A small PNG of one colour, made here. */
  function png(width: number, height: number): Uint8Array {
    const table = new Uint32Array(256).map((_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    const crc = (bytes: Uint8Array) => {
      let c = 0xffffffff
      for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(4)
      head.writeUInt32BE(body.length)
      const tail = Buffer.alloc(4)
      tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), body])))
      return Buffer.concat([head, Buffer.from(type), body, tail])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header.set([8, 2, 0, 0, 0], 8)
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)])
    const raw = Buffer.concat(Array<Buffer>(height).fill(row))
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    )
  }

  it('draws a diagonal across a cell, crosses one out and takes the line away', () => {
    const { plugin, doc, para, steps } = withTable(false)
    const cellOf = (source: HwpDocument, cell: number) =>
      JSON.parse(source.getCellProperties(0, para, tableIn(source, para).control, cell)) as {
        diagonalSlash: number
        diagonalBackSlash: number
        diagonalLine: number
      }
    const before = steps()
    expect(plugin.formatCells(1, [{ row: 1, col: 1 }], { diagonal: 'down' })).toMatchObject({
      ok: true,
      count: 1,
    })
    expect(steps()).toBe(before + 1)
    // the corner cell holds a word, which the line runs through: the answer says so
    expect(plugin.formatCells(1, [{ row: 1, col: 1 }], { diagonal: 'down' })).toMatchObject({
      crossed: [{ row: 1, col: 1 }],
    })
    // from the top left to the bottom right, a solid line
    expect(cellOf(doc(), 0)).toMatchObject({
      diagonalBackSlash: 2,
      diagonalSlash: 0,
      diagonalLine: 1,
    })
    // the cell beside it has none
    expect(cellOf(doc(), 1)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 0 })
    // both file formats keep it
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(cellOf(new HwpDocument(saved), 0).diagonalBackSlash).toBe(2)
    }
    plugin.formatCells(1, [{ row: 2, col: 2 }], { diagonal: 'both' })
    expect(cellOf(doc(), 4)).toMatchObject({ diagonalBackSlash: 2, diagonalSlash: 2 })
    plugin.formatCells(1, [{ row: 1, col: 1 }], { diagonal: 'up' })
    expect(cellOf(doc(), 0)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 2 })
    // taking the line away crosses nothing
    expect(plugin.formatCells(1, null, { diagonal: 'none' })).not.toHaveProperty('crossed')
    expect(cellOf(doc(), 0)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 0 })
    expect(cellOf(doc(), 4)).toMatchObject({ diagonalBackSlash: 0, diagonalSlash: 0 })
    expect(() => plugin.formatCells(1, null, { diagonal: 'zigzag' as never })).toThrow(/diagonal/)
  })

  it('draws a line round the pages, reads it back and takes it away', () => {
    const { plugin, doc, steps } = open()
    const sideOf = (source: HwpDocument, side: string) =>
      (JSON.parse(source.getPageBorderFill(0)) as Record<string, Line>)[side]!
    expect(plugin.pageLayout().pageBorder).toBeNull()
    const before = steps()
    expect(plugin.setPageBorder({ line: 'double', width: 0.7, color: '#1F3864' })).toEqual({
      ok: true,
      sections: 1,
      drawn: true,
    })
    expect(steps()).toBe(before + 1)
    for (const side of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']) {
      expect(sideOf(doc(), side).type).toBe(8)
      expect(sideOf(doc(), side).color.toLowerCase()).toBe('#1f3864')
    }
    expect(plugin.pageLayout().pageBorder).toMatchObject({ line: 'double' })
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(sideOf(new HwpDocument(saved), 'borderTop').type).toBe(8)
    }
    expect(plugin.setPageBorder({ line: 'none' })).toMatchObject({ ok: true, drawn: false })
    expect(sideOf(doc(), 'borderTop').type).toBe(0)
    expect(plugin.pageLayout().pageBorder).toBeNull()
    expect(() => plugin.setPageBorder({ line: 'wavy' as never })).toThrow(/line/)
    expect(() => plugin.setPageBorder({ line: 'solid', color: 'navy' })).toThrow(/color/)
  })

  it('sets tab stops with a leader: the right edge of the text unless a place is given', () => {
    const lines = ['차례', '제1장 추진 배경\t3', '제2장 세부 계획\t12', '성명: 홍길동\t(인)', '끝']
    const { plugin, doc, steps } = open(blank(lines))
    const edge = textWidth(doc()) * 2
    const before = steps()
    expect(
      plugin.formatParagraph('제1장 추진 배경', null, { tabs: [{ leader: 'dots' }] }),
    ).toMatchObject({ ok: true })
    expect(steps()).toBe(before + 1)
    // a right tab at the right edge of the text, dots leading to it
    expect(tabsOf(doc(), 1)).toEqual([{ position: edge, type: 1, fill: 3 }])
    // the other paragraphs keep theirs
    expect(tabsOf(doc(), 2)).toEqual([])
    // with a right margin the edge is that much nearer: a stop is counted from the left
    // edge of the text, not from the margins of its paragraph
    plugin.formatParagraph('제2장 세부 계획', null, {
      marginRight: 20,
      tabs: [{ leader: 'dashes' }],
    })
    expect(tabsOf(doc(), 2)).toEqual([{ position: edge - 20 * 200, type: 1, fill: 2 }])
    // stops at places of their own, sorted from the left, the edge last
    plugin.formatParagraph('성명: 홍길동', null, {
      tabs: [{ leader: 'line' }, { atMm: 60, align: 'center' }, { atMm: 30.5, align: 'decimal' }],
    })
    expect(tabsOf(doc(), 3)).toEqual([
      { position: Math.round(((30.5 * 7200) / 25.4) * 2), type: 3, fill: 0 },
      { position: Math.round(((60 * 7200) / 25.4) * 2), type: 2, fill: 0 },
      { position: edge, type: 1, fill: 1 },
    ])
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(tabsOf(new HwpDocument(saved), 1)).toEqual([{ position: edge, type: 1, fill: 3 }])
    }
    // an empty list takes the stops away
    plugin.formatParagraph('제1장 추진 배경', null, { tabs: [] })
    expect(tabsOf(doc(), 1)).toEqual([])
    // a style carries them to every paragraph it is given to
    plugin.styleParagraphs({
      styles: [{ name: '차례 줄', format: { tabs: [{ leader: 'dots' }] } }],
      apply: [{ style: '차례 줄', startsWith: '제' }],
    })
    expect(tabsOf(doc(), 1)).toEqual([{ position: edge, type: 1, fill: 3 }])
    expect(tabsOf(doc(), 2)).toEqual([{ position: edge, type: 1, fill: 3 }])
    for (const bad of [
      { tabs: 'dots' },
      { tabs: [{ leader: 'stars' }] },
      { tabs: [{ align: 'middle' }] },
      { tabs: [{ atMm: 0 }] },
      { tabs: [{}, {}] },
    ]) {
      expect(() => plugin.formatParagraph('끝', null, bad as never)).toThrow(/tab/)
    }
    // tab stops belong to a paragraph, not to a piece of its text
    expect(() => plugin.formatText('끝', null, false, { tabs: [{}] })).toThrow(/whole paragraph/)
  })

  it('takes a tab in the text of a new paragraph, and no other control character', () => {
    const { plugin, doc } = open()
    expect(plugin.insertParagraphs('', null, 'end', ['부록 1\t21'])).toMatchObject({ ok: true })
    const last = doc().getParagraphCount(0) - 1
    expect(textOf(doc(), last)).toBe('부록 1\t21')
    expect(() => plugin.insertParagraphs('', null, 'end', ['종\u0007'])).toThrow()
  })

  it('gives a picture another width and keeps its shape', () => {
    const start = blank(['그림 자리', '끝'])
    start.insertPicture(0, 0, 0, '', png(120, 80), 9000, 6000, 120, 80, 'png', '')
    const { plugin, doc, steps } = open(start)
    expect(plugin.listPictures().count).toBe(1)
    const sizeOf = (source: HwpDocument) => {
      const picture = (
        JSON.parse(source.getControls()) as { ctrlId: string; para: number; controlIndex: number }[]
      ).find((control) => /pic|gso/.test(control.ctrlId))!
      return JSON.parse(source.getPictureProperties(0, picture.para, picture.controlIndex)) as {
        width: number
        height: number
      }
    }
    expect(sizeOf(doc())).toMatchObject({ width: 9000, height: 6000 })
    const before = steps()
    const result = plugin.resizePicture(1, { widthMm: 60 })
    expect(result).toMatchObject({ ok: true, widthMm: 60, heightMm: 40, fitted: false })
    expect(steps()).toBe(before + 1)
    // 60 mm in the engine's units, the height in the same proportion
    expect(sizeOf(doc())).toEqual(expect.objectContaining({ width: 17008, height: 11339 }))
    expect(sizeOf(new HwpDocument(doc().exportHwp())).width).toBe(17008)
    // never wider than the text of its page
    const wide = plugin.resizePicture(1, { widthMm: 300 })
    expect(wide).toMatchObject({ ok: true, fitted: true })
    expect(sizeOf(doc()).width).toBeLessThanOrEqual(textWidth(doc()) + 100)
    expect(sizeOf(doc()).height / sizeOf(doc()).width).toBeCloseTo(2 / 3, 2)
    expect(plugin.resizePicture(2, { widthMm: 50 })).toEqual({
      ok: false,
      reason: 'no_such_picture',
      count: 1,
    })
    expect(() => plugin.resizePicture(1, { widthMm: 1 })).toThrow(/widthMm/)
  })

  it('puts equations in the place of their placeholders, as large as the text there', () => {
    const lines = ['1. 다음을 계산하시오. [[1]]', '2. [[2]] 의 값은? 또 [[3]] 은?', '끝']
    const start = blank(lines)
    // the second line is 14 pt
    start.applyCharFormat(
      0,
      1,
      0,
      start.getParagraphLength(0, 1),
      JSON.stringify({ fontSize: 1400 }),
    )
    const { plugin, doc, steps } = open(start)
    const before = steps()
    const result = plugin.insertEquations([
      { find: '[[1]]', script: '{1} over {2} + {1} over {3}' },
      { find: '[[2]]', script: 'sqrt {16}' },
      { find: '[[3]]', script: 'x^2 + 2x + 1' },
    ])
    expect(result).toMatchObject({ ok: true, count: 3 })
    expect(steps()).toBe(before + 1)
    // the placeholders are gone, the words round them stay
    expect(textOf(doc(), 0)).not.toContain('[[')
    expect(textOf(doc(), 1)).not.toContain('[[')
    expect(textOf(doc(), 0)).toContain('1. 다음을 계산하시오.')
    expect(textOf(doc(), 1)).toContain('의 값은? 또')
    const made = equationsOf(doc())
    expect(made.map((equation) => equation.para)).toEqual([0, 1, 1])
    // each holds its script and is as large as the text it stands in
    const written = made.map(
      (equation) =>
        JSON.parse(
          doc().getEquationProperties(0, equation.para, equation.controlIndex, -1, -1),
        ) as { script: string; fontSize: number },
    )
    expect(written.map((equation) => equation.fontSize)).toEqual([1000, 1400, 1400])
    expect(written.map((equation) => equation.script)).toEqual([
      '{1} over {2} + {1} over {3}',
      'sqrt {16}',
      'x^2 + 2x + 1',
    ])
    // the text the model reads back does not show them
    expect(plugin.readText()).not.toContain('over')
    for (const saved of [doc().exportHwp(), doc().exportHwpx()]) {
      expect(equationsOf(new HwpDocument(saved))).toHaveLength(3)
    }
  })

  it('keeps the text when asked to, and leaves the document alone when one cannot be placed', () => {
    const { plugin, doc, steps } = withTable(false)
    const before = steps()
    // right after the text it names
    expect(
      plugin.insertEquations([{ find: '추진 배경', script: 'a^2 + b^2 = c^2', replace: false }]),
    ).toMatchObject({ ok: true, count: 1 })
    expect(textOf(doc(), 1)).toContain('□ 추진 배경')
    expect(equationsOf(doc())).toHaveLength(1)
    expect(steps()).toBe(before + 1)
    // the second item is not in the document: the first is not put in either
    expect(
      plugin.insertEquations([
        { find: '세부 일정', script: 'x' },
        { find: '없는 글', script: 'y' },
      ]),
    ).toMatchObject({ ok: false, reason: 'not_found', index: 1, find: '없는 글' })
    expect(equationsOf(doc())).toHaveLength(1)
    expect(steps()).toBe(before + 1)
    // text that occurs twice needs its occurrence
    expect(plugin.insertEquations([{ find: '○', script: 'x' }])).toMatchObject({
      ok: false,
      reason: 'ambiguous',
      index: 0,
      count: 2,
    })
    // text of a table cell
    expect(plugin.insertEquations([{ find: ROWS[1]![0]!, script: 'x' }])).toMatchObject({
      ok: false,
      reason: 'in_table',
      index: 0,
    })
    expect(() => plugin.insertEquations([])).toThrow(/equations/)
    expect(() => plugin.insertEquations([{ find: '세부 일정', script: '  ' }])).toThrow(/script/)
    expect(() => plugin.insertEquations([{ find: '', script: 'x' }])).toThrow(/find/)
  })
})
