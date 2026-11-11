import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindFileViewRenderer, fileViewRenderer } from '../src/renderer/view-renderer'
import { renderViewBitmap } from '../src/renderer/view-bitmap'
import type { PdfViewApi, PdfViewBitmapResult } from '../src/shared/view-source'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function fixture() {
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  )
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2
  const putImageData = vi.fn()
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    putImageData,
  } as unknown as CanvasRenderingContext2D)
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  const page = { render } as unknown as PDFPageProxy
  const doc = {} as PDFDocumentProxy
  const api = {
    renderViewPage: vi.fn(async () => ({
      width: 2,
      height: 2,
      rgba: new Uint8Array(16).fill(255).buffer,
    })),
    cancelViewRender: vi.fn(async () => {}),
  }
  bindFileViewRenderer(
    doc,
    { id: 'source', length: 20, hasXfa: false, initialData: new ArrayBuffer(0) },
    api as unknown as PdfViewApi,
  )
  return {
    canvas,
    putImageData,
    render,
    page,
    doc,
    api,
    params: { canvas, viewport: {} } as Parameters<PDFPageProxy['render']>[0],
  }
}

describe('flat PDF page bitmaps with the existing interaction model', () => {
  it('paints the copied callback pixels before releasing both worlds buffers', async () => {
    const f = fixture()
    const producer = new Uint8Array(16).fill(29).buffer
    let consumer!: ArrayBuffer
    let painted: number[] = []
    f.putImageData.mockImplementation((image: ImageData) => {
      painted = [...image.data]
    })
    const api = {
      ...f.api,
      renderViewPageWithReply: (
        _request: unknown,
        receive: (result: PdfViewBitmapResult) => void,
      ) => {
        consumer = producer.slice(0)
        receive({ ok: true, bitmap: { width: 2, height: 2, rgba: consumer } })
        producer.transfer(0)
      },
    }
    bindFileViewRenderer(
      f.doc,
      { id: 'source', length: 20, hasXfa: false, initialData: new ArrayBuffer(0) },
      api as unknown as PdfViewApi,
    )
    await renderViewBitmap(f.doc, f.page, 1, f.params, 0).promise
    expect(painted).toEqual(Array(16).fill(29))
    expect(producer.byteLength).toBe(0)
    expect(consumer.byteLength).toBe(0)
    expect(f.api.renderViewPage).not.toHaveBeenCalled()
    expect(f.render).not.toHaveBeenCalled()
  })

  it('writes RGBA pixels without asking PDF.js to decode/render page images', async () => {
    const f = fixture()
    await renderViewBitmap(f.doc, f.page, 4, f.params, 90).promise
    expect(f.api.renderViewPage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'source',
        page: 4,
        width: 2,
        height: 2,
        rotation: 1,
        thumbnail: false,
      }),
    )
    expect(f.putImageData).toHaveBeenCalledOnce()
    expect(f.render).not.toHaveBeenCalled()
    expect(f.canvas.dataset.pdfViewBackend).toBe('file')
  })

  it('does not paint or fall back when a cancelled render resolves late', async () => {
    const f = fixture()
    let finish!: (value: { width: number; height: number; rgba: ArrayBuffer }) => void
    f.api.renderViewPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const job = renderViewBitmap(f.doc, f.page, 1, f.params, 0)
    job.cancel()
    const pixels = new ArrayBuffer(16)
    finish({ width: 2, height: 2, rgba: pixels })
    await expect(job.promise).rejects.toThrow('cancelled')
    expect(f.putImageData).not.toHaveBeenCalled()
    expect(f.render).not.toHaveBeenCalled()
    expect(f.api.cancelViewRender).toHaveBeenCalledWith('source', expect.any(String))
    expect(fileViewRenderer(f.doc)).toBeDefined()
    expect(pixels.byteLength).toBe(0)
  })

  it('uses the original renderer after a failed backend and forwards cancellation', async () => {
    const f = fixture()
    f.api.renderViewPage.mockRejectedValueOnce(new Error('unsupported render'))
    const cancel = vi.fn()
    let settle!: () => void
    f.render.mockReturnValueOnce({
      promise: new Promise<void>((resolve) => {
        settle = resolve
      }),
      cancel,
    })
    const job = renderViewBitmap(f.doc, f.page, 1, f.params, 0)
    await vi.waitFor(() => expect(f.render).toHaveBeenCalledOnce())
    job.cancel()
    settle()
    await job.promise
    expect(cancel).toHaveBeenCalledOnce()
    expect(fileViewRenderer(f.doc)).toBeUndefined()
    expect(f.render).toHaveBeenCalledWith(f.params)
  })

  it('keeps XFA documents on the original path', async () => {
    const f = fixture()
    const doc = {} as PDFDocumentProxy
    bindFileViewRenderer(
      doc,
      { id: 'xfa', length: 20, hasXfa: true, initialData: new ArrayBuffer(0) },
      f.api as unknown as PdfViewApi,
    )
    await renderViewBitmap(doc, f.page, 1, f.params, 0).promise
    expect(f.render).toHaveBeenCalledOnce()
    expect(f.api.renderViewPage).not.toHaveBeenCalled()
  })
})
