import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import sheetsEn from '@univerjs/sheets/locale/en-US'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { describe, expect, it } from 'vitest'

import {
  columnHeaderText,
  columnHideStart,
  createHidingMark,
  hideTargetOf,
  removeHiding,
  subtractArea,
} from '../src/renderer/hiding/actions'
import { liveDefinedNames, readHidingMarks } from '../src/renderer/hiding/marks'
import type { UniverRuntime } from '../src/renderer/univer-state'

const MAX = 1_048_575

describe('column header rule', () => {
  it('hides below a text header that has values under it', () => {
    expect(columnHideStart(['이름', '김민지', '이준'])).toBe(1)
    expect(columnHeaderText(['이름', '김민지'])).toBe('이름')
    // a title block above the header: the first value is the header
    expect(columnHideStart([null, '', 'Name', 'Kim'])).toBe(3)
  })

  it('hides the whole column when the first value is a number, alone, or absent', () => {
    expect(columnHideStart([1, 2, 3])).toBe(0)
    expect(columnHideStart(['2024', 'x'])).toBe(0)
    expect(columnHideStart(['Name'])).toBe(0)
    expect(columnHideStart([])).toBe(0)
    expect(columnHeaderText([1, 2])).toBe('')
  })

  it('makes one area per run of columns that start on the same row', async () => {
    const columns: Record<number, string[]> = { 1: ['Name', 'a'], 2: ['Phone', 'b'], 3: ['x'] }
    const target = await hideTargetOf(
      [
        {
          wholeColumns: true,
          area: { sheetId: 's', startRow: 0, endRow: MAX, startColumn: 1, endColumn: 3 },
        },
        {
          wholeColumns: false,
          area: { sheetId: 's', startRow: 4, endRow: 6, startColumn: 7, endColumn: 8 },
        },
      ],
      async (_sheet, column) => columns[column] ?? [],
    )
    expect(target).toEqual({
      seed: 'Name',
      areas: [
        { sheetId: 's', startRow: 1, endRow: MAX, startColumn: 1, endColumn: 2 },
        { sheetId: 's', startRow: 0, endRow: MAX, startColumn: 3, endColumn: 3 },
        { sheetId: 's', startRow: 4, endRow: 6, startColumn: 7, endColumn: 8 },
      ],
    })
  })
})

describe('subtractArea', () => {
  const a = { sheetId: 's', startRow: 0, endRow: 9, startColumn: 0, endColumn: 3 }
  it('keeps what lies outside the cut', () => {
    expect(subtractArea(a, { ...a, startRow: 3, endRow: 4, startColumn: 1, endColumn: 2 })).toEqual(
      [
        { ...a, endRow: 2 },
        { ...a, startRow: 5 },
        { ...a, startRow: 3, endRow: 4, endColumn: 0 },
        { ...a, startRow: 3, endRow: 4, startColumn: 3 },
      ],
    )
    expect(subtractArea(a, a)).toEqual([])
    expect(subtractArea(a, { ...a, sheetId: 't' })).toEqual([a])
  })
})

describe('making and removing marks in Univer', () => {
  function boot() {
    const univer = new Univer({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: sheetsEn },
      logLevel: LogLevel.SILENT,
    })
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin)
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'wb',
      sheetOrder: ['s1'],
      sheets: { s1: { id: 's1', name: '명단 1', rowCount: 20, columnCount: 10 } },
    })
    const runtime = { univer, univerAPI: FUniver.newAPI(univer) } as unknown as UniverRuntime
    return { univer, runtime }
  }

  it('names marks with the duplicate number and cuts or drops them on stop hiding', () => {
    const { univer, runtime } = boot()
    const column = { sheetId: 's1', startRow: 1, endRow: MAX, startColumn: 1, endColumn: 1 }
    expect(createHidingMark(runtime, [column], '학생 이름', 'ko')).toBe('IeumHide_학생_이름')
    expect(
      createHidingMark(runtime, [{ ...column, startColumn: 3, endColumn: 3 }], '학생 이름', 'ko'),
    ).toBe('IeumHide2_학생_이름')
    expect(createHidingMark(runtime, [{ ...column, startRow: 4, endRow: 4 }], '', 'en')).toBe(
      'IeumHide_Sensitive_info',
    )
    expect(liveDefinedNames(runtime).map((defined) => defined.formula.replace(/^=/, ''))).toEqual([
      "'명단 1'!$B$2:$B$1048576",
      "'명단 1'!$D$2:$D$1048576",
      "'명단 1'!$B$5",
    ])
    // stop hiding rows 5–6 of column B: the column mark splits, the one-cell mark goes
    expect(
      removeHiding(runtime, [
        { sheetId: 's1', startRow: 4, endRow: 5, startColumn: 0, endColumn: 2 },
      ]),
    ).toBe(2)
    const marks = readHidingMarks(runtime, null)
    expect(marks.ok && marks.marks.map((mark) => [mark.name, mark.areas.length]).sort()).toEqual([
      ['IeumHide2_학생_이름', 1],
      ['IeumHide_학생_이름', 2],
    ])
    univer.dispose()
  })
})
