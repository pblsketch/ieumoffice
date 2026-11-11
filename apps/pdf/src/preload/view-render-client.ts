import type {
  PdfViewBitmap,
  PdfViewBitmapResult,
  PdfViewRenderRequest,
} from '../shared/view-source'
import type { PdfViewRenderReply } from '../shared/view-render-reply'

/** A fixed response channel, without exposing IPC events or arbitrary channel names. */
export class ViewRenderClient {
  private nextTicket = 0
  private readonly pending = new Map<
    number,
    { resolve(bitmap: PdfViewBitmap): void; reject(error: Error): void }
  >()

  constructor(
    private readonly send: (ticket: number, request: PdfViewRenderRequest) => void,
    listen: (receive: (message: PdfViewRenderReply) => void) => void,
  ) {
    listen((message) => {
      const waiter = this.pending.get(message?.ticket)
      if (!waiter) return
      this.pending.delete(message.ticket)
      if (message.ok) waiter.resolve(message.bitmap)
      else waiter.reject(new Error(message.error))
    })
  }

  render(request: PdfViewRenderRequest): Promise<PdfViewBitmap> {
    if (this.pending.size >= 128) return Promise.reject(new Error('pdf: view render queue full'))
    return new Promise((resolve, reject) => {
      const ticket = ++this.nextTicket
      this.pending.set(ticket, { resolve, reject })
      try {
        this.send(ticket, request)
      } catch (error) {
        this.pending.delete(ticket)
        reject(error)
      }
    })
  }

  deliver(request: PdfViewRenderRequest, receive: (result: PdfViewBitmapResult) => void): void {
    void this.render(request)
      .then(
        (bitmap) => {
          try {
            // contextBridge copies this callback's arguments synchronously.
            receive({ ok: true, bitmap })
          } finally {
            const pixels = bitmap.rgba as ArrayBuffer & { transfer(size: number): ArrayBuffer }
            if (typeof pixels?.transfer === 'function') pixels.transfer(0)
          }
        },
        (error: unknown) => receive({ ok: false, error: String(error) }),
      )
      // A destroyed renderer cannot receive a late reply; its buffer is still released.
      .catch(() => {})
  }
}
