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
  HidingCarryRefused,
  checkSourceCarriable,
  createHidingCarry,
  sourceHidingMarks,
} from '../src/renderer/hiding/merge-carry'
import { readHidingMarks } from '../src/renderer/hiding/marks'
import type { WorkbookFile } from '../src/shared/desktop-api'
import type { UniverRuntime } from '../src/renderer/univer-state'

function source(definedNames: WorkbookFile['definedNames'], pivots = false): WorkbookFile {
  return {
    name: 'roster.xlsx',
    sessionId: '22222222-2222-4222-8222-222222222222',
    definedNames,
    sheets: [
      { id: 'a', name: 'Names', pivotRanges: [], pivotTables: [] },
      {
        id: 'b',
        name: 'Calc',
        pivotRanges: pivots ? [{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 }] : [],
        pivotTables: [],
      },
    ],
  } as unknown as WorkbookFile
}

const read =
  (formulas: Record<string, { row: number; column: number; formula: string }[]>) =>
  async (request: { sheetId: string }) => ({
    cells: (formulas[request.sheetId] ?? []).map((cell) => ({ ...cell, value: 0 })),
    sharedGroups: [],
    indexingComplete: true,
    truncated: false,
  })

describe('carrying hiding marks through a merge', () => {
  it('reads a source’s marks, sheet-scoped ones included', () => {
    const marks = sourceHidingMarks(
      source([
        { name: 'IeumHide_이름', formula: 'Names!$B$2:$B$1048576' },
        { name: 'IeumHide2_이름', formula: '$C$2', sheetIndex: 1 },
        { name: 'Other', formula: 'Names!$A$1' },
      ]),
    )
    expect(marks?.map((mark) => [mark.name, mark.areas[0]?.sheetId])).toEqual([
      ['IeumHide_이름', 'a'],
      ['IeumHide2_이름', 'b'],
    ])
    expect(sourceHidingMarks(source([{ name: 'Other', formula: 'Names!$A$1' }]))).toBeNull()
  })

  it('refuses a source whose marks cannot be resolved', () => {
    expect(() => sourceHidingMarks(source([{ name: 'IeumHide_x', formula: '#REF!' }]))).toThrow(
      HidingCarryRefused,
    )
  })

  it('refuses a source where something leans on the hidden cells, or that holds a pivot', async () => {
    const file = source([{ name: 'IeumHide_이름', formula: 'Names!$B$2:$B$9' }])
    const marks = sourceHidingMarks(file)!
    await expect(
      checkSourceCarriable(
        file,
        marks,
        read({ b: [{ row: 0, column: 0, formula: 'Names!B3' }] }) as never,
      ),
    ).rejects.toBeInstanceOf(HidingCarryRefused)
    await expect(
      checkSourceCarriable(
        file,
        marks,
        read({ b: [{ row: 0, column: 0, formula: 'INDIRECT("x")' }] }) as never,
      ),
    ).rejects.toBeInstanceOf(HidingCarryRefused)
    await expect(
      checkSourceCarriable(
        file,
        marks,
        read({ b: [{ row: 0, column: 0, formula: 'SUM(Names!C2:C9)' }] }) as never,
      ),
    ).resolves.toBeUndefined()
    const pivoted = source([{ name: 'IeumHide_이름', formula: 'Names!$B$2:$B$9' }], true)
    await expect(checkSourceCarriable(pivoted, marks, read({}) as never)).rejects.toBeInstanceOf(
      HidingCarryRefused,
    )
  })

  it('re-creates the marks on the merged sheets as they arrive', () => {
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
      sheetOrder: ['m1', 'm2', 'm3'],
      sheets: {
        m1: { id: 'm1', name: 'Mine', rowCount: 10, columnCount: 5 },
        m2: { id: 'm2', name: 'Names', rowCount: 10, columnCount: 5 },
        m3: { id: 'm3', name: 'Calc', rowCount: 10, columnCount: 5 },
      },
    })
    const runtime = { univer, univerAPI: FUniver.newAPI(univer) } as unknown as UniverRuntime
    ;(
      runtime.univerAPI.getActiveWorkbook() as unknown as {
        insertDefinedName(n: string, r: string): void
      }
    ).insertDefinedName('IeumHide_이름', 'Mine!$A$1')
    const marks = sourceHidingMarks(
      source([{ name: 'IeumHide_이름', formula: 'Names!$B$2:$B$9,Calc!$A$1' }]),
    )!
    const carry = createHidingCarry(runtime, marks, 'ko')
    carry.sheetAdded('a', 'm2')
    carry.sheetAdded('b', 'm3')
    const now = readHidingMarks(runtime, null)
    expect(now.ok && now.marks.find((mark) => mark.name === 'IeumHide2_이름')?.areas).toEqual([
      { sheetId: 'm2', startRow: 1, endRow: 8, startColumn: 1, endColumn: 1 },
      { sheetId: 'm3', startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    ])
    univer.dispose()
  })
})
