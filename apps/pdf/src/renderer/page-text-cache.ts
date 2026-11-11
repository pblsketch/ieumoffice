import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { retainPageResources } from './page-resources'

export type PageTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
const MAX_PAGES = 8
const MAX_ESTIMATED_BYTES = 8 * 1024 * 1024
const MIN_TEXT_CHARS = 8

/** The same scanned-page threshold for detection and the AI fallback. */
export const isScannedText = (text: string): boolean =>
  text.replace(/\s/g, '').length < MIN_TEXT_CHARS

/** Detection does not need a positioned, case-folded full-document search index. */
export function isScannedContent(content: PageTextContent): boolean {
  let count = 0
  for (const item of content.items) {
    if (!('str' in item) || typeof item.str !== 'string') continue
    count += item.str.replace(/\s/g, '').length
    if (count >= MIN_TEXT_CHARS) return false
  }
  return true
}

interface PageTexts {
  pending: Map<number, Promise<PageTextContent>>
  ready: Map<number, { content: PageTextContent; weight: number }>
  bytes: number
}

/** Conservative accounting for raw text objects, not a measurement of JS heap. */
function estimatedBytes(content: PageTextContent): number {
  let bytes = 256
  for (const item of content.items) {
    bytes += 192
    if ('str' in item && typeof item.str === 'string')
      bytes += item.str.length * 2 + (item.fontName?.length ?? 0) * 2
  }
  for (const [name, style] of Object.entries(content.styles ?? {}))
    bytes += 160 + name.length * 2 + (style.fontFamily?.length ?? 0) * 2
  return bytes
}

/** Share concurrent extraction and a bounded recent window between text consumers. */
export function createPageTextCache() {
  let documents = new WeakMap<PDFDocumentProxy, PageTexts>()
  return {
    get(doc: PDFDocumentProxy, pageNo: number): Promise<PageTextContent> {
      let pages = documents.get(doc)
      if (!pages) {
        pages = { pending: new Map(), ready: new Map(), bytes: 0 }
        documents.set(doc, pages)
      }
      const cached = pages.ready.get(pageNo)
      if (cached) {
        pages.ready.delete(pageNo)
        pages.ready.set(pageNo, cached)
        return Promise.resolve(cached.content)
      }
      const pending = pages.pending.get(pageNo)
      if (pending) return pending
      const state = pages
      const request = (async () => {
        const lease = retainPageResources(doc, pageNo)
        try {
          const page = await lease.page
          const content = await page.getTextContent()
          const weight = estimatedBytes(content)
          if (weight <= MAX_ESTIMATED_BYTES) {
            state.ready.set(pageNo, { content, weight })
            state.bytes += weight
            while (state.ready.size > MAX_PAGES || state.bytes > MAX_ESTIMATED_BYTES) {
              const oldest = state.ready.entries().next().value!
              state.ready.delete(oldest[0])
              state.bytes -= oldest[1].weight
            }
          }
          return content
        } finally {
          lease.release()
        }
      })().finally(() => state.pending.delete(pageNo))
      state.pending.set(pageNo, request)
      return request
    },
    clear() {
      // In-flight consumers keep their own result; it cannot repopulate this map.
      documents = new WeakMap()
    },
  }
}
