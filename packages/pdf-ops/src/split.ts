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

export type SplitMode = 'ranges' | 'fixed' | 'bookmarks' | 'maxSize'

export type SplitFixedKind = 'pagesPerFile' | 'fileCount'

export type SplitNamingPattern = 'numbered' | 'range' | 'bookmark'

export type SplitSizeUnit = 'KB' | 'MB'

/** One 1-based inclusive page range */
export interface SplitRange {
  start: number
  end: number
}

/** One resolved document bookmark entry (1-based page and 1-based nesting level) */
export interface SplitBookmarkEntry {
  title: string
  /** 1 = top-level chapter, 2 = sub-section, ... */
  level: number
  /** 1-based page number */
  page: number
}

export type SplitPlanRequest =
  | {
      mode: 'ranges'
      ranges: SplitRange[]
      /** Merge every listed range in order into a single output PDF */
      mergeRanges?: boolean
    }
  | {
      mode: 'fixed'
      kind: SplitFixedKind
      value: number
    }
  | {
      mode: 'bookmarks'
      level: 1 | 2
      /** Keep pages that precede the first matching bookmark as a leading file */
      includeLeadingPages?: boolean
      /** Pre-resolved bookmarks (e.g. from editor outline / pending bookmark edits) */
      bookmarks?: SplitBookmarkEntry[]
    }
  | {
      mode: 'maxSize'
      /** Target maximum byte size per output file */
      maxBytes: number
    }

export interface SplitOutputOptions {
  /** Base filename prefix (defaults to source file basename without .pdf) */
  prefix?: string
  /** Output naming pattern */
  pattern?: SplitNamingPattern
  /** Group multiple output files into a dedicated subfolder */
  createSubfolder?: boolean
}

/** One planned output PDF file (1-based page numbers in order) */
export interface SplitPartPlan {
  pages: number[]
  /** Bookmark title when split by bookmarks */
  label?: string
}

export type SplitPlanError =
  'empty-ranges' | 'invalid-range' | 'invalid-fixed' | 'no-bookmarks' | 'invalid-size'

export type SplitPlanResult =
  | { ok: true; dynamic: false; parts: SplitPartPlan[] }
  | { ok: true; dynamic: true; parts: [] }
  | { ok: false; error: SplitPlanError }

/** Minimum allowed maxSize target (10 KB) */
export const MIN_SPLIT_MAX_BYTES = 10 * 1024

/** Maximum allowed maxSize target (1 GB) */
export const MAX_SPLIT_MAX_BYTES = 1024 * 1024 * 1024

/** Dashes accepted inside a range token */
const RANGE_TOKEN_RE = /^(\d{1,6})\s*(?:[-‐–—~～]\s*(\d{1,6}))?$/

/** Windows reserved filenames that cannot be used as file or folder stems */
const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Parse a comma/semicolon-separated list of ranges ("1-3, 4-8, 9") into
 * ordered SplitRange entries without merging adjacent ranges. Reversed bounds
 * ("5-3") are normalized to ascending ("3-5").
 */
export function parseSplitRangeList(
  text: string,
  pageCount: number,
): { ok: true; ranges: SplitRange[] } | { ok: false; reason: 'empty' | 'syntax' | 'outOfRange' } {
  const tokens = text
    .split(/[,;，、；]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (tokens.length === 0) return { ok: false, reason: 'empty' }
  const ranges: SplitRange[] = []
  let outOfRange = false
  for (const token of tokens) {
    const match = RANGE_TOKEN_RE.exec(token)
    if (!match) return { ok: false, reason: 'syntax' }
    const a = Number(match[1])
    const b = match[2] === undefined ? a : Number(match[2])
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    if (start < 1 || end > pageCount) {
      outOfRange = true
      continue
    }
    ranges.push({ start, end })
  }
  if (outOfRange) return { ok: false, reason: 'outOfRange' }
  return { ok: true, ranges }
}

/** Format SplitRange entries into a compact range string ("1-3, 4, 5-8") */
export function formatSplitRangeList(ranges: readonly SplitRange[]): string {
  return ranges.map((r) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`)).join(', ')
}

/** Format a sorted or arbitrary 1-based page list into compact ranges ("1-3,5") */
export function formatPartPages(pages: readonly number[]): string {
  if (pages.length === 0) return ''
  const groups: string[] = []
  let runStart = pages[0]!
  let prev = runStart
  for (let i = 1; i < pages.length; i++) {
    const cur = pages[i]!
    if (cur === prev + 1) {
      prev = cur
    } else {
      groups.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`)
      runStart = cur
      prev = cur
    }
  }
  groups.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`)
  return groups.join(',')
}

/**
 * Convert scissor cut points (1-based page numbers after which a cut occurs)
 * into contiguous ranges covering 1..pageCount.
 */
export function cutAfterToRanges(cutAfter: readonly number[], pageCount: number): SplitRange[] {
  if (pageCount <= 0) return []
  const cuts = [...new Set(cutAfter)]
    .filter((p) => Number.isInteger(p) && p >= 1 && p < pageCount)
    .sort((a, b) => a - b)
  const ranges: SplitRange[] = []
  let start = 1
  for (const cut of cuts) {
    ranges.push({ start, end: cut })
    start = cut + 1
  }
  ranges.push({ start, end: pageCount })
  return ranges
}

/**
 * If `ranges` cleanly partitions 1..pageCount contiguously in order without
 * gaps or overlaps, return the 1-based scissor cut points; otherwise null.
 */
export function rangesToCutAfter(
  ranges: readonly SplitRange[],
  pageCount: number,
): number[] | null {
  if (pageCount <= 0 || ranges.length === 0) return null
  let expected = 1
  const cuts: number[] = []
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!
    if (r.start !== expected || r.end < r.start || r.end > pageCount) return null
    if (i < ranges.length - 1) cuts.push(r.end)
    expected = r.end + 1
  }
  return expected === pageCount + 1 ? cuts : null
}

/**
 * Build contiguous bookmark split parts for the requested nesting depth.
 * Multiple bookmarks pointing to the same page keep the first title so no
 * empty parts are created.
 */
export function planBookmarkParts(
  bookmarks: readonly SplitBookmarkEntry[],
  pageCount: number,
  level: 1 | 2,
  includeLeadingPages = true,
): SplitPartPlan[] {
  if (pageCount <= 0) return []
  const matching = bookmarks
    .filter(
      (b) =>
        b.level >= 1 &&
        b.level <= level &&
        Number.isInteger(b.page) &&
        b.page >= 1 &&
        b.page <= pageCount,
    )
    .sort((a, b) => a.page - b.page)

  // Deduplicate bookmarks landing on the same page, keeping the earliest entry
  const anchors: { page: number; title: string }[] = []
  for (const entry of matching) {
    if (anchors.length === 0 || anchors[anchors.length - 1]!.page !== entry.page) {
      anchors.push({ page: entry.page, title: entry.title.trim() })
    }
  }
  if (anchors.length === 0) return []

  const parts: SplitPartPlan[] = []
  const firstPage = anchors[0]!.page
  if (includeLeadingPages && firstPage > 1) {
    parts.push({
      pages: Array.from({ length: firstPage - 1 }, (_, i) => i + 1),
    })
  }
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i]!.page
    const end = i + 1 < anchors.length ? anchors[i + 1]!.page - 1 : pageCount
    if (end < start) continue
    const label = anchors[i]!.title
    parts.push({
      pages: Array.from({ length: end - start + 1 }, (_, idx) => start + idx),
      ...(label ? { label } : {}),
    })
  }
  return parts
}

/** Validate a split plan and build static parts (or mark dynamic for maxSize) */
export function planSplitParts(
  plan: SplitPlanRequest,
  pageCount: number,
  bookmarks: readonly SplitBookmarkEntry[] = [],
): SplitPlanResult {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: 'invalid-range' }
  }

  switch (plan.mode) {
    case 'ranges': {
      if (!Array.isArray(plan.ranges) || plan.ranges.length === 0) {
        return { ok: false, error: 'empty-ranges' }
      }
      const normalized: SplitRange[] = []
      for (const raw of plan.ranges) {
        if (
          !Number.isInteger(raw.start) ||
          !Number.isInteger(raw.end) ||
          raw.start < 1 ||
          raw.end < 1 ||
          raw.start > pageCount ||
          raw.end > pageCount
        ) {
          return { ok: false, error: 'invalid-range' }
        }
        const start = Math.min(raw.start, raw.end)
        const end = Math.max(raw.start, raw.end)
        normalized.push({ start, end })
      }
      if (plan.mergeRanges) {
        const mergedPages: number[] = []
        for (const r of normalized) {
          for (let p = r.start; p <= r.end; p++) mergedPages.push(p)
        }
        return { ok: true, dynamic: false, parts: [{ pages: mergedPages }] }
      }
      const parts: SplitPartPlan[] = normalized.map((r) => ({
        pages: Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i),
      }))
      return { ok: true, dynamic: false, parts }
    }

    case 'fixed': {
      const value = Math.floor(plan.value)
      if (!Number.isInteger(value) || value < 1) {
        return { ok: false, error: 'invalid-fixed' }
      }
      if (plan.kind === 'fileCount') {
        const count = Math.min(value, pageCount)
        const baseSize = Math.floor(pageCount / count)
        const remainder = pageCount % count
        const parts: SplitPartPlan[] = []
        let cursor = 1
        for (let i = 0; i < count; i++) {
          const size = baseSize + (i < remainder ? 1 : 0)
          parts.push({ pages: Array.from({ length: size }, (_, idx) => cursor + idx) })
          cursor += size
        }
        return { ok: true, dynamic: false, parts }
      }
      const chunkSize = Math.min(value, pageCount)
      const parts: SplitPartPlan[] = []
      for (let start = 1; start <= pageCount; start += chunkSize) {
        const end = Math.min(pageCount, start + chunkSize - 1)
        parts.push({ pages: Array.from({ length: end - start + 1 }, (_, i) => start + i) })
      }
      return { ok: true, dynamic: false, parts }
    }

    case 'bookmarks': {
      const source = plan.bookmarks ?? bookmarks
      const parts = planBookmarkParts(
        source,
        pageCount,
        plan.level === 2 ? 2 : 1,
        plan.includeLeadingPages !== false,
      )
      if (parts.length === 0) return { ok: false, error: 'no-bookmarks' }
      return { ok: true, dynamic: false, parts }
    }

    case 'maxSize': {
      if (
        typeof plan.maxBytes !== 'number' ||
        !Number.isFinite(plan.maxBytes) ||
        plan.maxBytes < MIN_SPLIT_MAX_BYTES ||
        plan.maxBytes > MAX_SPLIT_MAX_BYTES
      ) {
        return { ok: false, error: 'invalid-size' }
      }
      return { ok: true, dynamic: true, parts: [] }
    }
  }
}

/** Sanitize a string for safe cross-platform file or folder stem usage */
export function sanitizeSplitName(raw: string, fallback: string, maxLen = 60): string {
  // Strip filesystem-forbidden characters and control bytes
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, maxLen)
    .replace(/[. ]+$/g, '')
  if (!cleaned || WINDOWS_RESERVED_RE.test(cleaned)) return fallback
  return cleaned
}

/** Subfolder name created inside the chosen output directory when createSubfolder is enabled */
export function splitSubfolderName(sourceBaseName: string, prefix?: string): string {
  const stem = sanitizeSplitName(
    (prefix?.trim() || sourceBaseName.replace(/\.pdf$/i, '')).trim(),
    'split',
    50,
  )
  return `${stem}-split`
}

/**
 * Generate deduplicated output `.pdf` filenames for each planned part.
 * Zero-pads indices automatically when total parts >= 10 so OS file lists
 * preserve natural order, while keeping 1..9 concise ("name-1.pdf").
 */
export function formatSplitOutputNames(
  parts: readonly SplitPartPlan[],
  sourceName: string,
  options?: SplitOutputOptions,
): string[] {
  const stripped = sourceName.replace(/\.pdf$/i, '') || 'document'
  const prefix = sanitizeSplitName(options?.prefix?.trim() || stripped, 'document', 60)
  const pattern: SplitNamingPattern = options?.pattern ?? 'numbered'
  const count = parts.length
  const padWidth = count >= 10 ? String(count).length : 1

  const used = new Set<string>()
  const uniqueName = (stem: string): string => {
    const safeStem = sanitizeSplitName(stem, prefix, 80)
    const first = `${safeStem}.pdf`
    if (!used.has(first.toLowerCase())) {
      used.add(first.toLowerCase())
      return first
    }
    let n = 2
    while (used.has(`${safeStem}-${n}.pdf`.toLowerCase())) n++
    const candidate = `${safeStem}-${n}.pdf`
    used.add(candidate.toLowerCase())
    return candidate
  }

  return parts.map((part, index) => {
    const seq = String(index + 1).padStart(padWidth, '0')
    if (pattern === 'range') {
      const rangeText = formatPartPages(part.pages)
      return uniqueName(rangeText ? `${prefix}_p${rangeText}` : `${prefix}-${seq}`)
    }
    if (pattern === 'bookmark') {
      if (part.label) {
        const title = sanitizeSplitName(part.label, `${prefix}-${seq}`, 60)
        return uniqueName(`${seq}_${title}`)
      }
      const rangeText = formatPartPages(part.pages)
      return uniqueName(rangeText ? `${seq}_${prefix}_p${rangeText}` : `${prefix}-${seq}`)
    }
    if (count === 1) {
      const rangeText = formatPartPages(part.pages)
      return uniqueName(rangeText ? `${prefix}_p${rangeText}` : `${prefix}-split`)
    }
    return uniqueName(`${prefix}-${seq}`)
  })
}

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
