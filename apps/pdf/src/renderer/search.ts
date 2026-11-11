import type { PDFDocumentProxy } from 'pdfjs-dist'
import { foldCase, isWordChar } from '@genoffice/ui'
import { createPageTextCache, isScannedContent, type PageTextContent } from './page-text-cache'
import { waitForViewActivity } from './view-renderer'

/** One hit: original page + PDF user-space rects (multiple when spanning several text items) */
export interface SearchMatch {
  pageIndex: number
  rects: [number, number, number, number][]
}

interface IndexedItem {
  start: number
  end: number
  x: number
  y: number
  w: number
  h: number
  /** Rotated run (tilted baseline) — excluded from block grouping */
  rot?: boolean
  /** pdf.js font id (e.g. 'g_d0_f7'); resolves to the run's font for edit previews */
  font?: string
}

export interface PageEntry {
  /** Original text (same length as lower; used for context excerpts) */
  text: string
  lower: string
  items: IndexedItem[]
}

export type SearchIndex = PageEntry[]

const MAX_MATCHES = 1000

/** Match modifiers for `searchInIndex`; both default off (plain case-insensitive scan) */
export interface SearchOptions {
  /** Case-sensitive matching — compare characters without folding case */
  matchCase?: boolean
  /** Whole-word matching — the hit must not continue a longer word on either side */
  wholeWord?: boolean
}

/** CJK scripts (kana, hangul, ideographs, and the punctuation/fullwidth blocks
    that travel with them): text written with these has no inter-word spaces */
const CJK_RE =
  /[\u1100-\u11FF\u2E80-\u318F\u31A0-\u31BF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{2FA1F}]/u

/** Whole-word boundary check for the hit at [start, start + len) of `text`.
    CJK characters never count as word characters here: CJK scripts do not
    separate words with spaces, so there is no word boundary to assert inside
    CJK runs — a CJK neighbour acts like a delimiter and a CJK match edge
    imposes no boundary at all. That degrades whole-word matching to a plain
    search for CJK sequences (and for the CJK side of mixed text) while Latin
    runs glued into a longer word are still rejected. */
function wordBoundaryOk(text: string, start: number, len: number): boolean {
  const wordChar = (ch: string | undefined): boolean => !!ch && !CJK_RE.test(ch) && isWordChar(ch)
  const left = !wordChar(text[start - 1]) || !wordChar(text[start])
  const right = !wordChar(text[start + len]) || !wordChar(text[start + len - 1])
  return left && right
}

interface RawTextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  hasEOL?: boolean
  fontName?: string
}

/** Concatenate text per page + record each item's char range and PDF-space box (built once, cached per doc by caller) */
export async function buildSearchIndex(
  doc: PDFDocumentProxy,
  readText: (pageNo: number) => Promise<PageTextContent> = async (n) =>
    (await doc.getPage(n)).getTextContent(),
): Promise<SearchIndex> {
  const entries: PageEntry[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await readText(n)
    let text = ''
    const items: IndexedItem[] = []
    for (const it of content.items as RawTextItem[]) {
      if (typeof it.str !== 'string') continue
      if (it.str.length > 0) {
        // Geometry is optional; without a transform the item still contributes its
        // characters, or it is unfindable while its hasEOL newline still lands.
        if (it.transform) {
          const h = it.height || Math.hypot(it.transform[2] ?? 0, it.transform[3] ?? 0)
          // Rotation tilts the baseline (b ≠ 0). A non-zero c alone is horizontal
          // shear — synthetic italics — which stays horizontally set and must keep
          // participating in block grouping.
          const rot = Math.abs(it.transform[1] ?? 0) > h * 1e-3
          items.push({
            start: text.length,
            end: text.length + it.str.length,
            x: it.transform[4] ?? 0,
            y: it.transform[5] ?? 0,
            w: it.width ?? 0,
            h,
            ...(rot ? { rot: true } : {}),
            ...(typeof it.fontName === 'string' ? { font: it.fontName } : {}),
          })
        }
        text += it.str
      }
      if (it.hasEOL) text += '\n'
    }
    entries.push({ text, lower: foldCase(text), items })
  }
  return entries
}

/** One text extraction per loaded document, shared by every consumer */
export interface SearchIndexCache {
  /** Base index of `doc`; the same promise for the same document until cleared */
  get(doc: PDFDocumentProxy): Promise<SearchIndex>
  /** Recent raw text, shared with navigation without retaining every page's objects. */
  textContent(doc: PDFDocumentProxy, pageNo: number): Promise<PageTextContent>
  /** Compact scanned flags; null means detection was cancelled before it finished. */
  scannedPages(doc: PDFDocumentProxy, signal: AbortSignal): Promise<number[] | null>
  /** Drop the cached extraction (a save-reload replaces the document content) */
  clear(): void
}

/** Build the positioned index only on demand. Navigation and automatic scan
    detection share a bounded recent text window and compact detection flags. */
export function createSearchIndexCache(): SearchIndexCache {
  let entry: { doc: PDFDocumentProxy; promise: Promise<SearchIndex> } | null = null
  let detected = new WeakMap<PDFDocumentProxy, Uint8Array>()
  const texts = createPageTextCache()
  const flagsOf = (doc: PDFDocumentProxy): Uint8Array => {
    let flags = detected.get(doc)
    if (!flags) detected.set(doc, (flags = new Uint8Array(doc.numPages)))
    return flags
  }
  const readText = async (doc: PDFDocumentProxy, n: number): Promise<PageTextContent> => {
    const flags = flagsOf(doc)
    const content = await texts.get(doc, n)
    flags[n - 1] = isScannedContent(content) ? 1 : 2
    return content
  }
  return {
    get(doc) {
      if (entry?.doc !== doc)
        entry = { doc, promise: buildSearchIndex(doc, (n) => readText(doc, n)) }
      return entry.promise
    },
    textContent: readText,
    async scannedPages(doc, signal) {
      const flags = flagsOf(doc)
      const scanned: number[] = []
      let reads = 0
      for (let index = 0; index < flags.length; index++) {
        if (signal.aborted) return null
        if (flags[index] === 0) {
          if (!(await waitForViewActivity(doc, signal))) return null
          const content = await texts.get(doc, index + 1)
          flags[index] = isScannedContent(content) ? 1 : 2
          reads++
          if (signal.aborted) return null
          // Give input and paint a turn between background extraction batches.
          if (reads % 8 === 0) await new Promise<void>((done) => setTimeout(done, 0))
        }
        if (flags[index] === 1) scanned.push(index)
      }
      return signal.aborted ? null : scanned
    },
    clear() {
      entry = null
      detected = new WeakMap()
      texts.clear()
    },
  }
}

/** Full-text search with optional case/word modifiers; rects linearly interpolated within items by char ratio (approximate; bounding box for rotated glyphs) */
export function searchInIndex(
  index: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchMatch[] {
  const matchCase = opts.matchCase ?? false
  const wholeWord = opts.wholeWord ?? false
  const q = matchCase ? query : foldCase(query)
  if (!q) return []
  const matches: SearchMatch[] = []
  for (let pageIndex = 0; pageIndex < index.length; pageIndex++) {
    const { text, lower, items } = index[pageIndex]!
    // The sensitive path reads the original text; the insensitive path reuses
    // the precomputed fold so a search never re-folds the whole page. foldCase
    // is length-preserving, so hit offsets are valid in `text` either way.
    const hay = matchCase ? text : lower
    let from = 0
    while (matches.length < MAX_MATCHES) {
      const s = hay.indexOf(q, from)
      if (s < 0) break
      if (wholeWord && !wordBoundaryOk(text, s, q.length)) {
        from = s + 1
        continue
      }
      const e = s + q.length
      from = e
      const rects: [number, number, number, number][] = []
      for (const it of items) {
        if (it.end <= s || it.start >= e) continue
        const len = it.end - it.start
        const lo = (Math.max(s, it.start) - it.start) / len
        const hi = (Math.min(e, it.end) - it.start) / len
        const x1 = it.x + it.w * lo
        const x2 = it.x + it.w * hi
        if (x2 - x1 < 0.01) continue
        rects.push([x1, it.y, x2, it.y + it.h])
      }
      if (rects.length > 0) matches.push({ pageIndex, rects })
    }
    if (matches.length >= MAX_MATCHES) break
  }
  return matches
}

/**
 * Pages to list as "found in AI-read text" (spec §7). AI-read text has no
 * positions, so a page is listed only when its AI-read text holds the query
 * and its positioned text (the text layer, with Windows OCR for scanned
 * pages: the `index` the viewer searches) holds none of it. `aiTexts` is keyed
 * by 1-based page; the answer is 0-based page indices, ascending.
 */
export function aiReadOnlyPages(
  index: SearchIndex,
  aiTexts: ReadonlyMap<number, string>,
  query: string,
): number[] {
  const q = foldCase(query)
  if (!q) return []
  const out: number[] = []
  for (const [page, text] of aiTexts) {
    const pageIndex = page - 1
    if (pageIndex < 0) continue
    if (index[pageIndex]?.lower.includes(q)) continue
    if (foldCase(text).includes(q)) out.push(pageIndex)
  }
  return out.sort((a, b) => a - b)
}
