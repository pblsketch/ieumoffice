import { describe, expect, it } from 'vitest'
import { createValueNumbering } from '@genoffice/agent-core/hiding-values'
import type { WorkbookOperation } from '@genoffice/xlsx-gateway/domain/workbook-dsl'

import {
  createDependencyIndex,
  formulaRefAreas,
  type HidingNode,
} from '../src/renderer/hiding/dependents'
import {
  formatHidingReference,
  parseHidingReference,
  resolveHidingMarks,
  type HidingSheet,
} from '../src/renderer/hiding/marks'
import { createSheetHidingView, type SheetHidingView } from '../src/renderer/hiding/view'
import { hidingOperationError } from '../src/renderer/hiding/skill-guard'

const SHEETS: HidingSheet[] = [
  { id: 's1', name: '명단' },
  { id: 's2', name: 'Scores' },
]

describe('hiding names resolve to areas', () => {
  it('reads column-below-header, whole-column, cell and multi-area references', () => {
    const marks = resolveHidingMarks(
      [
        { name: 'IeumHide_학생이름', formula: "='명단'!$B$2:$B$1048576" },
        { name: 'IeumHide2_학생이름', formula: "'명단'!$C:$C" },
        { name: 'ieumhide_v1.2_전화', formula: "Scores!$A$3:$B$9,'명단'!$F$2" },
        { name: 'Revenue', formula: 'Scores!$A$1' },
      ],
      SHEETS,
    )
    expect(marks.ok).toBe(true)
    if (!marks.ok) return
    expect(marks.marks.map((mark) => [mark.name, mark.label])).toEqual([
      ['IeumHide_학생이름', '학생이름'],
      ['IeumHide2_학생이름', '학생이름'],
      ['ieumhide_v1.2_전화', 'v1.2_전화'],
    ])
    expect(marks.marks[0]?.areas).toEqual([
      { sheetId: 's1', startRow: 1, endRow: 1_048_575, startColumn: 1, endColumn: 1 },
    ])
    expect(marks.marks[1]?.areas[0]).toMatchObject({ startRow: 0, startColumn: 2, endColumn: 2 })
    expect(marks.marks[2]?.areas).toHaveLength(2)
  })

  it('fails closed on #REF!, a missing sheet, a formula, or a name the engine refused', () => {
    for (const formula of ['#REF!', "'Gone'!$A$1", 'SUM(Scores!A1:A3)', "'명단'!#REF!"]) {
      const marks = resolveHidingMarks([{ name: 'IeumHide_x', formula }], SHEETS)
      expect(marks).toEqual({ ok: false, names: ['IeumHide_x'] })
    }
    expect(resolveHidingMarks([], SHEETS, ['IeumHide_y', 'Other'])).toEqual({
      ok: false,
      names: ['IeumHide_y'],
    })
  })

  it('writes a reference that reads back to the same areas', () => {
    const areas = parseHidingReference("'명단'!$B$2:$B$1048576,Scores!$C$3", SHEETS)!
    const text = formatHidingReference(areas, SHEETS)
    expect(text).toBe("'명단'!$B$2:$B$1048576,'Scores'!$C$3")
    expect(parseHidingReference(text, SHEETS)).toEqual(areas)
  })
})

describe('formula references', () => {
  const context = { sheets: SHEETS }
  it('reads plain, cross-sheet, whole-column and lowercase references', () => {
    expect(formulaRefAreas('=SUM(b2:b4)+Scores!A1', 's1', context)).toEqual([
      { sheetId: 's1', startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 },
      { sheetId: 's2', startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    ])
    expect(formulaRefAreas("=COUNTA('명단'!B:B)", 's2', context)).toEqual([
      { sheetId: 's1', startRow: 0, endRow: 1_048_575, startColumn: 1, endColumn: 1 },
    ])
  })

  it('cannot follow computed, named, structured, external or unknown-sheet references', () => {
    for (const formula of [
      '=INDIRECT("B"&2)',
      '=SUM(OFFSET(A1,1,1))',
      '=IeumHide_학생이름',
      '=SUM(MyRange)',
      '=SUM(Table1[Score])',
      '=[1]Sheet1!A1',
      '=Gone!A1',
      '=SUM(Sheet1:Sheet3!A1)',
    ]) {
      expect(formulaRefAreas(formula, 's1', context)).toBe('unknown')
    }
    expect(formulaRefAreas('="INDIRECT(A1)"&B2', 's1', context)).not.toBe('unknown')
  })
})

const MARKS = [
  {
    name: 'IeumHide_이름',
    label: '이름',
    areas: [{ sheetId: 's1', startRow: 1, endRow: 1_048_575, startColumn: 1, endColumn: 1 }],
  },
  {
    name: 'IeumHide_성적',
    label: '성적',
    areas: [{ sheetId: 's2', startRow: 1, endRow: 9, startColumn: 2, endColumn: 2 }],
  },
]

function node(sheetId: string, row: number, column: number, formula: string): HidingNode {
  return {
    area: { sheetId, startRow: row, endRow: row, startColumn: column, endColumn: column },
    refs: formulaRefAreas(formula, sheetId, { sheets: SHEETS }),
  }
}

describe('dependency index', () => {
  it('follows chains across sheets and joins labels in code point order', () => {
    const index = createDependencyIndex(MARKS, [
      node('s1', 1, 3, '=B2'), // D2 reads a name
      node('s2', 0, 5, "='명단'!D2&C3"), // reads D2 (name) and a score
      node('s2', 0, 6, '=F1'), // reads it through F1
      node('s1', 1, 4, '=A2*2'), // reads nothing hidden
    ])
    expect([...(index.labelsAt('s1', 1, 3) ?? [])]).toEqual(['이름'])
    expect([...(index.labelsAt('s2', 0, 6) ?? [])].sort()).toEqual(['성적', '이름'])
    expect(index.labelsAt('s1', 1, 4)).toBeNull()
    expect(
      index.hasDependentIn({ sheetId: 's2', startRow: 0, endRow: 0, startColumn: 0, endColumn: 9 }),
    ).toBe(true)
    expect(
      index.hasDependentIn({ sheetId: 's1', startRow: 1, endRow: 1, startColumn: 4, endColumn: 4 }),
    ).toBe(false)
  })

  it('counts unknown formulas, circular chains and unknown sheets as leaning on every mark', () => {
    const index = createDependencyIndex(
      MARKS,
      [
        node('s1', 0, 9, '=INDIRECT("B2")'),
        node('s1', 0, 10, '=L1'),
        node('s1', 0, 11, '=K1'),
        node('s1', 0, 12, '=Scores!Z1'),
      ],
      new Set(['s2']),
    )
    for (const column of [9, 10, 12]) {
      expect([...(index.labelsAt('s1', 0, column) ?? [])].sort()).toEqual(['성적', '이름'])
    }
  })
})

function view(nodes: HidingNode[] = []): SheetHidingView {
  return createSheetHidingView(MARKS, createValueNumbering(), nodes, new Set(), { sheets: SHEETS })
}

describe('operations refused on hidden content', () => {
  const v = view([node('s1', 1, 3, '=B2')])
  const refused = (op: Record<string, unknown>) =>
    hidingOperationError([op as unknown as WorkbookOperation], v)
  const cases: [string, Record<string, unknown>][] = [
    ['set_cell', { op: 'set_cell', sheetId: 's1', address: 'B3', value: 'x' }],
    ['set_formula', { op: 'set_formula', sheetId: 's1', address: 'B3', formula: '=1' }],
    ['clear_cell', { op: 'clear_cell', sheetId: 's1', address: 'B3' }],
    ['set_range', { op: 'set_range', sheetId: 's1', start: 'A3', values: [['a', 'b']] }],
    ['clear_range', { op: 'clear_range', sheetId: 's1', range: 'A1:C9' }],
    ['find_replace', { op: 'find_replace', sheetId: 's1', range: 'B:B', find: 'a', replace: 'b' }],
    ['merge_cells', { op: 'merge_cells', sheetId: 's1', range: 'A2:B2' }],
    ['set_note', { op: 'set_note', sheetId: 's1', address: 'B5', text: 'n' }],
    ['delete_rows', { op: 'delete_rows', sheetId: 's1', row: 5, count: 1 }],
    ['delete_cols', { op: 'delete_cols', sheetId: 's1', column: 'A', count: 2 }],
    ['delete_sheet', { op: 'delete_sheet', sheetId: 's2' }],
    ['duplicate_sheet', { op: 'duplicate_sheet', sheetId: 's1' }],
    ['add_defined_name', { op: 'add_defined_name', name: 'IeumHide_x', ref: 'Scores!A1' }],
    ['delete_defined_name', { op: 'delete_defined_name', name: 'ieumhide2_이름' }],
    ['copy_range', { op: 'copy_range', sheetId: 's1', source: 'B2:B5', target: 'H2' }],
    ['copy_range into', { op: 'copy_range', sheetId: 's1', source: 'H2:H5', target: 'B2' }],
    ['copy_range leaning', { op: 'copy_range', sheetId: 's1', source: 'D2', target: 'H2' }],
    ['move_range', { op: 'move_range', sheetId: 's1', source: 'B2', target: 'H2' }],
    ['fill_range', { op: 'fill_range', sheetId: 's1', source: 'B2', target: 'H2:H9' }],
    ['convert_to_values', { op: 'convert_to_values', sheetId: 's1', range: 'D1:D9' }],
    [
      'sort_range',
      { op: 'sort_range', sheetId: 's1', range: 'A1:C9', byColumn: 'A', order: 'asc' },
    ],
    [
      'sort keyed',
      { op: 'sort_range', sheetId: 's1', range: 'C1:D9', byColumn: 'D', order: 'asc' },
    ],
    ['filter', { op: 'set_filter_criteria', sheetId: 's1', column: 'B', values: ['x'] }],
    ['cf', { op: 'add_conditional_format', sheetId: 's1', range: 'B1:B9', rule: { type: 'x' } }],
    [
      'cf formula',
      { op: 'add_conditional_format', sheetId: 's1', range: 'H1:H9', rule: { formula: '=B2="a"' } },
    ],
    ['validation', { op: 'set_data_validation', sheetId: 's2', range: 'C2', validation: null }],
    ['pivot', { op: 'add_pivot', sheetId: 's1', sourceRange: 'A1:C9', targetCell: 'H1' }],
  ]
  it.each(cases)('%s', (_name, op) => {
    expect(refused(op)).toMatch(/Rejected/)
  })

  it('lets formulas read hidden cells and leaves other edits alone', () => {
    for (const op of [
      { op: 'set_formula', sheetId: 's1', address: 'H2', formula: '=LEN(B2)' },
      { op: 'set_cell', sheetId: 's1', address: 'D2', value: 3 },
      { op: 'insert_rows', sheetId: 's1', row: 3, count: 1 },
      { op: 'format_range', sheetId: 's1', range: 'B2:B9', format: { bold: true } },
      { op: 'fill_range', sheetId: 's1', source: 'D2', target: 'D3:D9' },
      { op: 'sort_range', sheetId: 's1', range: 'E1:F9', byColumn: 'E', order: 'asc' },
      { op: 'add_defined_name', name: 'Total', ref: 'Scores!A1' },
    ]) {
      expect(refused(op)).toBeNull()
    }
  })

  it('refuses nothing in a workbook without marks', () => {
    const none = createSheetHidingView([], createValueNumbering(), [], new Set(), {
      sheets: SHEETS,
    })
    expect(none.active).toBe(false)
    expect(
      hidingOperationError(
        [{ op: 'delete_sheet', sheetId: 's1' } as unknown as WorkbookOperation],
        none,
      ),
    ).toBeNull()
  })
})
