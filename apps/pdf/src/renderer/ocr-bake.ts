/**
 * Re-export pure OCR baking helpers from shared/ocr-bake so existing editor
 * imports stay unchanged while Node/utility jobs share the exact same logic.
 */
export { buildOcrBakeInserts, groupLines, ocrLinesToWords } from '../shared/ocr-bake'
export type { NormalizedOcrLine, OcrWordLike } from '../shared/ocr-bake'
