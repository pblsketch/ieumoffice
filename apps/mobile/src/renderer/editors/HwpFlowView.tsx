import { useEffect, useMemo, useRef, useState } from 'react'
import { buildFlowDocument, buildFlowHtml } from './hwpFlow'
import type { FlowEngineDocument } from './rhwpEngine'

export interface HwpFlowViewProps {
  readonly bytes: Uint8Array | null
  readonly title: string
  readonly lang: string
  /** Text scale; document sizes are in pt, so the whole frame is zoomed. */
  readonly zoom: number
  /** Opens bytes with the rhwp engine; injectable for tests. */
  readonly openDocument: (bytes: Uint8Array) => Promise<FlowEngineDocument>
  /** Called when the engine cannot build a flow (the caller falls back to the page view). */
  readonly onUnavailable?: (message: string) => void
}

/**
 * Reading view that reflows an HWP document to the screen width. The HTML
 * comes from the document, so it is shown in a frame that may not run scripts.
 */
export function HwpFlowView({
  bytes,
  title,
  lang,
  zoom,
  openDocument,
  onUnavailable,
}: HwpFlowViewProps) {
  const [body, setBody] = useState<string | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    if (!bytes || bytes.byteLength === 0) {
      setBody('')
      return
    }
    let cancelled = false
    setBody(null)
    void (async () => {
      let doc: FlowEngineDocument | null = null
      try {
        doc = await openDocument(bytes)
        const html = buildFlowHtml(doc)
        if (!cancelled) setBody(html)
      } catch (err) {
        if (!cancelled) onUnavailable?.(err instanceof Error ? err.message : String(err))
      } finally {
        doc?.free()
      }
    })()
    return () => {
      cancelled = true
    }
    // onUnavailable is a notification only; rebuilding on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, openDocument])

  // The frame is rebuilt only when the document changes; zoom is applied in place
  // so the reading position stays put.
  const srcDoc = useMemo(
    () => (body === null ? '' : buildFlowDocument(body, zoomRef.current, lang)),
    [body, lang],
  )
  const applyZoom = () => {
    frameRef.current?.contentDocument?.documentElement.style.setProperty(
      '--flow-zoom',
      String(zoomRef.current),
    )
  }
  useEffect(applyZoom, [zoom])

  return (
    <div className="mobile-hwp-flow" data-editor="hwp-flow" data-testid="hwp-flow-view">
      {body === null ? (
        <div className="mobile-hwp-loading" aria-live="polite">
          <div className="mobile-spinner" aria-hidden="true" />
        </div>
      ) : (
        <iframe
          className="mobile-hwp-flow-frame"
          title={title}
          ref={frameRef}
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          onLoad={applyZoom}
        />
      )}
    </div>
  )
}
