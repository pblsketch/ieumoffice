// Touch text selection over a page without the DOM selection: the page's text runs
// from PDF.js `getTextContent` in PDF user space, a drag from one point to another
// picks the characters between them in content order, and the picked characters
// become markup quads in the PC shape [x1,yMax,x2,yMax,x1,yMin,x2,yMin]
// (apps/pdf/src/renderer/annotations.ts `selectionQuadsByPage`).
//
// Characters are split evenly over a run's advance width (PDF.js gives no glyph
// positions); a run's box follows the PDF.js text layer (ascent from the font
// style, else 0.8 of the font height), the box the PC selection rects come from.

/** One PDF.js text item as this module reads it. */
export interface PdfTextItemLike {
  readonly str: string
  readonly transform: readonly number[]
  readonly width: number
  readonly height: number
  readonly fontName?: string
}

export interface PdfTextStyleLike {
  readonly ascent?: number
  readonly descent?: number
  readonly vertical?: boolean
}

export interface TextRun {
  readonly str: string
  /** Baseline origin in PDF user space. */
  readonly x: number
  readonly y: number
  /** Unit direction of the baseline. */
  readonly cos: number
  readonly sin: number
  /** Advance width along the baseline. */
  readonly width: number
  /** Font height; the box spans [ascent - height, ascent] across the baseline. */
  readonly height: number
  readonly ascent: number
}

/** A caret between characters: run index and character boundary (0..str.length). */
export interface TextCaret {
  readonly run: number
  readonly offset: number
}

/** PDF.js text content → runs that can be picked (empty and zero-size items dropped). */
export function textRunsOf(
  items: readonly unknown[],
  styles: Readonly<Record<string, PdfTextStyleLike | undefined>> = {},
): TextRun[] {
  const runs: TextRun[] = []
  for (const raw of items) {
    const item = raw as Partial<PdfTextItemLike>
    if (typeof item.str !== 'string' || item.str.length === 0) continue
    const t = item.transform
    if (!Array.isArray(t) || t.length < 6 || t.some((n) => !Number.isFinite(n))) continue
    const [a, b, c, d, e, f] = t as number[]
    const style = item.fontName ? styles[item.fontName] : undefined
    if (style?.vertical) continue
    const len = Math.hypot(a!, b!)
    const height = Math.hypot(c!, d!) || item.height || 0
    const width = item.width ?? 0
    if (!(len > 0) || !(height > 0) || !(width > 0)) continue
    const ascentRatio = style?.ascent ? style.ascent : style?.descent ? 1 + style.descent : 0.8
    runs.push({
      str: item.str,
      x: e!,
      y: f!,
      cos: a! / len,
      sin: b! / len,
      width,
      height,
      ascent: ascentRatio * height,
    })
  }
  return runs
}

/** A point in run coordinates: u along the baseline, v across it (up). */
function local(run: TextRun, x: number, y: number): [number, number] {
  const dx = x - run.x
  const dy = y - run.y
  return [dx * run.cos + dy * run.sin, -dx * run.sin + dy * run.cos]
}

function point(run: TextRun, u: number, v: number): [number, number] {
  return [run.x + u * run.cos - v * run.sin, run.y + u * run.sin + v * run.cos]
}

/** Distance from a PDF point to a run's box (0 inside). */
export function runDistance(run: TextRun, x: number, y: number): number {
  const [u, v] = local(run, x, y)
  const du = Math.max(0, -u, u - run.width)
  const bottom = run.ascent - run.height
  const dv = Math.max(0, bottom - v, v - run.ascent)
  return Math.hypot(du, dv)
}

/**
 * The caret nearest a PDF point: the closest run, then the character boundary under
 * the point. Null when no run lies within `maxDistance` (PDF units).
 */
export function caretAt(
  runs: readonly TextRun[],
  x: number,
  y: number,
  maxDistance = Infinity,
): TextCaret | null {
  let best = -1
  let bestDistance = Infinity
  runs.forEach((run, i) => {
    const distance = runDistance(run, x, y)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  if (best < 0 || bestDistance > maxDistance) return null
  const run = runs[best]!
  const [u] = local(run, x, y)
  const n = run.str.length
  const offset = Math.round((Math.min(Math.max(u, 0), run.width) / run.width) * n)
  return { run: best, offset: Math.min(Math.max(offset, 0), n) }
}

const before = (a: TextCaret, b: TextCaret): boolean =>
  a.run < b.run || (a.run === b.run && a.offset <= b.offset)

const isAxisAligned = (run: TextRun): boolean => Math.abs(run.sin) < 1e-3 && run.cos > 0

interface Box {
  x1: number
  x2: number
  yMin: number
  yMax: number
}

/** Join the boxes of one visual line that touch or nearly touch (PC normalizeSelectionRects). */
function mergeLineBoxes(boxes: readonly Box[]): Box[] {
  interface Line {
    lo: number
    hi: number
    minSize: number
    boxes: Box[]
  }
  const lines: Line[] = []
  for (const box of boxes) {
    const size = box.yMax - box.yMin
    let match: Line | null = null
    let bestOverlap = -1
    for (const line of lines) {
      const overlap = Math.min(box.yMax, line.hi) - Math.max(box.yMin, line.lo)
      if (overlap * 2 < Math.min(size, line.minSize)) continue
      if (overlap > bestOverlap) {
        match = line
        bestOverlap = overlap
      }
    }
    if (match) {
      match.lo = Math.max(match.lo, box.yMin)
      match.hi = Math.min(match.hi, box.yMax)
      match.minSize = Math.min(match.minSize, size)
      match.boxes.push(box)
    } else lines.push({ lo: box.yMin, hi: box.yMax, minSize: size, boxes: [box] })
  }
  return lines.flatMap((line) => {
    const out: Box[] = []
    for (const box of [...line.boxes].sort((p, q) => p.x1 - q.x1)) {
      const last = out[out.length - 1]
      if (last && box.x1 - last.x2 <= line.minSize / 2) {
        out[out.length - 1] = {
          x1: Math.min(last.x1, box.x1),
          x2: Math.max(last.x2, box.x2),
          yMin: Math.min(last.yMin, box.yMin),
          yMax: Math.max(last.yMax, box.yMax),
        }
      } else out.push({ ...box })
    }
    return out
  })
}

/**
 * The quads of the characters between two carets (either order), in PDF user space.
 * Whitespace-only pieces add nothing; horizontal pieces on one line are joined.
 */
export function selectionQuads(
  runs: readonly TextRun[],
  anchor: TextCaret,
  focus: TextCaret,
): number[][] {
  const [from, to] = before(anchor, focus) ? [anchor, focus] : [focus, anchor]
  const boxes: Box[] = []
  const rotated: number[][] = []
  for (let i = from.run; i <= to.run; i++) {
    const run = runs[i]
    if (!run) continue
    const n = run.str.length
    const start = i === from.run ? from.offset : 0
    const end = i === to.run ? to.offset : n
    if (end <= start) continue
    if (!run.str.slice(start, end).trim()) continue
    const u0 = (run.width * start) / n
    const u1 = (run.width * end) / n
    const top = run.ascent
    const bottom = run.ascent - run.height
    if (isAxisAligned(run)) {
      boxes.push({ x1: run.x + u0, x2: run.x + u1, yMin: run.y + bottom, yMax: run.y + top })
    } else {
      rotated.push([
        ...point(run, u0, top),
        ...point(run, u1, top),
        ...point(run, u0, bottom),
        ...point(run, u1, bottom),
      ])
    }
  }
  return [
    ...mergeLineBoxes(boxes).map((b) => [b.x1, b.yMax, b.x2, b.yMax, b.x1, b.yMin, b.x2, b.yMin]),
    ...rotated,
  ]
}

/** The text between two carets (spaces kept as PDF.js gives them). */
export function selectionText(
  runs: readonly TextRun[],
  anchor: TextCaret,
  focus: TextCaret,
): string {
  const [from, to] = before(anchor, focus) ? [anchor, focus] : [focus, anchor]
  let text = ''
  for (let i = from.run; i <= to.run; i++) {
    const run = runs[i]
    if (!run) continue
    const start = i === from.run ? from.offset : 0
    const end = i === to.run ? to.offset : run.str.length
    text += run.str.slice(start, end)
  }
  return text
}
