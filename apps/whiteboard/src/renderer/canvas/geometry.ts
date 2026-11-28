/**
 * Pure geometry, hit-testing, marquee selection, smart alignment guides,
 * multi-object alignment/distribution, group resize, rotation, and search
 * helpers for the whiteboard canvas.
 */
import type {
  BoardDocument,
  BoardObject,
  ConnectorProps,
  LinkProps,
  Point,
  ShapeProps,
  StickyProps,
  TableProps,
  TextProps,
} from '@genoffice/whiteboard-engine'
import { resolveConnectorEnd } from './paper-style'
import { richTextPlain } from '../export/render-svg'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export type AlignDirection = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

export type DistributeAxis = 'horizontal' | 'vertical'

export interface SnapGuide {
  readonly axis: 'x' | 'y'
  readonly value: number
  readonly from: number
  readonly to: number
}

export interface SearchHit {
  readonly objectId: string
  readonly pageId: string
  readonly kind: BoardObject['kind']
  readonly snippet: string
}

/** Returns true when an object has been locked via extra metadata. */
export function isObjectLocked(obj: BoardObject): boolean {
  return obj.locked === true
}

/** Computes axis-aligned bounding box for any board object (including connectors). */
export function objectBounds(obj: BoardObject, byId: ReadonlyMap<string, BoardObject>): Rect {
  if (obj.kind === 'connector') {
    const p = obj.props as unknown as ConnectorProps
    const s = resolveConnectorEnd(p.start, byId)
    const e = resolveConnectorEnd(p.end, byId)
    const pts = [s, ...(p.waypoints ?? []), e]
    const xs = pts.map((pt) => pt.x)
    const ys = pts.map((pt) => pt.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return {
      x: minX,
      y: minY,
      width: Math.max(24, Math.max(...xs) - minX),
      height: Math.max(24, Math.max(...ys) - minY),
    }
  }
  return {
    x: obj.x,
    y: obj.y,
    width: Math.max(obj.width, 24),
    height: Math.max(obj.height, 24),
  }
}

/** Computes the union bounding box of a set of objects. */
export function selectionBounds(
  objects: readonly BoardObject[],
  byId: ReadonlyMap<string, BoardObject>,
): Rect | null {
  if (objects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const obj of objects) {
    const b = objectBounds(obj, byId)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.width > maxX) maxX = b.x + b.width
    if (b.y + b.height > maxY) maxY = b.y + b.height
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

/** Normalizes two drag corners into a positive-width/height rectangle. */
export function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  )
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ccw = (p1: Point, p2: Point, p3: Point) =>
    (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x)
  const d1 = ccw(a, b, c)
  const d2 = ccw(a, b, d)
  const d3 = ccw(c, d, a)
  const d4 = ccw(c, d, b)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true
  const tl = { x: r.x, y: r.y }
  const tr = { x: r.x + r.width, y: r.y }
  const br = { x: r.x + r.width, y: r.y + r.height }
  const bl = { x: r.x, y: r.y + r.height }
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  )
}

/** Tests whether a board object intersects a marquee selection rectangle. */
export function objectIntersectsRect(
  obj: BoardObject,
  rect: Rect,
  byId: ReadonlyMap<string, BoardObject>,
): boolean {
  if (obj.kind === 'connector') {
    const p = obj.props as unknown as ConnectorProps
    const s = resolveConnectorEnd(p.start, byId)
    const e = resolveConnectorEnd(p.end, byId)
    const pts = [s, ...(p.waypoints ?? []), e]
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (segmentIntersectsRect(pts[i]!, pts[i + 1]!, rect)) return true
    }
    return false
  }
  return rectsIntersect(objectBounds(obj, byId), rect)
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Tests whether a point (e.g. sweeping eraser cursor) hits an object. */
export function objectHitsPoint(
  obj: BoardObject,
  pt: Point,
  byId: ReadonlyMap<string, BoardObject>,
  tolerance = 8,
): boolean {
  if (obj.kind === 'connector') {
    const p = obj.props as unknown as ConnectorProps
    const s = resolveConnectorEnd(p.start, byId)
    const e = resolveConnectorEnd(p.end, byId)
    const pts = [s, ...(p.waypoints ?? []), e]
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (distToSegment(pt, pts[i]!, pts[i + 1]!) <= tolerance + (p.strokeWidth ?? 2)) {
        return true
      }
    }
    return false
  }
  const b = objectBounds(obj, byId)
  return (
    pt.x >= b.x - tolerance &&
    pt.x <= b.x + b.width + tolerance &&
    pt.y >= b.y - tolerance &&
    pt.y <= b.y + b.height + tolerance
  )
}

/** Expands a set of selected object IDs to include all page siblings sharing any selected groupId. */
export function expandGroupSelection(
  ids: readonly string[],
  pageObjects: readonly BoardObject[],
): string[] {
  const idSet = new Set(ids)
  const groupIds = new Set<string>()
  for (const obj of pageObjects) {
    if (idSet.has(obj.id) && obj.groupId) {
      groupIds.add(obj.groupId)
    }
  }
  if (groupIds.size === 0) return [...idSet]
  for (const obj of pageObjects) {
    if (obj.groupId && groupIds.has(obj.groupId)) {
      idSet.add(obj.id)
    }
  }
  return [...idSet]
}

/**
 * Computes magnetic alignment snap offsets and visual guide lines for a moving rectangle
 * against stationary peer rectangles on the same page.
 */
export function computeSnapGuides(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
): { snapDx: number; snapDy: number; guides: SnapGuide[] } {
  if (others.length === 0 || threshold <= 0) {
    return { snapDx: 0, snapDy: 0, guides: [] }
  }

  const mXs = [moving.x, moving.x + moving.width / 2, moving.x + moving.width]
  const mYs = [moving.y, moving.y + moving.height / 2, moving.y + moving.height]

  let bestDx = Infinity
  let bestXVal = 0
  let bestXPeer: Rect | null = null

  let bestDy = Infinity
  let bestYVal = 0
  let bestYPeer: Rect | null = null

  for (const other of others) {
    const oXs = [other.x, other.x + other.width / 2, other.x + other.width]
    for (const mx of mXs) {
      for (const ox of oXs) {
        const diff = ox - mx
        if (Math.abs(diff) <= threshold && Math.abs(diff) < Math.abs(bestDx)) {
          bestDx = diff
          bestXVal = ox
          bestXPeer = other
        }
      }
    }
    const oYs = [other.y, other.y + other.height / 2, other.y + other.height]
    for (const my of mYs) {
      for (const oy of oYs) {
        const diff = oy - my
        if (Math.abs(diff) <= threshold && Math.abs(diff) < Math.abs(bestDy)) {
          bestDy = diff
          bestYVal = oy
          bestYPeer = other
        }
      }
    }
  }

  const snapDx = Number.isFinite(bestDx) ? bestDx : 0
  const snapDy = Number.isFinite(bestDy) ? bestDy : 0
  const snapped: Rect = {
    x: moving.x + snapDx,
    y: moving.y + snapDy,
    width: moving.width,
    height: moving.height,
  }

  const guides: SnapGuide[] = []
  if (bestXPeer) {
    guides.push({
      axis: 'x',
      value: bestXVal,
      from: Math.min(snapped.y, bestXPeer.y) - 18,
      to: Math.max(snapped.y + snapped.height, bestXPeer.y + bestXPeer.height) + 18,
    })
  }
  if (bestYPeer) {
    guides.push({
      axis: 'y',
      value: bestYVal,
      from: Math.min(snapped.x, bestYPeer.x) - 18,
      to: Math.max(snapped.x + snapped.width, bestYPeer.x + bestYPeer.width) + 18,
    })
  }

  return { snapDx, snapDy, guides }
}

/** Computes a single rectangle resize for any of the 8 handles, with optional aspect lock. */
export function computeSingleResize(
  orig: Rect,
  handle: ResizeHandle,
  rawDx: number,
  rawDy: number,
  keepAspect: boolean,
  minW = 32,
  minH = 24,
): Rect {
  let x = orig.x
  let y = orig.y
  let width = orig.width
  let height = orig.height

  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')

  if (hasE) {
    width = Math.max(minW, orig.width + rawDx)
  } else if (hasW) {
    const dx = Math.min(rawDx, orig.width - minW)
    x = orig.x + dx
    width = orig.width - dx
  }

  if (hasS) {
    height = Math.max(minH, orig.height + rawDy)
  } else if (hasN) {
    const dy = Math.min(rawDy, orig.height - minH)
    y = orig.y + dy
    height = orig.height - dy
  }

  const isCorner = (hasW || hasE) && (hasN || hasS)
  if (keepAspect && isCorner && orig.width > 0 && orig.height > 0) {
    const aspect = orig.width / orig.height
    const scaleX = width / orig.width
    const scaleY = height / orig.height
    if (Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)) {
      const nextH = Math.max(minH, width / aspect)
      if (hasN) y = orig.y + orig.height - nextH
      height = nextH
    } else {
      const nextW = Math.max(minW, height * aspect)
      if (hasW) x = orig.x + orig.width - nextW
      width = nextW
    }
  }

  return { x, y, width, height }
}

/** Computes proportional per-object rectangles when resizing a multi-selection bounding box. */
export function computeGroupResize(
  origBounds: Rect,
  handle: ResizeHandle,
  rawDx: number,
  rawDy: number,
  items: ReadonlyArray<{ id: string; rect: Rect }>,
  keepAspect: boolean,
): Map<string, Rect> {
  const nextBounds = computeSingleResize(origBounds, handle, rawDx, rawDy, keepAspect, 40, 32)
  const scaleX = origBounds.width > 0 ? nextBounds.width / origBounds.width : 1
  const scaleY = origBounds.height > 0 ? nextBounds.height / origBounds.height : 1
  const out = new Map<string, Rect>()
  for (const item of items) {
    const relX = item.rect.x - origBounds.x
    const relY = item.rect.y - origBounds.y
    out.set(item.id, {
      x: nextBounds.x + relX * scaleX,
      y: nextBounds.y + relY * scaleY,
      width: Math.max(24, item.rect.width * scaleX),
      height: Math.max(20, item.rect.height * scaleY),
    })
  }
  return out
}

/** Computes align move patches for 2+ unlocked non-connector objects. */
export function computeAlignUpdates(
  objects: readonly BoardObject[],
  direction: AlignDirection,
): Array<{ id: string; x: number; y: number }> {
  const movable = objects.filter((o) => o.kind !== 'connector' && !isObjectLocked(o))
  if (movable.length < 2) return []

  const minX = Math.min(...movable.map((o) => o.x))
  const maxX = Math.max(...movable.map((o) => o.x + o.width))
  const midX = (minX + maxX) / 2
  const minY = Math.min(...movable.map((o) => o.y))
  const maxY = Math.max(...movable.map((o) => o.y + o.height))
  const midY = (minY + maxY) / 2

  const updates: Array<{ id: string; x: number; y: number }> = []
  for (const o of movable) {
    let x = o.x
    let y = o.y
    if (direction === 'left') x = minX
    else if (direction === 'center') x = Math.round(midX - o.width / 2)
    else if (direction === 'right') x = Math.round(maxX - o.width)
    else if (direction === 'top') y = minY
    else if (direction === 'middle') y = Math.round(midY - o.height / 2)
    else if (direction === 'bottom') y = Math.round(maxY - o.height)

    if (Math.abs(x - o.x) > 0.5 || Math.abs(y - o.y) > 0.5) {
      updates.push({ id: o.id, x, y })
    }
  }
  return updates
}

/** Computes even-gap distribution patches for 3+ unlocked non-connector objects. */
export function computeDistributeUpdates(
  objects: readonly BoardObject[],
  axis: DistributeAxis,
): Array<{ id: string; x: number; y: number }> {
  const movable = objects.filter((o) => o.kind !== 'connector' && !isObjectLocked(o))
  if (movable.length < 3) return []

  const sorted = [...movable].sort((a, b) => (axis === 'horizontal' ? a.x - b.x : a.y - b.y))
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!

  if (axis === 'horizontal') {
    const totalSpan = last.x + last.width - first.x
    const sumW = sorted.reduce((acc, o) => acc + o.width, 0)
    const gap = (totalSpan - sumW) / (sorted.length - 1)
    let cursor = first.x
    const updates: Array<{ id: string; x: number; y: number }> = []
    for (const o of sorted) {
      const nextX = Math.round(cursor)
      if (Math.abs(nextX - o.x) > 0.5) {
        updates.push({ id: o.id, x: nextX, y: o.y })
      }
      cursor += o.width + gap
    }
    return updates
  }

  const totalSpan = last.y + last.height - first.y
  const sumH = sorted.reduce((acc, o) => acc + o.height, 0)
  const gap = (totalSpan - sumH) / (sorted.length - 1)
  let cursor = first.y
  const updates: Array<{ id: string; x: number; y: number }> = []
  for (const o of sorted) {
    const nextY = Math.round(cursor)
    if (Math.abs(nextY - o.y) > 0.5) {
      updates.push({ id: o.id, x: o.x, y: nextY })
    }
    cursor += o.height + gap
  }
  return updates
}

/** Computes normalized rotation angle in [0, 360) where 0 deg points straight up. */
export function computeRotationDegrees(center: Point, pointer: Point, snap15: boolean): number {
  const rad = Math.atan2(pointer.y - center.y, pointer.x - center.x)
  let deg = ((rad * 180) / Math.PI + 90 + 360) % 360
  if (snap15) {
    deg = Math.round(deg / 15) * 15
  } else {
    for (const cardinal of [0, 90, 180, 270, 360]) {
      if (Math.abs(deg - cardinal) <= 3) {
        deg = cardinal
        break
      }
    }
  }
  return Math.round(deg) % 360
}

/** Extracts searchable plain text from any board object. */
export function extractObjectSearchText(obj: BoardObject): string {
  switch (obj.kind) {
    case 'sticky':
      return richTextPlain((obj.props as unknown as StickyProps).text)
    case 'text':
      return richTextPlain((obj.props as unknown as TextProps).text)
    case 'shape':
      return richTextPlain((obj.props as unknown as ShapeProps).text)
    case 'connector':
      return richTextPlain((obj.props as unknown as ConnectorProps).label)
    case 'table': {
      const tp = obj.props as unknown as TableProps
      return Object.values(tp.cells ?? {})
        .map((c) => richTextPlain(c))
        .filter(Boolean)
        .join(' ')
    }
    case 'link': {
      const lp = obj.props as unknown as LinkProps
      return [lp.title, lp.description, lp.url].filter(Boolean).join(' ')
    }
    default:
      return ''
  }
}

/** Searches all objects across a board document (active page first) for case-insensitive matches. */
export function searchBoardObjects(
  doc: BoardDocument,
  query: string,
  activePageId?: string,
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const pagesOrdered = activePageId
    ? [
        ...doc.pages.filter((p) => p.id === activePageId),
        ...doc.pages.filter((p) => p.id !== activePageId),
      ]
    : doc.pages

  const hits: SearchHit[] = []
  for (const page of pagesOrdered) {
    const objs = doc.objects
      .filter((o) => o.pageId === page.id)
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
    for (const obj of objs) {
      const raw = extractObjectSearchText(obj)
      if (!raw) continue
      const idx = raw.toLowerCase().indexOf(needle)
      if (idx < 0) continue
      const start = Math.max(0, idx - 16)
      const snippet = raw
        .slice(start, start + 56)
        .replace(/\s+/g, ' ')
        .trim()
      hits.push({
        objectId: obj.id,
        pageId: page.id,
        kind: obj.kind,
        snippet,
      })
    }
  }
  return hits
}
