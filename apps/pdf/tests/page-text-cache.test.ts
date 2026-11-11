import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createPageTextCache, type PageTextContent } from '../src/renderer/page-text-cache'
import { createSearchIndexCache, searchInIndex } from '../src/renderer/search'
import { buildHeadingOutline } from '../src/renderer/heading-outline'

const content = (text: string): PageTextContent =>
  ({
    items: [{ str: text, fontName: 'f1', transform: [12, 0, 0, 12, 0, 700], width: 90 }],
    styles: { f1: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } },
  }) as PageTextContent

function document(count: number, read: (n: number) => Promise<PageTextContent>) {
  const reads: number[] = []
  const cleanup = vi.fn()
  return {
    reads,
    cleanup,
    doc: {
      numPages: count,
      getPage: async (n: number) => ({
        getTextContent: () => {
          reads.push(n)
          return read(n)
        },
        cleanup,
      }),
    } as unknown as PDFDocumentProxy,
  }
}

describe('bounded page text and detection', () => {
  it('coalesces readers and preserves the text and font objects needed by navigation', async () => {
    const text = content('shared text')
    const { doc, reads, cleanup } = document(1, async () => text)
    const cache = createPageTextCache()
    const [a, b] = await Promise.all([cache.get(doc, 1), cache.get(doc, 1)])
    expect(a).toBe(text)
    expect(b).toBe(text)
    expect(reads).toEqual([1])
    await Promise.resolve()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('rehydrates a cold page while retaining a recently touched page', async () => {
    const { doc, reads } = document(20, async (n) => content(`page ${n}`))
    const cache = createPageTextCache()
    for (let n = 1; n <= 8; n++) await cache.get(doc, n)
    await cache.get(doc, 1)
    await cache.get(doc, 9)
    expect((await cache.get(doc, 1)).items).toEqual(content('page 1').items)
    await cache.get(doc, 2)
    expect(reads.filter((n) => n === 1)).toHaveLength(1)
    expect(reads.filter((n) => n === 2)).toHaveLength(2)
  })

  it('does not retain an oversized page but still returns all of its text', async () => {
    const large = content('x'.repeat(4 * 1024 * 1024))
    const { doc, reads } = document(2, async (n) => (n === 1 ? large : content('small')))
    const cache = createPageTextCache()
    await cache.get(doc, 2)
    expect(await cache.get(doc, 1)).toBe(large)
    expect(await cache.get(doc, 1)).toBe(large)
    await cache.get(doc, 2)
    expect(reads).toEqual([2, 1, 1])
  })

  it('retries a rejected extraction instead of caching its failure', async () => {
    let attempts = 0
    const { doc, cleanup } = document(1, async () => {
      if (++attempts === 1) throw new Error('transient page read')
      return content('retry succeeded')
    })
    const cache = createPageTextCache()
    await expect(cache.get(doc, 1)).rejects.toThrow('transient page read')
    expect(await cache.get(doc, 1)).toEqual(content('retry succeeded'))
    await Promise.resolve()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('does not let a pre-clear request replace the new cache generation', async () => {
    let finish!: (value: PageTextContent) => void
    let calls = 0
    const { doc } = document(1, async () => {
      if (++calls === 1) return new Promise<PageTextContent>((done) => (finish = done))
      return content('new generation')
    })
    const cache = createPageTextCache()
    const old = cache.get(doc, 1)
    await Promise.resolve()
    cache.clear()
    expect(await cache.get(doc, 1)).toEqual(content('new generation'))
    finish(content('old generation'))
    expect(await old).toEqual(content('old generation'))
    expect(await cache.get(doc, 1)).toEqual(content('new generation'))
    expect(calls).toBe(2)
  })

  it('detects scanned pages without constructing positioned entries, then supports search', async () => {
    let geometryReads = 0
    const text = content('searchable document text')
    Object.defineProperty(text.items[0], 'transform', {
      get() {
        geometryReads++
        return [12, 0, 0, 12, 0, 700]
      },
    })
    const { doc, reads } = document(2, async (n) => (n === 1 ? text : content(' \n\t')))
    const cache = createSearchIndexCache()
    expect(await cache.scannedPages(doc, new AbortController().signal)).toEqual([1])
    expect(geometryReads).toBe(0)
    const index = await cache.get(doc)
    expect(searchInIndex(index, 'searchable').map((m) => m.pageIndex)).toEqual([0])
    expect(geometryReads).toBeGreaterThan(0)
    expect(reads).toEqual([1, 2])
  })

  it('uses compact flags after a full search even when recent raw pages were evicted', async () => {
    const { doc, reads } = document(32, async (n) => content(n % 3 ? 'digital page text' : ''))
    const cache = createSearchIndexCache()
    await cache.get(doc)
    expect(await cache.scannedPages(doc, new AbortController().signal)).toEqual([
      2, 5, 8, 11, 14, 17, 20, 23, 26, 29,
    ])
    expect(reads).toHaveLength(32)
  })

  it('cancels detection after its in-flight page and reuses that result on retry', async () => {
    let finish!: (value: PageTextContent) => void
    let markStarted!: () => void
    const started = new Promise<void>((done) => {
      markStarted = done
    })
    const { doc, reads } = document(3, async (n) =>
      n === 1
        ? new Promise<PageTextContent>((done) => {
            finish = done
            markStarted()
          })
        : content(''),
    )
    const cache = createSearchIndexCache()
    const controller = new AbortController()
    const detecting = cache.scannedPages(doc, controller.signal)
    await started
    controller.abort()
    finish(content(''))
    expect(await detecting).toBeNull()
    expect(reads).toEqual([1])
    expect(await cache.scannedPages(doc, new AbortController().signal)).toEqual([0, 1, 2])
    expect(reads).toEqual([1, 2, 3])
  })

  it('shares navigation extraction with automatic detection beyond the recent-page window', async () => {
    const texts = Array.from({ length: 40 }, (_, index) => ({
      items: [
        { str: `Chapter ${index + 1}`, transform: [20, 0, 0, 20, 72, 720], hasEOL: true },
        ...Array.from({ length: 8 }, (_, line) => ({
          str: `body text on line ${line}`,
          transform: [10, 0, 0, 10, 72, 690 - line * 12],
          hasEOL: true,
        })),
      ],
      styles: {},
    })) as PageTextContent[]
    const { doc, reads } = document(texts.length, async (n) => texts[n - 1])
    const cache = createSearchIndexCache()
    const [outline, scanned] = await Promise.all([
      buildHeadingOutline(
        doc,
        () => false,
        (n) => cache.textContent(doc, n),
      ),
      cache.scannedPages(doc, new AbortController().signal),
    ])
    expect(outline?.map((node) => node.title)).toEqual(texts.map((_, i) => `Chapter ${i + 1}`))
    expect(scanned).toEqual([])
    expect(reads).toHaveLength(texts.length)
  })
})
