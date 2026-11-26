// View mode on a real Univer: edits that do not go through the cell editor
// (the long-press menu's insert, delete and clear, tablet-keyboard shortcuts,
// the grid's own buttons) are cancelled while the document is in view mode,
// and Univer's long-press menu is switched off there. The loader's writes,
// zoom, freeze and undo still run. And which desktop status lines become
// toasts: progress and per-click confirmations do not, refusals do.
import {
  CommandType,
  ICommandService,
  LocaleType,
  LogLevel,
  Univer,
  type ICommand,
} from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import {
  ClearSelectionContentCommand,
  InsertMultiRowsAboveCommand,
  RemoveRowCommand,
  SetRangeValuesMutation,
  UniverSheetsPlugin,
} from '@univerjs/sheets'
import sheetsEnUS from '@univerjs/sheets/locale/en-US'
import '@univerjs/sheets/facade'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbookFile } from '../../sheets/src/shared/desktop-api'
import { setModuleLang, t } from '../../sheets/src/renderer/i18n/locale'
import {
  journalSuppression,
  type LazyWorkbookState,
  type UniverRuntime,
} from '../../sheets/src/renderer/univer-state'
import { journalSize } from '../../sheets/src/renderer/edit-journal'
import { installEditJournal } from '../src/renderer/editors/sheets/journal/editJournal'
import {
  isPcStatusLine,
  PC_STATUS_LINE_KEYS,
  toastUnlessStatus,
} from '../src/renderer/editors/sheets/journal/statusLines'
import { createLazyWorkbookState } from '../src/renderer/editors/sheets/grid/lazyWorkbook'
import { pcUniverSync } from '../src/renderer/editors/sheets/grid/pcGridModules'
import { applyFreeze, readFreeze } from '../src/renderer/editors/sheets/grid/ViewMenuSheet'
import { runHeaderAction, selectHeaderLine } from '../src/renderer/editors/sheets/grid/headerMenu'
import {
  installViewModeGuard,
  isViewModeEdit,
} from '../src/renderer/editors/sheets/grid/viewModeGuard'

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

/** Long-press menu commands the mobile sheets UI registers (the test boots without the UI). */
const MENU_COMMANDS: readonly ICommand[] = [
  InsertMultiRowsAboveCommand,
  RemoveRowCommand,
  ClearSelectionContentCommand,
] as readonly ICommand[]

/** Stands in for the sheets UI's zoom operation (it needs a render unit the test does not have). */
const ZOOM_OPERATION: ICommand = {
  id: 'sheet.operation.set-zoom-ratio',
  type: CommandType.OPERATION,
  handler: () => true,
}

function boot(initialView: boolean) {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: sheetsEnUS },
  })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverFormulaEnginePlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  const univerAPI = FUniver.newAPI(univer)
  const runtime = { univer, univerAPI } as unknown as UniverRuntime
  const file = structuredClone(FILE)
  pcUniverSync.loadWorkbookSkeleton(runtime, file)
  const commands = univer.__getInjector().get(ICommandService)
  for (const command of [...MENU_COMMANDS, ZOOM_OPERATION]) {
    if (!commands.hasCommand(command.id)) commands.registerCommand(command)
  }
  const state = createLazyWorkbookState(file)
  state.flags.preloadComplete = true
  state.loadedRanges.set('sheet-1', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 7 })
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: state }
  const notices: string[] = []
  const statuses: string[] = []
  installEditJournal(runtime, lazyWorkbookRef, {
    onMessage: (message) => notices.push(message),
    onStatus: (message) => statuses.push(message),
  })
  const menu = {
    disabled: false,
    enable: () => (menu.disabled = false),
    disable: () => (menu.disabled = true),
  }
  const guard = installViewModeGuard(runtime, { initialView, contextMenu: menu })
  const workbook = univerAPI.getActiveWorkbook()!
  return {
    runtime,
    commands,
    state,
    workbook,
    sheet: workbook.getActiveSheet(),
    guard,
    menu,
    notices,
    statuses,
  }
}

/** Runs a command the way Univer's menu does; a cancelled one rejects or answers false. */
async function attempt(commands: ICommandService, id: string, params?: object): Promise<boolean> {
  try {
    return (await commands.executeCommand(id, params)) !== false
  } catch {
    return false
  }
}

afterEach(() => {
  journalSuppression.active = false
})

describe('view mode on the grid', () => {
  it('cancels the long-press menu edits in view mode and runs them in edit mode', async () => {
    const { runtime, commands, state, sheet, guard } = boot(true)
    const rows = sheet.getMaxRows()
    sheet.getRange(1, 0).setValue('kept')
    // setValue above ran in view mode too: it is cancelled like any other edit.
    expect(sheet.getRange(1, 0).getValue()).toBeNull()

    selectHeaderLine(runtime, 'row', 3)
    expect(await runHeaderAction(runtime, 'row', 'insertBefore')).toBe(false)
    expect(await runHeaderAction(runtime, 'row', 'remove')).toBe(false)
    expect(sheet.getMaxRows()).toBe(rows)
    expect(journalSize(state.editJournal)).toBe(0)

    guard.setViewMode(false)
    sheet.getRange(1, 0).setValue('kept')
    expect(sheet.getRange(1, 0).getValue()).toBe('kept')
    selectHeaderLine(runtime, 'row', 3)
    expect(await runHeaderAction(runtime, 'row', 'insertBefore')).toBe(true)
    expect(sheet.getMaxRows()).toBe(rows + 1)
    expect(journalSize(state.editJournal)).toBeGreaterThan(0)

    // Back to view: clearing the cell (the menu's "clear contents") is cancelled.
    guard.setViewMode(true)
    runtime.univerAPI.getActiveWorkbook()!.setActiveRange(sheet.getRange(1, 0))
    expect(await attempt(commands, ClearSelectionContentCommand.id)).toBe(false)
    expect(sheet.getRange(1, 0).getValue()).toBe('kept')
  }, 180_000)

  it("switches Univer's long-press menu off in view mode", () => {
    const { guard, menu } = boot(true)
    expect(menu.disabled).toBe(true)
    guard.setViewMode(false)
    expect(menu.disabled).toBe(false)
    guard.setViewMode(true)
    expect(menu.disabled).toBe(true)
    guard.dispose()
    expect(menu.disabled).toBe(false)
  }, 180_000)

  it("lets the loader's writes, zoom, freeze and undo through in view mode", async () => {
    const { runtime, commands, guard, sheet } = boot(false)
    sheet.getRange(2, 1).setValue('edited')
    guard.setViewMode(true)

    // The lazy loader writes under the journal suppression.
    journalSuppression.active = true
    commands.syncExecuteCommand(SetRangeValuesMutation.id, {
      unitId: runtime.univerAPI.getActiveWorkbook()!.getId(),
      subUnitId: 'sheet-1',
      cellValue: { 5: { 5: { v: 'streamed' } } },
    })
    journalSuppression.active = false
    expect(sheet.getRange(5, 5).getValue()).toBe('streamed')

    const unitId = runtime.univerAPI.getActiveWorkbook()!.getId()
    expect(
      await attempt(commands, ZOOM_OPERATION.id, { unitId, subUnitId: 'sheet-1', zoomRatio: 1.5 }),
    ).toBe(true)
    applyFreeze(runtime, 'row')
    expect(readFreeze(runtime)).toEqual({ rows: 1, columns: 0 })

    // The AI panel's undo of a run, pressed after going back to view.
    // Undo replays mutations: the freeze, then the edit made in edit mode.
    await runtime.univerAPI.undo()
    expect(readFreeze(runtime)).toEqual({ rows: 0, columns: 0 })
    await runtime.univerAPI.undo()
    expect(sheet.getRange(2, 1).getValue()).not.toBe('edited')
  }, 180_000)

  it('treats the journal’s mutations as edits, except zoom and freeze', () => {
    expect(isViewModeEdit('sheet.mutation.set-range-values')).toBe(true)
    expect(isViewModeEdit('sheet.mutation.insert-row')).toBe(true)
    expect(isViewModeEdit('sheet.mutation.remove.numfmt')).toBe(true)
    expect(isViewModeEdit('sheet.mutation.set-frozen')).toBe(false)
    expect(isViewModeEdit('sheet.operation.set-zoom-ratio')).toBe(false)
    expect(isViewModeEdit('sheet.operation.set-selections')).toBe(false)
    expect(isViewModeEdit('sheet.command.copy')).toBe(false)
  })
})

describe('desktop status lines on the phone', () => {
  it('keeps progress and confirmations out of the toasts in every module language', () => {
    for (const lang of ['ko', 'en', 'tr'] as const) {
      setModuleLang(lang)
      expect(
        isPcStatusLine(t('appStreamingRows', { name: 'book.xlsx', rows: '2,002' })),
        lang,
      ).toBe(true)
      expect(isPcStatusLine(t('appIndexing', { name: 'Sheet1', rows: '1,000' })), lang).toBe(true)
      expect(isPcStatusLine(t('appRecalcDone', { count: 3 })), lang).toBe(true)
      expect(isPcStatusLine(t('appAppliedToSelection')), lang).toBe(true)
      for (const key of PC_STATUS_LINE_KEYS) expect(isPcStatusLine(t(key)), key).toBe(true)
      // Refusals, errors and asked-for results stay toasts.
      expect(isPcStatusLine(t('appSortRangeTooLarge')), lang).toBe(false)
      expect(isPcStatusLine(t('appWorkbookStructureLocked')), lang).toBe(false)
      expect(isPcStatusLine(t('appRecalculated')), lang).toBe(false)
      expect(isPcStatusLine('Engine error: the range is locked'), lang).toBe(false)
    }
    setModuleLang('ko')
  })

  it('sends a status line to the status sink and anything else to the toast', () => {
    setModuleLang('ko')
    const toasts: string[] = []
    const statuses: string[] = []
    const sink = toastUnlessStatus(
      (message) => toasts.push(message),
      (message) => statuses.push(message),
    )
    sink(t('appStreamingRows', { name: 'book.xlsx', rows: '2,002' }))
    sink(t('appFullLoadRunning'))
    expect(statuses).toHaveLength(1)
    expect(toasts).toEqual([t('appFullLoadRunning')])
  })

  it("sends the reload after a structural edit to the journal's status sink", async () => {
    setModuleLang('ko')
    const { runtime, notices } = boot(false)
    selectHeaderLine(runtime, 'row', 3)
    expect(await runHeaderAction(runtime, 'row', 'insertBefore')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Whatever the reload reported, none of it reached the toast channel.
    expect(notices.filter(isPcStatusLine)).toEqual([])
    expect(notices).toEqual([])
  }, 180_000)
})

describe('the keyboard stays down while a workbook reloads', () => {
  function editorInput(): HTMLElement {
    // Univer's hidden cell-editor input (docs-ui marks it this way).
    const input = document.createElement('div')
    input.contentEditable = 'true'
    input.tabIndex = 0
    input.dataset.uComp = 'editor'
    document.body.appendChild(input)
    return input
  }

  it("takes Univer's focus back until the person touches the grid", async () => {
    const { holdKeyboardDuringLoad } =
      await import('../src/renderer/editors/sheets/grid/keyboardHold')
    const grid = document.createElement('div')
    document.body.appendChild(grid)
    const input = editorInput()
    let editing = false
    const quiet = holdKeyboardDuringLoad(grid, () => editing)
    input.focus()
    expect(document.activeElement).not.toBe(input)
    // A cell edit keeps its focus.
    editing = true
    input.focus()
    expect(document.activeElement).toBe(input)
    input.blur()
    editing = false
    quiet.settle()
    input.focus()
    expect(document.activeElement).not.toBe(input)
    // The person's own touch ends the quiet window.
    grid.dispatchEvent(new Event('pointerdown'))
    input.focus()
    expect(document.activeElement).toBe(input)
    quiet.end()
    input.remove()
    grid.remove()
  }, 180_000)

  it('ends on its own a few seconds after the load', async () => {
    const { holdKeyboardDuringLoad } =
      await import('../src/renderer/editors/sheets/grid/keyboardHold')
    vi.useFakeTimers()
    try {
      const grid = document.createElement('div')
      const input = editorInput()
      const quiet = holdKeyboardDuringLoad(grid, () => false)
      quiet.settle()
      vi.advanceTimersByTime(5000)
      input.focus()
      expect(document.activeElement).toBe(input)
      input.remove()
    } finally {
      vi.useRealTimers()
    }
  }, 180_000)
})
