// The document area of the mobile PDF editor: pages stacked top to bottom,
// two-finger zoom, fit to width, and bitmaps only for the visible pages and their
// neighbours. Later tasks mount their per-page layers through `renderPageOverlay`.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { pdfRectToCss, type PageGeom } from '../../../../../../pdf/src/renderer/annotations'
import { clampScale } from '../../../../../../pdf/src/renderer/view-config'
import {
  computePageLayout,
  currentPageAt,
  fitWidthScale,
  inWindow,
  PDF_PAGE_GAP,
  pageLeft,
  renderWindow,
  visiblePageRange,
  type PdfPageLayout,
} from './layout'
import { pdfPageDisplaySize, pdfPageGeom, type PdfOpenedDocument } from './model'
import { PdfLinkLayer } from './PdfLinkLayer'
import { PdfPageCanvas } from './PdfPageCanvas'

/** Zoom and position that outlive the viewer (kept by the document while the settings screen shows). */
export interface PdfViewState {
  /** Fit width follows the viewport (rotation, split screen); a pinch turns it off. */
  readonly fitWidth: boolean
  readonly scale: number
  /** Page at the top of the viewport and how far into it (0..1). */
  readonly anchorPage: number
  readonly anchorFraction: number
}

export const INITIAL_PDF_VIEW_STATE: PdfViewState = {
  fitWidth: true,
  scale: 1,
  anchorPage: 0,
  anchorFraction: 0,
}

/** One page as an overlay sees it. */
export interface PdfPageOverlayContext {
  /** 0-based original page index. */
  readonly pageIndex: number
  readonly geom: PageGeom
  readonly scale: number
  /** Page box size in CSS px. */
  readonly width: number
  readonly height: number
  /** The page is in the render window (its bitmap is drawn). */
  readonly rendered: boolean
}

type PdfRect = readonly [number, number, number, number]

/** Search hits of one page in PDF user space; the active hit's rects are drawn stronger. */
export interface PdfPageHits {
  readonly rects: readonly PdfRect[]
  readonly activeRects: readonly PdfRect[]
}

export interface PdfViewerHandle {
  scrollToPage(pageIndex: number): void
  /** Brings a PDF user-space rect of a page into view (a third from the top). */
  scrollToPageRect(pageIndex: number, rect: PdfRect): void
  fitToWidth(): void
  getScale(): number
  getCurrentPage(): number
  /** Pages drawn right now (the render window), null before the first layout. */
  getRenderWindow(): { first: number; last: number } | null
}

export interface PdfViewerProps {
  readonly model: PdfOpenedDocument
  readonly initialView: PdfViewState
  readonly onViewChange: (view: PdfViewState) => void
  readonly onCurrentPageChange?: (pageIndex: number) => void
  readonly onGoToDest: (dest: unknown) => void
  readonly onOpenExternalUrl?: (url: string) => void
  readonly hits?: ReadonlyMap<number, PdfPageHits>
  /** Unsaved rotations (clockwise degrees) by page; none while viewing. */
  readonly rotationDeltas?: ReadonlyMap<number, number>
  readonly annotationMode?: number
  readonly renderPageOverlay?: (ctx: PdfPageOverlayContext) => ReactNode
  readonly labels: {
    readonly page: (pageNo: number) => string
    readonly brokenPage: string
    readonly internalLink: string
  }
}

interface PinchState {
  startDistance: number
  startScale: number
  ratio: number
  /** Midpoint in viewport coordinates. */
  clientX: number
  clientY: number
  /** Midpoint in content coordinates (transform origin). */
  contentX: number
  contentY: number
  anchor: { page: number; fx: number; fy: number }
}

/** Where a viewport point lands: page and fractions inside it. */
function anchorAt(
  layout: PdfPageLayout,
  contentX: number,
  contentY: number,
): { page: number; fx: number; fy: number } {
  const range = visiblePageRange(layout, contentY, 1)
  const page = range ? range.first : 0
  const top = layout.tops[page] ?? 0
  const h = layout.heights[page] || 1
  const w = layout.widths[page] || 1
  return {
    page,
    fx: (contentX - pageLeft(layout, page)) / w,
    fy: (contentY - top) / h,
  }
}

function touchDistance(touches: TouchList): number {
  const a = touches[0]!
  const b = touches[1]!
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  {
    model,
    initialView,
    onViewChange,
    onCurrentPageChange,
    onGoToDest,
    onOpenExternalUrl,
    hits,
    rotationDeltas,
    annotationMode,
    renderPageOverlay,
    labels,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [fitWidth, setFitWidth] = useState(initialView.fitWidth)
  const [manualScale, setManualScale] = useState(initialView.scale)
  const [scrollTop, setScrollTop] = useState(0)
  /** Scroll target applied after the next layout (keeps a page point in place across zoom). */
  const pendingAnchorRef = useRef<{
    page: number
    fx: number
    fy: number
    clientX: number
    clientY: number
  } | null>({
    page: initialView.anchorPage,
    fx: 0,
    fy: initialView.anchorFraction,
    clientX: 0,
    clientY: 0,
  })
  const pinchRef = useRef<PinchState | null>(null)

  const sizes = useMemo(
    () => model.pages.map((_, i) => pdfPageDisplaySize(model, i, rotationDeltas?.get(i) ?? 0)),
    [model, rotationDeltas],
  )
  const scale = fitWidth && viewport.width > 0 ? fitWidthScale(sizes, viewport.width) : manualScale
  const layout = useMemo(
    () => computePageLayout(sizes, scale, viewport.width),
    [sizes, scale, viewport.width],
  )
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  const visible = visiblePageRange(layout, scrollTop, viewport.height || 1)
  const win = renderWindow(visible, sizes.length)
  const currentPage = currentPageAt(layout, scrollTop, viewport.height)

  // viewport size: measured now and whenever the stage changes (rotation, split screen)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () =>
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      )
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // a pending anchor lands once the new layout is in the DOM
  useLayoutEffect(() => {
    const el = scrollRef.current
    const anchor = pendingAnchorRef.current
    if (!el || !anchor || viewport.width === 0 || layout.tops.length === 0) return
    pendingAnchorRef.current = null
    const page = Math.min(Math.max(anchor.page, 0), layout.tops.length - 1)
    const top = layout.tops[page]! + anchor.fy * layout.heights[page]! - anchor.clientY
    const left = pageLeft(layout, page) + anchor.fx * layout.widths[page]! - anchor.clientX
    el.scrollTop = Math.max(0, top)
    el.scrollLeft = Math.max(0, left)
    setScrollTop(el.scrollTop)
  }, [layout, viewport.width])

  // what outlives the viewer: zoom and the page at the top
  useEffect(() => {
    const top = anchorAt(layout, 0, scrollTop)
    onViewChange({
      fitWidth,
      scale,
      anchorPage: top.page,
      anchorFraction: Math.min(Math.max(top.fy, 0), 1),
    })
  }, [fitWidth, scale, scrollTop, layout, onViewChange])

  useEffect(() => {
    onCurrentPageChange?.(currentPage)
  }, [currentPage, onCurrentPageChange])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) setScrollTop(el.scrollTop)
  }, [])

  /** Keeps the page point at the viewport top in place while the scale changes. */
  const anchorTop = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const a = anchorAt(layoutRef.current, el.scrollLeft, el.scrollTop)
    pendingAnchorRef.current = { ...a, clientX: 0, clientY: 0 }
  }, [])

  // two-finger zoom: scale the page column with a transform while the fingers move
  // (cheap), then commit the new scale and re-render; the point under the fingers stays put
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      const rect = el.getBoundingClientRect()
      const clientX = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - rect.left
      const clientY = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - rect.top
      const contentX = el.scrollLeft + clientX
      const contentY = el.scrollTop + clientY
      pinchRef.current = {
        startDistance: Math.max(1, touchDistance(e.touches)),
        startScale: scaleRef.current,
        ratio: 1,
        clientX,
        clientY,
        contentX,
        contentY,
        anchor: anchorAt(layoutRef.current, contentX, contentY),
      }
    }
    const onMove = (e: TouchEvent) => {
      const pinch = pinchRef.current
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const target = clampScale((pinch.startScale * touchDistance(e.touches)) / pinch.startDistance)
      pinch.ratio = target / pinch.startScale
      const pages = pagesRef.current
      if (pages) {
        pages.style.transformOrigin = `${pinch.contentX}px ${pinch.contentY}px`
        pages.style.transform = `scale(${pinch.ratio})`
      }
    }
    const onEnd = (e: TouchEvent) => {
      const pinch = pinchRef.current
      if (!pinch || e.touches.length >= 2) return
      pinchRef.current = null
      const pages = pagesRef.current
      if (pages) {
        pages.style.transform = ''
        pages.style.transformOrigin = ''
      }
      if (pinch.ratio === 1) return
      pendingAnchorRef.current = {
        ...pinch.anchor,
        clientX: pinch.clientX,
        clientY: pinch.clientY,
      }
      setFitWidth(false)
      setManualScale(clampScale(pinch.startScale * pinch.ratio))
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  const scrollToPage = useCallback((pageIndex: number) => {
    const el = scrollRef.current
    const l = layoutRef.current
    if (!el || l.tops.length === 0) return
    const page = Math.min(Math.max(pageIndex, 0), l.tops.length - 1)
    el.scrollTop = Math.max(0, l.tops[page]! - PDF_PAGE_GAP)
    setScrollTop(el.scrollTop)
  }, [])

  useImperativeHandle(
    ref,
    (): PdfViewerHandle => ({
      scrollToPage,
      scrollToPageRect(pageIndex, rect) {
        const el = scrollRef.current
        const l = layoutRef.current
        if (!el || pageIndex < 0 || pageIndex >= l.tops.length) return
        const geom = pdfPageGeom(model, pageIndex, rotationDeltas?.get(pageIndex) ?? 0)
        const box = pdfRectToCss(geom, rect, l.scale)
        el.scrollTop = Math.max(0, l.tops[pageIndex]! + box.top - el.clientHeight / 3)
        const left = pageLeft(l, pageIndex) + box.left
        if (left < el.scrollLeft || left + box.width > el.scrollLeft + el.clientWidth) {
          el.scrollLeft = Math.max(0, left - el.clientWidth / 4)
        }
        setScrollTop(el.scrollTop)
      },
      fitToWidth() {
        anchorTop()
        setFitWidth(true)
      },
      getScale: () => scaleRef.current,
      getCurrentPage: () => currentPageAt(layoutRef.current, scrollTop, viewport.height),
      getRenderWindow: () => win,
    }),
    [anchorTop, model, rotationDeltas, scrollToPage, scrollTop, viewport.height, win],
  )

  return (
    <div ref={scrollRef} className="m-pdf-scroll" onScroll={onScroll} data-testid="pdf-scroll">
      <div
        ref={pagesRef}
        className="m-pdf-pages"
        style={{ width: layout.contentWidth, height: layout.contentHeight }}
      >
        {sizes.map((_, i) => {
          const rendered = inWindow(win, i)
          const rotation = rotationDeltas?.get(i) ?? 0
          const geom = pdfPageGeom(model, i, rotation)
          const width = layout.widths[i]!
          const height = layout.heights[i]!
          const pageHits = rendered ? hits?.get(i) : undefined
          const style = {
            top: layout.tops[i],
            left: pageLeft(layout, i),
            width,
            height,
            // PDF.js sizes the text layer from this variable
            '--scale-factor': scale,
          } as CSSProperties
          return (
            <div
              key={i}
              className="m-pdf-page"
              style={style}
              data-page={i}
              data-rendered={rendered}
              role="group"
              aria-label={labels.page(i + 1)}
            >
              {model.failedPages.has(i + 1) ? (
                <div className="m-pdf-page-broken">{labels.brokenPage}</div>
              ) : (
                <PdfPageCanvas
                  doc={model.proxy}
                  pageNo={i + 1}
                  scale={scale}
                  rotationDelta={rotation}
                  rendered={rendered}
                  annotationMode={annotationMode}
                />
              )}
              {pageHits?.rects.map((rect, k) => (
                <div
                  key={`h${k}`}
                  className="m-pdf-hit"
                  style={pdfRectToCss(geom, rect, scale)}
                  data-testid="pdf-search-hit"
                />
              ))}
              {pageHits?.activeRects.map((rect, k) => (
                <div
                  key={`a${k}`}
                  className="m-pdf-hit m-pdf-hit-active"
                  style={pdfRectToCss(geom, rect, scale)}
                  data-testid="pdf-search-hit-active"
                />
              ))}
              {rendered && !model.failedPages.has(i + 1) && (
                <PdfLinkLayer
                  doc={model.proxy}
                  pageNo={i + 1}
                  geom={geom}
                  scale={scale}
                  onGoToDest={onGoToDest}
                  onOpenExternalUrl={onOpenExternalUrl}
                  internalLinkLabel={labels.internalLink}
                />
              )}
              {renderPageOverlay?.({ pageIndex: i, geom, scale, width, height, rendered })}
            </div>
          )
        })}
      </div>
    </div>
  )
})
