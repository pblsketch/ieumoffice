// One page bitmap plus its text layer, with the PC PdfPage.tsx rules: draw while the
// page is in the render window, release the bitmap once it leaves, and keep the old
// bitmap on screen until a re-render (zoom) has finished so the page never flashes.
import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { AnnotationMode, TextLayer } from './pdfjs'

/**
 * Pixel budget of one page bitmap. iOS web views refuse canvases above ~16.7M
 * pixels (they draw blank), so deep zoom trades device pixels for this budget,
 * as the PC editor does with its larger one. It limits resolution, not pages.
 */
export const MOBILE_MAX_PAGE_RENDER_PIXELS = 16_000_000

/** Device pixel ratio for a page bitmap: at most 2x, and within the pixel budget. */
export function pageRenderDpr(width: number, height: number, devicePixelRatio: number): number {
  return Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(MOBILE_MAX_PAGE_RENDER_PIXELS / Math.max(1, width * height)),
  )
}

export interface PdfPageCanvasProps {
  readonly doc: PDFDocumentProxy
  /** 1-based. */
  readonly pageNo: number
  readonly scale: number
  /** Unsaved rotation (clockwise degrees) on top of the page's own /Rotate. */
  readonly rotationDelta?: number
  /** In the render window: draw; out of it: release the bitmap. */
  readonly rendered: boolean
  /**
   * Which annotations PDF.js paints into the bitmap. Viewing paints form fields'
   * appearances (no form layer yet); a task that adds an HTML form layer switches to
   * `AnnotationMode.ENABLE_FORMS` like the PC editor, or values are drawn twice.
   */
  readonly annotationMode?: number
}

/** Zero a canvas's backing store: iOS WebKit frees canvas memory only on GC otherwise. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

function releaseCanvases(holder: HTMLElement): void {
  for (const canvas of holder.querySelectorAll('canvas')) releaseCanvas(canvas)
}

export function PdfPageCanvas({
  doc,
  pageNo,
  scale,
  rotationDelta = 0,
  rendered,
  annotationMode = AnnotationMode.ENABLE,
}: PdfPageCanvasProps) {
  const holderRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    if (!rendered) {
      releaseCanvases(holder)
      holder.replaceChildren()
      return
    }
    let cancelled = false
    let renderTask: RenderTask | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageNo)
        if (cancelled) return
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotationDelta) % 360 })
        const dpr = pageRenderDpr(viewport.width, viewport.height, window.devicePixelRatio)
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        renderTask = page.render({
          canvas,
          viewport,
          annotationMode,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        })
        try {
          await renderTask.promise
        } catch {
          releaseCanvas(canvas)
          return // cancelled
        }
        if (cancelled) {
          releaseCanvas(canvas)
          return
        }
        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        releaseCanvases(holder)
        holder.replaceChildren(canvas, textDiv)
        // the text layer lets a long press select and copy the page's text
        const textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport,
        })
        await textLayer.render().catch(() => {})
      } catch {
        // a page PDF.js cannot draw stays blank; the probe already reported it
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, pageNo, scale, rotationDelta, rendered, annotationMode])
  return <div ref={holderRef} className="m-pdf-page-content" data-rendered={rendered} />
}
