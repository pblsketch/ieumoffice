/// CSV export of the active sheet: display strings from the live Univer model
/// (number formats applied, formula results, values only), Excel-style
/// quoting, CRLF rows. The main process runs the loss warning + save dialog
/// and writes UTF-8 with a BOM so Excel reopens it correctly.

import { MAX_CSV_EXPORT_CHARS } from '../shared/ipc-channels'
import { settleFormulas } from './formula-settle'
import { formulaViewSheets } from './formula-view'
import { t } from './i18n/locale'
import { showToast } from './toast-bus'
import type { LazyWorkbookState, UniverRuntime } from './univer-state'
import { neutralizeCsvFormulaField } from '@genoffice/xlsx-gateway/domain/csv-formula-guard'

/// Rows fetched per getDisplayValues call, bounding the facade's allocation.
const EXPORT_ROW_BLOCK = 4096

/** The App refs/state the CSV export needs; built fresh per call. */
export interface CsvExportContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  setMessage: (message: string) => void
  /// Routes into the regular Save As flow when the user picks "Save as .xlsx"
  /// in the formula-loss warning.
  requestSaveAs: () => void
}

/// The slice of the Univer facade the export reads (structural, so the
/// caller passes the FWorksheet through a cast — same pattern as print-html).
export interface CsvWorksheet {
  getLastRow(): number
  getLastColumn(): number
  getSheetId(): string
  getSheetName(): string
  getRange(
    row: number,
    column: number,
    numRows: number,
    numColumns: number,
  ): { getDisplayValues(): string[][] }
  getSheet(): {
    getCellMatrix(): {
      forValue(
        callback: (row: number, column: number, cell: { f?: string | null } | null) => unknown,
      ): void
    }
  }
}

/** The CSV export's formula-neutralization preference: off by default —
    accounting text ("-"), social handles ("@handle") and negative currency
    keep their bytes, and the plain CSV save never rewrites a cell. Only the
    explicit Export ▸ CSV command consults it. */
export const CSV_NEUTRALIZE_KEY = 'aisheets.csv-neutralize-formulas'

export function csvNeutralizeFormulasEnabled(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): boolean {
  return storage.getItem(CSV_NEUTRALIZE_KEY) === '1'
}

export function csvField(text: string, neutralizeFormulas = false): string {
  const normalized = text.replace(/\r\n|\r/g, '\n')
  // formula-injection guard, shared with the CLI's writer (xlsx-gateway
  // domain/csv-formula-guard): opt-in, and limited to the shapes the next app
  // actually evaluates — a leading =, @/ +/- followed by a function call, or
  // the DDE program|topic!cell form. Ordinary data never gains the apostrophe
  // (Excel does not hide it on CSV open; pandas and DB imports read it as
  // data).
  const guarded = neutralizeFormulas ? neutralizeCsvFormulaField(normalized) : normalized
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function csvFromDisplayRows(
  rows: readonly (readonly string[])[],
  neutralizeFormulas = false,
): string {
  return rows
    .map((row) => row.map((cell) => csvField(cell, neutralizeFormulas)).join(',') + '\r\n')
    .join('')
}

/// Runs `read` with the sheet dropped from the formula-view set, restoring it
/// afterwards: CSV always exports calculated values, and in formula view the
/// display interceptor would hand getDisplayValues the formula text instead.
/// The read is synchronous, so the grid never repaints while the flag is off.
export function withoutFormulaView<T>(sheets: Set<string>, sheetId: string, read: () => T): T {
  const hadFormulaView = sheets.delete(sheetId)
  try {
    return read()
  } finally {
    if (hadFormulaView) sheets.add(sheetId)
  }
}

/// Serializes the active sheet's display grid; 'too-large' when the text
/// exceeds the IPC cap. Callers gate on preloadComplete first.
export function serializeActiveSheetCsv(
  sheet: CsvWorksheet,
  state: LazyWorkbookState | null,
  neutralizeFormulas = false,
): string | 'too-large' {
  const rowCount = Math.max(sheet.getLastRow(), 0) + 1
  const columnCount = Math.max(sheet.getLastColumn(), 0) + 1
  const parts: string[] = []
  let length = 0
  const tooLarge = withoutFormulaView(formulaViewSheets(state), sheet.getSheetId(), () => {
    for (let start = 0; start < rowCount; start += EXPORT_ROW_BLOCK) {
      const blockRows = Math.min(EXPORT_ROW_BLOCK, rowCount - start)
      const part = csvFromDisplayRows(
        sheet.getRange(start, 0, blockRows, columnCount).getDisplayValues(),
        neutralizeFormulas,
      )
      length += part.length
      if (length > MAX_CSV_EXPORT_CHARS) return true
      parts.push(part)
    }
    return false
  })
  return tooLarge ? 'too-large' : parts.join('')
}

/// The active FWorksheet through the structural CsvWorksheet slice, plus the
/// live sheet count — shared by the menu export and the save flows.
export function activeCsvSheet(
  runtime: UniverRuntime | null,
): { sheet: CsvWorksheet; sheetCount: number } | null {
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const worksheet = workbook?.getActiveSheet()
  if (!workbook || !worksheet) return null
  return {
    sheet: worksheet as unknown as CsvWorksheet,
    sheetCount: workbook.getSheets().length,
  }
}

/// A worksheet by id through the CsvWorksheet slice (the active sheet when
/// omitted) — the AI create_document path's analog of activeCsvSheet.
export function csvSheetById(runtime: UniverRuntime | null, sheetId?: string): CsvWorksheet | null {
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const worksheet =
    sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
  return worksheet ? (worksheet as unknown as CsvWorksheet) : null
}

export function sheetHasFormulas(sheet: CsvWorksheet): boolean {
  let found = false
  sheet
    .getSheet()
    .getCellMatrix()
    .forValue((_row, _column, cell) => {
      if (!cell?.f) return undefined
      found = true
      return false
    })
  return found
}

/** Export ▸ CSV. `neutralizeFormulas` rides the command path only (the
    preference); a CSV Save As passes nothing — the plain save keeps every
    cell's bytes (see save-actions). */
export async function handleExportCsv(
  ctx: CsvExportContext,
  targetPath?: string,
  opts?: { neutralizeFormulas?: boolean },
): Promise<void> {
  const runtime = ctx.univerRef.current
  if (!runtime || !activeCsvSheet(runtime)) return
  const state = ctx.lazyWorkbookRef.current
  if (state && !state.flags.preloadComplete) {
    ctx.setMessage(t('appCsvExportNeedsFullLoad'))
    return
  }
  try {
    await settleFormulas(runtime)
    // The formula pass awaited: take the sheet again, it may have changed meanwhile.
    const active = activeCsvSheet(runtime)
    if (!active || ctx.lazyWorkbookRef.current !== state) return
    const { sheet, sheetCount } = active
    const content = serializeActiveSheetCsv(sheet, state, opts?.neutralizeFormulas ?? false)
    if (content === 'too-large') {
      ctx.setMessage(t('appCsvExportTooLarge'))
      return
    }
    const baseName = (state?.file.name ?? 'Book1').replace(/\.[^.]+$/, '')
    const result = await window.desktopApi.exportCsv({
      fileName: `${baseName}.csv`,
      content,
      hasFormulas: sheetHasFormulas(sheet),
      ...(sheetCount > 1 ? { activeSheetName: sheet.getSheetName() } : {}),
      ...(targetPath === undefined ? {} : { targetPath }),
    })
    if (result.canceled) {
      if (result.saveAsXlsxInstead) ctx.requestSaveAs()
      else ctx.setMessage(t('appCsvExportCanceled'))
      return
    }
    // Toast like the regular save paths: the status bar alone is easy to
    // miss, and a CSV Save As keeps the window on the source workbook — with
    // no prominent confirmation the export reads as "nothing was saved".
    const exported =
      sheetCount > 1
        ? t('appCsvExportedActiveOnly', { name: sheet.getSheetName(), path: result.path })
        : t('appCsvExported', { path: result.path })
    ctx.setMessage(exported)
    showToast(exported)
  } catch (error: unknown) {
    const failed = error instanceof Error ? error.message : t('appCsvExportFailed')
    ctx.setMessage(failed)
    showToast(failed, 'error')
  }
}
