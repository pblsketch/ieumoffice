// A small real Univer workbook for the edit toolbar tests: the phone's edit
// journal installed on it, the toolbar's command runner, and what both say.
import { CommandType, ICommandService, LocaleType, LogLevel, Univer } from '@univerjs/core'
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
import '@univerjs/engine-formula/facade'
import type { WorkbookFile, WorkbookSaveRequest } from '../../../sheets/src/shared/desktop-api'
import type { LazyWorkbookState, UniverRuntime } from '../../../sheets/src/renderer/univer-state'
import { installEditJournal } from '../../src/renderer/editors/sheets/journal/editJournal'
import { createLazyWorkbookState } from '../../src/renderer/editors/sheets/grid/lazyWorkbook'
import { pcUniverSync } from '../../src/renderer/editors/sheets/grid/pcGridModules'
import { pcSaveActions } from '../../src/renderer/editors/sheets/save/documentSlot'
import {
  createToolbarCommands,
  type FullLoadPrompt,
} from '../../src/renderer/editors/sheets/toolbar/runRibbon'
import { pcOpExecutor } from '../../src/renderer/editors/sheets/toolbar/pcToolbarModules'

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

export function boot(options: { preloadComplete?: boolean } = {}) {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: sheetsEnUS },
  })
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
  state.flags.preloadComplete = options.preloadComplete ?? true
  state.loadedRanges.set('sheet-1', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 7 })
  // The sheet's file state (protection) as the first range read leaves it;
  // the desktop executor checks it before a row or sheet change.
  state.sheetProtections.set('sheet-1', { protected: false } as never)
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: state }
  const messages: string[] = []
  const uninstall = installEditJournal(runtime, lazyWorkbookRef, {
    onMessage: (message) => messages.push(message),
  })
  const workbook = univerAPI.getActiveWorkbook()!
  const sheet = workbook.getActiveSheet()
  const commandService = univer.__getInjector().get(ICommandService)
  // Registered by the sheets UI plugin (desktop and phone alike), which
  // needs a rendered grid; a stand-in that only records the call.
  commandService.registerCommand({
    id: 'sheet.command.set-col-auto-width',
    type: CommandType.COMMAND,
    handler: () => true,
  })
  const executed: string[] = []
  commandService.onCommandExecuted((info) => {
    if (!info.id.includes('.operation.')) executed.push(info.id)
  })
  const prompts: FullLoadPrompt[] = []
  const pending: number[] = []
  const toolbar = createToolbarCommands({
    runtime,
    lazyWorkbookRef,
    setMessage: (message) => messages.push(message),
    setPendingEdits: (count) => pending.push(count),
    onFullLoadPrompt: (prompt) => prompts.push(prompt),
  })
  return {
    runtime,
    state,
    lazyWorkbookRef,
    messages,
    uninstall,
    workbook,
    sheet,
    executed,
    prompts,
    toolbar,
    univer,
  }
}

/** The desktop dispatcher called with a context shaped like App.tsx's `ribbonContext()`. */
export function desktopContext(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
) {
  const fail = () => {
    throw new Error('not reached by these commands')
  }
  const sparklineDisposablesRef = { current: [] }
  const sparklineTimerRef = { current: null }
  return {
    univerRef: { current: runtime },
    lazyWorkbookRef,
    runOps: (ops: never[]) => {
      const workbook = runtime.univerAPI.getActiveWorkbook()!
      return pcOpExecutor.applyChangePlan(
        pcOpExecutor.planFromOps(ops, workbook, 'ribbon'),
        {
          runtime,
          workbook,
          state: lazyWorkbookRef.current!,
          lazyWorkbookRef,
          sparklineDisposablesRef,
          sparklineTimerRef,
          shapeEditRef: { current: fail },
          chartEditRef: { current: fail },
          setMessage: () => undefined,
          setPendingEdits: () => undefined,
          visualContext: fail,
          pivotContext: fail,
          queueChartDataSync: () => undefined,
        },
        { userFacing: true },
      )
    },
    traceArrowsRef: { current: { disposables: [], nextId: 0 } },
    sparklineDisposablesRef,
    sparklineTimerRef,
    chartEditRef: { current: fail },
    shapeEditRef: { current: fail },
    refreshSelectionFormatRef: { current: () => undefined },
    selectedVisual: null,
    selectedChart: null,
    setMessage: () => undefined,
    setChartDialog: fail,
    setSymbolDialogOpen: fail,
    openCellsDialog: fail,
    setScreenshotDialogOpen: fail,
    setIconsDialogOpen: fail,
    setEquationDialogOpen: fail,
    openRecommendedCharts: fail,
    setPendingEdits: () => undefined,
    visualContext: fail,
    dataToolsContext: fail,
    tableDesignContext: fail,
    visualArrangeContext: fail,
    pivotContext: fail,
    handlePageLayoutCommand: fail,
    handleExportPdf: () => Promise.resolve(false),
  } as never
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

export function seed(sheet: ReturnType<typeof boot>['sheet']): void {
  sheet.getRange('A1').setValue(3)
  sheet.getRange('A2').setValue(1)
  sheet.getRange('A3').setValue(2)
  sheet.getRange('B1').setValue('x')
}

export async function saveRequest(
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
