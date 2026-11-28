import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ImageEditInput, TextEditInput, TextInsertInput } from '../shared/ipc'
import { pdfRectToCss, type PageGeom } from './annotations'
import type { LocalImageEdit } from './ImageEditLayer'
import { hexTo255 } from './color-presets'
import { colorsToRuns } from './color-runs'
import { keyRunsToStyleRuns, type TextDraft } from './text-edit-preview'

/**
 * Editing text on a scanned page. The words there come from the picture (the
 * app's own OCR, or an invisible OCR layer a scanner or an earlier save wrote),
 * so there is no visible text object for the engine to rewrite or move. Such
 * an edit is carried out on the picture instead:
 *
 * - a text change covers the old words with a paper-colored patch and places
 *   the new text as an inserted text object on top of it;
 * - a block move copies the block's pixels to the new spot and covers the old
 *   spot with a patch.
 *
 * Both are ordinary pending image inserts and text inserts, so undo, save, the
 * image tools and the thumbnails treat them like any other insert. Patches and
 * moved copies are placed `overPicture`: right above the scan's picture and so
 * under any text, the new text included. The patch keeps the form's ruled lines
 * and the moved copy is the ink alone (splitScanInk).
 */

type Rect = [number, number, number, number]

/** A scan's own OCR run in the file (an invisible text layer the engine matched):
    the probe's rect and text, deleted along with an edit of its words */
export interface ScanRun {
  rect: Rect
  oldText: string
  fontSize: number
}

/** Grow a rect so the patch also hides ink that pokes past the recognized box */
export function scanCoverRect(rect: readonly [number, number, number, number]): Rect {
  const h = rect[3] - rect[1]
  const pad = Math.max(1.5, h * 0.15)
  return [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad]
}

const center = (r: readonly number[]): [number, number] => [
  (r[0]! + r[2]!) / 2,
  (r[1]! + r[3]!) / 2,
]

const inside = (p: readonly [number, number], r: readonly number[]): boolean =>
  p[0] >= r[0]! && p[0] <= r[2]! && p[1] >= r[1]! && p[1] <= r[3]!

/** Is the center of `rect` under one of the patches? */
export const coveredByScanPatch = (
  rect: readonly number[],
  covers: readonly (readonly number[])[],
): boolean => {
  if (covers.length === 0) return false
  const c = center(rect)
  return covers.some((r) => inside(c, r))
}

/** Pending scan patches per page (original page index → covered rects) */
export function scanPatchRects(edits: readonly LocalImageEdit[]): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>()
  for (const e of edits) {
    if (!e.scanPatch || e.input.kind !== 'insertImage') continue
    const list = out.get(e.input.pageIndex) ?? []
    list.push(e.input.rect)
    out.set(e.input.pageIndex, list)
  }
  return out
}

/** Baseline of a line box's text: a fifth of the box above its bottom, where descenders end */
const lineBaseline = (rect: readonly number[]): number => rect[1]! + (rect[3]! - rect[1]!) * 0.2

/**
 * The text insert that carries a scan draft's new text. The words keep the
 * reader's own line breaks: the recognized box only fits the old handwriting,
 * so re-wrapping to it would break a short entry ("3" → "3시간") into pieces.
 * Null when nothing changed, or when nothing is left to write (a cleared box:
 * the patch alone erases the words).
 */
export function scanInsertFromDraft(
  d: Pick<
    TextDraft,
    | 'origIdx'
    | 'rect'
    | 'oldText'
    | 'value'
    | 'fontSize'
    | 'size'
    | 'color'
    | 'font'
    | 'bold'
    | 'italic'
    | 'block'
    | 'charStyles'
  >,
  rotate: number,
): TextInsertInput | null {
  const text = d.value.replace(/\s+$/, '')
  if (!text.trim()) return null
  const size = d.size ?? d.fontSize
  // the editor's selection styles (a word recolored, one number in bold)
  const runs = d.charStyles ? colorsToRuns(d.charStyles.slice(0, text.length)) : []
  return {
    pageIndex: d.origIdx,
    origin: d.block ? [d.block.leftPt, d.block.firstBaseline] : [d.rect[0], lineBaseline(d.rect)],
    text,
    fontSize: size,
    color: d.color ? hexTo255(d.color) : [0, 0, 0],
    ...(d.font ? { font: d.font } : {}),
    ...(d.bold ? { bold: true } : {}),
    ...(d.italic ? { italic: true } : {}),
    ...(d.block ? { lineLeading: d.block.lineHeight * (size / d.fontSize) } : {}),
    ...(runs.length > 0 ? { styleRuns: keyRunsToStyleRuns(runs) } : {}),
    rotate,
  }
}

/** A draft that would change nothing: same words, no style picked */
export const scanDraftUntouched = (
  d: Pick<
    TextDraft,
    'oldText' | 'value' | 'size' | 'color' | 'font' | 'bold' | 'italic' | 'charStyles'
  >,
): boolean =>
  d.value === d.oldText &&
  d.size === undefined &&
  d.color === undefined &&
  d.font === undefined &&
  !d.bold &&
  !d.italic &&
  !d.charStyles?.some((k) => k)

/** The insert for a text edit committed before the engine reported its run invisible */
export function scanInsertFromEdit(input: TextEditInput, rotate: number): TextInsertInput | null {
  if (!input.newText.trim()) return null
  const size = input.newFontSize ?? input.fontSize
  return {
    pageIndex: input.pageIndex,
    origin: input.origin ?? [input.rect[0], lineBaseline(input.rect)],
    text: input.newText,
    fontSize: size,
    color: input.newColor ?? [0, 0, 0],
    ...(input.newFont ? { font: input.newFont } : {}),
    ...(input.newBold ? { bold: true } : {}),
    ...(input.newItalic ? { italic: true } : {}),
    ...(input.lineLeading !== undefined ? { lineLeading: input.lineLeading } : {}),
    ...(input.lineXOffsets ? { lineXOffsets: input.lineXOffsets } : {}),
    ...(input.align ? { align: input.align } : {}),
    rotate,
  }
}

/** '#rrggbb' → 0-255 RGB; anything else is white paper */
export function paperRgb(hex: string | undefined): [number, number, number] {
  const m = hex ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [255, 255, 255]
}

/** A small solid PNG (base64, no data: prefix); the saved image is stretched to its rect */
export function solidPng(rgb: readonly [number, number, number]): string {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  ctx.fillRect(0, 0, 4, 4)
  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

/** An image insert laid right over the scan's picture under `rect` (and under any
    text): the paper patch, or a moved copy. `image` defaults to plain paper until
    the rule-keeping patch is rendered. */
export function scanPatchInput(
  pageIndex: number,
  rect: Rect,
  paper: string | undefined,
  rotate: number,
  image: string = solidPng(paperRgb(paper)),
): Extract<ImageEditInput, { kind: 'insertImage' }> {
  return {
    kind: 'insertImage',
    pageIndex,
    image,
    rect,
    layer: 'belowText',
    rotate,
    overPicture: true,
  }
}

/** The two pictures a scan edit is made of, split from the page's pixels under a
    rect. `patch` erases the words but keeps the form's ruled lines; `cutout` is
    the words' ink alone on transparency, so a moved copy neither drags a piece of
    a table line along nor paints a paper box over its new spot. RGBA, row-major. */
export interface ScanInk {
  patch: Uint8ClampedArray<ArrayBuffer>
  cutout: Uint8ClampedArray<ArrayBuffer>
}

/** Darker or more colored than the paper by this much counts as ink */
const INK_DIFF = 64
/** A row (column) at least this much ink, touching both ends, is a ruled line */
const RULE_FILL = 0.85

export function splitScanInk(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  paper: readonly [number, number, number],
): ScanInk {
  const diff = (i: number) =>
    Math.max(
      Math.abs(data[i]! - paper[0]),
      Math.abs(data[i + 1]! - paper[1]),
      Math.abs(data[i + 2]! - paper[2]),
    )
  const ink = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) ink[p] = diff(p * 4) > INK_DIFF ? 1 : 0
  // A form's rules cross the whole patch; handwriting never does, because the
  // patch is the ink box plus a margin of paper on every side
  const ruleRow = new Uint8Array(h)
  for (let y = 0; y < h; y++) {
    let n = 0
    for (let x = 0; x < w; x++) n += ink[y * w + x]!
    if (ink[y * w]! && ink[y * w + w - 1]! && n >= w * RULE_FILL) ruleRow[y] = 1
  }
  const ruleCol = new Uint8Array(w)
  for (let x = 0; x < w; x++) {
    let n = 0
    for (let y = 0; y < h; y++) n += ink[y * w + x]!
    if (ink[x]! && ink[(h - 1) * w + x]! && n >= h * RULE_FILL) ruleCol[x] = 1
  }
  const patch = new Uint8ClampedArray(w * h * 4)
  const cutout = new Uint8ClampedArray(w * h * 4)
  const nearRuleRow = (y: number) => !!(ruleRow[y] || ruleRow[y - 1] || ruleRow[y + 1])
  const nearRuleCol = (x: number) => !!(ruleCol[x] || ruleCol[x - 1] || ruleCol[x + 1])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      // the rule itself, and the faint antialiased edge beside it — dropping that
      // edge would leave the line visibly thinner across the patch
      const rule = ink[p]
        ? !!(ruleRow[y] || ruleCol[x])
        : (nearRuleRow(y) || nearRuleCol(x)) && diff(i) > INK_DIFF / 4
      if (rule) {
        patch[i] = data[i]!
        patch[i + 1] = data[i + 1]!
        patch[i + 2] = data[i + 2]!
      } else {
        patch[i] = paper[0]
        patch[i + 1] = paper[1]
        patch[i + 2] = paper[2]
      }
      patch[i + 3] = 255
      if (rule) continue // the cutout stays transparent there
      // Ink over the paper, un-blended: alpha from how far the pixel is from the
      // paper, color pulled back to the stroke's own so the edges stay smooth
      const d = diff(i)
      if (d < INK_DIFF / 3) continue
      const a = Math.min(1, d / 160)
      for (let c = 0; c < 3; c++) {
        cutout[i + c] = paper[c]! + (data[i + c]! - paper[c]!) / a
      }
      cutout[i + 3] = Math.round(a * 255)
    }
  }
  return { patch, cutout }
}

/**
 * The page's pixels inside `rect`, upright as the reader sees them (display
 * orientation, like the OCR render) at about 200 dpi, split into a patch and a
 * cutout (splitScanInk). PNGs as base64 without the data: prefix.
 */
export async function renderScanPieces(
  doc: PDFDocumentProxy,
  origIdx: number,
  geom: PageGeom,
  rect: Rect,
  paper: string | undefined,
): Promise<{ patch: string; cutout: string } | null> {
  const scale = 200 / 72
  try {
    const page = await doc.getPage(origIdx + 1)
    const viewport = page.getViewport({ scale, rotation: ((geom.rot % 360) + 360) % 360 })
    const box = pdfRectToCss(geom, rect, scale)
    const sx = Math.max(0, Math.floor(box.left))
    const sy = Math.max(0, Math.floor(box.top))
    const sw = Math.min(Math.ceil(box.width), Math.floor(viewport.width) - sx)
    const sh = Math.min(Math.ceil(box.height), Math.floor(viewport.height) - sy)
    if (sw <= 0 || sh <= 0) return null
    const full = document.createElement('canvas')
    full.width = Math.floor(viewport.width)
    full.height = Math.floor(viewport.height)
    await page.render({ canvas: full, viewport }).promise
    const crop = document.createElement('canvas')
    crop.width = sw
    crop.height = sh
    const ctx = crop.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh)
    // release the page-sized bitmap now rather than at the next GC
    full.width = 0
    full.height = 0
    const { patch, cutout } = splitScanInk(
      ctx.getImageData(0, 0, sw, sh).data,
      sw,
      sh,
      paperRgb(paper),
    )
    const png = (pixels: Uint8ClampedArray<ArrayBuffer>) => {
      ctx.clearRect(0, 0, sw, sh)
      ctx.putImageData(new ImageData(pixels, sw, sh), 0, 0)
      return crop.toDataURL('image/png').split(',')[1] ?? ''
    }
    const out = { patch: png(patch), cutout: png(cutout) }
    return out.patch && out.cutout ? out : null
  } catch {
    return null
  }
}

/** Box in some pixel grid (x/y = top-left, y down) */
export interface PxBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Grow `start` while one of its edges still touches ink, inside `limit`.
 * The recognized (or, after a save, the font-metric) box of handwriting is
 * rarely as large as the strokes themselves: a patch over just that box leaves
 * a tail of the old word behind, and a moved copy loses it. Growing stops at
 * the first ink-free row or column, so neighbouring words stay out; a ruled
 * line the word touches runs to `limit` and no further.
 */
export function growInkBox(
  isInk: (x: number, y: number) => boolean,
  start: PxBox,
  limit: PxBox,
): PxBox {
  const b = { ...start }
  const colHasInk = (x: number) => {
    for (let y = b.y0; y < b.y1; y++) if (isInk(x, y)) return true
    return false
  }
  const rowHasInk = (y: number) => {
    for (let x = b.x0; x < b.x1; x++) if (isInk(x, y)) return true
    return false
  }
  let changed = true
  while (changed) {
    changed = false
    while (b.x0 > limit.x0 && colHasInk(b.x0 - 1)) {
      b.x0--
      changed = true
    }
    while (b.x1 < limit.x1 && colHasInk(b.x1)) {
      b.x1++
      changed = true
    }
    while (b.y0 > limit.y0 && rowHasInk(b.y0 - 1)) {
      b.y0--
      changed = true
    }
    while (b.y1 < limit.y1 && rowHasInk(b.y1)) {
      b.y1++
      changed = true
    }
  }
  return b
}

/**
 * `box` (page CSS px at the current zoom) grown to the ink drawn around it on
 * the page's rendered canvas: up to a line height sideways and a third of one
 * up and down. Ink is anything clearly darker or more colored than `paper`.
 * Returns the box unchanged when the canvas cannot be read.
 */
export function growToRenderedInk(
  pageEl: Element | null,
  box: { left: number; top: number; width: number; height: number },
  paper: string | undefined,
): { left: number; top: number; width: number; height: number } {
  const canvas = pageEl?.querySelector('canvas')
  if (!canvas || canvas.width === 0 || canvas.clientWidth === 0) return box
  const k = canvas.width / canvas.clientWidth
  const h = box.height * k
  const start: PxBox = {
    x0: Math.max(0, Math.floor(box.left * k)),
    y0: Math.max(0, Math.floor(box.top * k)),
    x1: Math.min(canvas.width, Math.ceil((box.left + box.width) * k)),
    y1: Math.min(canvas.height, Math.ceil((box.top + box.height) * k)),
  }
  const limit: PxBox = {
    x0: Math.max(0, Math.floor(start.x0 - h)),
    y0: Math.max(0, Math.floor(start.y0 - h / 3)),
    x1: Math.min(canvas.width, Math.ceil(start.x1 + h)),
    y1: Math.min(canvas.height, Math.ceil(start.y1 + h / 3)),
  }
  if (limit.x1 <= limit.x0 || limit.y1 <= limit.y0) return box
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return box
    const w = limit.x1 - limit.x0
    const img = ctx.getImageData(limit.x0, limit.y0, w, limit.y1 - limit.y0)
    const [pr, pg, pb] = paperRgb(paper)
    const isInk = (x: number, y: number) => {
      const i = ((y - limit.y0) * w + (x - limit.x0)) * 4
      const d = Math.max(
        Math.abs(img.data[i]! - pr),
        Math.abs(img.data[i + 1]! - pg),
        Math.abs(img.data[i + 2]! - pb),
      )
      return d > 64
    }
    const g = growInkBox(isInk, start, limit)
    return {
      left: g.x0 / k,
      top: g.y0 / k,
      width: (g.x1 - g.x0) / k,
      height: (g.y1 - g.y0) / k,
    }
  } catch {
    return box
  }
}
