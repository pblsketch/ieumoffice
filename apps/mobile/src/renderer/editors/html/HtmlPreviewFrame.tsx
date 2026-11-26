import { useCallback, useEffect, useRef } from 'react'
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

export interface HtmlPreviewFrameProps {
  /** The preview copy (CSP and element ids), never the saved text. */
  readonly srcDoc: string
  readonly title: string
  readonly onElementPress?: (sid: number | null) => void
}

/** The document in a frame that cannot run scripts (spec 5.2). Fits the screen width. */
export function HtmlPreviewFrame({ srcDoc, title, onElementPress }: HtmlPreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const onElementPressRef = useRef(onElementPress)
  onElementPressRef.current = onElementPress

  const onLoad = useCallback(() => {
    detachRef.current?.()
    detachRef.current = null
    const frameDocument = frameRef.current?.contentDocument
    if (!frameDocument) return
    detachRef.current = attachFrameGuards(frameDocument, (sid) => onElementPressRef.current?.(sid))
  }, [])

  useEffect(
    () => () => {
      detachRef.current?.()
      detachRef.current = null
    },
    [],
  )

  return (
    <iframe
      ref={frameRef}
      className="web-html-frame"
      title={title}
      sandbox={PREVIEW_SANDBOX}
      srcDoc={srcDoc}
      onLoad={onLoad}
      data-testid="web-html-preview"
    />
  )
}
