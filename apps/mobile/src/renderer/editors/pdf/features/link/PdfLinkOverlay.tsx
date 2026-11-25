// One page of the link feature: the pending link boxes (tap one to edit it in edit
// mode) and, while placing, the surface a finger drags the new box on.
import { useRef, useState, type PointerEvent } from 'react'
import { pdfRectToCss } from '../../../../../../../pdf/src/renderer/annotations'
import type { PdfFeaturePage } from '../../edit/types'
import { dragToPdfRect, type PdfPendingLink } from './linkTarget'

type Point = [number, number]
type Rect = [number, number, number, number]

/** The pointer in page CSS px; a pinch zoom transform scales the box on screen, so undo it. */
function localPoint(e: PointerEvent<HTMLElement>, page: PdfFeaturePage): Point {
  const box = e.currentTarget.getBoundingClientRect()
  const fx = box.width > 0 ? page.width / box.width : 1
  const fy = box.height > 0 ? page.height / box.height : 1
  return [(e.clientX - box.left) * fx, (e.clientY - box.top) * fy]
}

export function PdfLinkOverlay({
  page,
  links,
  placing,
  interactive,
  labelOf,
  onPlaced,
  onOpenLink,
}: {
  readonly page: PdfFeaturePage
  readonly links: readonly PdfPendingLink[]
  readonly placing: boolean
  /** Pending boxes answer a tap (edit mode, not placing). */
  readonly interactive: boolean
  readonly labelOf: (link: PdfPendingLink) => string
  readonly onPlaced: (pageIndex: number, rect: Rect) => void
  readonly onOpenLink: (link: PdfPendingLink) => void
}) {
  const startRef = useRef<{ id: number; at: Point } | null>(null)
  const [live, setLive] = useState<{ from: Point; to: Point } | null>(null)

  if (!placing && links.length === 0) return null

  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (!placing || startRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const at = localPoint(e, page)
    startRef.current = { id: e.pointerId, at }
    setLive({ from: at, to: at })
  }
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start || start.id !== e.pointerId) return
    setLive({ from: start.at, to: localPoint(e, page) })
  }
  const onUp = (e: PointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start || start.id !== e.pointerId) return
    startRef.current = null
    setLive(null)
    const rect = dragToPdfRect(page.geom, page.scale, start.at, localPoint(e, page))
    if (rect) onPlaced(page.pageIndex, rect)
  }
  const onCancel = () => {
    startRef.current = null
    setLive(null)
  }

  return (
    <div
      className="m-pdf-link-edit-layer"
      data-placing={placing}
      data-testid={`pdf-link-layer-${page.pageIndex}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          className="m-pdf-link-pending"
          style={pdfRectToCss(page.geom, link.input.rect, page.scale)}
          data-interactive={interactive}
          tabIndex={interactive ? 0 : -1}
          aria-label={labelOf(link)}
          onClick={() => {
            if (interactive) onOpenLink(link)
          }}
          data-testid="pdf-link-pending"
        />
      ))}
      {live && (
        <div
          className="m-pdf-link-live"
          style={{
            left: Math.min(live.from[0], live.to[0]),
            top: Math.min(live.from[1], live.to[1]),
            width: Math.abs(live.to[0] - live.from[0]),
            height: Math.abs(live.to[1] - live.from[1]),
          }}
          data-testid="pdf-link-live"
        />
      )}
    </div>
  )
}
