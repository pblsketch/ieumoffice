/**
 * PDF split, shared by the PDF editor, the PDF tools window and the phone app.
 *
 * Planning, validation and output naming are pure helpers. The split
 * execution and bookmark reading engine runs entirely locally with pdf-lib
 * and never mutates the source bytes. Picking a subfolder on disk
 * (uniqueSplitSubfolder) needs file paths and stays in apps/pdf.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib'
import {
  type SplitBookmarkEntry,
  type SplitPlanRequest,
  type SplitOutputOptions,
  type SplitPartPlan,
  planSplitParts,
  formatSplitOutputNames,
} from './split-plan'

// Split execution and bookmark reading (pdf-lib)

const MAX_BOOKMARKS = 5000
const MAX_BOOKMARK_DEPTH = 32
const MAX_NAME_TREE_NODES = 4096

export interface SplitOutputPart {
  bytes: Uint8Array
  /** 1-based source page numbers included in this file */
  pages: number[]
  /** Bookmark title when applicable */
  label?: string
  /** Suggested `.pdf` filename */
  name: string
}

export interface SplitExecutionResult {
  parts: SplitOutputPart[]
  /** 1-based page numbers that alone exceeded maxBytes in maxSize mode */
  oversizedPages: number[]
}

export interface SplitExecuteOptions {
  /** Source file basename (with or without .pdf) used for output naming */
  sourceName?: string
  output?: SplitOutputOptions
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

function abortError(): Error {
  return Object.assign(new Error('Split aborted'), { name: 'AbortError' })
}

function yieldTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function decodePdfText(obj: unknown): string {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try {
      return obj.decodeText()
    } catch {
      return ''
    }
  }
  return ''
}

/** Resolve a named destination key from /Catalog /Dests or /Names /Dests */
function buildNamedDestLookup(doc: PDFDocument): Map<string, PDFArray> {
  const map = new Map<string, PDFArray>()
  const extractArray = (raw: unknown): PDFArray | null => {
    const resolved = raw instanceof PDFRef ? doc.context.lookup(raw) : raw
    if (resolved instanceof PDFArray) return resolved
    if (resolved instanceof PDFDict) {
      const d = resolved.lookupMaybe(PDFName.of('D'), PDFArray)
      if (d) return d
    }
    return null
  }

  // Legacy PDF 1.1 dictionary at /Catalog /Dests
  const legacyDests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict)
  if (legacyDests) {
    for (const [k, v] of legacyDests.entries()) {
      const arr = extractArray(v)
      if (arr) map.set(k.decodeText(), arr)
    }
  }

  // PDF 1.2+ name tree at /Catalog /Names /Dests
  const namesDict = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const destsTree = namesDict?.lookupMaybe(PDFName.of('Dests'), PDFDict)
  if (destsTree) {
    const visited = new Set<PDFDict>()
    const stack: PDFDict[] = [destsTree]
    while (stack.length > 0 && visited.size < MAX_NAME_TREE_NODES) {
      const node = stack.pop()!
      if (visited.has(node)) continue
      visited.add(node)
      const pairs = node.lookupMaybe(PDFName.of('Names'), PDFArray)
      if (pairs) {
        const len = pairs.size()
        for (let i = 0; i + 1 < len; i += 2) {
          const key = decodePdfText(pairs.lookup(i))
          const arr = extractArray(pairs.get(i + 1))
          if (key && arr && !map.has(key)) map.set(key, arr)
        }
      }
      const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
      if (kids) {
        for (let i = kids.size() - 1; i >= 0; i--) {
          const kid = kids.lookup(i)
          if (kid instanceof PDFDict) stack.push(kid)
        }
      }
    }
  }
  return map
}

function resolveDestPage(
  doc: PDFDocument,
  rawDest: unknown,
  pageRefMap: ReadonlyMap<string, number>,
  namedDests: ReadonlyMap<string, PDFArray>,
  pageCount: number,
): number | null {
  let dest = rawDest instanceof PDFRef ? doc.context.lookup(rawDest) : rawDest
  if (dest instanceof PDFName) {
    dest = namedDests.get(dest.decodeText())
  } else if (dest instanceof PDFString || dest instanceof PDFHexString) {
    dest = namedDests.get(decodePdfText(dest))
  }
  if (!(dest instanceof PDFArray) || dest.size() === 0) return null
  const target = dest.get(0)
  if (target instanceof PDFRef) {
    return pageRefMap.get(target.toString()) ?? null
  }
  if (target instanceof PDFNumber) {
    const page = target.asNumber() + 1
    return Number.isInteger(page) && page >= 1 && page <= pageCount ? page : null
  }
  return null
}

/** Read the bookmark tree (/Outlines) from an already-loaded PDFDocument */
export function readBookmarksFromDoc(doc: PDFDocument): SplitBookmarkEntry[] {
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!outlines) return []

  const pages = doc.getPages()
  const pageCount = pages.length
  if (pageCount === 0) return []
  const pageRefMap = new Map<string, number>()
  pages.forEach((p, idx) => pageRefMap.set(p.ref.toString(), idx + 1))
  const namedDests = buildNamedDestLookup(doc)

  const out: SplitBookmarkEntry[] = []
  const seen = new Set<PDFDict>()

  const walk = (parent: PDFDict, level: number): void => {
    if (level > MAX_BOOKMARK_DEPTH) return
    let cur = parent.lookupMaybe(PDFName.of('First'), PDFDict)
    while (cur && !seen.has(cur) && seen.size < MAX_BOOKMARKS) {
      seen.add(cur)
      const title = decodePdfText(cur.lookup(PDFName.of('Title'))).trim()
      let rawDest: unknown = cur.get(PDFName.of('Dest'))
      if (!rawDest) {
        const action = cur.lookupMaybe(PDFName.of('A'), PDFDict)
        if (action?.lookup(PDFName.of('S')) === PDFName.of('GoTo')) {
          rawDest = action.get(PDFName.of('D'))
        }
      }
      const page = resolveDestPage(doc, rawDest, pageRefMap, namedDests, pageCount)
      if (page !== null) {
        out.push({ title, level, page })
      }
      walk(cur, level + 1)
      cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict)
    }
  }

  walk(outlines, 1)
  return out
}

/** Read document bookmarks (/Outlines) from PDF bytes; returns [] on missing outlines */
export async function readPdfBookmarks(bytes: Uint8Array): Promise<SplitBookmarkEntry[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return readBookmarksFromDoc(doc)
}

async function copyPagesToBytes(
  src: PDFDocument,
  oneBasedPages: readonly number[],
): Promise<Uint8Array> {
  const part = await PDFDocument.create()
  const indices = oneBasedPages.map((p) => p - 1)
  const copied = await part.copyPages(src, indices)
  for (const page of copied) part.addPage(page)
  return part.save({ useObjectStreams: false })
}

/**
 * Split into consecutive parts whose serialized byte length does not exceed
 * `maxBytes`, using exponential + binary search on each chunk. Any single page
 * larger than `maxBytes` is emitted alone and reported in `oversizedPages`.
 */
async function splitByMaxSize(
  src: PDFDocument,
  maxBytes: number,
  options: SplitExecuteOptions,
): Promise<{ parts: { bytes: Uint8Array; pages: number[] }[]; oversizedPages: number[] }> {
  const total = src.getPageCount()
  const parts: { bytes: Uint8Array; pages: number[] }[] = []
  const oversizedPages: number[] = []
  const rangePages = (start: number, end: number) =>
    Array.from({ length: end - start + 1 }, (_, i) => start + i)

  const build = async (start: number, end: number): Promise<Uint8Array> => {
    if (options.signal?.aborted) throw abortError()
    const bytes = await copyPagesToBytes(src, rangePages(start, end))
    if (options.signal?.aborted) throw abortError()
    return bytes
  }

  let start = 1
  while (start <= total) {
    const single = await build(start, start)
    if (single.length > maxBytes) {
      oversizedPages.push(start)
      parts.push({ bytes: single, pages: [start] })
      options.onProgress?.(start, total)
      start += 1
      await yieldTick()
      continue
    }

    if (start === total) {
      parts.push({ bytes: single, pages: [start] })
      options.onProgress?.(total, total)
      break
    }

    let lo = start
    let bestBytes = single
    let upper = total + 1

    // Estimate how many pages fit based on the first page's serialized size
    let step = Math.max(
      1,
      Math.min(total - start, Math.floor(maxBytes / Math.max(1, single.length))),
    )
    while (lo < total) {
      const probe = Math.min(total, start + step)
      if (probe <= lo) break
      const probeBytes = await build(start, probe)
      if (probeBytes.length <= maxBytes) {
        lo = probe
        bestBytes = probeBytes
        if (probe === total) {
          upper = total + 1
          break
        }
        step *= 2
      } else {
        upper = probe
        break
      }
    }

    // Refine exact boundary between lo (fits) and upper (too large)
    while (lo + 1 < upper) {
      const mid = Math.floor((lo + upper) / 2)
      const midBytes = await build(start, mid)
      if (midBytes.length <= maxBytes) {
        lo = mid
        bestBytes = midBytes
      } else {
        upper = mid
      }
    }

    parts.push({ bytes: bestBytes, pages: rangePages(start, lo) })
    options.onProgress?.(lo, total)
    start = lo + 1
    await yieldTick()
  }

  return { parts, oversizedPages }
}

/**
 * Execute a SplitPlanRequest against PDF bytes, returning serialized output
 * PDFs paired with their planned page lists and suggested filenames.
 */
export async function executeSplitPlan(
  bytes: Uint8Array,
  plan: SplitPlanRequest,
  options: SplitExecuteOptions = {},
): Promise<SplitExecutionResult> {
  if (options.signal?.aborted) throw abortError()
  const src = await PDFDocument.load(bytes, { updateMetadata: false })
  const pageCount = src.getPageCount()
  const sourceName = options.sourceName || 'document.pdf'

  if (plan.mode === 'maxSize') {
    const checked = planSplitParts(plan, pageCount)
    if (!checked.ok) throw new Error(`split: ${checked.error}`)
    const { parts: rawParts, oversizedPages } = await splitByMaxSize(src, plan.maxBytes, options)
    const plans: SplitPartPlan[] = rawParts.map((p) => ({ pages: p.pages }))
    const names = formatSplitOutputNames(plans, sourceName, options.output)
    return {
      parts: rawParts.map((p, i) => ({
        bytes: p.bytes,
        pages: p.pages,
        name: names[i]!,
      })),
      oversizedPages,
    }
  }

  const bookmarks = plan.mode === 'bookmarks' ? (plan.bookmarks ?? readBookmarksFromDoc(src)) : []
  const planned = planSplitParts(plan, pageCount, bookmarks)
  if (!planned.ok) throw new Error(`split: ${planned.error}`)

  const names = formatSplitOutputNames(planned.parts, sourceName, options.output)
  const parts: SplitOutputPart[] = []
  const totalParts = planned.parts.length
  for (let i = 0; i < totalParts; i++) {
    if (options.signal?.aborted) throw abortError()
    const partPlan = planned.parts[i]!
    const partBytes = await copyPagesToBytes(src, partPlan.pages)
    if (options.signal?.aborted) throw abortError()
    parts.push({
      bytes: partBytes,
      pages: partPlan.pages,
      ...(partPlan.label ? { label: partPlan.label } : {}),
      name: names[i]!,
    })
    options.onProgress?.(i + 1, totalParts)
    if (totalParts > 1) await yieldTick()
  }

  return { parts, oversizedPages: [] }
}
