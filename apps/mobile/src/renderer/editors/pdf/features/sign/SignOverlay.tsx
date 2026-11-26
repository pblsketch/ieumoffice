// Signatures on one page (spec 3.6): pending image stamps drawn where they will be
// saved; tap one to select it, then drag to move, drag the corner to resize (aspect
// kept, PC DrawLayer rules) or delete it. While a new signature waits, a tap on the
// page drops it there. A plain tap on the page never starts a drag, so scrolling the
// document over unselected stamps keeps working.
//
// The drop answers the tap's pointerup, not its click: right after the signature sheet
// closes, a web view may deliver the first tap's pointerdown/pointerup without a click.
// A finger that moves further than a tap is a scroll (the browser then cancels the
// pointer), so scrolling over the page keeps working while a signature waits.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pdfRectToCss } from '../../../../../../../pdf/src/renderer/annotations'
import type { PdfFeaturePage } from '../../edit/types'
import { IconClose } from '../../../../components/MobileIcons'
import { SvgIcon } from '../../../../components/icons/svgIcon'
import { viewBoxToPdfRect, viewShiftToPdf } from './place'

export interface PlacedSignature {
  readonly id: string
  readonly pageIndex: number
  readonly image: string
  readonly rect: readonly [number, number, number, number]
}

interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface SignOverlayProps {
  readonly page: PdfFeaturePage
  readonly signatures: readonly PlacedSignature[]
  /** Editing, and no other bar tool is on: stamps can be selected and changed. */
  readonly interactive: boolean
  /** A new signature waits for a tap on the page. */
  readonly placing: boolean
  readonly selectedId: string | null
  readonly labels: {
    readonly placed: string
    readonly remove: string
    readonly resize: string
    readonly place: string
  }
  readonly onPlace: (vx: number, vy: number) => void
  readonly onSelect: (id: string) => void
  readonly onMove: (id: string, dx: number, dy: number) => void
  readonly onResize: (id: string, rect: [number, number, number, number]) => void
  readonly onRemove: (id: string) => void
}

/** A drag shorter than this (CSS px) is a tap. */
const TAP_SLOP = 3
/** Finger travel (CSS px) up to which a press on the page still drops the signature. */
export const SIGN_PLACE_SLOP = 10
/** Smallest side a resize may shrink a stamp to (CSS px; PC DrawLayer). */
const MIN_SIDE = 16

function IconResize() {
  return (
    <SvgIcon size={16}>
      <path d="M20 14v6h-6M20 20l-8-8" />
    </SvgIcon>
  )
}

export function SignOverlay({
  page,
  signatures,
  interactive,
  placing,
  selectedId,
  labels,
  onPlace,
  onSelect,
  onMove,
  onResize,
  onRemove,
}: SignOverlayProps) {
  const { geom, scale } = page
  const [drag, setDrag] = useState<{
    id: string
    from: [number, number]
    to: [number, number]
  } | null>(null)
  const [resize, setResize] = useState<{
    id: string
    from: [number, number]
    start: Box
    box: Box
  } | null>(null)
  // the press on the placing catcher, and whether its pointerup already dropped it
  const placePress = useRef<{ id: number; x: number; y: number } | null>(null)
  const placedByPointer = useRef(false)

  const placeAt = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const at = e.currentTarget.getBoundingClientRect()
    onPlace((e.clientX - at.left) / scale, (e.clientY - at.top) / scale)
  }

  const bodyDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!interactive || id !== selectedId) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ id, from: [e.clientX, e.clientY], to: [e.clientX, e.clientY] })
  }
  const bodyMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag) setDrag({ ...drag, to: [e.clientX, e.clientY] })
  }
  const bodyUp = () => {
    const d = drag
    setDrag(null)
    if (!d) return
    const dx = d.to[0] - d.from[0]
    const dy = d.to[1] - d.from[1]
    if (Math.hypot(dx, dy) < TAP_SLOP) return
    const [px, py] = viewShiftToPdf(geom, [0, 0], [dx / scale, dy / scale])
    onMove(d.id, px, py)
  }

  const handleDown = (e: ReactPointerEvent<HTMLElement>, id: string, start: Box) => {
    if (!interactive) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setResize({ id, from: [e.clientX, e.clientY], start, box: start })
  }
  const handleMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!resize) return
    const { start, from } = resize
    const k = Math.max(
      (start.w + e.clientX - from[0]) / start.w,
      (start.h + e.clientY - from[1]) / start.h,
      MIN_SIDE / Math.max(start.w, start.h),
    )
    setResize({ ...resize, box: { x: start.x, y: start.y, w: start.w * k, h: start.h * k } })
  }
  const handleUp = () => {
    const r = resize
    setResize(null)
    if (!r) return
    if (Math.abs(r.box.w - r.start.w) < 2 && Math.abs(r.box.h - r.start.h) < 2) return
    const { x, y, w, h } = r.box
    onResize(
      r.id,
      viewBoxToPdfRect(geom, { x: x / scale, y: y / scale, w: w / scale, h: h / scale }),
    )
  }

  return (
    <div className="m-pdf-sign-layer" data-testid={`pdf-sign-layer-${page.pageIndex}`}>
      {signatures.map((sig) => {
        const css = pdfRectToCss(geom, sig.rect, scale)
        const committed: Box = { x: css.left, y: css.top, w: css.width, h: css.height }
        const box = resize?.id === sig.id ? resize.box : committed
        const shift =
          drag?.id === sig.id ? [drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]] : [0, 0]
        const selected = interactive && selectedId === sig.id
        return (
          <div
            key={sig.id}
            className="m-pdf-sign-box"
            data-pdf-sign-box=""
            data-interactive={interactive}
            data-selected={selected}
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              transform: `translate(${shift[0]}px, ${shift[1]}px)`,
            }}
            data-testid="pdf-sign-placed"
            data-id={sig.id}
          >
            <button
              type="button"
              className="m-pdf-sign-body"
              aria-label={labels.placed}
              aria-pressed={selected}
              tabIndex={interactive ? 0 : -1}
              onClick={() => {
                if (interactive && !selected) onSelect(sig.id)
              }}
              onPointerDown={(e) => bodyDown(e, sig.id)}
              onPointerMove={bodyMove}
              onPointerUp={bodyUp}
              onPointerCancel={() => setDrag(null)}
              data-testid="pdf-sign-body"
            >
              <img src={`data:image/png;base64,${sig.image}`} alt="" draggable={false} />
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  className="m-pdf-sign-handle m-pdf-sign-remove"
                  aria-label={labels.remove}
                  onClick={() => onRemove(sig.id)}
                  data-testid="pdf-sign-remove"
                >
                  <IconClose size={16} />
                </button>
                <span
                  role="button"
                  tabIndex={-1}
                  className="m-pdf-sign-handle m-pdf-sign-resize"
                  aria-label={labels.resize}
                  onPointerDown={(e) => handleDown(e, sig.id, committed)}
                  onPointerMove={handleMove}
                  onPointerUp={handleUp}
                  onPointerCancel={() => setResize(null)}
                  data-testid="pdf-sign-resize"
                >
                  <IconResize />
                </span>
              </>
            )}
          </div>
        )
      })}
      {placing && (
        <div
          className="m-pdf-sign-catch"
          role="button"
          tabIndex={-1}
          aria-label={labels.place}
          onPointerDown={(e) => {
            placedByPointer.current = false
            placePress.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
          }}
          onPointerUp={(e) => {
            const press = placePress.current
            placePress.current = null
            if (!press || press.id !== e.pointerId) return
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SIGN_PLACE_SLOP) return
            placedByPointer.current = true
            placeAt(e)
          }}
          onPointerCancel={() => {
            placePress.current = null
          }}
          onClick={(e) => {
            // the click of a tap its pointerup already answered; a click without a
            // pointer press (assistive technology) still drops it
            if (placedByPointer.current) {
              placedByPointer.current = false
              return
            }
            placeAt(e)
          }}
          data-testid={`pdf-sign-catch-${page.pageIndex}`}
        />
      )}
    </div>
  )
}
