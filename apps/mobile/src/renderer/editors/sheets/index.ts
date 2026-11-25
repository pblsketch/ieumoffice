import type { EditorKind } from '../editorKind'
import { provisionalSheetsKind } from './provisionalKind'

/** Editor kinds of track T1 (spreadsheets: xlsx, xlsm, xls, csv); the registry already spreads this list. */
export const sheetsEditorKinds: readonly EditorKind[] = [
  // Provisional grid prototype (XLS-T2); the full kind replaces it.
  provisionalSheetsKind,
]
