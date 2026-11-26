import type { EditorKind } from '../editorKind'
import { epubEditorKind } from './epub/epubKind'
import { pptxEditorKind } from './pptx/pptxKind'

/** Editor kinds of track T5 (EPUB and PPTX readers); the registry already spreads this list. */
export const readersEditorKinds: readonly EditorKind[] = [epubEditorKind, pptxEditorKind]
