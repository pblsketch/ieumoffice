// Feature slot "annot" (PDF-T5): text markup (highlight, underline, squiggly, strikeout)
// and sticky notes with replies (spec 3.4); bar button Highlighter.
import type { PdfFeature } from '../../edit/types'
import { useAnnotFeature } from './useAnnotFeature'

export const annotFeature: PdfFeature = { id: 'annot', useFeature: useAnnotFeature }

export { useAnnotFeature }
export * from './markupOps'
export * from './noteOps'
export {
  caretAt,
  selectionQuads,
  selectionText,
  textRunsOf,
  type TextCaret,
  type TextRun,
} from './textRuns'
export { MEMO_AUTHOR_KEY } from './prefs'
export { ANNOT_LONG_PRESS_MS } from './AnnotPageLayer'
