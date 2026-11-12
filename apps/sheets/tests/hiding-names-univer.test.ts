/**
 * The sensitive-info hiding marks are workbook-scope defined names
 * `IeumHide[<n>]_<label>`. Their labels carry any Unicode letter, digits,
 * underscores and periods, so these run the real Univer name table: the
 * names must install as real names (not fall into `uninstalledDefinedNames`)
 * and come back out of the save snapshot, and the save-side XML patch must
 * write them verbatim.
 */
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import sheetsEn from '@univerjs/sheets/locale/en-US'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { applyDefinedNamesState } from '@genoffice/xlsx-gateway/gateway/xlsx-defined-names'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createEditJournal } from '../src/renderer/edit-journal'
import { readHidingMarks } from '../src/renderer/hiding/marks'
import { applyDefinedNames, collectDefinedNamesState } from '../src/renderer/univer-sync'
import type { LazyWorkbookState, UniverRuntime } from '../src/renderer/univer-state'

const HIDING_NAMES = [
  { name: 'IeumHide_학생이름', formula: "'명단'!$B$2:$B$1048576" },
  { name: 'IeumHide2_학생이름', formula: "'명단'!$D$3:$E$9" },
  { name: 'IeumHide_이름', formula: "'명단'!$B:$B" },
  { name: 'IeumHide_v1.2_전화', formula: "'명단'!$C$2:$C$9,'명단'!$F$2" },
  { name: 'ieumhide3_Name', formula: "'명단'!$A$1" },
]

describe('IeumHide defined names in the real Univer name table', () => {
  let univer: Univer
  let api: FUniver
  let runtime: UniverRuntime
  let state: LazyWorkbookState

  beforeAll(() => {
    univer = new Univer({
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
      sheets: { s1: { id: 's1', name: '명단', rowCount: 20, columnCount: 10 } },
    })
    api = FUniver.newAPI(univer)
    runtime = { univer, univerAPI: api } as unknown as UniverRuntime
    state = {
      uninstalledDefinedNames: new Set<string>(),
      editJournal: createEditJournal(),
      file: { sheets: [{ id: 's1', name: '명단' }], definedNames: HIDING_NAMES },
    } as unknown as LazyWorkbookState
    applyDefinedNames(runtime, state.file, state)
  })

  afterAll(() => {
    univer.dispose()
  })

  it('installs every hiding name as a real defined name', () => {
    expect([...state.uninstalledDefinedNames]).toEqual([])
    const installed = (
      api.getActiveWorkbook() as unknown as {
        getDefinedNames(): { getName(): string; getFormulaOrRefString(): string }[]
      }
    )
      .getDefinedNames()
      .map((defined) => [defined.getName(), defined.getFormulaOrRefString().replace(/^=/, '')])
    expect(installed).toEqual(HIDING_NAMES.map((entry) => [entry.name, entry.formula]))
  })

  it('carries them through the save snapshot and the workbook XML patch', () => {
    state.editJournal.definedNames.dirty = true
    const snapshot = collectDefinedNamesState(runtime, state)
    expect(snapshot?.names).toEqual(HIDING_NAMES)
    expect(snapshot?.preserveNames).toEqual([])
    const xml = applyDefinedNamesState(
      '<workbook><sheets><sheet name="명단" sheetId="1" r:id="rId1"/></sheets><calcPr/></workbook>',
      snapshot!,
    )
    for (const entry of HIDING_NAMES) {
      expect(xml).toContain(`<definedName name="${entry.name}">${entry.formula}</definedName>`)
    }
  })
})

describe('IeumHide marks follow the sheet in Univer', () => {
  it('shift with inserted rows and columns, follow a rename, and fail closed when the sheet goes', async () => {
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
      sheetOrder: ['s1', 's2'],
      sheets: {
        s1: { id: 's1', name: '명단', rowCount: 20, columnCount: 10 },
        s2: { id: 's2', name: 'Other', rowCount: 20, columnCount: 10 },
      },
    })
    const api = FUniver.newAPI(univer)
    const runtime = { univer, univerAPI: api } as unknown as UniverRuntime
    const state = { uninstalledDefinedNames: new Set<string>() }
    const workbook = api.getActiveWorkbook() as unknown as {
      insertDefinedName(name: string, ref: string): void
      getSheetBySheetId(id: string): {
        insertRowsBefore(row: number, count: number): void
        insertColumnsBefore(column: number, count: number): void
        setName(name: string): void
      }
      deleteSheet(sheet: unknown): void
    }
    workbook.insertDefinedName('IeumHide_이름', "'명단'!$B$2:$B$9")
    const sheet = workbook.getSheetBySheetId('s1')
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
    sheet.insertRowsBefore(0, 2)
    sheet.insertColumnsBefore(0, 1)
    sheet.setName('Roster')
    await settle()
    const marks = readHidingMarks(runtime, state)
    expect(marks).toEqual({
      ok: true,
      marks: [
        {
          name: 'IeumHide_이름',
          label: '이름',
          areas: [{ sheetId: 's1', startRow: 3, endRow: 10, startColumn: 2, endColumn: 2 }],
        },
      ],
    })
    workbook.deleteSheet(sheet)
    await settle()
    expect(readHidingMarks(runtime, state)).toEqual({ ok: false, names: ['IeumHide_이름'] })
    univer.dispose()
  })
})
