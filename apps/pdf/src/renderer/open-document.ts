import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { DOC_OPTS } from './view-config'

export function loadPdfForView(bytes: Uint8Array, password?: string) {
  // PDF.js takes ownership of this buffer. Finish byte-level inspection before
  // calling; encryption and damaged-page recovery already reread their source.
  return getDocument({ data: bytes, password, ...DOC_OPTS })
}
