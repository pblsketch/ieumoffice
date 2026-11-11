import type { PdfViewBitmap } from './view-source'

export type PdfViewRenderReply =
  { ticket: number; ok: true; bitmap: PdfViewBitmap } | { ticket: number; ok: false; error: string }
