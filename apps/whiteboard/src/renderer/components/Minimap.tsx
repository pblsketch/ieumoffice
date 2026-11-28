/**
 * Miro-style collapsible bottom-right interactive minimap with live viewport navigation.
 */
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import type {
  BoardObject,
  ConnectorProps,
  Page,
  ShapeProps,
  StickyProps,
  StrokeProps,
} from '@genoffice/whiteboard-engine'
import { objectBounds } from '../canvas/geometry'
import { PAPER_COLORS, PAPER_FILL_SWATCHES, resolveConnectorEnd } from '../canvas/paper-style'

const MAP_W = 180
const MAP_H = 112

function miniSwatch(obj: BoardObject): string {
  if (obj.kind === 'sticky')
    return (obj.props as unknown as StickyProps).color || PAPER_FILL_SWATCHES[0]
  if (obj.kind === 'shape') {
    const f = (obj.props as unknown as ShapeProps).fill
    return f && f !== 'transparent' ? f : PAPER_COLORS.zoneFill
  }
  if (obj.kind === 'stroke') return (obj.props as unknown as StrokeProps).color || PAPER_COLORS.ink
  if (obj.kind === 'connector') {
    return (obj.props as unknown as ConnectorProps).color || PAPER_COLORS.inkMuted
  }
  return PAPER_COLORS.lineStrong
}

export interface MinimapProps {
  readonly page: Page
  readonly objects: readonly BoardObject[]
  readonly pan: { x: number; y: number }
  readonly zoom: number
  readonly stageWidth: number
  readonly stageHeight: number
  readonly onPanTo: (nextPan: { x: number; y: number }) => void
}

export function Minimap({
  page,
  objects,
  pan,
  zoom,
  stageWidth,
  stageHeight,
  onPanTo,
}: MinimapProps): ReactElement {
  const draggingRef = useRef(false)
  const byId = new Map(objects.map((o) => [o.id, o]))
  const boxes = objects.map((o) => ({ obj: o, box: objectBounds(o, byId) }))

  const viewX = -pan.x / zoom
  const viewY = -pan.y / zoom
  const viewW = Math.max(100, stageWidth / zoom)
  const viewH = Math.max(100, stageHeight / zoom)

  let minX = Math.min(0, viewX)
  let minY = Math.min(0, viewY)
  let maxX = Math.max(page.width || 1280, viewX + viewW)
  let maxY = Math.max(page.height || 720, viewY + viewH)

  for (const { box } of boxes) {
    if (box.x - 60 < minX) minX = box.x - 60
    if (box.y - 60 < minY) minY = box.y - 60
    if (box.x + box.width + 60 > maxX) maxX = box.x + box.width + 60
    if (box.y + box.height + 60 > maxY) maxY = box.y + box.height + 60
  }

  const worldW = Math.max(300, maxX - minX)
  const worldH = Math.max(200, maxY - minY)
  const scale = Math.min((MAP_W - 12) / worldW, (MAP_H - 12) / worldH)
  const offsetX = (MAP_W - worldW * scale) / 2 - minX * scale
  const offsetY = (MAP_H - worldH * scale) / 2 - minY * scale

  const centerOnClient = (clientX: number, clientY: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const boardX = (mx - offsetX) / scale
    const boardY = (my - offsetY) / scale
    onPanTo({
      x: Math.round(stageWidth / 2 - boardX * zoom),
      y: Math.round(stageHeight / 2 - boardY * zoom),
    })
  }

  const handleDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    centerOnClient(e.clientX, e.clientY, e.currentTarget)
  }

  const handleMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    e.stopPropagation()
    centerOnClient(e.clientX, e.clientY, e.currentTarget)
  }

  const handleUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    e.stopPropagation()
    draggingRef.current = false
  }

  return (
    <div className="wb-minimap" onPointerDown={(e) => e.stopPropagation()}>
      <svg
        width={MAP_W}
        height={MAP_H}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        {page.format !== 'freeform' && (
          <rect
            x={offsetX}
            y={offsetY}
            width={page.width * scale}
            height={page.height * scale}
            fill={PAPER_COLORS.paper}
            stroke={PAPER_COLORS.lineStrong}
            strokeWidth={0.8}
            rx={2}
          />
        )}
        {boxes
          .filter(({ obj }) => obj.kind !== 'connector')
          .map(({ obj, box }) => (
            <rect
              key={obj.id}
              x={offsetX + box.x * scale}
              y={offsetY + box.y * scale}
              width={Math.max(2.5, box.width * scale)}
              height={Math.max(2, box.height * scale)}
              rx={1}
              fill={miniSwatch(obj)}
            />
          ))}
        {objects
          .filter((o) => o.kind === 'connector')
          .map((o) => {
            const p = o.props as unknown as ConnectorProps
            const s = resolveConnectorEnd(p.start, byId)
            const e = resolveConnectorEnd(p.end, byId)
            return (
              <line
                key={o.id}
                x1={offsetX + s.x * scale}
                y1={offsetY + s.y * scale}
                x2={offsetX + e.x * scale}
                y2={offsetY + e.y * scale}
                stroke={p.color || PAPER_COLORS.inkMuted}
                strokeWidth={1}
              />
            )
          })}
        <rect
          className="wb-minimap-viewport"
          x={offsetX + viewX * scale}
          y={offsetY + viewY * scale}
          width={Math.max(10, viewW * scale)}
          height={Math.max(8, viewH * scale)}
          rx={2}
        />
      </svg>
    </div>
  )
}
