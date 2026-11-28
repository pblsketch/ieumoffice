import { describe, expect, it } from 'vitest'

// The AI boundary loads the desktop files through import.meta.glob; here each
// file is checked to export every function the phone's typed boundary names.
const expected: Record<string, readonly string[]> = {
  pcWorkbookReaders: ['getActiveSheetInfo', 'readCells', 'readFormats', 'readSheetFeatures'],
  pcWorkbookSearch: ['findWorkbookCells', 'selectWorkbookRange'],
  pcFormulaAudit: ['traceWorkbookPrecedents', 'traceWorkbookDependents'],
  pcAggregateRange: ['aggregateWorkbookRange'],
  pcPlanOperations: ['proposeOperations'],
  pcOpExecutor: ['applyChangePlan'],
  pcAiUniverSync: ['lazyWorkbookCellReader', 'ensureLazyRangeLoaded'],
}

describe('the desktop AI modules behind the typed boundary', () => {
  it('export what the phone calls', async () => {
    const boundary =
      (await import('../src/renderer/editors/sheets/ai/pcAiModules')) as unknown as Record<
        string,
        Record<string, unknown>
      >
    for (const [module, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(typeof boundary[module]?.[name], `${module} ${name}`).toBe('function')
      }
    }
  }, 180_000)
})
