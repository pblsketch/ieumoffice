/**
 * The desktop's Excel-compatibility modules the phone installs, imported as
 * they are from apps/sheets/src/renderer. Only modules that touch the grid's
 * model, rendering and formula engine are here; modules that hang on the
 * desktop chrome (ribbon, context menus, the desktop formula bar, keyboard
 * shortcuts, the IME Hanja fix, clipboard, status bar, find panel, outline
 * gutter) are left out — see the prototype results for the list and why.
 */
import { SheetInterceptorService } from '@univerjs/sheets'
import { installAutofitLinePitch } from '../../../../../../sheets/src/renderer/autofit-line-pitch'
import { installAutofitWrapBudget } from '../../../../../../sheets/src/renderer/autofit-wrap-budget'
import { installBorderOverflowExclusionFix } from '../../../../../../sheets/src/renderer/border-overflow-exclusion'
import { installCellClipAnchorFix } from '../../../../../../sheets/src/renderer/cell-clip-anchor-fix'
import { installCenterContinuousRender } from '../../../../../../sheets/src/renderer/center-continuous'
import { installCfDisplayKeyCompare } from '../../../../../../sheets/src/renderer/cf-duplicate-key'
import { installCfEmptySheetFastPath } from '../../../../../../sheets/src/renderer/cf-empty-fast-path'
import { installCfFormulaFold } from '../../../../../../sheets/src/renderer/cf-formula-fold'
import { installCriteriaCompareCacheFix } from '../../../../../../sheets/src/renderer/criteria-compare-cache'
import { installErrorValueAlignment } from '../../../../../../sheets/src/renderer/error-value-align'
import { installFilterRangeOutlineSuppression } from '../../../../../../sheets/src/renderer/filter-range-outline'
import { installCachedValueFallbackInterceptor } from '../../../../../../sheets/src/renderer/formula-cached-fallback'
import { installFormulaLexerFix } from '../../../../../../sheets/src/renderer/formula-lexer-fix'
import { installFormulaNullResultFix } from '../../../../../../sheets/src/renderer/formula-null-result'
import { installFormulaStreamHold } from '../../../../../../sheets/src/renderer/formula-stream-hold'
import {
  installFormulaTextInterceptor,
  installFormulaViewInterceptor,
} from '../../../../../../sheets/src/renderer/formula-view'
import { installGridGrowth } from '../../../../../../sheets/src/renderer/grid-growth'
import { installIfsEmptySetFix } from '../../../../../../sheets/src/renderer/ifs-empty-set'
import { installKoreanDateInput } from '../../../../../../sheets/src/renderer/korean-date-input'
import { installHeaderUnhideDebounce } from '../../../../../../sheets/src/renderer/load-perf-patches'
import {
  installForceStringMarkGate,
  installLongTextRender,
} from '../../../../../../sheets/src/renderer/long-text-render'
import { installMergeBorderFix } from '../../../../../../sheets/src/renderer/merge-border-fix'
import { installNewSheetNaming } from '../../../../../../sheets/src/renderer/new-sheet-name'
import { installRateFallback } from '../../../../../../sheets/src/renderer/rate-function'
import { installRichTextBidiFix } from '../../../../../../sheets/src/renderer/rich-text-bidi-fix'
import { installRtlGridMirror } from '../../../../../../sheets/src/renderer/rtl-grid-mirror'
import { installRtlTextDirectionFix } from '../../../../../../sheets/src/renderer/rtl-text-fix'
import { installSheetRenameFix } from '../../../../../../sheets/src/renderer/sheet-rename-fix'
import { installRightToLeftCommand } from '../../../../../../sheets/src/renderer/sheet-rtl-view'
import { installStylesCacheReuse } from '../../../../../../sheets/src/renderer/styles-cache-reuse'
import { installThickBorderFix } from '../../../../../../sheets/src/renderer/thick-border-fix'
import {
  installJournalSuppressionUndoFilter,
  installLoadAutoHeightGate,
  type LazyWorkbookState,
  type UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { installVeryHiddenSheetGuard } from '../../../../../../sheets/src/renderer/very-hidden-sheets'
import { installVertAlignRender } from '../../../../../../sheets/src/renderer/vert-align-render'
import {
  pcFormulaNewlineDisplay,
  pcFunctionRegistryProbe,
  pcNumfmtFix,
  pcUniverSync,
} from './pcGridModules'

/** The desktop modules installed here, by file (reported by the prototype). */
export const REUSED_PC_MODULES = [
  'create-univer.ts',
  'univer-sync.ts',
  'univer-state.ts',
  'univer-locales.ts',
  'edit-journal.ts',
  'load-budget.ts',
  'full-load.ts',
  'outline-actions.ts',
  'autofit-line-pitch.ts',
  'autofit-wrap-budget.ts',
  'border-overflow-exclusion.ts',
  'cell-clip-anchor-fix.ts',
  'center-continuous.ts',
  'cf-duplicate-key.ts',
  'cf-empty-fast-path.ts',
  'cf-formula-fold.ts',
  'criteria-compare-cache.ts',
  'error-value-align.ts',
  'filter-range-outline.ts',
  'formula-cached-fallback.ts',
  'formula-lexer-fix.ts',
  'formula-newline-display.ts',
  'formula-null-result.ts',
  'formula-stream-hold.ts',
  'formula-view.ts',
  'function-registry-probe.ts',
  'grid-growth.ts',
  'ifs-empty-set.ts',
  'korean-date-input.ts',
  'load-perf-patches.ts',
  'long-text-render.ts',
  'merge-border-fix.ts',
  'new-sheet-name.ts',
  'numfmt-fix.ts',
  'rate-function.ts',
  'rich-text-bidi-fix.ts',
  'rtl-grid-mirror.ts',
  'rtl-text-fix.ts',
  'sheet-rename-fix.ts',
  'sheet-rtl-view.ts',
  'styles-cache-reuse.ts',
  'thick-border-fix.ts',
  'very-hidden-sheets.ts',
  'vert-align-render.ts',
] as const

/** Prototype-level patches (once per page) and per-runtime installs, in the desktop's order. */
export function installExcelCompat(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
): () => void {
  installFilterRangeOutlineSuppression(runtime)
  installVeryHiddenSheetGuard(runtime, lazyWorkbookRef)
  installNewSheetNaming(runtime)
  pcUniverSync.installInjectorResolutionGuard(runtime)
  const disposers: Array<() => void> = []
  const add = (disposable: { dispose(): void } | (() => void)): void => {
    disposers.push(typeof disposable === 'function' ? disposable : () => disposable.dispose())
  }
  add(pcUniverSync.installFindRevealFix(runtime))
  add(installGridGrowth(runtime))
  add(pcUniverSync.installWrapMeasureLifecycle(runtime))
  installJournalSuppressionUndoFilter()
  installLoadAutoHeightGate()
  installBorderOverflowExclusionFix()
  installCfEmptySheetFastPath()
  installStylesCacheReuse()
  installCellClipAnchorFix()
  installMergeBorderFix()
  installThickBorderFix()
  installRtlTextDirectionFix()
  installRtlGridMirror()
  installRightToLeftCommand(runtime)
  installRichTextBidiFix()
  installCenterContinuousRender()
  installLongTextRender()
  installVertAlignRender()
  installAutofitWrapBudget()
  installAutofitLinePitch()
  installHeaderUnhideDebounce()
  installForceStringMarkGate(runtime.univer.__getInjector().get(SheetInterceptorService))
  installFormulaStreamHold(runtime)
  add(installFormulaViewInterceptor(runtime, lazyWorkbookRef))
  add(installFormulaTextInterceptor(runtime, lazyWorkbookRef))
  add(installCachedValueFallbackInterceptor(runtime, lazyWorkbookRef))
  add(pcFormulaNewlineDisplay.installFormulaNewlineDisplay(runtime))
  add(pcFunctionRegistryProbe.installSupportedFunctionProbe(runtime))
  add(
    pcNumfmtFix.installNumberFormatFix(
      runtime,
      () => lazyWorkbookRef.current?.file.date1904 === true,
    ),
  )
  add(installErrorValueAlignment(runtime))
  add(installRateFallback(runtime))
  add(installIfsEmptySetFix(runtime))
  add(installCriteriaCompareCacheFix())
  add(installFormulaLexerFix(runtime))
  add(installSheetRenameFix())
  add(installCfFormulaFold(runtime))
  add(installCfDisplayKeyCompare(runtime))
  add(installFormulaNullResultFix(runtime))
  add(installKoreanDateInput(runtime))
  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // A disposer of a runtime already torn down has nothing left to undo.
      }
    }
  }
}
