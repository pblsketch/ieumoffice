/**
 * The spreadsheet editor kind (track T1): `.xlsx`, `.xlsm`, `.xls`, `.csv`.
 * Light on purpose: everything heavy (the desktop API, the conversions, the
 * grid) loads on first use, from `open()` and the Workspace's lazy grid.
 */
import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../editorKind'

export const SHEETS_FORMATS: readonly MobileDocFormat[] = ['xlsx', 'xlsm', 'xls', 'csv']

export const sheetsEditorKind: EditorKind = {
  id: 'sheets',
  formats: SHEETS_FORMATS,
  openExtensions: SHEETS_FORMATS,
  // [+] makes an untitled .xlsx with one Sheet1.
  createFormats: ['xlsx'],
  labelKey: 'sheetsEditorName',
  editable: true,
  // The AI run is XLS-T11's (ai/documentSlot.ts); the entry stays hidden while AI is off.
  hasAi: true,
  // Every recovery copy is an .xlsx (an .xls or .csv session edits an .xlsx copy).
  recoveryFormat: () => 'xlsx',
  async open(request) {
    const { openSheetsDocument } = await import('./open/openDocument')
    return openSheetsDocument(request)
  },
}
