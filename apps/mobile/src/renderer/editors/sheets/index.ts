import type { EditorKind } from '../editorKind'
import { sheetsEditorKind } from './kind'

/**
 * Editor kinds of track T1 (spreadsheets: xlsx, xlsm, xls, csv); the registry
 * already spreads this list. Which task owns which file: README-slots.md.
 */
export const sheetsEditorKinds: readonly EditorKind[] = [sheetsEditorKind]
