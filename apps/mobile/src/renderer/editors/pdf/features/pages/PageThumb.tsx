// One page thumbnail of the organizer sheet: drawn only while it is on screen (or
// close to it) and released once it scrolls away, so a long document holds a few
// small bitmaps at a time (spec 3.9, 5: visible range only, no page cap).
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

/** CSS width the thumbnail bitmap is drawn for; the tile scales it to fit. */
const THUMB_CSS_WIDTH = 120

/** Whether the element is on screen or within a screen's margin of it. */
function useNearScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setNear(entry.isIntersecting)
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return near
}

export function PageThumb({
  doc,
  pageNo,
  rotationDelta,
}: {
  readonly doc: PDFDocumentProxy
  /** 1-based page of `doc`; null for a pending blank page (plain paper). */
  readonly pageNo: number | null
  readonly rotationDelta: number
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const near = useNearScreen(holderRef)
  const draw = near && pageNo !== null

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    if (!draw || pageNo === null) {
      holder.replaceChildren()
      return
    }
    let cancelled = false
    let task: RenderTask | null = null
    let canvas: HTMLCanvasElement | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageNo)
        if (cancelled) return
        const rotation = (((page.rotate + rotationDelta) % 360) + 360) % 360
        const base = page.getViewport({ scale: 1, rotation })
        const viewport = page.getViewport({ scale: THUMB_CSS_WIDTH / base.width, rotation })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
        task = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        })
        await task.promise
        if (!cancelled) holder.replaceChildren(canvas)
      } catch {
        // a page PDF.js cannot draw stays plain paper
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      // give the bitmap memory back at once (web views keep canvas backing stores)
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [doc, pageNo, rotationDelta, draw])

  return <div ref={holderRef} className="m-pdf-pages-thumb-bitmap" data-drawn={draw} />
}
