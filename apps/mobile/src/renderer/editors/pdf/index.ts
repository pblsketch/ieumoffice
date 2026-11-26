import type { EditorKind } from '../editorKind'
import { pdfEditorKind } from './kind'

/** Editor kinds of track T2 (PDF); the registry already spreads this list. */
export const pdfEditorKinds: readonly EditorKind[] = [pdfEditorKind]
