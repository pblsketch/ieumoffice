import {
  CommandType,
  ICommandService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
} from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import sheetsEn from '@univerjs/sheets/locale/en-US'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { describe, expect, it } from 'vitest'

import {
  followCopy,
  followReorder,
  installHidingFollow,
  normalizeAreas,
} from '../src/renderer/hiding/follow'
import { readHidingMarks, type SheetHidingMark } from '../src/renderer/hiding/marks'
import type { UniverRuntime } from '../src/renderer/univer-state'

const mark = (startRow: number, endRow: number, column: number): SheetHidingMark => ({
  name: 'IeumHide_이름',
  label: '이름',
  areas: [{ sheetId: 's1', startRow, endRow, startColumn: column, endColumn: column }],
})

describe('marks follow moved values', () => {
  it('a copy adds the shifted hidden part, tiled over a larger target', () => {
    const out = followCopy(
      [mark(1, 3, 1)],
      { sheetId: 's1', startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 },
      { sheetId: 's2', startRow: 10, endRow: 19, startColumn: 5, endColumn: 7 },
    )
    expect(out.get('IeumHide_이름')).toEqual([
      { sheetId: 's2', startRow: 11, endRow: 13, startColumn: 6, endColumn: 6 },
      { sheetId: 's2', startRow: 16, endRow: 18, startColumn: 6, endColumn: 6 },
    ])
    expect(
      followCopy(
        [mark(1, 3, 1)],
        { sheetId: 's1', startRow: 0, endRow: 4, startColumn: 3, endColumn: 4 },
        { sheetId: 's1', startRow: 0, endRow: 4, startColumn: 8, endColumn: 9 },
      ).size,
    ).toBe(0)
  })

  it('a sort adds the rows hidden values land on; rows inside the mark need nothing', () => {
    // rows 1..4 reordered: new row 1 <- old 4, 2 <- 3, 3 <- 2, 4 <- 1; B3:B4 (rows 2..3) is hidden
    const order = { 1: 4, 2: 3, 3: 2, 4: 1 }
    const out = followReorder(
      [mark(2, 3, 1)],
      's1',
      { startRow: 1, endRow: 4, startColumn: 0, endColumn: 3 },
      order,
    )
    // old 3 -> new 2 (inside), old 2 -> new 3 (inside): nothing new
    expect(out.size).toBe(0)
    const moved = followReorder(
      [mark(1, 1, 1)],
      's1',
      { startRow: 1, endRow: 4, startColumn: 0, endColumn: 3 },
      order,
    )
    expect(moved.get('IeumHide_이름')).toEqual([
      { sheetId: 's1', startRow: 4, endRow: 4, startColumn: 1, endColumn: 1 },
    ])
  })

  it('joins strips and drops contained areas', () => {
    const a = { sheetId: 's', startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }
    expect(
      normalizeAreas([a, { ...a, startRow: 1, endRow: 1 }, { ...a, startRow: 1, endRow: 1 }]),
    ).toEqual([{ ...a, endRow: 1 }])
  })
})

describe('the follow listener in Univer', () => {
  it('grows the mark after a copy-paste, a move and a sort, and never shrinks it', async () => {
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
      sheets: { s1: { id: 's1', name: 'Roster', rowCount: 40, columnCount: 12 } },
    })
    const api = FUniver.newAPI(univer)
    const runtime = { univer, univerAPI: api } as unknown as UniverRuntime
    const injector = univer.__getInjector()
    const commands = injector.get(ICommandService)
    // stand-ins for the sheets-ui clipboard commands (the listener reacts to their ids)
    for (const id of ['sheet.command.copy', 'sheet.command.paste']) {
      commands.registerCommand({ id, type: CommandType.COMMAND, handler: () => true })
    }
    const workbook = api.getActiveWorkbook()!
    ;(workbook as unknown as { insertDefinedName(n: string, r: string): void }).insertDefinedName(
      'IeumHide_이름',
      'Roster!$B$2:$B$3',
    )
    const follow = installHidingFollow(runtime)
    const sheet = workbook.getSheetBySheetId('s1')!
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
    const areas = () => {
      const marks = readHidingMarks(runtime, null)
      return marks.ok ? marks.marks[0]?.areas : null
    }

    sheet.getRange('A1:C4').activate()
    await commands.executeCommand('sheet.command.copy')
    sheet.getRange('F10').activate()
    sheet.getRange('F10:H13').activate()
    await commands.executeCommand('sheet.command.paste')
    await settle()
    expect(areas()).toContainEqual({
      sheetId: 's1',
      startRow: 10,
      endRow: 11,
      startColumn: 6,
      endColumn: 6,
    })

    commands.syncExecuteCommand('sheet.mutation.reorder-range', {
      unitId: 'wb',
      subUnitId: 's1',
      range: { startRow: 1, endRow: 4, startColumn: 0, endColumn: 2 },
      order: { 1: 4, 2: 3, 3: 2, 4: 1 },
    })
    await settle()
    // B2 lands on row 5 and B3 on row 4: both added, joined with B2:B3 that stays hidden
    expect(areas()).toContainEqual({
      sheetId: 's1',
      startRow: 1,
      endRow: 4,
      startColumn: 1,
      endColumn: 1,
    })
    // a dragged block (move-range): its landing place joins the mark
    commands.syncExecuteCommand('sheet.mutation.move-range', {
      unitId: 'wb',
      from: { unitId: 'wb', subUnitId: 's1', value: { 1: { 1: null } } },
      to: { unitId: 'wb', subUnitId: 's1', value: { 1: { 9: { v: 'Kim' } } } },
    })
    await settle()
    expect(areas()).toContainEqual({
      sheetId: 's1',
      startRow: 1,
      endRow: 1,
      startColumn: 9,
      endColumn: 9,
    })
    follow.dispose()
    univer.dispose()
  })
})
