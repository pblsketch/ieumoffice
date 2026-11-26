/**
 * The desktop modules the edit journal listener needs that reach
 * `WorkbookVisuals.tsx` (directly or through `app-constants.ts` and
 * `univer-sync.ts`), loaded through `import.meta.glob` and typed here. Why a
 * glob and not an import: see `grid/pcGridModules.ts`. The signatures repeat
 * the desktop exports the phone calls; `tests/sheets-pc-journal-modules.test.ts`
 * checks that each one exists and that the mutation names are the desktop's.
 */
import type { IRange } from '@univerjs/core'
import type {
  LazyWorkbookState,
  UniverRuntime,
  UniverWorksheet,
} from '../../../../../../sheets/src/renderer/univer-state'

type AxisAttrMutation = {
  kind: 'size' | 'hidden' | 'auto-size'
  axis: 'row' | 'column'
  hidden?: boolean
}

/** apps/sheets/src/renderer/app-constants.ts (the names the journal listens to). */
export interface PcAppConstants {
  SET_RANGE_VALUES_MUTATION: string
  SET_RANGE_VALUES_COMMAND: string
  SET_NUMFMT_MUTATION: string
  REMOVE_NUMFMT_MUTATION: string
  SET_FROZEN_MUTATION: string
  TOGGLE_GRIDLINES_MUTATION: string
  SET_RIGHT_TO_LEFT_MUTATION: string
  SET_ZOOM_OPERATION: string
  SET_ZOOM_COMMAND: string
  OPEN_FILTER_PANEL_OPERATION: string
  ROW_COLUMN_MUTATIONS: Record<
    string,
    { kind: 'insert-rows' | 'remove-rows' | 'insert-cols' | 'remove-cols'; axis: 'row' | 'column' }
  >
  MERGE_MUTATIONS: Record<string, 'merge-cells' | 'unmerge-cells'>
  AXIS_ATTR_MUTATIONS: Record<string, AxisAttrMutation>
  REORDER_RANGE_MUTATION: string
  MOVE_RANGE_MUTATION: string
  MOVE_RANGE_COMMAND: string
  MOVE_ROWS_MUTATION: string
  MOVE_ROWS_COMMAND: string
  COPY_SHEET_COMMAND: string
  AUTO_FILL_COMMAND: string
  FILTER_MUTATIONS: ReadonlySet<string>
  CF_MUTATIONS: ReadonlySet<string>
  DV_MUTATIONS: ReadonlySet<string>
  DEFINED_NAME_MUTATIONS: ReadonlySet<string>
  NOTE_MUTATIONS: ReadonlySet<string>
  SHEET_LIFECYCLE_MUTATIONS: ReadonlySet<string>
  STRUCTURE_LOCK_COMMANDS: ReadonlySet<string>
  STRUCTURAL_EDIT_COMMAND_PATTERN: RegExp
  RANGE_SHIFT_COMMAND_PATTERN: RegExp
  SORT_COMMAND_PATTERN: RegExp
  FILTER_COMMAND_PATTERN: RegExp
  DV_EDIT_COMMAND_PATTERN: RegExp
  BLOCKED_COMMAND_PATTERN: RegExp
  pixelsToCharacterWidth(pixels: number): number
}

/** apps/sheets/src/renderer/univer-sync.ts (the journal's part). */
export interface PcUniverSyncJournal {
  journalRangeSnapshot(
    runtime: UniverRuntime,
    state: LazyWorkbookState,
    sheetId: string,
    range: IRange,
    order?: Readonly<Record<number, number>>,
  ): void
  matrixBounds(value: unknown): IRange | null
  workbookStructureLocked(state: LazyWorkbookState | null): boolean
  loadVisibleRange(
    runtime: UniverRuntime,
    lazyWorkbookRef: { current: LazyWorkbookState | null },
    worksheet: UniverWorksheet,
    setMessage: (message: string) => void,
  ): Promise<void>
}

/** apps/sheets/src/renderer/large-filter.ts. */
export interface PcLargeFilter {
  isLargeFilterSheet(state: LazyWorkbookState, sheetId: string): boolean
  extendLargeFilterRange(
    runtime: UniverRuntime,
    state: LazyWorkbookState,
    worksheet: UniverWorksheet,
  ): boolean
}

export type PcReorderVerdict =
  'allow' | 'loading' | 'offerFullLoad' | 'workbookTooLarge' | 'rangeTooLarge' | 'valueModeFormulas'

type CellCounts = {
  readonly gridCells: number
  readonly storedCells: number
  readonly valueCells: number
}

/** apps/sheets/src/renderer/reorder-gate.ts. */
export interface PcReorderGate {
  reorderGate(input: {
    formulaMode: boolean
    preloadComplete: boolean
    preloadRunning: boolean
    isAddedSheet: boolean
    cellCounts: CellCounts
    rangeCells: number
    rangeHasStreamedFormulas: () => boolean
  }): PcReorderVerdict
  fullLoadGate(input: {
    formulaMode: boolean
    preloadRunning: boolean
    cellCounts: CellCounts
  }): 'loading' | 'offerFullLoad' | 'workbookTooLarge'
  largestRangeCells(ranges: readonly IRange[]): number
  rangeHasStreamedFormulas(
    state: LazyWorkbookState,
    sheetId: string,
    ranges: readonly IRange[],
  ): boolean
  reorderCommandRanges(
    commandId: string,
    params: unknown,
    selection: IRange | undefined,
    extent: { rows: number; columns: number } | null,
  ): IRange[]
}

/** apps/sheets/src/renderer/plan-operations.ts (the delete-span check). */
export interface PcPlanOperations {
  structuralDeleteFormulaErrorSync(
    state: LazyWorkbookState,
    workbook: unknown,
    op:
      | { op: 'delete_rows'; sheetId: string; row: number; count: number }
      | { op: 'delete_cols'; sheetId: string; column: string; count: number },
  ): string | null
}

function single<T>(modules: Record<string, T>, name: string): T {
  const module = Object.values(modules)[0]
  if (!module) throw new Error(`Desktop journal module missing: ${name}`)
  return module
}

export const pcAppConstants = single(
  import.meta.glob<PcAppConstants>('../../../../../../sheets/src/renderer/app-constants.ts', {
    eager: true,
  }),
  'app-constants.ts',
)

export const pcUniverSyncJournal = single(
  import.meta.glob<PcUniverSyncJournal>('../../../../../../sheets/src/renderer/univer-sync.ts', {
    eager: true,
  }),
  'univer-sync.ts',
)

export const pcLargeFilter = single(
  import.meta.glob<PcLargeFilter>('../../../../../../sheets/src/renderer/large-filter.ts', {
    eager: true,
  }),
  'large-filter.ts',
)

export const pcReorderGate = single(
  import.meta.glob<PcReorderGate>('../../../../../../sheets/src/renderer/reorder-gate.ts', {
    eager: true,
  }),
  'reorder-gate.ts',
)

export const pcPlanOperations = single(
  import.meta.glob<PcPlanOperations>('../../../../../../sheets/src/renderer/plan-operations.ts', {
    eager: true,
  }),
  'plan-operations.ts',
)
