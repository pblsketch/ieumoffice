// The grid area's edits on a real Univer with the phone's edit journal: the
// header menu entries (the desktop header menu's commands), the sheet
// switcher's add and rename (new sheets continue Sheet1 whatever the UI
// language), and the view menu's freeze choices all land in the save request
// the desktop's own save flow builds.
import { ICommandService, LocaleType, LogLevel, Univer, type ICommand } from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import {
  InsertMultiColsLeftCommand,
  InsertMultiColsRightCommand,
  InsertMultiRowsAboveCommand,
  InsertMultiRowsAfterCommand,
  RemoveColCommand,
  RemoveRowCommand,
  SetColHiddenCommand,
  SetColWidthCommand,
  SetRowHeightCommand,
  SetRowHiddenCommand,
  SetSelectedColsVisibleCommand,
  SetSelectedRowsVisibleCommand,
  UniverSheetsPlugin,
} from '@univerjs/sheets'
import {
  HideColConfirmCommand,
  HideRowConfirmCommand,
  RemoveColConfirmCommand,
  RemoveRowConfirmCommand,
} from '@univerjs/sheets-ui'
import sheetsKoKR from '@univerjs/sheets/locale/ko-KR'
import '@univerjs/sheets/facade'
import { describe, expect, it } from 'vitest'
import type { WorkbookFile, WorkbookSaveRequest } from '../../sheets/src/shared/desktop-api'
import type { LazyWorkbookState, UniverRuntime } from '../../sheets/src/renderer/univer-state'
import { installNewSheetNaming } from '../../sheets/src/renderer/new-sheet-name'
import { installEditJournal } from '../src/renderer/editors/sheets/journal/editJournal'
import { createLazyWorkbookState } from '../src/renderer/editors/sheets/grid/lazyWorkbook'
import { pcUniverSync } from '../src/renderer/editors/sheets/grid/pcGridModules'
import { pcSaveActions } from '../src/renderer/editors/sheets/save/documentSlot'
import {
  currentAxisSpan,
  currentLineSize,
  runHeaderAction,
  selectHeaderLine,
  selectHeaderLines,
} from '../src/renderer/editors/sheets/grid/headerMenu'
import {
  activateSheet,
  addSheet,
  readSheetTabs,
  renameSheet,
  sheetNameProblem,
} from '../src/renderer/editors/sheets/grid/sheetTabs'
import { applyFreeze, readFreeze } from '../src/renderer/editors/sheets/grid/ViewMenuSheet'

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

/** The header menu commands the mobile sheets UI registers (the test boots without the UI). */
const HEADER_COMMANDS: readonly ICommand[] = [
  InsertMultiRowsAboveCommand,
  InsertMultiRowsAfterCommand,
  InsertMultiColsLeftCommand,
  InsertMultiColsRightCommand,
  RemoveRowCommand,
  RemoveColCommand,
  SetRowHiddenCommand,
  SetColHiddenCommand,
  SetSelectedRowsVisibleCommand,
  SetSelectedColsVisibleCommand,
  SetRowHeightCommand,
  SetColWidthCommand,
  RemoveRowConfirmCommand,
  RemoveColConfirmCommand,
  HideRowConfirmCommand,
  HideColConfirmCommand,
] as readonly ICommand[]

function boot() {
  // A Korean UI: Univer alone would name an added sheet after its locale ("시트1").
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.KO_KR,
    locales: { [LocaleType.KO_KR]: sheetsKoKR },
  })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverFormulaEnginePlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  const univerAPI = FUniver.newAPI(univer)
  const runtime = { univer, univerAPI } as unknown as UniverRuntime
  const file = structuredClone(FILE)
  pcUniverSync.loadWorkbookSkeleton(runtime, file)
  // The sheets plugin registers its own commands with the first workbook.
  const commands = univer.__getInjector().get(ICommandService)
  for (const command of HEADER_COMMANDS) {
    if (!commands.hasCommand(command.id)) commands.registerCommand(command)
  }
  installNewSheetNaming(runtime)
  const state = createLazyWorkbookState(file)
  state.flags.preloadComplete = true
  state.loadedRanges.set('sheet-1', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 7 })
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: state }
  const messages: string[] = []
  installEditJournal(runtime, lazyWorkbookRef, { onMessage: (message) => messages.push(message) })
  const workbook = univerAPI.getActiveWorkbook()!
  return { runtime, lazyWorkbookRef, workbook, sheet: workbook.getActiveSheet(), messages }
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

describe('the header menu on the edit journal', () => {
  it('selects the pressed line, or keeps a whole-line selection made before the press', () => {
    const { runtime } = boot()
    selectHeaderLine(runtime, 'row', 4)
    expect(currentAxisSpan(runtime, 'row')).toEqual({ axis: 'row', start: 4, end: 4, count: 1 })
    selectHeaderLines(runtime, 'row', 3, 6)
    selectHeaderLine(runtime, 'row', 5, true)
    expect(currentAxisSpan(runtime, 'row')).toEqual({ axis: 'row', start: 3, end: 6, count: 4 })
    // A fresh press (not selected before) narrows to the one line, as in Excel.
    selectHeaderLine(runtime, 'row', 5, false)
    expect(currentAxisSpan(runtime, 'row')).toEqual({ axis: 'row', start: 5, end: 5, count: 1 })
    selectHeaderLine(runtime, 'column', 2)
    expect(currentAxisSpan(runtime, 'column')).toEqual({
      axis: 'column',
      start: 2,
      end: 2,
      count: 1,
    })
  }, 180_000)

  it('inserts as many lines as are selected', async () => {
    const { runtime, sheet } = boot()
    const before = sheet.getMaxRows()
    selectHeaderLines(runtime, 'row', 2, 4)
    expect(await runHeaderAction(runtime, 'row', 'insertBefore')).toBe(true)
    expect(sheet.getMaxRows()).toBe(before + 3)
  }, 180_000)

  it('records row insert, hide, show, size and delete into the save request', async () => {
    const { runtime, lazyWorkbookRef, sheet } = boot()
    selectHeaderLine(runtime, 'row', 2)
    expect(await runHeaderAction(runtime, 'row', 'insertBefore')).toBe(true)
    selectHeaderLine(runtime, 'row', 5)
    expect(await runHeaderAction(runtime, 'row', 'insertAfter')).toBe(true)
    selectHeaderLine(runtime, 'row', 8)
    expect(await runHeaderAction(runtime, 'row', 'hide')).toBe(true)
    expect(sheet.getSheet().getRowVisible(8)).toBe(false)
    // Showing hidden rows acts on a selection around them, as in Excel.
    selectHeaderLines(runtime, 'row', 7, 9)
    expect(await runHeaderAction(runtime, 'row', 'show')).toBe(true)
    expect(sheet.getSheet().getRowVisible(8)).toBe(true)
    selectHeaderLine(runtime, 'row', 3)
    expect(await runHeaderAction(runtime, 'row', 'size', 40)).toBe(true)
    expect(currentLineSize(runtime, 'row')).toBe(40)
    selectHeaderLine(runtime, 'row', 10)
    expect(await runHeaderAction(runtime, 'row', 'remove')).toBe(true)

    const kinds = (await saveRequest(runtime, lazyWorkbookRef)).structuralOps.map((op) => op.kind)
    for (const kind of ['insert-rows', 'remove-rows', 'set-rows-hidden', 'set-row-size']) {
      expect(kinds, kind).toContain(kind)
    }
  }, 180_000)

  it('records column insert, hide, width and delete into the save request', async () => {
    const { runtime, lazyWorkbookRef } = boot()
    selectHeaderLine(runtime, 'column', 1)
    expect(await runHeaderAction(runtime, 'column', 'insertBefore')).toBe(true)
    expect(await runHeaderAction(runtime, 'column', 'insertAfter')).toBe(true)
    selectHeaderLine(runtime, 'column', 4)
    expect(await runHeaderAction(runtime, 'column', 'hide')).toBe(true)
    selectHeaderLine(runtime, 'column', 2)
    expect(await runHeaderAction(runtime, 'column', 'size', 150)).toBe(true)
    selectHeaderLine(runtime, 'column', 6)
    expect(await runHeaderAction(runtime, 'column', 'remove')).toBe(true)

    const kinds = (await saveRequest(runtime, lazyWorkbookRef)).structuralOps.map((op) => op.kind)
    for (const kind of ['insert-cols', 'remove-cols', 'set-cols-hidden', 'set-col-size']) {
      expect(kinds, kind).toContain(kind)
    }
  }, 180_000)

  it('refuses a size that is not a number without sending anything', async () => {
    const { runtime, lazyWorkbookRef } = boot()
    selectHeaderLine(runtime, 'row', 1)
    expect(await runHeaderAction(runtime, 'row', 'size')).toBe(false)
    expect((await saveRequest(runtime, lazyWorkbookRef)).structuralOps).toEqual([])
  }, 180_000)
})

describe('the sheet switcher on the edit journal', () => {
  it('names new sheets Sheet2, Sheet3 in a Korean UI and shows the added sheet', async () => {
    const { runtime, lazyWorkbookRef, workbook } = boot()
    expect(await addSheet(runtime)).toBe('Sheet2')
    expect(workbook.getActiveSheet().getSheetName()).toBe('Sheet2')
    expect(await addSheet(runtime)).toBe('Sheet3')
    expect(readSheetTabs(runtime).tabs.map((tab) => tab.name)).toEqual([
      'Sheet1',
      'Sheet2',
      'Sheet3',
    ])

    const request = await saveRequest(runtime, lazyWorkbookRef)
    const added = request.sheetOps.filter((op) => op.kind === 'add-sheet')
    expect(JSON.stringify(added)).toContain('Sheet2')
    expect(JSON.stringify(added)).toContain('Sheet3')
  }, 180_000)

  it('fills the lowest free SheetN', async () => {
    const { runtime, workbook, sheet } = boot()
    await addSheet(runtime)
    await addSheet(runtime)
    const second = workbook.getSheetByName('Sheet2')!
    await renameSheet(runtime, second.getSheetId(), '자료')
    workbook.setActiveSheet(sheet)
    expect(await addSheet(runtime)).toBe('Sheet2')
  }, 180_000)

  it('renames through the journal and checks Excel name rules first', async () => {
    const { runtime, lazyWorkbookRef } = boot()
    await addSheet(runtime)
    const { tabs } = readSheetTabs(runtime)
    const second = tabs[1]!
    expect(sheetNameProblem(runtime, second.id, '')).toBe('empty')
    expect(sheetNameProblem(runtime, second.id, 'a/b')).toBe('invalid')
    expect(sheetNameProblem(runtime, second.id, 'x'.repeat(32))).toBe('invalid')
    expect(sheetNameProblem(runtime, second.id, "'quoted")).toBe('invalid')
    expect(sheetNameProblem(runtime, second.id, 'sheet1')).toBe('taken')
    expect(sheetNameProblem(runtime, second.id, 'SHEET2')).toBeNull()
    expect(await renameSheet(runtime, second.id, 'sheet1')).toBe(false)
    expect(await renameSheet(runtime, second.id, '자료')).toBe(true)
    expect(readSheetTabs(runtime).tabs[1]?.name).toBe('자료')

    const request = await saveRequest(runtime, lazyWorkbookRef)
    expect(JSON.stringify(request.sheetOps)).toContain('자료')
  }, 180_000)

  it('switches the active sheet', async () => {
    const { runtime } = boot()
    await addSheet(runtime)
    const { tabs } = readSheetTabs(runtime)
    activateSheet(runtime, tabs[0]!.id)
    expect(readSheetTabs(runtime).activeId).toBe(tabs[0]!.id)
  }, 180_000)
})

describe('the view menu freeze on the edit journal', () => {
  it('freezes the top row alone, then the first column alone, then nothing', async () => {
    const { runtime, lazyWorkbookRef } = boot()
    applyFreeze(runtime, 'row')
    expect(readFreeze(runtime)).toEqual({ rows: 1, columns: 0 })
    applyFreeze(runtime, 'column')
    expect(readFreeze(runtime)).toEqual({ rows: 0, columns: 1 })
    let request = await saveRequest(runtime, lazyWorkbookRef)
    expect(request.pageSetupStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheetId: 'sheet-1', frozenRows: 0, frozenColumns: 1 }),
      ]),
    )
    applyFreeze(runtime, 'none')
    expect(readFreeze(runtime)).toEqual({ rows: 0, columns: 0 })
    request = await saveRequest(runtime, lazyWorkbookRef)
    expect(request.pageSetupStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheetId: 'sheet-1', frozenRows: 0, frozenColumns: 0 }),
      ]),
    )
  }, 180_000)
})
