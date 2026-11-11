import type { PdfViewBitmap, PdfViewRenderRequest } from '../shared/view-source'
import type { PdfViewRenderReply } from '../shared/view-render-reply'
import { releaseOwnedBuffer } from './owned-buffer'

/** Reply synchronously serializes the pixels before their main-isolate storage is released. */
export async function replyViewRender(
  ticket: unknown,
  request: PdfViewRenderRequest,
  render: (request: PdfViewRenderRequest) => Promise<PdfViewBitmap>,
  reply: (message: PdfViewRenderReply) => void,
): Promise<void> {
  if (!Number.isSafeInteger(ticket) || (ticket as number) < 1) return
  let bitmap: PdfViewBitmap | undefined
  try {
    bitmap = await render(request)
    reply({ ticket: ticket as number, ok: true, bitmap })
  } catch (error) {
    try {
      reply({
        ticket: ticket as number,
        ok: false,
        error: error instanceof Error ? error.message : 'pdf: view render failed',
      })
    } catch {
      // The frame may have disappeared while its page was being rendered.
    }
  } finally {
    // These are exclusive worker output buffers, never the reusable WASM heap.
    // Discard their backing stores now, rather than waiting for an idle main heap's GC.
    if (bitmap) releaseOwnedBuffer(bitmap.rgba)
  }
}
