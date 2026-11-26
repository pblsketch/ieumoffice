// The phone's edit journal on a real Univer: every 1판 edit kind lands in
// the journal and in the save request the desktop's own save flow builds
// (`handleSave(ctx, 'ods')` assembles the request without sending it).
import {
  BorderStyleTypes,
  BorderType,
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  Univer,
} from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter'
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt'
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort'
import sheetsEnUS from '@univerjs/sheets/locale/en-US'
import '@univerjs/sheets/facade'
import '@univerjs/sheets-filter/facade'
import '@univerjs/sheets-numfmt/facade'
import '@univerjs/sheets-sort/facade'
import { describe, expect, it } from 'vitest'
import type { WorkbookFile, WorkbookSaveRequest } from '../../sheets/src/shared/desktop-api'
import type { LazyWorkbookState, UniverRuntime } from '../../sheets/src/renderer/univer-state'
import { journalSize } from '../../sheets/src/renderer/edit-journal'
import { installEditJournal } from '../src/renderer/editors/sheets/journal/editJournal'
import { createLazyWorkbookState } from '../src/renderer/editors/sheets/grid/lazyWorkbook'
import { pcUniverSync } from '../src/renderer/editors/sheets/grid/pcGridModules'
import { pcSaveActions } from '../src/renderer/editors/sheets/save/documentSlot'

const SHEET = {
  id: 'sheet-1',
  name: 'Sheet1',
  rowCount: 20,
  columnCount: 8,
  hidden: false,
  showGridLines: true,
  tabColor: null,
  defaultRowHeight: null,
  defaultColumnWidth: null,
  freeze: null,
  columnWidths: [],
  cells: {},
  tables: [],
  protections: [],
  merges: [],
  notes: [],
  pivotTables: [],
  pivotRanges: [],
  sparklines: [],
  showFormulas: false,
  valueCellCount: 0,
  storedCellCount: 0,
}

const FILE = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  path: '/w/book.xlsx',
  name: 'book.xlsx',
  sha256: 'abc123',
  fileBytes: 4096,
  entryCount: 5,
  visuals: [],
  styles: [],
  dxfStyles: [],
  definedNames: [],
  sheets: [SHEET],
} as unknown as WorkbookFile

function boot() {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: sheetsEnUS },
  })
  // The desktop save module brings the sheets-ui facade, which asks for the render manager.
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverFormulaEnginePlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  univer.registerPlugin(UniverSheetsNumfmtPlugin)
  univer.registerPlugin(UniverSheetsFilterPlugin)
  univer.registerPlugin(UniverSheetsSortPlugin)
  const univerAPI = FUniver.newAPI(univer)
  const runtime = { univer, univerAPI } as unknown as UniverRuntime
  const file = structuredClone(FILE)
  pcUniverSync.loadWorkbookSkeleton(runtime, file)
  const state = createLazyWorkbookState(file)
  // Everything is resident in this small workbook (the gates allow sorting).
  state.flags.preloadComplete = true
  state.loadedRanges.set('sheet-1', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 7 })
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: state }
  const recorded: number[] = []
  const messages: string[] = []
  const uninstall = installEditJournal(runtime, lazyWorkbookRef, {
    onRecorded: (pending) => recorded.push(pending),
    onMessage: (message) => messages.push(message),
  })
  const workbook = univerAPI.getActiveWorkbook()!
  const sheet = workbook.getActiveSheet()
  const commands = univer.__getInjector().get(ICommandService)
  return {
    runtime,
    state,
    lazyWorkbookRef,
    recorded,
    messages,
    uninstall,
    workbook,
    sheet,
    commands,
  }
}

async function saveRequest(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
): Promise<WorkbookSaveRequest> {
  const built = (await (
    await pcSaveActions()
  ).handleSave(
    {
      univerRef: { current: runtime },
      lazyWorkbookRef,
      setMessage: () => undefined,
      openLazyWorkbook: async () => true,
      stashViewRestore: () => undefined,
    },
    'ods',
    true,
  )) as { ok: boolean; request?: WorkbookSaveRequest }
  if (!built.request) throw new Error('no save request')
  return built.request
}

describe('the phone edit journal', () => {
  it('records values, formulas, styles and number formats into the save request', async () => {
    const { runtime, lazyWorkbookRef, recorded, sheet } = boot()
    sheet.getRange('A1').setValue(42)
    sheet.getRange('B1').setValue('=A1*2')
    sheet.getRange('C1').setValue('text')
    sheet.getRange('C1').setFontWeight('bold')
    sheet.getRange('C1').setBackground('#ffff00')
    sheet.getRange('C1').setHorizontalAlignment('center')
    sheet.getRange('C1').setBorder(BorderType.ALL, BorderStyleTypes.THIN, '#000000')
    sheet.getRange('A1').setNumberFormat('0.00')
    expect(recorded.length).toBeGreaterThan(0)

    const request = await saveRequest(runtime, lazyWorkbookRef)
    const at = (row: number, column: number) =>
      request.edits.filter((edit) => edit.row === row && edit.column === column)
    expect(at(0, 0).some((edit) => (edit as { value?: unknown }).value === 42)).toBe(true)
    expect(at(0, 1).some((edit) => (edit as { formula?: string }).formula === '=A1*2')).toBe(true)
    const styled = at(0, 2).find((edit) => (edit as { style?: unknown }).style !== undefined) as
      { style?: Record<string, unknown> } | undefined
    expect(styled?.style).toBeDefined()
    const style = JSON.stringify(styled?.style)
    expect(style).toMatch(/bold|"b"/)
    expect(style).toMatch(/ffff00/i)
    expect(style).toMatch(/center/)
    expect(style).toMatch(/border|thin/i)
    const numfmt = at(0, 0).find(
      (edit) => (edit as { style?: { numberFormat?: string } }).style?.numberFormat !== undefined,
    ) as { style?: { numberFormat?: string } } | undefined
    expect(numfmt?.style?.numberFormat).toBe('0.00')
  }, 180_000)

  it('records row and column insert, delete, hide and size, and merges', async () => {
    const { runtime, lazyWorkbookRef, sheet } = boot()
    sheet.insertRowBefore(2)
    sheet.deleteRow(5)
    sheet.insertColumnBefore(1)
    sheet.deleteColumn(4)
    sheet.hideRow(sheet.getRange('A8'))
    sheet.hideColumn(sheet.getRange('F1'))
    sheet.setRowHeight(3, 40)
    sheet.setColumnWidth(2, 120)
    sheet.getRange('D10:E11').merge()

    const request = await saveRequest(runtime, lazyWorkbookRef)
    const kinds = request.structuralOps.map((op) => op.kind)
    for (const kind of [
      'insert-rows',
      'remove-rows',
      'insert-cols',
      'remove-cols',
      'set-rows-hidden',
      'set-cols-hidden',
      'set-row-size',
      'set-col-size',
      'merge-cells',
    ]) {
      expect(kinds, kind).toContain(kind)
    }
  }, 180_000)

  it('records a sort, a filter, sheet add and rename, and a freeze', async () => {
    const { runtime, lazyWorkbookRef, state, sheet, workbook } = boot()
    sheet.getRange('A1').setValue(3)
    sheet.getRange('A2').setValue(1)
    sheet.getRange('A3').setValue(2)
    await sheet.getRange('A1:A3').sort(0)
    expect(sheet.getRange('A1').getValue()).toBe(1)

    sheet.getRange('A1:B3').createFilter()
    const added = workbook.insertSheet()
    added.setName('Data')
    workbook.setActiveSheet(sheet)
    sheet.setFrozenRows(1)

    const request = await saveRequest(runtime, lazyWorkbookRef)
    // the sorted cells are journaled as the screen shows them
    const a1 = request.edits.find((edit) => edit.row === 0 && edit.column === 0) as
      { value?: unknown } | undefined
    expect(a1?.value).toBe(1)
    expect(request.filterStates.map((filter) => filter.sheetId)).toContain('sheet-1')
    expect(request.sheetOps.some((op) => op.kind === 'add-sheet')).toBe(true)
    expect(JSON.stringify(request.sheetOps)).toContain('Data')
    expect(request.pageSetupStates).toEqual(
      expect.arrayContaining([expect.objectContaining({ sheetId: 'sheet-1', frozenRows: 1 })]),
    )
    expect(journalSize(state.editJournal)).toBeGreaterThan(0)
  }, 180_000)

  it('cancels what the phone does not offer, and stops recording once uninstalled', async () => {
    const { runtime, state, sheet, commands, uninstall } = boot()
    await commands.executeCommand('sheet.command.copy-sheet', {
      unitId: 'file-abc123',
      subUnitId: 'sheet-1',
    })
    expect(runtime.univerAPI.getActiveWorkbook()!.getSheets()).toHaveLength(1)
    uninstall()
    sheet.getRange('A1').setValue(7)
    expect(state.editJournal.cells.size).toBe(0)
  }, 180_000)

  it('ignores edits to another unit than the open file', () => {
    const { runtime, state } = boot()
    const other = runtime.univerAPI.createWorkbook({ id: 'other', name: 'other' })
    runtime.univer.__getInjector().get(IUniverInstanceService).focusUnit('other')
    other.getActiveSheet().getRange('A1').setValue(1)
    expect(state.editJournal.cells.size).toBe(0)
  }, 180_000)
})
