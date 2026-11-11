import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { AnnotationMode, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderViewBitmap, type ViewRenderTask } from './view-bitmap'
import { pdfRectToCss, quadToRect } from './annotations'
import type { LocalMarkup, PageGeom } from './annotations'
import { MAX_PAGE_RENDER_PIXELS } from './view-config'
import { releaseCanvasPixels, retainPageResources } from './page-resources'
import { fileViewRenderer } from './view-renderer'
import { renderViewportTiles } from './view-tiles'
import { pageRasterCache } from './page-raster-cache'
const rasterOwners = new WeakMap<HTMLCanvasElement, object>()

/** Which items in the container are within the (expanded) viewport — shared lazy-render basis
    for pages/thumbnails. Rebuild the observer when enabled flips (sidebar toggles unmount/remount the root) */
export function useVisibleSet(
  rootRef: RefObject<HTMLElement | null>,
  count: number,
  rootMargin: string,
  enabled = true,
): { visible: Set<number>; setItemRef: (idx: number) => (el: HTMLElement | null) => void } {
  const [visible, setVisible] = useState<Set<number>>(new Set())
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    const root = rootRef.current
    if (!enabled || !root || count === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const idx = Number((e.target as HTMLElement).dataset.idx)
            if (e.isIntersecting) next.add(idx)
            else next.delete(idx)
          }
          return next
        })
      },
      { root, rootMargin },
    )
    for (const el of itemRefs.current) if (el) io.observe(el)
    return () => io.disconnect()
  }, [rootRef, count, rootMargin, enabled])
  return {
    visible,
    setItemRef: (idx) => (el) => {
      itemRefs.current[idx] = el
    },
  }
}

/** Single page: renders canvas + text layer (select/copy) when visible, released once off-viewport */
export function PdfPage({
  doc,
  pageNo,
  scale,
  rotationDelta,
  visible,
  onRenderState,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  scale: number
  /** Unsaved rotation delta (clockwise degrees) */
  rotationDelta: number
  visible: boolean
  onRenderState: (doc: PDFDocumentProxy, pageNo: number, pending: boolean) => void
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    // Offscreen pages still release their bitmap. For an in-place rerender (save
    // reload, zoom, rotation), keep the previous canvas visible until its replacement
    // is fully rendered so the page never flashes white between document instances.
    if (!visible) {
      const source = fileViewRenderer(doc)?.source.id
      for (const canvas of holder.querySelectorAll('canvas')) {
        if (source && canvas.dataset.pdfRasterSource === source && canvas.dataset.pdfRasterKey)
          pageRasterCache.put(doc, canvas.dataset.pdfRasterKey, canvas)
        else releaseCanvasPixels(canvas)
      }
      holder.replaceChildren()
      // A page captured by the post-save barrier may scroll out before its replacement
      // renders. Its overlays are no longer mounted, so treat the cleared offscreen page
      // as settled instead of making the whole document wait for the timeout.
      onRenderState(doc, pageNo, false)
      return
    }
    // Visibility may change while a save reload is running. Register newly visible
    // pages dynamically so global preview cleanup cannot outrun their bitmap swap.
    onRenderState(doc, pageNo, true)
    let cancelled = false
    let renderTask: ViewRenderTask | null = null
    let textLayer: TextLayer | null = null
    let canvas: HTMLCanvasElement | null = null
    let surface: HTMLElement | null = null
    const rasterOwner = {}
    const resources = retainPageResources(doc, pageNo)
    const rendering = (async () => {
      const page = await resources.page
      if (cancelled) return
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotationDelta) % 360 })
      // Cap at 2x: on hi-dpi screens a 3x-dpr full-page bitmap doubles memory with no visible gain.
      // Deep zoom trades dpr for the pixel budget instead — the page is already magnified.
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(MAX_PAGE_RENDER_PIXELS / (viewport.width * viewport.height)),
      )
      if (fileViewRenderer(doc) && viewport.width * viewport.height * dpr * dpr > 4_000_000) {
        surface = document.createElement('div')
        surface.dataset.pdfTileSurface = 'true'
        surface.style.position = 'absolute'
        surface.style.inset = '0'
        renderTask = renderViewportTiles(
          doc,
          page,
          pageNo,
          viewport,
          dpr,
          rotationDelta,
          holder,
          surface,
        )
      } else {
        const source = fileViewRenderer(doc)?.source.id
        const key = `${pageNo}:${scale}:${rotationDelta}:${page.rotate}:${dpr}`
        const cached = source ? pageRasterCache.take(doc, key) : undefined
        canvas = cached ?? document.createElement('canvas')
        rasterOwners.set(canvas, rasterOwner)
        surface = canvas
        if (source) {
          canvas.dataset.pdfRasterSource = source
          canvas.dataset.pdfRasterKey = key
        }
        if (cached) renderTask = { promise: Promise.resolve(), cancel() {} }
        else {
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          renderTask = renderViewBitmap(
            doc,
            page,
            pageNo,
            {
              canvas,
              viewport,
              // FormLayer renders interactive widgets as HTML. Exclude their saved appearance
              // streams from the page bitmap or filled values are drawn twice after a reload.
              annotationMode: AnnotationMode.ENABLE_FORMS,
              transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
            },
            rotationDelta,
          )
        }
      }
      try {
        await renderTask.promise
      } catch {
        return // cancelled
      }
      if (cancelled) return
      const textDiv = document.createElement('div')
      textDiv.className = 'textLayer'
      for (const old of holder.querySelectorAll('canvas')) releaseCanvasPixels(old)
      holder.replaceChildren(surface, textDiv)
      // Notify after the bitmap swap, but before the browser paints. A post-save
      // reload uses this to remove the matching edit previews in the same frame.
      onRenderState(doc, pageNo, false)
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      })
      try {
        await textLayer.render()
      } catch {
        /* cancelled */
      }
    })()
      .catch(() => {
        // A destroyed document or a failed page must not leave the save barrier pending.
        if (!cancelled) onRenderState(doc, pageNo, false)
      })
      // The canvas and text DOM are self-contained once rendering finishes.
      // Do not retain full-resolution source images merely because a tiny
      // thumbnail or a completed page remains visible.
      .finally(() => resources.release())
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      // Do not resize a canvas while PDF.js still owns its render context. Keep a
      // completed displayed bitmap through zoom/save until its replacement swaps in.
      void rendering.finally(() => {
        if (
          canvas &&
          rasterOwners.get(canvas) === rasterOwner &&
          !holder.contains(canvas) &&
          !pageRasterCache.holds(canvas)
        )
          releaseCanvasPixels(canvas)
        for (const tile of surface?.querySelectorAll('canvas') ?? [])
          if (!holder.contains(tile)) releaseCanvasPixels(tile)
      })
    }
  }, [doc, pageNo, scale, rotationDelta, visible, onRenderState])
  useEffect(() => {
    const holder = holderRef.current
    return () => {
      for (const canvas of holder?.querySelectorAll('canvas') ?? []) releaseCanvasPixels(canvas)
    }
  }, [])
  return <div ref={holderRef} className="pdf-page-content" />
}

/** Overlay for unsaved markups. Purely visual (pointer-events: none) so the text
 *  underneath stays selectable; clicking is handled by the page-level hit test. */
export function MarkupOverlay({
  markups,
  geom,
  scale,
  selectedId,
}: {
  markups: LocalMarkup[]
  geom: PageGeom
  scale: number
  selectedId: string | null
}) {
  return (
    <>
      {markups.flatMap((m) =>
        m.quads.map((q, i) => {
          const [r, g, b] = m.color
          const style: CSSProperties = pdfRectToCss(geom, quadToRect(q), scale)
          if (m.type === 'highlight') {
            style.background = `rgba(${r * 255}, ${g * 255}, ${b * 255}, 0.4)`
          } else if (m.type === 'squiggly') {
            // Wavy line pinned to the quad's bottom edge; the stretched viewBox keeps
            // the wave periodic at any quad width while non-scaling-stroke keeps the
            // stroke 2px at any zoom (matches the saved annotation's appearance)
            const bar = `rgb(${r * 255}, ${g * 255}, ${b * 255})`
            const points = Array.from({ length: 21 }, (_, k) => {
              const y = k % 2 === 0 ? 3 : k % 4 === 1 ? 0.7 : 5.3
              return `${k * 5},${y}`
            }).join(' ')
            return (
              <div
                key={`${m.id}-${i}`}
                className={`pdf-markup pdf-markup-squiggly${m.id === selectedId ? ' pdf-markup-selected' : ''}`}
                style={style}
              >
                <svg
                  width="100%"
                  height="6"
                  viewBox="0 0 100 6"
                  preserveAspectRatio="none"
                  style={{ position: 'absolute', bottom: 0, left: 0, overflow: 'visible' }}
                  aria-hidden
                >
                  <polyline
                    points={points}
                    fill="none"
                    stroke={bar}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            )
          } else {
            const bar = `rgb(${r * 255}, ${g * 255}, ${b * 255})`
            if (m.type === 'underline') style.borderBottom = `2px solid ${bar}`
            else style.backgroundImage = `linear-gradient(${bar}, ${bar})`
          }
          return (
            <div
              key={`${m.id}-${i}`}
              className={`pdf-markup pdf-markup-${m.type}${m.id === selectedId ? ' pdf-markup-selected' : ''}`}
              style={style}
            />
          )
        }),
      )}
    </>
  )
}
