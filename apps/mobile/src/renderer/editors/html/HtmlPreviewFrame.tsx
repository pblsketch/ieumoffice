import { useCallback, useEffect, useRef, useState } from 'react'
import { PREVIEW_SANDBOX, SID_ATTR } from './htmlPreview'

/**
 * The parent's guards on the frame document: a link press never moves the frame (v1: links are
 * not followed), and forms cannot submit (the sandbox does not grant form submission; the submit
 * is stopped here as well). `onElementPress` gets the element id under a press (element editing
 * hooks in here).
 * Returns the function that removes the guards.
 */
export function attachFrameGuards(
  frameDocument: Document,
  onElementPress?: (sid: number | null) => void,
): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target
    const element =
      target && (target as Node).nodeType === 1
        ? (target as Element)
        : ((target as Node | null)?.parentElement ?? null)
    if (element?.closest('a[href], area[href]')) event.preventDefault()
    if (onElementPress) {
      const owner = element?.closest(`[${SID_ATTR}]`)
      const sid = owner ? Number(owner.getAttribute(SID_ATTR)) : NaN
      onElementPress(Number.isFinite(sid) ? sid : null)
    }
  }
  const onSubmit = (event: Event) => event.preventDefault()
  frameDocument.addEventListener('click', onClick, true)
  frameDocument.addEventListener('submit', onSubmit, true)
  return () => {
    frameDocument.removeEventListener('click', onClick, true)
    frameDocument.removeEventListener('submit', onSubmit, true)
  }
}

/** Where the selection box goes, in the overlay layer's coordinates (px). */
export interface SelectionBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The box of the element `sid` in the frame, measured from outside: the element's rectangle in
 * the frame's viewport plus where the frame sits in `layer`. Only reads the frame document.
 */
export function measureSelection(
  frame: HTMLIFrameElement,
  layer: HTMLElement,
  sid: number,
): SelectionBox | null {
  const frameDocument = frame.contentDocument
  if (!frameDocument || !Number.isInteger(sid)) return null
  const element = frameDocument.querySelector(`[${SID_ATTR}="${sid}"]`)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const frameRect = frame.getBoundingClientRect()
  const layerRect = layer.getBoundingClientRect()
  return {
    left: rect.left + frameRect.left + frame.clientLeft - layerRect.left,
    top: rect.top + frameRect.top + frame.clientTop - layerRect.top,
    width: rect.width,
    height: rect.height,
  }
}

function sameBox(a: SelectionBox | null, b: SelectionBox | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

interface HiddenBox extends SelectionBox {
  readonly sid: number
}

function sameBoxes(a: readonly HiddenBox[], b: readonly HiddenBox[]): boolean {
  return a.length === b.length && a.every((box, i) => box.sid === b[i]!.sid && sameBox(box, b[i]!))
}

const NO_SIDS: readonly number[] = []

export interface HtmlPreviewFrameProps {
  /** The preview copy (CSP and element ids), never the saved text. */
  readonly srcDoc: string
  readonly title: string
  readonly onElementPress?: (sid: number | null) => void
  /** The selected element (edit mode): drawn as a box over the frame, not inside it. */
  readonly selectedSid?: number | null
  /** The elements hidden from the AI (spec 5.6): marked in the same layer, never in the frame. */
  readonly hiddenSids?: readonly number[]
}

/**
 * The document in a frame that cannot run scripts (spec 5.2). Fits the screen width. The
 * selection (spec 5.3) is a box in a layer above the frame that follows the frame's scrolling
 * and size; the frame document itself is never changed for it.
 */
export function HtmlPreviewFrame({
  srcDoc,
  title,
  onElementPress,
  selectedSid = null,
  hiddenSids = NO_SIDS,
}: HtmlPreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const onElementPressRef = useRef(onElementPress)
  onElementPressRef.current = onElementPress
  const selectedSidRef = useRef(selectedSid)
  selectedSidRef.current = selectedSid
  const hiddenSidsRef = useRef(hiddenSids)
  hiddenSidsRef.current = hiddenSids
  const [box, setBox] = useState<SelectionBox | null>(null)
  const [hiddenBoxes, setHiddenBoxes] = useState<readonly HiddenBox[]>([])

  const measure = useCallback(() => {
    const sid = selectedSidRef.current
    const frame = frameRef.current
    const layer = layerRef.current
    const next = sid !== null && frame && layer ? measureSelection(frame, layer, sid) : null
    setBox((prev) => (sameBox(prev, next) ? prev : next))
    const hidden: HiddenBox[] = []
    if (frame && layer) {
      for (const hiddenSid of hiddenSidsRef.current) {
        const measured = measureSelection(frame, layer, hiddenSid)
        if (measured) hidden.push({ ...measured, sid: hiddenSid })
      }
    }
    setHiddenBoxes((prev) => (sameBoxes(prev, hidden) ? prev : hidden))
  }, [])

  const onLoad = useCallback(() => {
    detachRef.current?.()
    detachRef.current = null
    const frame = frameRef.current
    const frameDocument = frame?.contentDocument
    if (!frameDocument) {
      measure()
      return
    }
    const detachGuards = attachFrameGuards(frameDocument, (sid) => onElementPressRef.current?.(sid))
    // scrolling of the page or of any box in it, and the frame's own size, move the element
    const frameWindow = frameDocument.defaultView
    frameDocument.addEventListener('scroll', measure, true)
    frameWindow?.addEventListener('resize', measure)
    detachRef.current = () => {
      detachGuards()
      frameDocument.removeEventListener('scroll', measure, true)
      frameWindow?.removeEventListener('resize', measure)
    }
    measure()
  }, [measure])

  useEffect(measure, [selectedSid, hiddenSids, measure])

  // the app's own layout (rotation, keyboard, tablet panes) moves or resizes the frame
  useEffect(() => {
    const frame = frameRef.current
    window.addEventListener('resize', measure)
    const observer =
      typeof ResizeObserver === 'undefined' || !frame ? null : new ResizeObserver(() => measure())
    if (observer && frame) observer.observe(frame)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [measure])

  useEffect(
    () => () => {
      detachRef.current?.()
      detachRef.current = null
    },
    [],
  )

  return (
    <div className="web-html-stage">
      <iframe
        ref={frameRef}
        className="web-html-frame"
        title={title}
        sandbox={PREVIEW_SANDBOX}
        srcDoc={srcDoc}
        onLoad={onLoad}
        data-testid="web-html-preview"
      />
      <div ref={layerRef} className="web-html-overlay" aria-hidden="true">
        {hiddenBoxes.map((hidden) => (
          <div
            key={hidden.sid}
            className="web-html-hidden"
            data-testid="web-html-hidden"
            data-sid={hidden.sid}
            style={{
              transform: `translate(${hidden.left}px, ${hidden.top}px)`,
              width: `${hidden.width}px`,
              height: `${hidden.height}px`,
            }}
          />
        ))}
        {selectedSid !== null && box && (
          <div
            className="web-html-selection"
            data-testid="web-html-selection"
            data-sid={selectedSid}
            style={{
              transform: `translate(${box.left}px, ${box.top}px)`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
          />
        )}
      </div>
    </div>
  )
}
