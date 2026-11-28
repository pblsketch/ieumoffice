// Find and replace in a Markdown / text document (spec 4.2): pure matching on the
// source, the hidden-span rule, and matching on the rendered preview.
// A relative import: the package entry `@genoffice/file-parse` pulls in heavy engines.
import { redactMarkdownSource } from '../../../../../packages/file-parse/src/markdown-redaction'

/** Find ignores letter case unless told otherwise (a tunable default). */
export const FIND_IGNORE_CASE = true

/** Names of the CSS Custom Highlights the preview paints (styled in markdownFindSheet.css). */
export const FIND_HIGHLIGHT = 'web-find'
export const FIND_HIGHLIGHT_CURRENT = 'web-find-current'

/** One match, as UTF-16 offsets `[start, end)` into the searched text. */
export interface TextMatch {
  readonly start: number
  readonly end: number
}

export interface FindOptions {
  readonly ignoreCase?: boolean
  /** Ranges no match may overlap; a match that does is skipped. Sorted by start. */
  readonly avoid?: readonly TextMatch[]
}

function escapeRegExp(text: string): string {
  // only syntax characters: other identity escapes are errors under the `u` flag
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

const overlaps = (a: TextMatch, b: TextMatch): boolean => a.start < b.end && a.end > b.start

/**
 * Literal, non-overlapping matches of `query` in `text`. Case folding goes through
 * the RegExp `i` flag, which keeps every offset in the original text.
 */
export function findInText(text: string, query: string, options: FindOptions = {}): TextMatch[] {
  if (query.length === 0) return []
  const ignoreCase = options.ignoreCase ?? FIND_IGNORE_CASE
  const avoid = options.avoid ?? []
  const pattern = new RegExp(escapeRegExp(query), ignoreCase ? 'giu' : 'gu')
  const out: TextMatch[] = []
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const match = { start: m.index, end: m.index + m[0].length }
    if (avoid.some((range) => overlaps(match, range))) {
      // a skipped match must not hide one that starts inside it
      const code = text.codePointAt(m.index) ?? 0
      pattern.lastIndex = m.index + (code > 0xffff ? 2 : 1)
      continue
    }
    out.push(match)
  }
  return out
}

// The hidden-span markup, paired the way `redactMarkdownSource` pairs it: an
// opening tag with the mark name, then the first raw closing tag after it.
const OPEN_RE = /<span\b[^>]*\bdata-redaction\b[^>]*>/gi
const CLOSE_RE = /<\/span\b[^>]*>?/gi
const MARK_NAME_RE = /data-redaction/i

interface HiddenSpanMarkup {
  readonly open: TextMatch
  readonly close: TextMatch | null
}

function scanHiddenSpans(source: string): HiddenSpanMarkup[] {
  const spans: HiddenSpanMarkup[] = []
  if (!MARK_NAME_RE.test(source)) return spans
  const open = new RegExp(OPEN_RE)
  const close = new RegExp(CLOSE_RE)
  let cursor = 0
  for (;;) {
    open.lastIndex = cursor
    const start = open.exec(source)
    if (!start) break
    const openRange = { start: start.index, end: start.index + start[0].length }
    close.lastIndex = openRange.end
    const end = close.exec(source)
    const closeRange = end ? { start: end.index, end: end.index + end[0].length } : null
    spans.push({ open: openRange, close: closeRange })
    cursor = closeRange?.end ?? openRange.end
  }
  return spans
}

/** The opening and closing tags of every hidden span, in order. */
export function hiddenSpanTagRanges(source: string): TextMatch[] {
  return scanHiddenSpans(source).flatMap((span) =>
    span.close ? [span.open, span.close] : [span.open],
  )
}

/** How many hidden spans (opening tag with its closing tag) the source holds. */
export function countHiddenSpans(source: string): number {
  return scanHiddenSpans(source).filter((span) => span.close !== null).length
}

/**
 * Matches in the source text. A match overlapping a hidden span's tag markup is
 * neither found nor replaced: a broken mark would hand the hidden words to the
 * model on the next AI run. The hidden words themselves are found.
 */
export function findInSource(
  source: string,
  query: string,
  ignoreCase: boolean = FIND_IGNORE_CASE,
): TextMatch[] {
  if (query.length === 0) return []
  return findInText(source, query, { ignoreCase, avoid: hiddenSpanTagRanges(source) })
}

/** One step forward or back from `current`, wrapping around; -1 when there is nothing. */
export function stepMatch(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : total - 1
  return (current + delta + total) % total
}

/** The first match starting at or after `offset`, wrapping to the first; -1 when none. */
export function matchIndexFrom(matches: readonly TextMatch[], offset: number): number {
  if (matches.length === 0) return -1
  const found = matches.findIndex((m) => m.start >= offset)
  return found < 0 ? 0 : found
}

/** The source with each of `matches` (sorted, non-overlapping) replaced by `replacement`. */
export function replaceMatches(
  source: string,
  matches: readonly TextMatch[],
  replacement: string,
): string {
  const parts: string[] = []
  let cursor = 0
  for (const m of matches) {
    parts.push(source.slice(cursor, m.start), replacement)
    cursor = m.end
  }
  parts.push(source.slice(cursor))
  return parts.join('')
}

const SPAN_TOKEN_RES = [/<span\b/gi, /<\/span\b/gi, /data-redaction/gi] as const
const countOf = (re: RegExp, text: string): number => text.match(re)?.length ?? 0

/**
 * True when a replace leaves the hidden spans as they were. Refused when fewer
 * hidden spans are read afterwards, when the reader the AI uses
 * (`redactMarkdownSource`) fails on the result, or, in a document that carries
 * hidden-span marks, when the replace added or removed span markup anywhere
 * (a new closing tag inside a span would end it early and let the rest out).
 */
export function replaceKeepsHiddenSpans(before: string, after: string): boolean {
  if (countHiddenSpans(after) < countHiddenSpans(before)) return false
  try {
    redactMarkdownSource(after)
  } catch {
    return false
  }
  if (MARK_NAME_RE.test(before)) {
    for (const re of SPAN_TOKEN_RES) {
      if (countOf(re, before) !== countOf(re, after)) return false
    }
  }
  return true
}

// ---- the rendered preview (view mode) ----

/** Elements whose text never runs on into the next one's. */
const BLOCK_SELECTOR =
  'p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,dt,dd,figcaption,div,section,article,table,tr,ul,ol,hr'

/** The block a match's text belongs to (what view mode scrolls into view). */
export function blockOf(node: Node, root: Element): Element | null {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement
  const block = el?.closest(BLOCK_SELECTOR) ?? null
  return block && root.contains(block) ? block : root
}

interface TextSegment {
  readonly node: Text
  /** Where this node's text starts in the joined text. */
  readonly from: number
}

/**
 * Matches on the text a reader sees (formatting marks gone), as DOM ranges over
 * the preview's text nodes. The DOM is not changed. Text of different blocks is
 * joined with a line break, so a match never runs from one block into the next.
 */
export function findInRenderedText(
  root: Element,
  query: string,
  ignoreCase: boolean = FIND_IGNORE_CASE,
): Range[] {
  if (query.length === 0) return []
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const segments: TextSegment[] = []
  const parts: string[] = []
  let length = 0
  let lastBlock: Element | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (text.data.length === 0) continue
    const block = blockOf(text, root)
    if (lastBlock !== null && block !== lastBlock) {
      parts.push('\n')
      length += 1
    }
    lastBlock = block
    segments.push({ node: text, from: length })
    parts.push(text.data)
    length += text.data.length
  }
  const joined = parts.join('')
  const locate = (offset: number, isEnd: boolean): { node: Text; offset: number } => {
    // the last segment starting before (end) or at/before (start) the offset
    let lo = 0
    let hi = segments.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const from = segments[mid]!.from
      if (isEnd ? from < offset : from <= offset) lo = mid
      else hi = mid - 1
    }
    const seg = segments[lo]!
    return { node: seg.node, offset: offset - seg.from }
  }
  return findInText(joined, query, { ignoreCase }).map((m) => {
    const range = doc.createRange()
    const start = locate(m.start, false)
    const end = locate(m.end, true)
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  })
}

type HighlightWindow = Window & {
  CSS?: { highlights?: Map<string, unknown> }
  Highlight?: new (...ranges: Range[]) => unknown
}

function highlightApi(win: Window | null) {
  const w = win as HighlightWindow | null
  const registry = w?.CSS?.highlights
  const HighlightType = w?.Highlight
  return registry && HighlightType ? { registry, HighlightType } : null
}

/**
 * Paints all matches and the current one with the CSS Custom Highlight API.
 * Returns false when the web view lacks the API (then only the count shows).
 */
export function paintFindHighlights(
  win: Window | null,
  ranges: readonly Range[],
  current: number,
): boolean {
  const api = highlightApi(win)
  if (!api) return false
  const others = ranges.filter((_, i) => i !== current)
  const now = ranges[current]
  api.registry.set(FIND_HIGHLIGHT, new api.HighlightType(...others))
  api.registry.set(FIND_HIGHLIGHT_CURRENT, new api.HighlightType(...(now ? [now] : [])))
  return true
}

export function clearFindHighlights(win: Window | null): void {
  const api = highlightApi(win)
  if (!api) return
  api.registry.delete(FIND_HIGHLIGHT)
  api.registry.delete(FIND_HIGHLIGHT_CURRENT)
}
