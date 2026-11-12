/**
 * A CSV session saved back as CSV (a plain Save, not an export) drops the
 * workbook's hiding marks: CSV has no defined names. The save asks first, every
 * time, and only when there are marks; a workbook without marks keeps the old
 * once-per-file question.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSave, type SaveContext } from '../src/renderer/save-actions'
import { createEditJournal, recordSetRangeValues } from '../src/renderer/edit-journal'

const saveWorkbookEdits = vi.fn()
const writeWorkbookRecovery = vi.fn()
const confirmCsvSave = vi.fn()

beforeEach(() => {
  saveWorkbookEdits.mockReset().mockResolvedValue({ canceled: true })
  writeWorkbookRecovery.mockReset().mockResolvedValue({ ok: true })
  confirmCsvSave.mockReset()
  ;(globalThis as unknown as { window: unknown }).window = {
    desktopApi: { saveWorkbookEdits, writeWorkbookRecovery, confirmCsvSave },
  }
})

let serial = 0

function csvCtx(names: string[]): SaveContext {
  const journal = createEditJournal()
  recordSetRangeValues(journal, 'sheet-1', { 0: { 0: { v: 'edited' } } })
  serial += 1
  const workbook = {
    getDefinedNames: () => names.map((name) => ({ getName: () => name })),
    getActiveSheet: () => null,
    getSheets: () => [],
  }
  return {
    univerRef: { current: { univerAPI: { getActiveWorkbook: () => workbook } } } as never,
    stashViewRestore: () => {},
    lazyWorkbookRef: {
      current: {
        editJournal: journal,
        uninstalledDefinedNames: new Set<string>(),
        recalc: {
          timer: null,
          generation: 0,
          failed: false,
          formulaCells: new Map(),
          overlay: new Map(),
        },
        flags: { preloadComplete: true },
        file: {
          sessionId: '11111111-1111-4111-8111-111111111111',
          needsSaveAs: false,
          restoredFromRecovery: false,
          csvPath: `/tmp/hiding-${serial}.csv`,
        },
      },
    } as never,
    setMessage: () => {},
    openLazyWorkbook: () => {},
  }
}

describe('saving a CSV session that holds hiding marks', () => {
  it('passes the mark count and asks on every save', async () => {
    confirmCsvSave.mockResolvedValue('cancel')
    const ctx = csvCtx(['IeumHide_이름', 'IeumHide2_이름', 'Total'])
    await handleSave(ctx, 'save')
    await handleSave(ctx, 'save')
    expect(confirmCsvSave).toHaveBeenCalledTimes(2)
    expect(confirmCsvSave).toHaveBeenNthCalledWith(1, 2)
    expect(saveWorkbookEdits).not.toHaveBeenCalled()
  })

  it('keeps the once-per-file question when there are no marks', async () => {
    confirmCsvSave.mockResolvedValue('cancel')
    const ctx = csvCtx(['Total'])
    await handleSave(ctx, 'save')
    expect(confirmCsvSave).toHaveBeenCalledWith(0)
  })
})
