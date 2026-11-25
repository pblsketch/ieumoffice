// The drawing layer of one page: shows the page's pending strokes and shapes, and
// while the [Pen] tool is on it turns pointers into drawings (or erases them) by the
// pen/finger rule of penInput.ts.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pdfToView, viewToPdf } from '../../../../../../../pdf/src/renderer/annotations'
import type { PageGeom } from '../../../../../../../pdf/src/renderer/annotations'
import { cssRgb, type LocalDrawing } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { DrawingInput } from '../../../../../../../pdf/src/shared/ipc'
import type { PdfFeaturePage } from '../../edit/types'
import {
  erasedIds,
  startStroke,
  type DrawToolChoice,
  type StrokeBuilder,
  type StrokeStyle,
} from './drawGeometry'
import type { PenInputRouter } from './penInput'

/** How far (CSS px) from a stroke the eraser still catches it: a fingertip is wider than a pen tip. */
const ERASE_TOLERANCE_TOUCH = 14
const ERASE_TOLERANCE_PRECISE = 8

type Gesture =
  | { readonly kind: 'stroke'; readonly pointerId: number; readonly builder: StrokeBuilder }
  | {
      readonly kind: 'erase'
      readonly pointerId: number
      readonly key: string
      readonly tolerance: number
      readonly removed: Set<string>
    }

export interface DrawPageLayerProps {
  readonly page: PdfFeaturePage
  /** This page's pending strokes and shapes. */
  readonly drawings: readonly LocalDrawing[]
  /** The [Pen] tool is on in edit mode: pointers draw here. */
  readonly active: boolean
  readonly tool: DrawToolChoice
  readonly style: StrokeStyle
  /** Fingers draw (no pen yet, or the switch is on); otherwise they move the view. */
  readonly fingerDraws: boolean
  readonly router: PenInputRouter
  readonly onCommit: (pageIndex: number, input: DrawingInput) => void
  /** Remove these drawings; one erasing gesture shares one key (one undo step). */
  readonly onErase: (ids: string[], gestureKey: string) => void
}

let eraseSeq = 0

function view(geom: PageGeom, scale: number, x: number, y: number): [number, number] {
  const [vx, vy] = pdfToView(geom, x, y)
  return [vx * scale, vy * scale]
}

/** The same picture the PC `DrawLayer` draws for a pending stroke or shape. */
function DrawingShape({ d, geom, scale }: { d: DrawingInput; geom: PageGeom; scale: number }) {
  if (d.kind === 'note' || d.kind === 'link' || d.kind === 'image') return null
  const stroke = cssRgb(d.color)
  if (d.kind === 'caret') {
    const [vx, vy] = view(geom, scale, d.point[0], d.point[1])
    const s = 8
    return (
      <path
        d={`M${vx - s} ${vy + s * 0.75} L${vx} ${vy} L${vx + s} ${vy + s * 0.75}`}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  const w = d.width * scale
  if (d.kind === 'ink') {
    return (
      <>
        {d.paths.map((path, i) => {
          const pts: string[] = []
          for (let j = 0; j + 1 < path.length; j += 2) {
            const [vx, vy] = view(geom, scale, path[j]!, path[j + 1]!)
            pts.push(`${vx},${vy}`)
          }
          return (
            <polyline
              key={i}
              points={pts.join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={w}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}
      </>
    )
  }
  if (d.kind === 'rect' || d.kind === 'ellipse') {
    const [ax, ay] = view(geom, scale, d.rect[0], d.rect[1])
    const [bx, by] = view(geom, scale, d.rect[2], d.rect[3])
    const [x, y, rw, rh] = [
      Math.min(ax, bx),
      Math.min(ay, by),
      Math.abs(bx - ax),
      Math.abs(by - ay),
    ]
    return d.kind === 'rect' ? (
      <rect x={x} y={y} width={rw} height={rh} fill="none" stroke={stroke} strokeWidth={w} />
    ) : (
      <ellipse
        cx={x + rw / 2}
        cy={y + rh / 2}
        rx={rw / 2}
        ry={rh / 2}
        fill="none"
        stroke={stroke}
        strokeWidth={w}
      />
    )
  }
  if (d.kind === 'polygon') {
    const pts = d.vertices.map(([px, py]) => view(geom, scale, px, py).join(',')).join(' ')
    return (
      <polygon points={pts} fill="none" stroke={stroke} strokeWidth={w} strokeLinejoin="round" />
    )
  }
  const [fx, fy] = view(geom, scale, d.from[0], d.from[1])
  const [tx, ty] = view(geom, scale, d.to[0], d.to[1])
  const head =
    d.kind === 'arrow'
      ? [-0.45, 0.45].map((off) => {
          const ang = Math.atan2(ty - fy, tx - fx)
          const len = Math.max(9 * scale, w * 4.5)
          return (
            <line
              key={off}
              x1={tx}
              y1={ty}
              x2={tx - len * Math.cos(ang + off)}
              y2={ty - len * Math.sin(ang + off)}
              stroke={stroke}
              strokeWidth={w}
              strokeLinecap="round"
            />
          )
        })
      : null
  return (
    <>
      <line x1={fx} y1={fy} x2={tx} y2={ty} stroke={stroke} strokeWidth={w} strokeLinecap="round" />
      {head}
      {d.kind === 'measure' && d.label ? (
        <text
          x={(fx + tx) / 2}
          y={(fy + ty) / 2 - 6 * scale}
          fill={stroke}
          fontSize={Math.max(9, 9 * scale)}
          textAnchor="middle"
        >
          {d.label}
        </text>
      ) : null}
    </>
  )
}

export function DrawPageLayer({
  page,
  drawings,
  active,
  tool,
  style,
  fingerDraws,
  router,
  onCommit,
  onErase,
}: DrawPageLayerProps) {
  const { pageIndex, geom, scale, width, height } = page
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [live, setLive] = useState<DrawingInput | null>(null)

  const cancelGesture = () => {
    gestureRef.current = null
    setLive(null)
  }

  // leaving the tool drops a half-made stroke
  useEffect(() => {
    if (!active) {
      gestureRef.current = null
      setLive(null)
    }
  }, [active])

  // While a pen is down, no touch on this layer may scroll or start a two-finger zoom
  // (a resting palm, or the pen's own touch sequence where the browser sends one).
  useEffect(() => {
    const el = svgRef.current
    if (!el || !active) return
    const onTouchStart = (e: TouchEvent) => {
      const stylus = [...(e.changedTouches ?? [])].some(
        (touch) => (touch as Touch & { touchType?: string }).touchType === 'stylus',
      )
      if (!stylus && !router.penDown()) return
      e.preventDefault()
      e.stopPropagation()
    }
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    return () => el.removeEventListener('touchstart', onTouchStart)
  }, [active, router])

  const toPdf = (clientX: number, clientY: number): [number, number] => {
    const box = svgRef.current!.getBoundingClientRect()
    return viewToPdf(geom, (clientX - box.left) / scale, (clientY - box.top) / scale)
  }
  const toPagePx = (clientX: number, clientY: number): [number, number] => {
    const box = svgRef.current!.getBoundingClientRect()
    return [clientX - box.left, clientY - box.top]
  }

  const erase = (gesture: Extract<Gesture, { kind: 'erase' }>, at: [number, number]) => {
    const hit = erasedIds(drawings, geom, scale, at, gesture.tolerance).filter(
      (id) => !gesture.removed.has(id),
    )
    if (hit.length === 0) return
    for (const id of hit) gesture.removed.add(id)
    onErase(hit, gesture.key)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!active) return
    if (e.pointerType !== 'touch' && e.button !== 0) return
    const decision = router.down(e.pointerId, e.pointerType)
    if (decision.abortLive) cancelGesture()
    if (decision.route === 'pass') return
    e.preventDefault()
    if (decision.route === 'block') return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (tool === 'eraser') {
      eraseSeq += 1
      const gesture: Gesture = {
        kind: 'erase',
        pointerId: e.pointerId,
        key: `pdf-draw-erase-${eraseSeq}`,
        tolerance: e.pointerType === 'touch' ? ERASE_TOLERANCE_TOUCH : ERASE_TOLERANCE_PRECISE,
        removed: new Set(),
      }
      gestureRef.current = gesture
      erase(gesture, toPagePx(e.clientX, e.clientY))
      return
    }
    const builder = startStroke(tool, toPdf(e.clientX, e.clientY), style)
    gestureRef.current = { kind: 'stroke', pointerId: e.pointerId, builder }
    setLive(builder.live())
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== e.pointerId) return
    // a pen reports many more positions than frames; keep them all for a smooth line
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? []
    const points = coalesced.length > 0 ? coalesced : [e.nativeEvent]
    if (gesture.kind === 'erase') {
      for (const p of points) erase(gesture, toPagePx(p.clientX, p.clientY))
      return
    }
    for (const p of points) gesture.builder.move(toPdf(p.clientX, p.clientY))
    setLive(gesture.builder.live())
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    router.up(e.pointerId)
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== e.pointerId) return
    cancelGesture()
    if (gesture.kind === 'stroke') {
      const input = gesture.builder.finish()
      if (input) onCommit(pageIndex, input)
    }
  }

  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>) => {
    router.up(e.pointerId)
    // the browser took the pointer over (a scroll or a zoom): the stroke is not kept
    if (gestureRef.current?.pointerId === e.pointerId) cancelGesture()
  }

  return (
    <svg
      ref={svgRef}
      className="m-pdf-draw-layer"
      data-active={active}
      data-testid={`pdf-draw-layer-${pageIndex}`}
      width={width}
      height={height}
      style={active ? { touchAction: fingerDraws ? 'none' : 'pan-x pan-y' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {drawings.map((d) => (
        <g key={d.id} data-drawing-id={d.id}>
          <DrawingShape d={d.input} geom={geom} scale={scale} />
        </g>
      ))}
      {live && <DrawingShape d={live} geom={geom} scale={scale} />}
    </svg>
  )
}
