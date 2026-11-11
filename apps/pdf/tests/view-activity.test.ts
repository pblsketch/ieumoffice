import { afterEach, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfViewApi } from '../src/shared/view-source'
import { bindFileViewRenderer, forgetFileViewRenderer } from '../src/renderer/view-renderer'
import { createSearchIndexCache } from '../src/renderer/search'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('pauses automatic detection in a hidden native tab and retires its wait when the document closes', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  let visible!: (value: boolean) => void
  const off = vi.fn()
  vi.stubGlobal('aiOfficeViewVisibility', {
    getVisible: async () => false,
    onChanged: (handler: typeof visible) => {
      visible = handler
      return off
    },
  })
  const getPage = vi.fn(async () => ({
    getTextContent: async () => ({ items: [], styles: {} }),
    cleanup() {},
  }))
  const doc = { numPages: 3, getPage } as unknown as PDFDocumentProxy
  bindFileViewRenderer(
    doc,
    { id: 'source', length: 1024, hasXfa: false, initialData: new ArrayBuffer(0) },
    {} as PdfViewApi,
  )
  const cache = createSearchIndexCache()
  const controller = new AbortController()
  const pending = cache.scannedPages(doc, controller.signal)
  await Promise.resolve()
  expect(getPage).not.toHaveBeenCalled()
  visible(true)
  expect(await pending).toEqual([0, 1, 2])
  expect(getPage).toHaveBeenCalledTimes(3)
  const other = { numPages: 1, getPage } as unknown as PDFDocumentProxy
  bindFileViewRenderer(
    other,
    { id: 'other', length: 1024, hasXfa: false, initialData: new ArrayBuffer(0) },
    {} as PdfViewApi,
  )
  const waiting = createSearchIndexCache().scannedPages(other, new AbortController().signal)
  forgetFileViewRenderer(other)
  expect(await waiting).toBeNull()
  expect(getPage).toHaveBeenCalledTimes(3)
  forgetFileViewRenderer(doc)
  expect(off).toHaveBeenCalledTimes(2)
})
