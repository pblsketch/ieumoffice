// Find and replace on the phone: the grid's own cells, then (while the
// workbook is streamed) the engine's file search with this session's edits
// laid over it, the desktop's match rules, and replacements that land in the
// edit journal.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findInWorkbook,
  replaceHit,
  revealHit,
  type FindOptions,
} from '../src/renderer/editors/sheets/toolbar/find'
import { boot, settle } from './helpers/sheetsToolbarBoot'

const OPTIONS: FindOptions = {
  text: 'apple',
  matchCase: false,
  entireCell: false,
  workbook: false,
  formulas: false,
}

afterEach(() => {
  Reflect.deleteProperty(window, 'desktopApi')
})

function at(hits: readonly { row: number; column: number }[]): string[] {
  return hits.map((hit) => `${hit.row}:${hit.column}`)
}

describe('find on the phone', () => {
  it("matches the grid's cells with the desktop's rules", async () => {
    const { runtime, lazyWorkbookRef, sheet } = boot()
    sheet.getRange('A1').setValue('apple')
    sheet.getRange('C5').setValue('Apple pie')
    sheet.getRange('B2').setValue(12)
    sheet.getRange('D3').setValue('=LEN("apple")')

    const plain = await findInWorkbook(runtime, lazyWorkbookRef, OPTIONS)
    expect(at(plain.hits)).toEqual(['0:0', '4:2'])
    const cased = await findInWorkbook(runtime, lazyWorkbookRef, {
      ...OPTIONS,
      text: 'Apple',
      matchCase: true,
    })
    expect(at(cased.hits)).toEqual(['4:2'])
    const whole = await findInWorkbook(runtime, lazyWorkbookRef, { ...OPTIONS, entireCell: true })
    expect(at(whole.hits)).toEqual(['0:0'])
    const formulas = await findInWorkbook(runtime, lazyWorkbookRef, { ...OPTIONS, formulas: true })
    expect(at(formulas.hits)).toContain('2:3')
    const number = await findInWorkbook(runtime, lazyWorkbookRef, { ...OPTIONS, text: '12' })
    expect(at(number.hits)).toEqual(['1:1'])
  }, 180_000)

  it('searches every sheet only when asked', async () => {
    const { runtime, lazyWorkbookRef, sheet, workbook } = boot()
    sheet.getRange('A1').setValue('apple')
    const other = workbook.insertSheet()
    other.getRange('B2').setValue('apple')
    workbook.setActiveSheet(sheet)
    const one = await findInWorkbook(runtime, lazyWorkbookRef, OPTIONS)
    expect(one.hits.map((hit) => hit.sheetId)).toEqual(['sheet-1'])
    const all = await findInWorkbook(runtime, lazyWorkbookRef, { ...OPTIONS, workbook: true })
    expect(all.hits.map((hit) => hit.sheetId)).toEqual(['sheet-1', other.getSheetId()])
  }, 180_000)

  it("adds the file's matches outside the loaded rows, under this session's edits", async () => {
    const { runtime, lazyWorkbookRef, sheet, state } = boot({ preloadComplete: false })
    sheet.getRange('A1').setValue('apple')
    const findWorkbookCells = vi.fn(async () => ({
      matches: [
        // inside the loaded window: the grid's own cell wins
        { row: 0, column: 0, value: 'apple', valueText: 'apple' },
        // outside it
        { row: 500, column: 1, value: 'apple tree', valueText: 'apple tree' },
        { row: 700, column: 2, value: 'apple', valueText: 'apple' },
      ],
      complete: true,
      indexingComplete: true,
    }))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { findWorkbookCells },
    })
    // An edit this session moved row 700's apple away; the file still has it.
    state.editJournal.cells.set(
      'sheet-1',
      new Map([
        [
          '700:2',
          { row: 700, column: 2, hasValue: true, value: 'pear', formula: undefined } as never,
        ],
      ]),
    )
    const result = await findInWorkbook(runtime, lazyWorkbookRef, OPTIONS)
    expect(findWorkbookCells).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'apple', matchCase: false, lookIn: 'values' }),
    )
    expect(at(result.hits)).toEqual(['0:0', '500:1'])
  }, 180_000)

  it('replaces into the cell, so the edit journal records it', async () => {
    const { runtime, lazyWorkbookRef, sheet, state } = boot()
    sheet.getRange('A1').setValue('apple pie')
    sheet.getRange('A2').setValue(1234)
    const [hit] = (await findInWorkbook(runtime, lazyWorkbookRef, OPTIONS)).hits
    expect(replaceHit(runtime, hit!, OPTIONS, 'pear')).toBe(true)
    await settle()
    expect(sheet.getRange('A1').getValue()).toBe('pear pie')
    const [number] = (await findInWorkbook(runtime, lazyWorkbookRef, { ...OPTIONS, text: '23' }))
      .hits
    expect(replaceHit(runtime, number!, { ...OPTIONS, text: '23' }, '99')).toBe(true)
    // A number stays a number (the desktop's coerceReplaceValue).
    expect(sheet.getRange('A2').getValue()).toBe(1994)
    const journal = state.editJournal.cells.get('sheet-1')
    expect([...(journal?.values() ?? [])].map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['pear pie', 1994]),
    )
    revealHit(runtime, lazyWorkbookRef, hit!, () => undefined)
    expect(runtime.univerAPI.getActiveWorkbook()!.getActiveRange()!.getA1Notation()).toBe('A1')
  }, 180_000)
})
