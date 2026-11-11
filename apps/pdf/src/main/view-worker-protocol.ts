import type { PdfViewBitmap, PdfViewRenderRequest } from '../shared/view-source'
export type PdfViewPixelBitmap = Omit<PdfViewBitmap, 'rgba'> & { rgba: Uint8Array }

export type PdfViewWorkerRequest =
  | { id: number; type: 'render'; fd: number; length: number; request: PdfViewRenderRequest }
  | { id: number; type: 'prepare'; sourceId: string }
  | { id: number; type: 'close'; sourceId: string }

export type PdfViewWorkerResponse =
  { id: number; ok: true; bitmap?: PdfViewPixelBitmap } | { id: number; ok: false; error: string }
