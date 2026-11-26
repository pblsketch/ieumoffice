/**
 * The desktop modules behind the workbook AI tools that reach
 * `WorkbookVisuals.tsx` (through `univer-sync.ts`), loaded as they are through
 * Vite's `import.meta.glob` and typed here. Why a glob and not an import: see
 * `grid/pcGridModules.ts`. The signatures repeat the desktop exports the phone
 * calls; `tests/sheets-ai-pc-modules.test.ts` checks that each one exists.
 *
 * Part of the AI chunk: nothing here loads until the AI runs.
 */
import type { InMemoryWorkbookAdapter } from '@genoffice/xlsx-gateway/domain/in-memory-workbook'
import type { RangeBounds } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { WorkbookOperation } from '@genoffice/xlsx-gateway/domain/workbook-dsl'
import type {
  ApplyOutcome,
  CellFormatState,
  CellScalar,
  CellState,
  ChangePlan,
} from '@genoffice/xlsx-gateway/domain/workbook.types'
import type { IRange } from '@univerjs/core'
import type { RangeAggregate } from '../../../../../../sheets/src/renderer/ai/aggregate'
import type {
  ActiveSheetInfo,
  FindCellsOptions,
  FindCellsOutcome,
  FrozenSelection,
  SelectRangeOutcome,
  TraceDependentsOutcome,
  TracePrecedentsOutcome,
} from '../../../../../../sheets/src/renderer/ai/tools'
import type {
  ActiveWorkbook,
  LazyWorkbookState,
  UniverRuntime,
  UniverWorksheet,
} from '../../../../../../sheets/src/renderer/univer-state'

type LazyRef = { current: LazyWorkbookState | null }
type SetMessage = (message: string) => void

/** apps/sheets/src/renderer/ai/workbook-readers.ts `WorkbookReadContext`. */
export interface PcWorkbookReadContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  adapterRef: { readonly current: InMemoryWorkbookAdapter }
}

/** apps/sheets/src/renderer/plan-operations.ts `PlanContext`. */
export interface PcPlanContext {
  readonly adapterRef: { readonly current: InMemoryWorkbookAdapter }
  readonly univerRef: { readonly current: UniverRuntime | null }
  readonly lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  readonly lazyPreviewRef: {
    current: { sessionId: string; sheetId: string; plan: ChangePlan } | null
  }
  readonly setPreview: (plan: ChangePlan | null) => void
  readonly autoApplySafePlan: (plan: ChangePlan) => Promise<ApplyOutcome>
}

/**
 * apps/sheets/src/renderer/op-executor.ts `OpExecutorContext`. The visual and
 * pivot contexts are typed `never`-returning: the phone does not offer the
 * operations that use them (`phoneLimits.ts`), so they only ever throw.
 */
export interface PcOpExecutorContext {
  runtime: UniverRuntime
  workbook: ActiveWorkbook
  state: LazyWorkbookState
  lazyWorkbookRef: LazyRef
  sparklineDisposablesRef: { current: { dispose(): void }[] }
  sparklineTimerRef: { current: ReturnType<typeof setTimeout> | null }
  shapeEditRef: { current: (visualId: string, changes: unknown) => void }
  chartEditRef: { current: (chartPath: string, edit: unknown) => void }
  setMessage: SetMessage
  setPendingEdits: (count: number) => void
  visualContext: () => never
  pivotContext: () => never
  queueChartDataSync: (sheetId: string, bounds: RangeBounds) => void
}

export interface PcApplyPlanOptions {
  verifyBeforeApply?: () => ApplyOutcome | null
  successMessage?: string | null
  userFacing?: boolean
}

export interface PcWorkbookReaders {
  getActiveSheetInfo(ctx: PcWorkbookReadContext, frozen?: FrozenSelection | null): ActiveSheetInfo
  readCells(
    ctx: PcWorkbookReadContext,
    addresses: readonly string[],
    sheetId?: string,
  ): Record<string, { value: CellScalar; formula?: string }>
  readFormats(
    ctx: PcWorkbookReadContext,
    addresses: readonly string[],
    sheetId?: string,
  ): Record<string, CellFormatState>
  readSheetFeatures(ctx: PcWorkbookReadContext, sheetId?: string): string
}

export interface PcWorkbookSearch {
  findWorkbookCells(
    ctx: PcWorkbookReadContext,
    options: FindCellsOptions,
  ): Promise<FindCellsOutcome>
  selectWorkbookRange(
    ctx: PcWorkbookReadContext,
    sheetId: string | undefined,
    bounds: RangeBounds,
    setMessage: SetMessage,
  ): Promise<SelectRangeOutcome>
}

export interface PcFormulaAudit {
  traceWorkbookPrecedents(
    ctx: PcWorkbookReadContext,
    sheetId: string | undefined,
    address: string,
  ): Promise<TracePrecedentsOutcome>
  traceWorkbookDependents(
    ctx: PcWorkbookReadContext,
    sheetId: string | undefined,
    address: string,
  ): Promise<TraceDependentsOutcome>
}

export interface PcAggregateRange {
  aggregateWorkbookRange(
    ctx: PcWorkbookReadContext,
    sheetId: string | undefined,
    bounds: RangeBounds,
  ): Promise<{ ok: true; aggregate: RangeAggregate } | { ok: false; error: string }>
}

export interface PcPlanOperations {
  proposeOperations(
    ctx: PcPlanContext,
    operations: readonly WorkbookOperation[],
    summary: string,
  ): { ok: true; plan: ChangePlan; applied: Promise<ApplyOutcome> } | { ok: false; error: string }
}

export interface PcOpExecutor {
  applyChangePlan(
    plan: ChangePlan,
    ctx: PcOpExecutorContext,
    options?: PcApplyPlanOptions,
  ): Promise<ApplyOutcome>
}

/** The two univer-sync.ts exports the AI path calls (the grid's boundary does not carry them). */
export interface PcAiUniverSync {
  lazyWorkbookCellReader(workbook: ActiveWorkbook): (address: string, sheetId: string) => CellState
  ensureLazyRangeLoaded(
    runtime: UniverRuntime,
    lazyWorkbookRef: LazyRef,
    worksheet: UniverWorksheet,
    range: IRange,
    setMessage: SetMessage,
  ): Promise<boolean>
}

function single<T>(modules: Record<string, T>, name: string): T {
  const module = Object.values(modules)[0]
  if (!module) throw new Error(`Desktop AI module missing: ${name}`)
  return module
}

export const pcWorkbookReaders = single(
  import.meta.glob<PcWorkbookReaders>(
    '../../../../../../sheets/src/renderer/ai/workbook-readers.ts',
    { eager: true },
  ),
  'ai/workbook-readers.ts',
)

export const pcWorkbookSearch = single(
  import.meta.glob<PcWorkbookSearch>(
    '../../../../../../sheets/src/renderer/ai/workbook-search.ts',
    {
      eager: true,
    },
  ),
  'ai/workbook-search.ts',
)

export const pcFormulaAudit = single(
  import.meta.glob<PcFormulaAudit>('../../../../../../sheets/src/renderer/ai/formula-audit.ts', {
    eager: true,
  }),
  'ai/formula-audit.ts',
)

export const pcAggregateRange = single(
  import.meta.glob<PcAggregateRange>(
    '../../../../../../sheets/src/renderer/ai/aggregate-range.ts',
    { eager: true },
  ),
  'ai/aggregate-range.ts',
)

export const pcPlanOperations = single(
  import.meta.glob<PcPlanOperations>('../../../../../../sheets/src/renderer/plan-operations.ts', {
    eager: true,
  }),
  'plan-operations.ts',
)

export const pcOpExecutor = single(
  import.meta.glob<PcOpExecutor>('../../../../../../sheets/src/renderer/op-executor.ts', {
    eager: true,
  }),
  'op-executor.ts',
)

export const pcAiUniverSync = single(
  import.meta.glob<PcAiUniverSync>('../../../../../../sheets/src/renderer/univer-sync.ts', {
    eager: true,
  }),
  'univer-sync.ts',
)
