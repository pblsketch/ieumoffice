/**
 * `ieumoffice selection` (and its MCP tool) reads the user's selection out of
 * the open grid. With hiding marks a hidden cell answers its label, a cell
 * leaning on one the labels it leans on, and a workbook whose marks cannot be
 * resolved answers no values at all (민감정보 가리기).
 */
import { describe, expect, it } from 'vitest'
import type { FWorkbook } from '@univerjs/sheets/facade'
import { createValueNumbering } from '@genoffice/agent-core/hiding-values'
import { handleSheetsControl } from '../src/renderer/control'
import { formulaRefAreas } from '../src/renderer/hiding/dependents'
import type { HidingSheet, SheetHidingMark } from '../src/renderer/hiding/marks'
import { createSheetHidingView, type SheetHidingState } from '../src/renderer/hiding/view'

const SHEETS: HidingSheet[] = [{ id: 's1', name: 'Roster' }]
const MARKS: SheetHidingMark[] = [
  {
    name: 'IeumHide_이름',
    label: '이름',
    areas: [{ sheetId: 's1', startRow: 1, endRow: 1_048_575, startColumn: 1, endColumn: 1 }],
  },
]

/** A1:C2 selected: No | Name | =UPPER(B2) */
function workbook(): FWorkbook {
  const range = {
    getRow: () => 0,
    getColumn: () => 0,
    getWidth: () => 3,
    getHeight: () => 2,
    getA1Notation: () => 'A1:C2',
    getValues: () => [
      ['No', 'Name', 'Upper'],
      [1, 'Kim Minji', 'KIM MINJI'],
    ],
    getFormulas: () => [
      ['', '', ''],
      ['', '', '=UPPER(B2)'],
    ],
  }
  const sheet = {
    getSheetName: () => 'Roster',
    getSheetId: () => 's1',
    getVisibleRange: () => ({ startRow: 0, endRow: 20, startColumn: 0, endColumn: 10 }),
  }
  return {
    getActiveSheet: () => sheet,
    getActiveRange: () => range,
  } as unknown as FWorkbook
}

function hiding(): SheetHidingState {
  const view = createSheetHidingView(
    MARKS,
    createValueNumbering(),
    [
      {
        area: { sheetId: 's1', startRow: 1, endRow: 1, startColumn: 2, endColumn: 2 },
        refs: formulaRefAreas('=UPPER(B2)', 's1', { sheets: SHEETS }),
      },
    ],
    new Set(),
    { sheets: SHEETS },
  )
  return { ok: true, view }
}

describe('the selection of a workbook with hidden cells', () => {
  it('answers hidden and leaning cells as their labels', () => {
    const reply = handleSheetsControl({ cmd: 'selection' }, workbook(), true, hiding())
    expect(JSON.stringify(reply)).not.toMatch(/Kim Minji|KIM MINJI/i)
    expect(reply).toMatchObject({ status: 'ok', result: { sheet: 'Roster', range: 'A1:C2' } })
    const values = (reply as unknown as { result: { values: unknown[][] } }).result.values
    expect(values[0]).toEqual(['No', 'Name', 'Upper'])
    expect(values[1]![0]).toBe(1)
    expect(values[1]![1]).toMatch(/^\{\{이름-\d+\}\}$/)
    expect(values[1]![2]).toBe('{{이름}}')
  })

  it('answers no values for a workbook whose marks cannot be resolved', () => {
    const reply = handleSheetsControl({ cmd: 'selection' }, workbook(), true, {
      ok: false,
      names: ['IeumHide_x'],
    })
    expect(reply).toMatchObject({ status: 'error', error: { reason: 'unsupported' } })
    expect(JSON.stringify(reply)).not.toContain('Kim')
  })

  it('answers the values as they are without marks', () => {
    const reply = handleSheetsControl({ cmd: 'selection' }, workbook(), true, {
      ok: true,
      view: createSheetHidingView([], createValueNumbering(), [], new Set(), { sheets: SHEETS }),
    })
    expect((reply as unknown as { result: { values: unknown[][] } }).result.values[1]).toEqual([
      1,
      'Kim Minji',
      'KIM MINJI',
    ])
  })
})
