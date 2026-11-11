/** Opaque, view-owned document input. Neither file paths nor descriptors cross IPC. */
export interface PdfViewSource {
  id: string
  length: number
  hasXfa: boolean
  initialData: ArrayBuffer
}

export const PDF_VIEW_RANGE_CHUNK_BYTES = 1024 * 1024
export const PDF_VIEW_MAX_RENDER_PIXELS = 48_000_000

/** Pixel bounds within the full rotated page raster. */
export interface PdfViewTile {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfViewRenderRequest {
  sourceId: string
  requestId: string
  /** The original document's 1-based page number. */
  page: number
  width: number
  height: number
  /** Additional clockwise quarter turns; the document's own rotation is retained. */
  rotation: number
  password?: string
  /** Visible pages precede queued thumbnail jobs. */
  thumbnail?: boolean
  tile?: PdfViewTile
}

export interface PdfViewBitmap {
  width: number
  height: number
  rgba: ArrayBuffer
  /** Linear-memory capacity, for resource-budget attribution. */
  wasmBytes?: number
}

export type PdfViewBitmapResult = { ok: true; bitmap: PdfViewBitmap } | { ok: false; error: string }

export interface PdfViewApi {
  openViewSource(path: string): Promise<PdfViewSource>
  readViewRange(sourceId: string, offset: number, length: number): Promise<ArrayBuffer>
  renderViewPage(request: PdfViewRenderRequest): Promise<PdfViewBitmap>
  /** Callback copying finishes before preload releases its exclusive pixel input. */
  renderViewPageWithReply?(
    request: PdfViewRenderRequest,
    receive: (result: PdfViewBitmapResult) => void,
  ): void
  cancelViewRender(sourceId: string, requestId: string): Promise<void>
  closeViewSource(sourceId: string): Promise<void>
}
