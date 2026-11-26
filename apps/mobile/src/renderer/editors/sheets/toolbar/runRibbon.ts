/**
 * Runs a toolbar command the way the desktop runs a ribbon click: the same
 * command string goes through the desktop's own dispatcher
 * (ribbon-actions.ts `handleRibbonCommand`), so every edit sends the Univer
 * commands the desktop sends and the edit journal records it the same way.
 *
 * Re-stated from apps/sheets/src/renderer/App.tsx (not exported there;
 * `tests/sheets-toolbar-pc-modules.test.ts` fails when the desktop text
 * changes):
 * - `handleRibbonCommand`'s own branches for `calculate-now` and
 *   `calculate-sheet` (the rest of that function is desktop chrome);
 * - `runUiOps` and `opExecutorContext`, which the dispatcher's `runOps`
 *   calls for row and column insert/delete and new sheets;
 * - the full-load offer of the sort/filter gate (`fullLoadPrompt`): the
 *   phone asks before sending the command, with the gate's own verdict, and
 *   shows the offer as its own sheet (`onFullLoadPrompt`). The journal's gate
 *   (journal/editJournal.ts) still refuses with the desktop's text when a
 *   command reaches it some other way (the grid's filter buttons).
 */
import { ICommandService } from '@univerjs/core'
import { SmartToggleSheetsFilterCommand } from '@univerjs/sheets-filter'
import type { WorkbookOperation } from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import type { ApplyOutcome } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { calculateNow, calculateSheet } from '../../../../../../sheets/src/renderer/calc-options'
import { t } from '../../../../../../sheets/src/renderer/i18n/locale'
import type {
  ActiveWorkbook,
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { pcFullLoad, pcLoadBudget } from '../grid/pcGridModules'
import { pcReorderGate } from '../journal/pcJournalModules'
import {
  pcOpExecutor,
  pcRibbonActions,
  type PcOpExecutorContext,
  type PcRibbonCommandContext,
} from './pcToolbarModules'

type LazyRef = { current: LazyWorkbookState | null }

/** The desktop's full-load dialog: 'ask' offers to load, 'tooLarge' only explains. */
export type FullLoadPrompt = 'ask' | 'tooLarge'

export interface ToolbarCommandDeps {
  readonly runtime: UniverRuntime
  readonly lazyWorkbookRef: LazyRef
  /** The desktop's status-bar text (the phone shows it as a toast). */
  readonly setMessage: (message: string) => void
  /** The journal's size after a command recorded straight into it. */
  readonly setPendingEdits: (count: number) => void
  /** Sort or filter needs the whole workbook first (the desktop's dialog). */
  readonly onFullLoadPrompt: (prompt: FullLoadPrompt) => void
}

export interface ToolbarCommands {
  /** Sends one desktop ribbon command string. */
  run(command: string): void
  /** The desktop dialog's [Load all]: loads the whole workbook. */
  startFullLoad(onProgress: (message: string) => void): Promise<void>
}

function notOnPhone(name: string): never {
  throw new Error(`${name} is not available on the phone`)
}

/** Commands the sort/filter gate holds back while the workbook is still streamed. */
function needsWholeWorkbook(command: string): 'sort' | 'filter' | null {
  if (command === 'sort:asc' || command === 'sort:desc' || command.startsWith('sort-custom:')) {
    return 'sort'
  }
  if (command === 'filter-toggle' || command === 'filter-reapply' || command === 'filter-clear') {
    return 'filter'
  }
  return null
}

/**
 * Registers the desktop UI commands the ribbon sends that the phone's
 * Univer plugins leave out: Univer's filter toggle is registered by the
 * desktop filter UI (`SheetsFilterUIDesktopController`), not by the mobile
 * one. Once per runtime.
 */
export function installToolbarCommands(runtime: UniverRuntime): void {
  const commands = runtime.univer.__getInjector().get(ICommandService)
  if (!commands.hasCommand(SmartToggleSheetsFilterCommand.id)) {
    commands.registerCommand(SmartToggleSheetsFilterCommand)
  }
}

export function createToolbarCommands(deps: ToolbarCommandDeps): ToolbarCommands {
  const { runtime, lazyWorkbookRef, setMessage, setPendingEdits } = deps
  installToolbarCommands(runtime)
  const univerRef = { current: runtime }
  const sparklineDisposablesRef: { current: { dispose(): void }[] } = { current: [] }
  const sparklineTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null }
  const chartEditRef = { current: () => notOnPhone('Chart editing') }
  const shapeEditRef = { current: () => notOnPhone('Shape editing') }

  /** App.tsx `opExecutorContext`. */
  function opExecutorContext(
    workbook: ActiveWorkbook,
    state: LazyWorkbookState,
  ): PcOpExecutorContext {
    return {
      runtime,
      workbook,
      state,
      lazyWorkbookRef,
      sparklineDisposablesRef,
      sparklineTimerRef,
      shapeEditRef,
      chartEditRef,
      setMessage,
      setPendingEdits,
      visualContext: () => notOnPhone('Pictures and charts'),
      pivotContext: () => notOnPhone('Pivot tables'),
      queueChartDataSync: () => undefined,
    }
  }

  /** App.tsx `runUiOps`: ribbon edits run the same executor as AI proposals. */
  function runUiOps(
    ops: readonly WorkbookOperation[],
    successMessage?: string | null,
  ): Promise<ApplyOutcome> {
    const state = lazyWorkbookRef.current
    const workbook = runtime.univerAPI.getActiveWorkbook()
    if (!state || !workbook) {
      return Promise.resolve({ ok: false, reason: t('appNoWorkbookOpen') })
    }
    let plan
    try {
      plan = pcOpExecutor.planFromOps(ops, workbook, 'ribbon')
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : t('appApplyTxFailed')
      setMessage(reason)
      return Promise.resolve({ ok: false, reason })
    }
    return pcOpExecutor.applyChangePlan(plan, opExecutorContext(workbook, state), {
      userFacing: true,
      ...(successMessage === undefined ? {} : { successMessage }),
      // The apply queues behind in-flight applies; the file may be closed or
      // replaced meanwhile, so drop the click rather than change the wrong workbook.
      verifyBeforeApply: () =>
        lazyWorkbookRef.current !== state ||
        runtime.univerAPI.getActiveWorkbook()?.getId() !== workbook.getId()
          ? { ok: false, reason: t('appApplyTxFailed') }
          : null,
    })
  }

  /** App.tsx `ribbonContext`: the phone's toolbar reaches only cell commands. */
  function ribbonContext(): PcRibbonCommandContext {
    return {
      univerRef,
      lazyWorkbookRef,
      runOps: runUiOps,
      traceArrowsRef: { current: { disposables: [], nextId: 0 } },
      sparklineDisposablesRef,
      sparklineTimerRef,
      chartEditRef,
      shapeEditRef,
      refreshSelectionFormatRef: { current: () => undefined },
      selectedVisual: null,
      selectedChart: null,
      setMessage,
      setChartDialog: () => notOnPhone('Chart editing'),
      setSymbolDialogOpen: () => undefined,
      openCellsDialog: () => notOnPhone('The Insert Cells dialog'),
      setScreenshotDialogOpen: () => undefined,
      setIconsDialogOpen: () => undefined,
      setEquationDialogOpen: () => undefined,
      openRecommendedCharts: () => notOnPhone('Charts'),
      setPendingEdits,
      visualContext: () => notOnPhone('Pictures and charts'),
      dataToolsContext: () => notOnPhone('Data tools'),
      tableDesignContext: () => notOnPhone('Tables'),
      visualArrangeContext: () => notOnPhone('Pictures and charts'),
      pivotContext: () => notOnPhone('Pivot tables'),
      handlePageLayoutCommand: () => notOnPhone('Page layout'),
      handleExportPdf: () => Promise.resolve(false),
    }
  }

  /**
   * The verdict the journal's sort/filter gate would give this command
   * (App.tsx `structuralDisposable`): while the workbook is still streamed,
   * a sort or filter of a sheet from the file needs every row.
   */
  function fullLoadVerdict(kind: 'sort' | 'filter'): FullLoadPrompt | 'loading' | null {
    const state = lazyWorkbookRef.current
    const sheetId = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetId()
    if (!state || state.flags.preloadComplete) return null
    if (sheetId !== undefined && state.editJournal.sheets.added.has(sheetId)) return null
    const verdict = pcReorderGate.fullLoadGate({
      formulaMode: state.formulaMode,
      preloadRunning: state.flags.preloadRunning,
      cellCounts: pcLoadBudget.workbookCellCounts(state.file.sheets),
    })
    if (verdict === 'loading') return 'loading'
    if (verdict === 'offerFullLoad') return 'ask'
    // Past the load budget the desktop filters on column projections read
    // from the file (large-filter.ts); the phone leaves that to the gate,
    // which refuses with the desktop's text.
    return kind === 'sort' ? 'tooLarge' : null
  }

  return {
    run(command) {
      // App.tsx handleRibbonCommand: the calculation commands it runs itself.
      if (command === 'calculate-now' || command === 'calculate-sheet') {
        if (command === 'calculate-now') calculateNow(runtime)
        else calculateSheet(runtime)
        setMessage(t('appRecalculated'))
        return
      }
      const reorder = needsWholeWorkbook(command)
      if (reorder) {
        const verdict = fullLoadVerdict(reorder)
        if (verdict === 'loading') {
          setMessage(t('appFullLoadRunning'))
          return
        }
        if (verdict) {
          deps.onFullLoadPrompt(verdict)
          return
        }
      }
      pcRibbonActions.handleRibbonCommand(ribbonContext(), command)
    },
    startFullLoad(onProgress) {
      onProgress(t('appFullLoadRunning'))
      // Joins a load that is already running.
      return pcFullLoad.startFullLoad(runtime, lazyWorkbookRef, onProgress)
    },
  }
}
