/**
 * The desktop grid modules that reach `WorkbookVisuals.tsx`
 * (univer-sync.ts and the modules that import it or app-constants.ts), loaded
 * as they are through Vite's `import.meta.glob` and typed here.
 *
 * Why not a plain import: `WorkbookVisuals.tsx` (lines 2830 and 2848) puts a
 * default before a spread of an indexed record. That compiles under the
 * desktop's `noUncheckedIndexedAccess`, but under the phone's compiler
 * settings TypeScript reports TS2783 there, and a plain import would bring the
 * file into the phone's type check. `import.meta.glob` bundles the same module
 * (Vite resolves it at build time) without the type checker following it, so
 * the desktop code stays untouched. The signatures below repeat the desktop
 * exports the phone calls; `tests/sheets-pc-grid-modules.test.ts` checks that
 * each one exists.
 */
import type { WorkbookFile } from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetOutlineState } from '../../../../../../sheets/src/renderer/outline-model'
import type {
  LazyWorkbookState,
  UniverRuntime,
  UniverWorksheet,
} from '../../../../../../sheets/src/renderer/univer-state'

type LazyRef = { current: LazyWorkbookState | null }
type ReadonlyLazyRef = { readonly current: LazyWorkbookState | null }
type SetMessage = (message: string) => void
type Disposable = { dispose(): void }

export interface PcUniverSync {
  loadWorkbookSkeleton(runtime: UniverRuntime | null, file: WorkbookFile): void
  applyWorkbookNotes(runtime: UniverRuntime | null, file: WorkbookFile): void
  applyDefinedNames(
    runtime: UniverRuntime | null,
    file: WorkbookFile,
    state: LazyWorkbookState,
  ): void
  loadVisibleRange(
    runtime: UniverRuntime,
    lazyWorkbookRef: LazyRef,
    worksheet: UniverWorksheet,
    setMessage: SetMessage,
    viewportStart?: { row: number; column: number },
    fromScroll?: boolean,
  ): Promise<void>
  activateFormulaClosure(
    runtime: UniverRuntime,
    lazyWorkbookRef: LazyRef,
    setMessage: SetMessage,
  ): Promise<void>
  clearLazyState(state: LazyWorkbookState | null): void
  recalcOverBudgetAtOpen(fileBytes: number | undefined, gridCellCount: number): boolean
  sheetOutline(state: LazyWorkbookState, sheetId: string): SheetOutlineState
  installInjectorResolutionGuard(runtime: UniverRuntime): void
  installFindRevealFix(runtime: UniverRuntime): () => void
  installWrapMeasureLifecycle(runtime: UniverRuntime): Disposable
}

export interface PcLoadBudget {
  workbookCellCounts(sheets: WorkbookFile['sheets']): {
    readonly gridCells: number
    readonly storedCells: number
    readonly valueCells: number
  }
  opensInFormulaMode(counts: {
    readonly gridCells: number
    readonly storedCells: number
    readonly valueCells: number
  }): boolean
}

export interface PcFullLoad {
  startFullLoad(
    runtime: UniverRuntime,
    lazyWorkbookRef: LazyRef,
    setMessage: SetMessage,
  ): Promise<void>
}

export interface PcOutlineActions {
  loadRowOutlines(state: LazyWorkbookState, lazyWorkbookRef: ReadonlyLazyRef): Promise<void>
}

export interface PcNumfmtFix {
  installNumberFormatFix(runtime: UniverRuntime, isDate1904?: () => boolean): Disposable
}

export interface PcFunctionRegistryProbe {
  installSupportedFunctionProbe(runtime: UniverRuntime): Disposable
}

export interface PcFormulaNewlineDisplay {
  installFormulaNewlineDisplay(runtime: UniverRuntime): Disposable
}

function single<T>(modules: Record<string, T>, name: string): T {
  const module = Object.values(modules)[0]
  if (!module) throw new Error(`Desktop grid module missing: ${name}`)
  return module
}

export const pcUniverSync = single(
  import.meta.glob<PcUniverSync>('../../../../../../sheets/src/renderer/univer-sync.ts', {
    eager: true,
  }),
  'univer-sync.ts',
)

export const pcLoadBudget = single(
  import.meta.glob<PcLoadBudget>('../../../../../../sheets/src/renderer/load-budget.ts', {
    eager: true,
  }),
  'load-budget.ts',
)

export const pcFullLoad = single(
  import.meta.glob<PcFullLoad>('../../../../../../sheets/src/renderer/full-load.ts', {
    eager: true,
  }),
  'full-load.ts',
)

export const pcOutlineActions = single(
  import.meta.glob<PcOutlineActions>('../../../../../../sheets/src/renderer/outline-actions.ts', {
    eager: true,
  }),
  'outline-actions.ts',
)

export const pcNumfmtFix = single(
  import.meta.glob<PcNumfmtFix>('../../../../../../sheets/src/renderer/numfmt-fix.ts', {
    eager: true,
  }),
  'numfmt-fix.ts',
)

export const pcFunctionRegistryProbe = single(
  import.meta.glob<PcFunctionRegistryProbe>(
    '../../../../../../sheets/src/renderer/function-registry-probe.ts',
    { eager: true },
  ),
  'function-registry-probe.ts',
)

export const pcFormulaNewlineDisplay = single(
  import.meta.glob<PcFormulaNewlineDisplay>(
    '../../../../../../sheets/src/renderer/formula-newline-display.ts',
    { eager: true },
  ),
  'formula-newline-display.ts',
)
