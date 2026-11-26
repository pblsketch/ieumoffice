/**
 * The desktop modules behind the edit toolbar that reach `WorkbookVisuals.tsx`
 * (through `univer-sync.ts` and `app-constants.ts`), loaded through
 * `import.meta.glob` and typed here. Why a glob and not an import: see
 * `grid/pcGridModules.ts`. The signatures repeat the desktop exports the
 * phone calls; `tests/sheets-toolbar-pc-modules.test.ts` checks that each one
 * exists and that the desktop's ribbon context still has the fields below.
 *
 * - ribbon-actions.ts: the desktop ribbon's command dispatcher
 *   (`handleRibbonCommand`). The phone sends the same command strings the
 *   desktop ribbon (ExcelShell.tsx) sends, through this same function.
 * - op-executor.ts: what the dispatcher's `runOps` runs on the desktop
 *   (row and column insert/delete, add sheet on a streamed workbook).
 * - lazy-find.ts: the find helpers the desktop's streamed-workbook find uses.
 */
import type { IRange } from '@univerjs/core'
import type { WorkbookOperation } from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import type { ApplyOutcome } from '@genoffice/xlsx-gateway/domain/workbook.types'
import type {
  ActiveWorkbook,
  LazyWorkbookState,
  UniverRuntime,
  UniverWorksheet,
} from '../../../../../../sheets/src/renderer/univer-state'

type LazyRef = { current: LazyWorkbookState | null }

/**
 * ribbon-actions.ts `RibbonCommandContext`, field for field (the phone fills
 * the ones the toolbar's commands reach and stubs the rest; see
 * runRibbon.ts). `PC_RIBBON_CONTEXT_KEYS` lists the names for the test that
 * compares them with the desktop interface.
 */
export interface PcRibbonCommandContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: LazyRef
  runOps: (
    ops: readonly WorkbookOperation[],
    successMessage?: string | null,
  ) => Promise<ApplyOutcome>
  traceArrowsRef: { current: { disposables: { dispose(): void }[]; nextId: number } }
  sparklineDisposablesRef: { current: { dispose(): void }[] }
  sparklineTimerRef: { current: ReturnType<typeof setTimeout> | null }
  chartEditRef: { readonly current: (chartPath: string, edit: unknown) => void }
  shapeEditRef: { readonly current: (visualId: string, changes: unknown) => void }
  refreshSelectionFormatRef: { readonly current: () => void }
  selectedVisual: null
  selectedChart: null
  setMessage: (message: string) => void
  setChartDialog: (dialog: unknown) => void
  setSymbolDialogOpen: (open: boolean) => void
  openCellsDialog: (mode: unknown) => void
  setScreenshotDialogOpen: (open: boolean) => void
  setIconsDialogOpen: (open: boolean) => void
  setEquationDialogOpen: (open: boolean) => void
  openRecommendedCharts: () => void
  setPendingEdits: (count: number) => void
  visualContext: () => never
  dataToolsContext: () => never
  tableDesignContext: () => never
  visualArrangeContext: () => never
  pivotContext: () => never
  handlePageLayoutCommand: (rest: string) => void
  handleExportPdf: () => Promise<boolean>
}

export const PC_RIBBON_CONTEXT_KEYS = [
  'univerRef',
  'lazyWorkbookRef',
  'runOps',
  'traceArrowsRef',
  'sparklineDisposablesRef',
  'sparklineTimerRef',
  'chartEditRef',
  'shapeEditRef',
  'refreshSelectionFormatRef',
  'selectedVisual',
  'selectedChart',
  'setMessage',
  'setChartDialog',
  'setSymbolDialogOpen',
  'openCellsDialog',
  'setScreenshotDialogOpen',
  'setIconsDialogOpen',
  'setEquationDialogOpen',
  'openRecommendedCharts',
  'setPendingEdits',
  'visualContext',
  'dataToolsContext',
  'tableDesignContext',
  'visualArrangeContext',
  'pivotContext',
  'handlePageLayoutCommand',
  'handleExportPdf',
] as const satisfies readonly (keyof PcRibbonCommandContext)[]

export interface PcRibbonActions {
  handleRibbonCommand(ctx: PcRibbonCommandContext, command: string): void
  parseStyleCommand(command: string): { name: string; argument: string; extra: string }
}

/** op-executor.ts `OpExecutorContext` (the fields an apply reads). */
export interface PcOpExecutorContext {
  runtime: UniverRuntime
  workbook: ActiveWorkbook
  state: LazyWorkbookState
  lazyWorkbookRef: LazyRef
  sparklineDisposablesRef: { current: { dispose(): void }[] }
  sparklineTimerRef: { current: ReturnType<typeof setTimeout> | null }
  shapeEditRef: { current: (visualId: string, changes: unknown) => void }
  chartEditRef: { current: (chartPath: string, edit: unknown) => void }
  setMessage: (message: string) => void
  setPendingEdits: (count: number) => void
  visualContext: () => never
  pivotContext: () => never
  queueChartDataSync: (sheetId: string, bounds: unknown) => void
}

/** The desktop's change plan, passed through untouched. */
export type PcChangePlan = { readonly __pcChangePlan: unique symbol }

export interface PcOpExecutor {
  planFromOps(
    ops: readonly WorkbookOperation[],
    workbook: ActiveWorkbook,
    summary: string,
  ): PcChangePlan
  applyChangePlan(
    plan: PcChangePlan,
    ctx: PcOpExecutorContext,
    options?: {
      verifyBeforeApply?: () => ApplyOutcome | null
      successMessage?: string | null
      userFacing?: boolean
    },
  ): Promise<ApplyOutcome>
}

/** @univerjs/find-replace `IFindQuery`, the fields lazy-find.ts reads. */
export interface PcFindQuery {
  readonly findString: string
  readonly caseSensitive: boolean
  readonly matchesTheWholeCell: boolean
  /** FindBy: 'value' | 'formula'. */
  readonly findBy: 'value' | 'formula'
  /** FindScope: 'subunit' (this sheet) | 'unit' (workbook). */
  readonly findScope: 'subunit' | 'unit'
  /** FindDirection: 'row' | 'column'. */
  readonly findDirection: 'row' | 'column'
  readonly replaceRevealed: boolean
}

export interface PcLazyCellTexts {
  value: string | null
  formula: string | undefined
}

export interface PcScanCell {
  readonly row: number
  readonly column: number
  readonly value: string | number | boolean | null
  readonly formula: string | undefined
}

export interface PcLazyFind {
  scalarToText(value: unknown): string | null
  buildLazyCellTest(query: PcFindQuery): ((cell: PcLazyCellTexts) => boolean) | null
  coveredByWindow(state: LazyWorkbookState, sheetId: string, row: number, column: number): boolean
  collectJournalMatches(
    state: LazyWorkbookState,
    sheetId: string,
    test: (cell: PcLazyCellTexts) => boolean,
  ): PcScanCell[]
  journalShadowKeys(state: LazyWorkbookState, sheetId: string): Set<string>
  sidecarQuery(query: PcFindQuery): {
    query: string
    matchCase: boolean
    matchEntireCell: boolean
    lookIn: 'values' | 'formulas'
    wildcards: boolean
  }
  coerceReplaceValue(
    raw: string | number | boolean | null | undefined,
    replaced: string,
  ): string | number | boolean
}

export interface PcUniverSyncFind {
  ensureLazyRangeLoaded(
    runtime: UniverRuntime,
    lazyWorkbookRef: LazyRef,
    worksheet: UniverWorksheet,
    range: IRange,
    setMessage: (message: string) => void,
    bulk?: boolean,
  ): Promise<boolean>
}

function single<T>(modules: Record<string, T>, name: string): T {
  const module = Object.values(modules)[0]
  if (!module) throw new Error(`Desktop toolbar module missing: ${name}`)
  return module
}

export const pcRibbonActions = single(
  import.meta.glob<PcRibbonActions>('../../../../../../sheets/src/renderer/ribbon-actions.ts', {
    eager: true,
  }),
  'ribbon-actions.ts',
)

export const pcOpExecutor = single(
  import.meta.glob<PcOpExecutor>('../../../../../../sheets/src/renderer/op-executor.ts', {
    eager: true,
  }),
  'op-executor.ts',
)

export const pcLazyFind = single(
  import.meta.glob<PcLazyFind>('../../../../../../sheets/src/renderer/lazy-find.ts', {
    eager: true,
  }),
  'lazy-find.ts',
)

export const pcUniverSyncFind = single(
  import.meta.glob<PcUniverSyncFind>('../../../../../../sheets/src/renderer/univer-sync.ts', {
    eager: true,
  }),
  'univer-sync.ts',
)
