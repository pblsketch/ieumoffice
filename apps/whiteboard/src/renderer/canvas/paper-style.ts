/**
 * Refined modern whiteboard visual tokens, Miro/Allo/Claude-inspired typography,
 * straight/curved/elbow connector routing with sleek arrowheads, object-edge snapping,
 * and rich-text mark helpers shared across the live whiteboard stage and SVG export.
 */
import type {
  BoardObject,
  ConnectorEnd,
  ConnectorHead,
  ConnectorRouting,
  LineStyle,
  Point,
  RichText,
  TextAlign,
  TextRun,
} from '@genoffice/whiteboard-engine'

/** Theme-invariant board paper and editorial document colors. */
export const PAPER_COLORS = {
  paper: '#FFFDF8',
  cardBg: '#FFFFFF',
  zoneFill: '#F7F5F0',
  ink: '#1F1D1A',
  inkMuted: '#6E685F',
  inkPlaceholder: 'rgba(31, 29, 26, 0.34)',
  line: '#E4DFD5',
  lineStrong: '#D4CEC3',
  lineDashed: '#BEB7AA',
  stickyBorder: 'rgba(31, 29, 26, 0.09)',
  connectorDefault: '#475569',
  shapeDefaultFill: '#FFFFFF',
  shapeDefaultStroke: '#CBD5E1',
  accent: '#C45234',
  live: '#1E7A72',
  highlighterYellow: '#FFE066',
} as const

/** Clean modern sans-serif stack suitable for both Korean and Latin board text. */
export const BOARD_FONT_STACK =
  "'Pretendard Variable', 'Pretendard', 'Inter', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif"

/** Curated Miro/Allo luminous pastel sticky note colors (all high-contrast with dark ink). */
export const PAPER_FILL_SWATCHES = [
  '#FFF3A1', // sunny butter yellow
  '#FFD1D8', // soft coral rose
  '#FFDAB3', // warm apricot
  '#CCF0D2', // fresh mint
  '#CBE4FF', // sky mist
  '#E3D7FF', // soft lavender
  '#C2EFEA', // seafoam aqua
  '#FFFFFF', // crisp index white
] as const

/** Harmonized fill + border pairings for shapes (Miro & Claude Artifacts diagram style). */
export interface ShapeStylePreset {
  readonly fill: string
  readonly stroke: string
}

export const SHAPE_STYLE_PRESETS: readonly ShapeStylePreset[] = [
  { fill: '#FFFFFF', stroke: '#CBD5E1' }, // clean white card
  { fill: '#F7F5F0', stroke: '#C7C0B3' }, // warm stone
  { fill: '#EEF6FF', stroke: '#60A5FA' }, // sky blue
  { fill: '#ECFDF3', stroke: '#34D399' }, // fresh mint
  { fill: '#FFFBEB', stroke: '#F59E0B' }, // warm amber
  { fill: '#FFF1F2', stroke: '#FB7185' }, // soft coral
  { fill: '#F5F3FF', stroke: '#A78BFA' }, // soft violet
  { fill: 'transparent', stroke: '#94A3B8' }, // wireframe / frame
] as const

/** Optional background pill/card presets for text boxes. */
export const TEXT_BG_PRESETS: readonly { readonly bg: string; readonly border?: string }[] = [
  { bg: 'transparent' },
  { bg: '#FFFFFF', border: '#E4DFD5' },
  { bg: '#F7F5F0', border: '#E4DFD5' },
  { bg: '#FFF3A1' },
  { bg: '#EEF6FF', border: '#BFDBFE' },
  { bg: '#ECFDF3', border: '#A7F3D0' },
] as const

/** Crisp ink colors for text, connectors, borders, and pen strokes. */
export const PAPER_INK_SWATCHES = [
  '#1F1D1A', // deep charcoal
  '#475569', // slate gray (default connector)
  '#2563EB', // cobalt blue
  '#0D9488', // deep teal
  '#16A34A', // emerald green
  '#D97706', // warm amber
  '#E11D48', // rose crimson
  '#7C3AED', // violet
] as const

export const FONT_SIZE_PRESETS = [14, 16, 20, 24, 32, 48] as const
export const LINE_WIDTH_PRESETS = [2, 4, 8] as const
export const HIGHLIGHTER_WIDTH_PRESETS = [16, 22, 32] as const
export const CONNECTOR_WIDTH_PRESETS = [1.5, 2.5, 4] as const

/** Curated translucent highlighter ink colors. */
export const HIGHLIGHTER_SWATCHES = [
  '#FFE066', // sunny yellow
  '#FFAFCC', // soft rose
  '#A7F3D0', // mint green
  '#93C5FD', // sky blue
  '#FDBA74', // warm apricot
  '#DDD6FE', // soft lavender
] as const

export const STICKY_DEFAULT_SIZE = 208
export const STICKY_DEFAULT_FONT_SIZE = 16
export const TEXT_DEFAULT_FONT_SIZE = 20
export const SHAPE_DEFAULT_FONT_SIZE = 15

export interface TypographyMetrics {
  readonly lineHeight: number
  readonly letterSpacing: string
}

/** Editorial line-height and tracking scaled to font size (display vs subhead vs body). */
export function typographyMetrics(fontSize: number): TypographyMetrics {
  if (fontSize >= 36) return { lineHeight: 1.18, letterSpacing: '-0.03em' }
  if (fontSize >= 24) return { lineHeight: 1.28, letterSpacing: '-0.022em' }
  return { lineHeight: 1.46, letterSpacing: '-0.012em' }
}

/**
 * Estimates natural text box dimensions for mixed CJK and Latin text so Korean and English
 * text boxes grow cleanly without premature wrapping or awkward trailing whitespace.
 */
export function estimateTextBoxSize(
  text: string,
  fontSize: number,
  padX = 16,
  padY = 12,
): { width: number; height: number } {
  const { lineHeight } = typographyMetrics(fontSize)
  const lines = (text || ' ').split('\n')
  let maxUnits = 0
  for (const line of lines) {
    let units = 0
    for (const ch of line) {
      const code = ch.codePointAt(0) ?? 0
      // Wide CJK, Hangul, Hiragana, Katakana, fullwidth punctuation
      const isWide =
        (code >= 0x1100 && code <= 0x11ff) ||
        (code >= 0x3000 && code <= 0x9fff) ||
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0xff00 && code <= 0xffef)
      units += isWide ? 1.02 : ch === ' ' ? 0.34 : 0.6
    }
    if (units > maxUnits) maxUnits = units
  }
  const width = Math.max(96, Math.min(960, Math.ceil(maxUnits * fontSize + padX * 2 + 12)))
  const height = Math.max(
    Math.ceil(fontSize * lineHeight + padY * 2),
    Math.ceil(lines.length * fontSize * lineHeight + padY * 2),
  )
  return { width, height }
}

export type RichMark = 'bold' | 'italic' | 'underline' | 'strike'

export interface RichFormatState {
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly color: string | null
}

/** Extracts shared formatting flags across all non-empty runs of a RichText block. */
export function richTextFormatState(rt: RichText | undefined): RichFormatState {
  const runs: TextRun[] = []
  for (const p of rt?.paragraphs ?? []) {
    for (const r of p.runs ?? []) {
      if (r.text) runs.push(r)
    }
  }
  if (runs.length === 0) {
    return { bold: false, italic: false, underline: false, strike: false, color: null }
  }
  const firstColor = runs[0]?.color ?? null
  const sameColor = runs.every((r) => (r.color ?? null) === firstColor) ? firstColor : null
  return {
    bold: runs.every((r) => Boolean(r.bold)),
    italic: runs.every((r) => Boolean(r.italic)),
    underline: runs.every((r) => Boolean(r.underline)),
    strike: runs.every((r) => Boolean(r.strike)),
    color: sameColor,
  }
}

/** Toggles a text mark across every run of a RichText block. */
export function toggleRichTextMark(rt: RichText | undefined, mark: RichMark): RichText {
  const state = richTextFormatState(rt)
  const nextVal = !state[mark]
  const paragraphs = (rt?.paragraphs ?? [{ runs: [{ text: '' }] }]).map((p) => ({
    ...p,
    runs: (p.runs ?? []).map((r) => {
      const next: TextRun = { ...r }
      if (nextVal) next[mark] = true
      else delete next[mark]
      return next
    }),
  }))
  return { paragraphs }
}

/** Sets text ink color across every run of a RichText block. */
export function setRichTextColor(rt: RichText | undefined, color: string): RichText {
  const paragraphs = (rt?.paragraphs ?? [{ runs: [{ text: '' }] }]).map((p) => ({
    ...p,
    runs: (p.runs ?? []).map((r) => ({ ...r, color })),
  }))
  return { paragraphs }
}

/** Builds a RichText block from plain multiline text while preserving the first run's marks. */
export function updateRichTextPreservingStyle(
  existing: RichText | undefined,
  text: string,
  defaultAlign?: TextAlign,
): RichText {
  const sample = existing?.paragraphs?.[0]?.runs?.[0]
  const style: Omit<TextRun, 'text'> = {}
  if (sample?.bold) style.bold = true
  if (sample?.italic) style.italic = true
  if (sample?.underline) style.underline = true
  if (sample?.strike) style.strike = true
  if (sample?.color) style.color = sample.color
  const align = existing?.paragraphs?.[0]?.align ?? defaultAlign
  return {
    paragraphs: text.split('\n').map((line) => ({
      ...(align ? { align } : {}),
      runs: [{ text: line, ...style }],
    })),
  }
}

/** Creates a fresh RichText block from plain multiline text. */
export function plainRichText(
  text: string,
  options: { bold?: boolean; color?: string; align?: TextAlign } = {},
): RichText {
  const style: Omit<TextRun, 'text'> = {}
  if (options.bold) style.bold = true
  if (options.color) style.color = options.color
  return {
    paragraphs: text.split('\n').map((line) => ({
      ...(options.align ? { align: options.align } : {}),
      runs: [{ text: line, ...style }],
    })),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Subtle curved paper-lift shadow silhouette beneath a sticky note's bottom edge (Miro signature). */
export function stickyLiftShadowPath(x: number, y: number, w: number, h: number): string {
  const insetX = Math.min(18, w * 0.08)
  const liftY = Math.min(9, h * 0.045)
  const x0 = x + insetX
  const x1 = x + w - insetX * 0.45
  const yBottom = y + h
  const yTop = yBottom - Math.min(18, h * 0.12)
  return [
    `M${round2(x0)} ${round2(yTop)}`,
    `L${round2(x1)} ${round2(yTop)}`,
    `L${round2(x1)} ${round2(yBottom + liftY)}`,
    `Q${round2(x + w * 0.55)} ${round2(yBottom + liftY * 0.25)} ${round2(x0)} ${round2(yBottom + liftY * 0.45)}`,
    'Z',
  ].join(' ')
}

/** Returns SVG stroke-dasharray and stroke-linecap for solid, dashed, and round-dot dotted lines. */
export function strokeLineAttrs(
  style: LineStyle | undefined,
  strokeWidth: number,
): { dasharray?: string; linecap: 'round' | 'butt' } {
  if (style === 'dashed') {
    const dash = round2(Math.max(6, strokeWidth * 3.2))
    const gap = round2(Math.max(4.5, strokeWidth * 2.4))
    return { dasharray: `${dash} ${gap}`, linecap: 'round' }
  }
  if (style === 'dotted') {
    const gap = round2(Math.max(5.5, strokeWidth * 2.8))
    return { dasharray: `0.01 ${gap}`, linecap: 'round' }
  }
  return { linecap: 'round' }
}

/** Sleek arrowhead length proportional to line stroke width (Miro/Allo/Claude scale). */
export function connectorHeadLength(strokeWidth: number): number {
  return Math.max(9.5, strokeWidth * 3.8 + 2)
}

/** Pulls `point` back along unit direction `dir` (pointing toward `point`). */
function pullBackAlong(point: Point, dir: Point, by: number): Point {
  return {
    x: round2(point.x - dir.x * by),
    y: round2(point.y - dir.y * by),
  }
}

function unitVec(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy)
  if (len < 1e-4) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

/** Sleek Miro-style open chevron arrowhead path with tip at `tip`, pointing along `dir`. */
export function connectorChevronPath(tip: Point, dir: Point, strokeWidth: number): string {
  const length = connectorHeadLength(strokeWidth)
  const angle = Math.atan2(dir.y, dir.x)
  const spread = 0.52 // ~30 deg half-angle for balanced crisp chevron
  const lx = tip.x - Math.cos(angle - spread) * length
  const ly = tip.y - Math.sin(angle - spread) * length
  const rx = tip.x - Math.cos(angle + spread) * length
  const ry = tip.y - Math.sin(angle + spread) * length
  return `M${round2(lx)} ${round2(ly)} L${round2(tip.x)} ${round2(tip.y)} L${round2(rx)} ${round2(ry)}`
}

/** Sleek Claude/diagram stealth notched filled arrowhead with tip at `tip`, pointing along `dir`. */
export function connectorArrowPath(tip: Point, from: Point, strokeWidth: number): string {
  const dir = unitVec(tip.x - from.x, tip.y - from.y)
  return connectorStealthPath(tip, dir, strokeWidth)
}

function connectorStealthPath(tip: Point, dir: Point, strokeWidth: number): string {
  const length = connectorHeadLength(strokeWidth) * 1.12
  const angle = Math.atan2(dir.y, dir.x)
  const half = length * 0.42 // crisp ~23 deg half-angle
  const bx = tip.x - Math.cos(angle) * length
  const by = tip.y - Math.sin(angle) * length
  const nx = tip.x - Math.cos(angle) * (length * 0.78) // subtle concave stealth notch
  const ny = tip.y - Math.sin(angle) * (length * 0.78)
  const px = -Math.sin(angle) * half
  const py = Math.cos(angle) * half
  return [
    `M${round2(tip.x)} ${round2(tip.y)}`,
    `L${round2(bx + px)} ${round2(by + py)}`,
    `L${round2(nx)} ${round2(ny)}`,
    `L${round2(bx - px)} ${round2(by - py)}`,
    'Z',
  ].join(' ')
}

export interface ConnectorHeadShape {
  readonly kind: 'chevron' | 'stealth' | 'circle'
  readonly path?: string
  readonly point?: Point
  readonly radius?: number
}

export interface ConnectorRenderGeometry {
  readonly shaftPath: string
  readonly fullPath: string
  readonly startHead: ConnectorHeadShape | null
  readonly endHead: ConnectorHeadShape | null
  /** Legacy-compatible filled path aliases (present for stealth arrows). */
  readonly startArrowPath: string | null
  readonly endArrowPath: string | null
  readonly startCircle: Point | null
  readonly endCircle: Point | null
  readonly midpoint: Point
}

export interface ResolvedConnectorEnd {
  readonly point: Point
  readonly normal: Point | null
}

function anchorNormal(anchorX: number | undefined, anchorY: number | undefined): Point | null {
  if (anchorX === undefined || anchorY === undefined) return null
  if (anchorY <= 0.05) return { x: 0, y: -1 }
  if (anchorY >= 0.95) return { x: 0, y: 1 }
  if (anchorX <= 0.05) return { x: -1, y: 0 }
  if (anchorX >= 0.95) return { x: 1, y: 0 }
  return null
}

/** Resolves a ConnectorEnd to both board point and outward anchor normal (if anchored to a side). */
export function resolveConnectorEndpoint(
  end: ConnectorEnd,
  byId: ReadonlyMap<string, BoardObject>,
): ResolvedConnectorEnd {
  if ('objectId' in end) {
    const obj = byId.get(end.objectId)
    if (obj) {
      return {
        point: {
          x: obj.x + obj.width * (end.anchorX ?? 0.5),
          y: obj.y + obj.height * (end.anchorY ?? 0.5),
        },
        normal: anchorNormal(end.anchorX, end.anchorY),
      }
    }
    return { point: { x: 0, y: 0 }, normal: null }
  }
  return { point: { x: end.x, y: end.y }, normal: null }
}

/** Resolves a ConnectorEnd (anchored object side or free canvas point) to board coordinates. */
export function resolveConnectorEnd(
  end: ConnectorEnd,
  byId: ReadonlyMap<string, BoardObject>,
): Point {
  return resolveConnectorEndpoint(end, byId).point
}

/** Builds a polyline SVG path with optional smooth quadratic fillets at interior bends. */
function roundedPolylinePath(pts: readonly Point[], radius: number): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${round2(pts[0]!.x)} ${round2(pts[0]!.y)}`
  if (pts.length === 2 || radius <= 0) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round2(p.x)} ${round2(p.y)}`).join(' ')
  }
  const cmds: string[] = [`M${round2(pts[0]!.x)} ${round2(pts[0]!.y)}`]
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1]!
    const curr = pts[i]!
    const next = pts[i + 1]!
    const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const d2 = Math.hypot(next.x - curr.x, next.y - curr.y)
    if (d1 < 1e-2 || d2 < 1e-2) {
      cmds.push(`L${round2(curr.x)} ${round2(curr.y)}`)
      continue
    }
    const r = Math.min(radius, d1 * 0.45, d2 * 0.45)
    const p1 = {
      x: curr.x - ((curr.x - prev.x) / d1) * r,
      y: curr.y - ((curr.y - prev.y) / d1) * r,
    }
    const p2 = {
      x: curr.x + ((next.x - curr.x) / d2) * r,
      y: curr.y + ((next.y - curr.y) / d2) * r,
    }
    cmds.push(`L${round2(p1.x)} ${round2(p1.y)}`)
    cmds.push(`Q${round2(curr.x)} ${round2(curr.y)} ${round2(p2.x)} ${round2(p2.y)}`)
  }
  const last = pts[pts.length - 1]!
  cmds.push(`L${round2(last.x)} ${round2(last.y)}`)
  return cmds.join(' ')
}

/** Removes redundant collinear or near-duplicate points from an orthogonal elbow path. */
function simplifyOrthogonal(raw: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const pt of raw) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.5) continue
    out.push(pt)
  }
  const cleaned: Point[] = []
  for (let i = 0; i < out.length; i += 1) {
    const p = out[i]!
    if (cleaned.length >= 2) {
      const a = cleaned[cleaned.length - 2]!
      const b = cleaned[cleaned.length - 1]!
      const sameX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5
      const sameY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5
      if (sameX || sameY) {
        cleaned[cleaned.length - 1] = p
        continue
      }
    }
    cleaned.push(p)
  }
  return cleaned
}

/** Computes clean orthogonal (elbow) waypoints respecting anchor normals. */
function buildElbowPoints(
  start: Point,
  end: Point,
  startNormal: Point | null,
  endNormal: Point | null,
): Point[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const stub = Math.min(28, Math.max(14, Math.hypot(dx, dy) * 0.22))

  const sN =
    startNormal ??
    (Math.abs(dx) >= Math.abs(dy) ? { x: dx >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dy >= 0 ? 1 : -1 })
  const eN =
    endNormal ??
    (Math.abs(dx) >= Math.abs(dy) ? { x: dx >= 0 ? -1 : 1, y: 0 } : { x: 0, y: dy >= 0 ? -1 : 1 })

  const s1: Point = startNormal ? { x: start.x + sN.x * stub, y: start.y + sN.y * stub } : start
  const e1: Point = endNormal ? { x: end.x + eN.x * stub, y: end.y + eN.y * stub } : end

  const sHoriz = Math.abs(sN.x) > 0.5
  const eHoriz = Math.abs(eN.x) > 0.5

  const pts: Point[] = [start]
  if (startNormal) pts.push(s1)

  if (sHoriz && eHoriz) {
    const forward = (e1.x - s1.x) * sN.x >= 0
    if (forward) {
      const midX = (s1.x + e1.x) / 2
      pts.push({ x: midX, y: s1.y }, { x: midX, y: e1.y })
    } else {
      const midY = (s1.y + e1.y) / 2
      pts.push({ x: s1.x, y: midY }, { x: e1.x, y: midY })
    }
  } else if (!sHoriz && !eHoriz) {
    const forward = (e1.y - s1.y) * sN.y >= 0
    if (forward) {
      const midY = (s1.y + e1.y) / 2
      pts.push({ x: s1.x, y: midY }, { x: e1.x, y: midY })
    } else {
      const midX = (s1.x + e1.x) / 2
      pts.push({ x: midX, y: s1.y }, { x: midX, y: e1.y })
    }
  } else if (sHoriz && !eHoriz) {
    pts.push({ x: e1.x, y: s1.y })
  } else {
    pts.push({ x: s1.x, y: e1.y })
  }

  if (endNormal) pts.push(e1)
  pts.push(end)
  return simplifyOrthogonal(pts)
}

/** Computes midpoint along the total arc length of a polyline. */
function polylineMidpoint(pts: readonly Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1) return pts[0]!
  let total = 0
  const segs: number[] = []
  for (let i = 1; i < pts.length; i += 1) {
    const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
    segs.push(d)
    total += d
  }
  const half = total / 2
  let acc = 0
  for (let i = 0; i < segs.length; i += 1) {
    const d = segs[i]!
    if (acc + d >= half && d > 1e-4) {
      const t = (half - acc) / d
      return {
        x: round2(pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t),
        y: round2(pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t),
      }
    }
    acc += d
  }
  return pts[Math.floor(pts.length / 2)]!
}

/** Computes cubic Bezier control points respecting anchor normals (Miro/Allo smooth S-curve). */
function cubicControlPoints(
  start: Point,
  end: Point,
  startNormal: Point | null,
  endNormal: Point | null,
): { c1: Point; c2: Point } {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dist = Math.hypot(dx, dy)
  const handle = Math.min(156, Math.max(36, dist * 0.42))

  let sDir: Point
  let eDir: Point
  if (startNormal) {
    sDir = startNormal
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    sDir = { x: dx >= 0 ? 1 : -1, y: 0 }
  } else {
    sDir = { x: 0, y: dy >= 0 ? 1 : -1 }
  }

  if (endNormal) {
    eDir = endNormal
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    eDir = { x: dx >= 0 ? -1 : 1, y: 0 }
  } else {
    eDir = { x: 0, y: dy >= 0 ? -1 : 1 }
  }

  return {
    c1: { x: round2(start.x + sDir.x * handle), y: round2(start.y + sDir.y * handle) },
    c2: { x: round2(end.x + eDir.x * handle), y: round2(end.y + eDir.y * handle) },
  }
}

function cubicPoint(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const mt = 1 - t
  return {
    x: round2(
      mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x,
    ),
    y: round2(
      mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y,
    ),
  }
}

function buildHeadShape(
  head: ConnectorHead | undefined,
  tip: Point,
  dir: Point,
  strokeWidth: number,
): { shape: ConnectorHeadShape | null; pullback: number } {
  if (!head || head === 'none') return { shape: null, pullback: 0 }
  if (head === 'arrow') {
    return {
      shape: { kind: 'chevron', path: connectorChevronPath(tip, dir, strokeWidth) },
      pullback: Math.max(0.8, strokeWidth * 0.4),
    }
  }
  if (head === 'triangle') {
    const len = connectorHeadLength(strokeWidth) * 1.12
    return {
      shape: { kind: 'stealth', path: connectorStealthPath(tip, dir, strokeWidth) },
      pullback: len * 0.72,
    }
  }
  if (head === 'circle') {
    const radius = Math.max(3.6, strokeWidth * 1.65)
    return {
      shape: { kind: 'circle', point: tip, radius },
      pullback: radius * 0.9,
    }
  }
  return { shape: null, pullback: 0 }
}

/**
 * Computes sleek Miro/Allo/Claude connector geometry supporting straight, smooth curved
 * (cubic Bezier), and rounded-corner elbow routing, with distinct open-chevron, stealth-filled,
 * and ringed-dot arrowheads.
 */
export function computeConnectorGeometry(
  start: Point,
  end: Point,
  waypoints: readonly Point[] | undefined,
  strokeWidth: number,
  startHeadKind: ConnectorHead | undefined,
  endHeadKind: ConnectorHead | undefined,
  routing: ConnectorRouting = 'straight',
  startNormal: Point | null = null,
  endNormal: Point | null = null,
): ConnectorRenderGeometry {
  const hasWaypoints = Boolean(waypoints && waypoints.length > 0)

  if (routing === 'curved' && !hasWaypoints) {
    const { c1, c2 } = cubicControlPoints(start, end, startNormal, endNormal)
    // Exact outward tangents at t=0 and t=1
    const startDir = unitVec(start.x - c1.x, start.y - c1.y)
    const endDir = unitVec(end.x - c2.x, end.y - c2.y)
    const sHead = buildHeadShape(startHeadKind, start, startDir, strokeWidth)
    const eHead = buildHeadShape(endHeadKind, end, endDir, strokeWidth)

    const sShaft = sHead.pullback > 0 ? pullBackAlong(start, startDir, sHead.pullback) : start
    const eShaft = eHead.pullback > 0 ? pullBackAlong(end, endDir, eHead.pullback) : end

    const fullPath = `M${round2(start.x)} ${round2(start.y)} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${round2(end.x)} ${round2(end.y)}`
    const shaftPath = `M${round2(sShaft.x)} ${round2(sShaft.y)} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${round2(eShaft.x)} ${round2(eShaft.y)}`
    const midpoint = cubicPoint(start, c1, c2, end, 0.5)

    return {
      shaftPath,
      fullPath,
      startHead: sHead.shape,
      endHead: eHead.shape,
      startArrowPath: sHead.shape?.kind === 'stealth' ? (sHead.shape.path ?? null) : null,
      endArrowPath: eHead.shape?.kind === 'stealth' ? (eHead.shape.path ?? null) : null,
      startCircle: sHead.shape?.kind === 'circle' ? start : null,
      endCircle: eHead.shape?.kind === 'circle' ? end : null,
      midpoint,
    }
  }

  const pts: Point[] =
    routing === 'elbow' && !hasWaypoints
      ? buildElbowPoints(start, end, startNormal, endNormal)
      : [start, ...(waypoints ?? []), end]

  const firstNeighbor = pts[1] ?? end
  const lastNeighbor = pts[pts.length - 2] ?? start
  const startDir = unitVec(start.x - firstNeighbor.x, start.y - firstNeighbor.y)
  const endDir = unitVec(end.x - lastNeighbor.x, end.y - lastNeighbor.y)

  const sHead = buildHeadShape(startHeadKind, start, startDir, strokeWidth)
  const eHead = buildHeadShape(endHeadKind, end, endDir, strokeWidth)

  const shaftPts = pts.map((pt) => ({ x: pt.x, y: pt.y }))
  if (sHead.pullback > 0 && shaftPts.length >= 2) {
    const segLen = Math.hypot(firstNeighbor.x - start.x, firstNeighbor.y - start.y)
    if (segLen > sHead.pullback) {
      shaftPts[0] = pullBackAlong(start, startDir, sHead.pullback)
    }
  }
  if (eHead.pullback > 0 && shaftPts.length >= 2) {
    const segLen = Math.hypot(end.x - lastNeighbor.x, end.y - lastNeighbor.y)
    if (segLen > eHead.pullback) {
      shaftPts[shaftPts.length - 1] = pullBackAlong(end, endDir, eHead.pullback)
    }
  }

  const cornerRadius = routing === 'elbow' ? 12 : routing === 'curved' ? 20 : hasWaypoints ? 6 : 0

  return {
    shaftPath: roundedPolylinePath(shaftPts, cornerRadius),
    fullPath: roundedPolylinePath(pts, cornerRadius),
    startHead: sHead.shape,
    endHead: eHead.shape,
    startArrowPath: sHead.shape?.kind === 'stealth' ? (sHead.shape.path ?? null) : null,
    endArrowPath: eHead.shape?.kind === 'stealth' ? (eHead.shape.path ?? null) : null,
    startCircle: sHead.shape?.kind === 'circle' ? start : null,
    endCircle: eHead.shape?.kind === 'circle' ? end : null,
    midpoint: polylineMidpoint(pts),
  }
}

export const SIDE_ANCHORS = [
  { anchorX: 0.5, anchorY: 0, nx: 0, ny: -1 },
  { anchorX: 1, anchorY: 0.5, nx: 1, ny: 0 },
  { anchorX: 0.5, anchorY: 1, nx: 0, ny: 1 },
  { anchorX: 0, anchorY: 0.5, nx: -1, ny: 0 },
] as const

export interface SnapAttachTarget {
  readonly objectId: string
  readonly anchorX: number
  readonly anchorY: number
  readonly x: number
  readonly y: number
}

/** Finds the top-most attachable object under `point` and snaps to its nearest/facing side middle. */
export function findAttachTarget(
  objects: readonly BoardObject[],
  point: Point,
  tolerance: number,
  excludeIds: ReadonlySet<string> = new Set(),
  toward?: Point,
): SnapAttachTarget | null {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const obj = objects[i]!
    if (obj.kind === 'connector' || obj.kind === 'stroke' || excludeIds.has(obj.id)) continue
    if (
      point.x < obj.x - tolerance ||
      point.y < obj.y - tolerance ||
      point.x > obj.x + obj.width + tolerance ||
      point.y > obj.y + obj.height + tolerance
    ) {
      continue
    }
    let best: (typeof SIDE_ANCHORS)[number] = SIDE_ANCHORS[0]
    let bestDist = Infinity
    for (const side of SIDE_ANCHORS) {
      const sx = obj.x + obj.width * side.anchorX
      const sy = obj.y + obj.height * side.anchorY
      const ref = toward ?? point
      const d = Math.hypot(ref.x - sx, ref.y - sy)
      if (d < bestDist) {
        bestDist = d
        best = side
      }
    }
    return {
      objectId: obj.id,
      anchorX: best.anchorX,
      anchorY: best.anchorY,
      x: round2(obj.x + obj.width * best.anchorX),
      y: round2(obj.y + obj.height * best.anchorY),
    }
  }
  return null
}

/** Maps a legacy raw white page background to warm ivory paper on the live stage. */
export function livePaperColor(bgColor: string | undefined): string {
  if (!bgColor || bgColor.toUpperCase() === '#FFFFFF' || bgColor.toUpperCase() === '#FFF') {
    return PAPER_COLORS.paper
  }
  return bgColor
}
