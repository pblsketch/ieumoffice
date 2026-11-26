// What a drag on the drawing layer produces, and what the eraser hits.
//
// The stroke builder follows PC `DrawLayer.tsx` pointer handling exactly, so a drawing
// made on the phone is the same `DrawingInput` the PC would record for the same
// pointer path: ink keeps every point as [x1,y1,x2,y2,…] in PDF space, rect/ellipse
// are normalized boxes, line/arrow carry from/to (and the PC's empty label), and the
// PC rules drop a click-and-release (ink under 3 points, boxes under 3 units, lines
// under 4 units).
import { pdfToView } from '../../../../../../../pdf/src/renderer/annotations'
import type { PageGeom } from '../../../../../../../pdf/src/renderer/annotations'
import type { LocalDrawing } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { DrawingInput } from '../../../../../../../pdf/src/shared/ipc'

export type Rgb = [number, number, number]
type Point = [number, number]

/** The shapes the [Pen] sheet draws (PC `DrawTool` names). */
export type DrawShapeTool = 'ink' | 'rect' | 'ellipse' | 'line' | 'arrow'

/** A tool of the [Pen] sheet: a shape or the eraser. */
export type DrawToolChoice = DrawShapeTool | 'eraser'

export const DRAW_TOOL_CHOICES: readonly DrawToolChoice[] = [
  'ink',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'eraser',
]

/** Stroke widths offered in the sheet (PDF points); 2 is the PC `STROKE_WIDTH`. */
export const DRAW_WIDTHS: readonly number[] = [1, 2, 4, 6]

/** Pending drawings this layer shows and the eraser removes: strokes and shapes. */
const STROKE_KINDS = new Set<DrawingInput['kind']>([
  'ink',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'polygon',
  'measure',
  'caret',
])

export const isStrokeDrawing = (d: LocalDrawing): boolean => STROKE_KINDS.has(d.input.kind)

export interface StrokeStyle {
  readonly color: Rgb
  readonly width: number
}

export interface StrokeBuilder {
  /** Next pointer position, PDF user space. */
  move(at: Point): void
  /** The shape as drawn so far (null until it has a size). */
  live(): DrawingInput | null
  /** The finished shape, or null when the PC would drop it as a mere click. */
  finish(): DrawingInput | null
}

/** Starts a stroke at `at` (PDF user space); `pageIndex` is 0 like the PC layer's. */
export function startStroke(tool: DrawShapeTool, at: Point, style: StrokeStyle): StrokeBuilder {
  const { color, width } = style
  const start = at
  let ink: number[] = [at[0], at[1]]
  let live: DrawingInput | null =
    tool === 'ink' ? { kind: 'ink', pageIndex: 0, color, width, paths: [ink] } : null

  return {
    move(next) {
      if (tool === 'ink') {
        ink = [...ink, next[0], next[1]]
        live = { kind: 'ink', pageIndex: 0, color, width, paths: [ink] }
      } else if (tool === 'rect' || tool === 'ellipse') {
        const [sx, sy] = start
        live = {
          kind: tool,
          pageIndex: 0,
          color,
          width,
          rect: [
            Math.min(sx, next[0]),
            Math.min(sy, next[1]),
            Math.max(sx, next[0]),
            Math.max(sy, next[1]),
          ],
        }
      } else {
        // the PC layer builds line and arrow with the measure tool's empty label
        live = {
          kind: tool,
          pageIndex: 0,
          color,
          width,
          from: start,
          to: next,
          label: '',
        } as DrawingInput
      }
    },
    live: () => live,
    finish() {
      const pending = live
      if (!pending) return null
      if (pending.kind === 'ink' && (pending.paths[0]?.length ?? 0) < 6) return null
      if (pending.kind === 'rect' || pending.kind === 'ellipse') {
        const [x1, y1, x2, y2] = pending.rect
        if (x2 - x1 < 3 && y2 - y1 < 3) return null
      }
      if (pending.kind === 'line' || pending.kind === 'arrow') {
        if (Math.hypot(pending.to[0] - pending.from[0], pending.to[1] - pending.from[1]) < 4)
          return null
      }
      return pending
    },
  }
}

// ── eraser hit test (displayed page pixels) ─────────────────────────────────

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function polylineDistance(p: Point, points: readonly Point[], closed = false): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(p[0] - points[0]![0], p[1] - points[0]![1])
  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, segmentDistance(p, points[i - 1]!, points[i]!))
  }
  if (closed) best = Math.min(best, segmentDistance(p, points.at(-1)!, points[0]!))
  return best
}

const ELLIPSE_STEPS = 48

/** The drawing's outline in displayed page pixels (closed outlines repeat no point). */
function outlines(
  d: DrawingInput,
  geom: PageGeom,
  scale: number,
): { pts: Point[]; closed: boolean }[] {
  const view = (x: number, y: number): Point => {
    const [vx, vy] = pdfToView(geom, x, y)
    return [vx * scale, vy * scale]
  }
  switch (d.kind) {
    case 'ink':
      return d.paths.map((path) => {
        const pts: Point[] = []
        for (let i = 0; i + 1 < path.length; i += 2) pts.push(view(path[i]!, path[i + 1]!))
        return { pts, closed: false }
      })
    case 'rect':
    case 'ellipse': {
      const [ax, ay] = view(d.rect[0], d.rect[1])
      const [bx, by] = view(d.rect[2], d.rect[3])
      const [x1, y1, x2, y2] = [
        Math.min(ax, bx),
        Math.min(ay, by),
        Math.max(ax, bx),
        Math.max(ay, by),
      ]
      if (d.kind === 'rect') {
        return [
          {
            pts: [
              [x1, y1],
              [x2, y1],
              [x2, y2],
              [x1, y2],
            ],
            closed: true,
          },
        ]
      }
      const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2]
      const pts: Point[] = []
      for (let i = 0; i < ELLIPSE_STEPS; i++) {
        const a = (i / ELLIPSE_STEPS) * Math.PI * 2
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
      }
      return [{ pts, closed: true }]
    }
    case 'polygon':
      return [{ pts: d.vertices.map(([x, y]) => view(x, y)), closed: true }]
    case 'line':
    case 'arrow':
    case 'measure':
      return [{ pts: [view(d.from[0], d.from[1]), view(d.to[0], d.to[1])], closed: false }]
    case 'caret':
      return [{ pts: [view(d.point[0], d.point[1])], closed: false }]
    default:
      return []
  }
}

/** Whether a touch at `at` (displayed page px) lies on the drawing's stroke, within `tolerance` px. */
export function drawingHit(
  d: DrawingInput,
  geom: PageGeom,
  scale: number,
  at: Point,
  tolerance: number,
): boolean {
  const half = 'width' in d && typeof d.width === 'number' ? (d.width * scale) / 2 : 0
  return outlines(d, geom, scale).some(
    ({ pts, closed }) => polylineDistance(at, pts, closed) <= tolerance + half,
  )
}

/** Ids of the drawings under the eraser at `at`. */
export function erasedIds(
  drawings: readonly LocalDrawing[],
  geom: PageGeom,
  scale: number,
  at: Point,
  tolerance: number,
): string[] {
  return drawings
    .filter((d) => isStrokeDrawing(d) && drawingHit(d.input, geom, scale, at, tolerance))
    .map((d) => d.id)
}
