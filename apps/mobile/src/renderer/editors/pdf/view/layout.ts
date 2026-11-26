// Page layout of the continuous vertical PDF view and the render window.
// Pure functions: the viewer feeds them the scroll position, tests feed them numbers.
import { clampScale } from '../../../../../../pdf/src/renderer/view-config'

/** Display size of one page at scale 1 (CSS px, rotation already applied). */
export interface PdfPageSize {
  readonly width: number
  readonly height: number
}

/** Space between pages and around the page column (CSS px). */
export const PDF_PAGE_GAP = 8
export const PDF_SIDE_PAD = 8

export interface PdfPageLayout {
  readonly scale: number
  /** Top of each page inside the scroll content (CSS px). */
  readonly tops: readonly number[]
  readonly widths: readonly number[]
  readonly heights: readonly number[]
  /** Scroll content size (CSS px). */
  readonly contentWidth: number
  readonly contentHeight: number
}

/** Pages stacked top to bottom at `scale`, each centred in a column `viewportWidth` wide. */
export function computePageLayout(
  sizes: readonly PdfPageSize[],
  scale: number,
  viewportWidth: number,
): PdfPageLayout {
  const tops: number[] = []
  const widths: number[] = []
  const heights: number[] = []
  let y = PDF_PAGE_GAP
  let maxW = 0
  for (const size of sizes) {
    const w = Math.floor(size.width * scale)
    const h = Math.floor(size.height * scale)
    tops.push(y)
    widths.push(w)
    heights.push(h)
    y += h + PDF_PAGE_GAP
    maxW = Math.max(maxW, w)
  }
  return {
    scale,
    tops,
    widths,
    heights,
    contentWidth: Math.max(viewportWidth, maxW + PDF_SIDE_PAD * 2),
    contentHeight: y,
  }
}

/** Left edge of page `index` inside the scroll content: centred, never under the side pad. */
export function pageLeft(layout: PdfPageLayout, index: number): number {
  const w = layout.widths[index] ?? 0
  return Math.max(PDF_SIDE_PAD, Math.floor((layout.contentWidth - w) / 2))
}

/** First and last page (0-based, inclusive) that intersect [top, top + height); null when none. */
export function visiblePageRange(
  layout: PdfPageLayout,
  top: number,
  height: number,
): { first: number; last: number } | null {
  const count = layout.tops.length
  if (count === 0) return null
  const bottom = top + Math.max(0, height)
  // first page whose bottom edge lies below `top`
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (layout.tops[mid]! + layout.heights[mid]! <= top) lo = mid + 1
    else hi = mid
  }
  const first = lo
  if (layout.tops[first]! >= bottom && first > 0) return { first: first - 1, last: first - 1 }
  let last = first
  while (last + 1 < count && layout.tops[last + 1]! < bottom) last++
  return { first, last }
}

/**
 * Pages that keep a bitmap: the visible ones and one neighbour on each side.
 * Decided by the visible range only — there is no page-count cap — so every
 * other page releases its canvas.
 */
export function renderWindow(
  range: { first: number; last: number } | null,
  count: number,
): { first: number; last: number } | null {
  if (!range || count === 0) return null
  return { first: Math.max(0, range.first - 1), last: Math.min(count - 1, range.last + 1) }
}

export function inWindow(win: { first: number; last: number } | null, index: number): boolean {
  return win !== null && index >= win.first && index <= win.last
}

/** The page shown at the top third of the viewport (the "current page" of the indicator). */
export function currentPageAt(layout: PdfPageLayout, top: number, height: number): number {
  const range = visiblePageRange(layout, top + height / 3, 1)
  return range ? range.first : 0
}

/** Scale at which the widest page fills the viewport width (PC "fit width"). */
export function fitWidthScale(sizes: readonly PdfPageSize[], viewportWidth: number): number {
  if (sizes.length === 0 || viewportWidth <= 0) return 1
  const maxW = Math.max(...sizes.map((s) => s.width))
  return clampScale((viewportWidth - PDF_SIDE_PAD * 2) / maxW)
}
