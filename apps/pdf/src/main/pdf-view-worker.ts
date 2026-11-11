/** A single WASM instance runs off the main thread and owns no document byte arrays. */
import { readFileSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { init } from '@embedpdf/pdfium'
import { PdfiumViewDocument, type ViewPdfium } from './view-render-core'
import type { PdfViewWorkerRequest, PdfViewWorkerResponse } from './view-worker-protocol'

const documents = new Map<string, PdfiumViewDocument>()
let modulePromise: Promise<ViewPdfium> | undefined
function moduleForView(): Promise<ViewPdfium> {
  return (modulePromise ??= (async () => {
    const wrapped = await init({
      wasmBinary: readFileSync(workerData.wasmPath as string),
      // Emscripten's synthetic environment must not inherit a non-ASCII argv path.
      thisProgram: 'genoffice-pdf-view',
    })
    const m = wrapped.pdfium as unknown as ViewPdfium & { _PDFiumExt_Init(): void }
    m._PDFiumExt_Init()
    return m
  })())
}

// Serialization also covers asynchronous initialization; PDFium is not reentrant.
let sequence = Promise.resolve()
let rasterIdle: ReturnType<typeof setTimeout> | undefined
parentPort?.on('message', (job: PdfViewWorkerRequest) => {
  sequence = sequence.then(async () => {
    let response: PdfViewWorkerResponse
    try {
      if (job.type === 'close') {
        documents.get(job.sourceId)?.close()
        documents.delete(job.sourceId)
        response = { id: job.id, ok: true }
      } else if (job.type === 'prepare') {
        await moduleForView()
        response = { id: job.id, ok: true }
      } else {
        const m = await moduleForView()
        const { sourceId, page, width, height, rotation, password } = job.request
        let doc = documents.get(sourceId)
        if (!doc) {
          doc = new PdfiumViewDocument(m, job.fd, job.length, password)
          documents.set(sourceId, doc)
        }
        // Native document caches are reconstructible from pinned descriptors.
        // Keep only the most recently used few documents in the WASM heap.
        documents.delete(sourceId)
        documents.set(sourceId, doc)
        while (documents.size > 4) {
          const oldest = documents.keys().next().value!
          documents.get(oldest)!.close()
          documents.delete(oldest)
        }
        response = {
          id: job.id,
          ok: true,
          bitmap: {
            ...doc.render(
              page,
              width,
              height,
              rotation,
              job.request.thumbnail === true,
              job.request.tile,
            ),
            wasmBytes: m.HEAPU8.byteLength,
          },
        }
        clearTimeout(rasterIdle)
        rasterIdle = setTimeout(() => {
          for (const doc of documents.values()) doc.releaseRasterPage()
        }, 200)
        rasterIdle.unref()
      }
    } catch (error) {
      response = {
        id: job.id,
        ok: false,
        error: error instanceof Error ? error.message : 'pdf: render failed',
      }
    }
    parentPort?.postMessage(
      response,
      response.ok && response.bitmap ? [response.bitmap.rgba.buffer as ArrayBuffer] : [],
    )
  })
})
