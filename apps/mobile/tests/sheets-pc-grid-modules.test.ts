import { describe, expect, it } from 'vitest'

// The boundary module loads the desktop files through import.meta.glob; here each
// file is checked to export every function the phone's typed boundary names.
const expected: Record<string, readonly string[]> = {
  'univer-sync.ts': [
    'loadWorkbookSkeleton',
    'applyWorkbookNotes',
    'applyDefinedNames',
    'loadVisibleRange',
    'activateFormulaClosure',
    'clearLazyState',
    'recalcOverBudgetAtOpen',
    'sheetOutline',
    'installInjectorResolutionGuard',
    'installFindRevealFix',
    'installWrapMeasureLifecycle',
  ],
  'load-budget.ts': ['workbookCellCounts', 'opensInFormulaMode'],
  'full-load.ts': ['startFullLoad'],
  'outline-actions.ts': ['loadRowOutlines'],
  'numfmt-fix.ts': ['installNumberFormatFix'],
  'function-registry-probe.ts': ['installSupportedFunctionProbe'],
  'formula-newline-display.ts': ['installFormulaNewlineDisplay'],
}

describe('the desktop grid modules behind the typed boundary', () => {
  it('export what the phone calls', async () => {
    const boundary = await import('../src/renderer/editors/sheets/grid/pcGridModules')
    const modules: Record<string, Record<string, unknown>> = {
      'univer-sync.ts': boundary.pcUniverSync as unknown as Record<string, unknown>,
      'load-budget.ts': boundary.pcLoadBudget as unknown as Record<string, unknown>,
      'full-load.ts': boundary.pcFullLoad as unknown as Record<string, unknown>,
      'outline-actions.ts': boundary.pcOutlineActions as unknown as Record<string, unknown>,
      'numfmt-fix.ts': boundary.pcNumfmtFix as unknown as Record<string, unknown>,
      'function-registry-probe.ts': boundary.pcFunctionRegistryProbe as unknown as Record<
        string,
        unknown
      >,
      'formula-newline-display.ts': boundary.pcFormulaNewlineDisplay as unknown as Record<
        string,
        unknown
      >,
    }
    for (const [file, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(typeof modules[file]?.[name], `${file} ${name}`).toBe('function')
      }
    }
  }, 60_000)
})
