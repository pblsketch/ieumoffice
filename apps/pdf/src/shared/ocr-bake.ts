/**
 * Pure OCR text-layer baking shared between the PDF editor renderer and the
 * batch OCR job process. Zero DOM or React dependencies.
 *
 * The persistence half of auto-OCR: the recognized words already carry their
 * PDF user-space boxes, so baking is grouping them into visual lines, splitting
 * wide gaps (table cells / columns) into separate runs, and emitting one
 * invisible (render mode 3) text insert per run — present, selectable and
 * searchable in every reader but never painted, surviving every save.
 */
import type { TextInsertInput } from './ipc'
import { geomDispSize, pdfToView, viewToPdf, type PageGeom } from './page-geom'

export interface OcrWordLike {
  text: string
  /** PDF user space [x1,y1,x2,y2] */
  rect: [number, number, number, number]
  /** Render a space after this word so copy keeps real word gaps */
  spaceAfter: boolean
}

export interface NormalizedOcrLine {
  text: string
  /** normalized bottom-left box [0..1] in display orientation */
  box: { x0: number; y0: number; x1: number; y1: number }
  confidence?: number
}

/** Text-insert colours are 0-255 RGB (the insert also rides with render mode 3). */
const BAKE_COLOR: [number, number, number] = [255, 255, 255]
const MIN_OCR_CONFIDENCE = 0.3

/** a line groups words whose vertical centers sit within half a line height */
export function groupLines<T extends OcrWordLike>(words: T[]): T[][] {
  const sorted = [...words].sort((a, b) => {
    const ca = (a.rect[1] + a.rect[3]) / 2
    const cb = (b.rect[1] + b.rect[3]) / 2
    if (Math.abs(ca - cb) > Math.min(a.rect[3] - a.rect[1], b.rect[3] - b.rect[1]) / 2) {
      return cb - ca
    }
    return a.rect[0] - b.rect[0]
  })
  const lines: T[][] = []
  for (const word of sorted) {
    const line = lines[lines.length - 1]
    if (line && sameLine(line, word)) line.push(word)
    else lines.push([word])
  }
  return lines
}

function sameLine(line: OcrWordLike[], word: OcrWordLike): boolean {
  const last = line[line.length - 1]!
  const lh = Math.min(last.rect[3] - last.rect[1], word.rect[3] - word.rect[1])
  const ca = (last.rect[1] + last.rect[3]) / 2
  const cb = (word.rect[1] + word.rect[3]) / 2
  return Math.abs(ca - cb) <= lh / 2
}

/** a user-space rect's axis-aligned box in display coordinates (y down) */
function displayBox(
  geom: PageGeom,
  rect: readonly [number, number, number, number],
): { x0: number; y0: number; x1: number; y1: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
  ] as const) {
    const [vx, vy] = pdfToView(geom, x, y)
    xs.push(vx)
    ys.push(vy)
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

interface DispWord {
  word: OcrWordLike
  box: { x0: number; y0: number; x1: number; y1: number }
}

function dispSameLine(line: DispWord[], word: DispWord): boolean {
  const last = line[line.length - 1]!
  const lh = Math.min(last.box.y1 - last.box.y0, word.box.y1 - word.box.y0)
  const ca = (last.box.y0 + last.box.y1) / 2
  const cb = (word.box.y0 + word.box.y1) / 2
  return Math.abs(ca - cb) <= lh / 2
}

/** the display-space twin of groupLines: same rule, y grows downward there */
function groupDisplayLines(words: DispWord[]): DispWord[][] {
  const sorted = [...words].sort((a, b) => {
    const ca = (a.box.y0 + a.box.y1) / 2
    const cb = (b.box.y0 + b.box.y1) / 2
    if (Math.abs(ca - cb) > Math.min(a.box.y1 - a.box.y0, b.box.y1 - b.box.y0) / 2) {
      return ca - cb
    }
    return a.box.x0 - b.box.x0
  })
  const lines: DispWord[][] = []
  for (const word of sorted) {
    const line = lines[lines.length - 1]
    if (line && dispSameLine(line, word)) line.push(word)
    else lines.push([word])
  }
  return lines
}

/** Split a display line at gaps wider than this many line heights: table cells and
    columns become runs of their own, each starting where its words start */
const RUN_GAP_EM = 1.5

function splitRuns(line: DispWord[]): DispWord[][] {
  const height = Math.max(...line.map((w) => w.box.y1 - w.box.y0))
  const runs: DispWord[][] = []
  for (const w of line) {
    const run = runs[runs.length - 1]
    const prev = run?.[run.length - 1]
    if (run && prev && w.box.x0 - prev.box.x1 <= height * RUN_GAP_EM) run.push(w)
    else runs.push([w])
  }
  return runs
}

/** Convert normalized bottom-left OS OCR lines to PDF user-space word boxes */
export function ocrLinesToWords(
  lines: readonly NormalizedOcrLine[],
  geom: PageGeom,
): OcrWordLike[] {
  const disp = geomDispSize(geom)
  const out: OcrWordLike[] = []
  for (const line of lines) {
    if (line.confidence !== undefined && line.confidence < MIN_OCR_CONFIDENCE) continue
    const text = line.text.trim()
    if (!text) continue
    const left = line.box.x0 * disp.width
    const top = (1 - line.box.y1) * disp.height
    const right = line.box.x1 * disp.width
    const bottom = (1 - line.box.y0) * disp.height
    if (right <= left || bottom <= top) continue
    const [ax, ay] = viewToPdf(geom, left, top)
    const [bx, by] = viewToPdf(geom, right, bottom)
    out.push({
      text,
      rect: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
      spaceAfter: false,
    })
  }
  return out
}

/** One invisible insert per run of a line (a line split at its wide gaps): origin at
    the run's left baseline, size from its box height. A whole line as one run would
    squeeze a form row into its left cell, leaving nothing under the right cell. */
export function buildOcrBakeInserts(
  origIdx: number,
  words: OcrWordLike[],
  geom: PageGeom,
): TextInsertInput[] {
  const rotate = ((geom.rot % 360) + 360) % 360
  const disp = words.map((word) => ({ word, box: displayBox(geom, word.rect) }))
  return groupDisplayLines(disp)
    .flatMap(splitRuns)
    .map((line) => {
      const left = Math.min(...line.map((w) => w.box.x0))
      const right = Math.max(...line.map((w) => w.box.x1))
      const bottom = Math.max(...line.map((w) => w.box.y1))
      const height = Math.max(...line.map((w) => w.box.y1 - w.box.y0))
      let text = ''
      line.forEach(({ word }, i) => {
        if (i > 0 && line[i - 1]!.word.spaceAfter) text += ' '
        text += word.text
      })
      const [ux, uy] = viewToPdf(geom, left, bottom - height * 0.22)
      return {
        pageIndex: origIdx,
        origin: [ux, uy],
        text,
        fontSize: Math.max(4, Math.min(height * 0.82, 72)),
        color: BAKE_COLOR,
        lineLeading: height * 1.1,
        // stretched to the recognized box: selections and search hits sit on the ink
        fitWidth: right - left,
        rotate,
        invisible: true,
      }
    })
}
