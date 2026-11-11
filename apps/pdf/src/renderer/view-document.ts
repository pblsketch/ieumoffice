/** Keep the existing PDF.js document model, backed by a pinned range capability. */
import { getDocument, PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfViewApi } from '../shared/view-source'
import { PDF_VIEW_RANGE_CHUNK_BYTES } from '../shared/view-source'
import { DOC_OPTS } from './view-config'
import { bindFileViewRenderer, forgetFileViewRenderer } from './view-renderer'

export async function openViewDocument(api: PdfViewApi, path: string, password?: string) {
  const source = await api.openViewSource(path)
  let failed: (reason: unknown) => void = () => {}
  const rangeError = new Promise<never>((_resolve, reject) => {
    failed = reject
  })
  void rangeError.catch(() => {})
  let closed = false
  let closing: Promise<void> | undefined
  let doc: PDFDocumentProxy | undefined
  let stop: (() => Promise<void>) | undefined
  class FileRanges extends PDFDataRangeTransport {
    private aborted = false
    constructor() {
      super(source.length, new Uint8Array(source.initialData), true)
    }
    requestDataRange(begin: number, end: number): void {
      void (async () => {
        if (this.aborted || closed) return
        const bytes =
          end - begin > PDF_VIEW_RANGE_CHUNK_BYTES ? new Uint8Array(end - begin) : undefined
        for (let at = begin; at < end; at += PDF_VIEW_RANGE_CHUNK_BYTES) {
          const amount = Math.min(PDF_VIEW_RANGE_CHUNK_BYTES, end - at)
          const chunk = new Uint8Array(await api.readViewRange(source.id, at, amount))
          if (this.aborted || closed) return
          if (chunk.byteLength !== amount) throw new Error('pdf: incomplete view range')
          if (bytes) bytes.set(chunk, at - begin)
          else {
            this.onDataRange(begin, chunk)
            return
          }
        }
        if (!this.aborted && !closed && bytes) this.onDataRange(begin, bytes)
      })().catch((error) => {
        if (this.aborted || closed) return
        failed(error)
        void stop?.().catch(() => {})
      })
    }
    abort(): void {
      this.aborted = true
    }
  }
  const range = new FileRanges()
  try {
    const task = getDocument({
      range,
      rangeChunkSize: 256 * 1024,
      disableAutoFetch: true,
      disableStream: true,
      password,
      ...DOC_OPTS,
    })
    const destroy = task.destroy.bind(task)
    stop = task.destroy = () =>
      (closing ??= (async () => {
        closed = true
        range.abort()
        if (doc) forgetFileViewRenderer(doc)
        try {
          await destroy()
        } finally {
          await api.closeViewSource(source.id)
        }
      })())
    const promise = Promise.race([task.promise, rangeError]).then((loaded) => {
      if (!closed) {
        doc = loaded
        bindFileViewRenderer(loaded, source, api, password)
      }
      return loaded
    })
    return {
      task: { promise, destroy: task.destroy },
      byteLength: source.length,
      xfaMarker: source.hasXfa,
    }
  } catch (error) {
    range.abort()
    await api.closeViewSource(source.id)
    throw error
  }
}
