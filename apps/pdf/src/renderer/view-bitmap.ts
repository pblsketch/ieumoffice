/** Preserve PDF.js's text/interaction layers while rendering only a flat page bitmap. */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PdfViewBitmap, PdfViewRenderRequest, PdfViewTile } from '../shared/view-source'
type RenderParameters = Parameters<PDFPageProxy['render']>[0]
import { fileViewRenderer } from './view-renderer'
import { ViewRenderQueue, type ViewRenderJob } from './view-render-queue'
const queues = new WeakMap<object, ViewRenderQueue>()

export interface ViewRenderTask {
  promise: Promise<unknown>
  cancel(): void
}
let requestSerial = 0

export function renderViewBitmap(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  pageNo: number,
  params: RenderParameters,
  rotationDelta: number,
  thumbnail = false,
  tile?: PdfViewTile,
): ViewRenderTask {
  const renderer = fileViewRenderer(doc)
  const canvas = params.canvas
  if (!renderer || !canvas) {
    if (canvas) canvas.dataset.pdfViewBackend = 'pdfjs'
    return page.render(params)
  }
  const requestId = String(++requestSerial)
  let cancelled = false
  let fallback: ViewRenderTask | undefined
  let queued: ViewRenderJob<PdfViewBitmap> | undefined
  const promise = (async () => {
    try {
      const request: PdfViewRenderRequest = {
        sourceId: renderer.source.id,
        requestId,
        page: pageNo,
        width: tile
          ? Math.floor(params.viewport.width * (params.transform?.[0] ?? 1))
          : canvas.width,
        height: tile
          ? Math.floor(params.viewport.height * (params.transform?.[3] ?? 1))
          : canvas.height,
        rotation: (((rotationDelta / 90) % 4) + 4) % 4,
        password: renderer.password,
        thumbnail,
        ...(tile ? { tile } : {}),
      }
      let queue = queues.get(renderer)
      if (!queue) queues.set(renderer, (queue = new ViewRenderQueue()))
      queued = queue.schedule(
        () =>
          renderer.api.renderViewPageWithReply
            ? new Promise<PdfViewBitmap>((resolve, reject) =>
                renderer.api.renderViewPageWithReply!(request, (result) =>
                  result.ok ? resolve(result.bitmap) : reject(new Error(result.error)),
                ),
              )
            : renderer.api.renderViewPage(request),
        thumbnail,
      )
      const bitmap = await queued.promise
      try {
        if (cancelled) throw new Error('pdf: view render cancelled')
        if (
          bitmap.width !== canvas.width ||
          bitmap.height !== canvas.height ||
          bitmap.rgba.byteLength !== bitmap.width * bitmap.height * 4
        )
          throw new Error('pdf: invalid view bitmap')
        const context = canvas.getContext('2d')
        if (!context) throw new Error('pdf: missing page canvas')
        context.putImageData(
          new ImageData(new Uint8ClampedArray(bitmap.rgba), bitmap.width, bitmap.height),
          0,
          0,
        )
        canvas.dataset.pdfViewBackend = 'file'
        if (bitmap.wasmBytes) canvas.dataset.pdfViewWasmBytes = String(bitmap.wasmBytes)
      } finally {
        // Canvas owns its copied pixels after putImageData, including across worlds.
        // Also release late cancelled or invalid payloads before any fallback render.
        const pixels = bitmap.rgba as ArrayBuffer & { transfer(size: number): ArrayBuffer }
        if (typeof pixels?.transfer === 'function') pixels.transfer(0)
      }
    } catch (error) {
      if (cancelled) throw error
      // Unsupported pages retain the original renderer and all existing features.
      renderer.disabled = true
      canvas.dataset.pdfViewBackend = 'pdfjs'
      fallback = page.render(params)
      await fallback.promise
    }
  })()
  return {
    promise,
    cancel() {
      cancelled = true
      queued?.cancel()
      fallback?.cancel()
      void renderer.api.cancelViewRender(renderer.source.id, requestId).catch(() => {})
    },
  }
}
