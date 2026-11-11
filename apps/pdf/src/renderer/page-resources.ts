import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

interface PageUse {
  users: number
  page: Promise<PDFPageProxy>
}

const documents = new WeakMap<PDFDocumentProxy, Map<number, PageUse>>()

/**
 * Share decoded page resources between the viewport, thumbnails and OCR. Removing
 * a canvas alone does not release PDF.js's image bitmaps or operator lists. Drop
 * those when the last consumer leaves; PDF.js defers cleanup if a render is still
 * settling. A later visit reads the page again from the same document.
 */
export function retainPageResources(doc: PDFDocumentProxy, pageNo: number) {
  let pages = documents.get(doc)
  if (!pages) documents.set(doc, (pages = new Map()))
  let use = pages.get(pageNo)
  if (!use) {
    use = { users: 0, page: doc.getPage(pageNo) }
    pages.set(pageNo, use)
  }
  use.users++
  const entry = use
  const registry = pages
  let released = false
  return {
    page: entry.page,
    release() {
      if (released) return
      released = true
      entry.users--
      if (entry.users !== 0) return
      void entry.page
        .then((page) => {
          // A new viewport/thumbnail may have acquired it while getPage resolved.
          if (entry.users !== 0 || registry.get(pageNo) !== entry) return
          registry.delete(pageNo)
          page.cleanup()
        })
        .catch(() => {
          if (entry.users === 0 && registry.get(pageNo) === entry) registry.delete(pageNo)
        })
    },
  }
}

/** Immediately release the native/GPU allocation; detached canvases otherwise await GC. */
export function releaseCanvasPixels(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}
