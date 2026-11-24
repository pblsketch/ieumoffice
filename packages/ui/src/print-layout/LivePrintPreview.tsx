import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  planSheets,
  validateOptions,
  type PageSize,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import { printLayoutText, type PrintLayoutStringKey } from '../strings-print-layout'
import { createZoomWheelClassifier, wheelZoomStepPercent } from '../wheel-zoom'
import { PrintLayoutSchematic } from './PrintLayoutSchematic'
import './print-layout.css'

export interface LivePreviewFaceResult {
  readonly index: number
  readonly png: Uint8Array
  readonly widthPt: number
  readonly heightPt: number
}

export interface LivePreviewBatchResult {
  readonly totalFaces: number
  readonly faceSizes: readonly PageSize[]
  readonly faces: readonly LivePreviewFaceResult[]
}

export type LivePreviewFaceFetcher = (
  faceIndices: number[],
  longSidePx: number,
  signal: AbortSignal,
) => Promise<LivePreviewBatchResult>

export interface LivePrintPreviewProps {
  lang: Lang
  /** Job page sizes before arrangement (for schematic fallback & immediate face count). */
  pages: readonly PageSize[] | null
  options: PrintLayoutOptions
  /** Changes whenever editor range/content or layout/overlay options change. */
  cacheKey: string
  /** On-demand fetcher rendering only requested 0-based face indices. */
  fetchFaces: LivePreviewFaceFetcher | undefined
  /** Long side resolution in CSS pixels (scaled with zoom up to 1600). */
  baseLongSidePx?: number | undefined
  /** Optional problem text when current options cannot produce faces. */
  problemText?: string | null | undefined
}

interface CachedFace {
  url: string
  widthPt: number
  heightPt: number
}

const MAX_CACHED_FACES = 24
const DEBOUNCE_MS = 220
const MIN_ZOOM = 25
const MAX_ZOOM = 300
const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300]

function nextZoomStep(current: number, dir: 1 | -1): number {
  if (dir > 0) {
    return ZOOM_STEPS.find((z) => z > current) ?? MAX_ZOOM
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i]! < current) return ZOOM_STEPS[i]!
  }
  return MIN_ZOOM
}

/**
 * Shared live print preview viewer with on-demand lazy PDFium rendering, LRU
 * face caching, debounce on option edits, zoom/fit controls, face navigation,
 * and an optional layout diagram toggle.
 */
export function LivePrintPreview(props: LivePrintPreviewProps): ReactElement {
  const { lang, pages, options, cacheKey, fetchFaces, baseLongSidePx = 960, problemText } = props
  const t = (key: PrintLayoutStringKey, params?: Record<string, string | number>) =>
    printLayoutText(lang, key, params)

  const plannedTotal = useMemo(() => {
    if (!pages || pages.length === 0) return null
    const checked = validateOptions(options, pages.length)
    if (!checked.ok) return null
    try {
      return planSheets(pages, checked.options).output.length
    } catch {
      return null
    }
  }, [pages, options])

  const [totalFaces, setTotalFaces] = useState<number | null>(plannedTotal)
  const [currentFace, setCurrentFace] = useState(0)
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [showDiagram, setShowDiagram] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [cacheVersion, setCacheVersion] = useState(0)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  const paneRef = useRef<HTMLDivElement | null>(null)
  const cacheRef = useRef<Map<number, CachedFace>>(new Map())
  const cacheKeyRef = useRef(cacheKey)
  const activeKeyRef = useRef(cacheKey)
  const fetchRef = useRef(fetchFaces)
  fetchRef.current = fetchFaces
  const abortRef = useRef<AbortController | null>(null)
  const zoomWheelRef = useRef<ReturnType<typeof createZoomWheelClassifier> | null>(null)

  const clearCache = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      URL.revokeObjectURL(entry.url)
    }
    cacheRef.current.clear()
  }, [])

  const putCache = useCallback((index: number, face: LivePreviewFaceResult) => {
    const map = cacheRef.current
    const existing = map.get(index)
    if (existing) {
      URL.revokeObjectURL(existing.url)
      map.delete(index)
    }
    const url = URL.createObjectURL(
      new Blob([face.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    )
    map.set(index, { url, widthPt: face.widthPt, heightPt: face.heightPt })
    while (map.size > MAX_CACHED_FACES) {
      const oldestKey = map.keys().next().value
      if (oldestKey === undefined) break
      const oldest = map.get(oldestKey)
      if (oldest) URL.revokeObjectURL(oldest.url)
      map.delete(oldestKey)
    }
  }, [])

  // Cleanup URLs and in-flight requests on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      clearCache()
    },
    [clearCache],
  )

  // Track pane dimensions for fit-to-pane zoom.
  useEffect(() => {
    const el = paneRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Keep totalFaces synced when the local plan knows the count immediately.
  useEffect(() => {
    if (plannedTotal !== null) {
      setTotalFaces(plannedTotal)
      setCurrentFace((prev) => Math.min(prev, Math.max(0, plannedTotal - 1)))
    }
  }, [plannedTotal])

  // Invalidate cache when cacheKey changes.
  useEffect(() => {
    if (cacheKeyRef.current !== cacheKey) {
      cacheKeyRef.current = cacheKey
      activeKeyRef.current = cacheKey
      abortRef.current?.abort()
      clearCache()
      setFailed(false)
      setCacheVersion((v) => v + 1)
    }
  }, [cacheKey, clearCache])

  const effectiveTotal = totalFaces ?? plannedTotal
  const clampedFace =
    effectiveTotal !== null && effectiveTotal > 0
      ? Math.min(currentFace, effectiveTotal - 1)
      : Math.max(0, currentFace)

  // On-demand lazy render of current face (+ prefetch neighbours).
  useEffect(() => {
    if (showDiagram || problemText || !fetchRef.current) return
    const cached = cacheRef.current.get(clampedFace)
    const needCurrent = !cached
    const neighbors: number[] = []
    if (effectiveTotal === null || clampedFace + 1 < effectiveTotal) {
      if (!cacheRef.current.has(clampedFace + 1)) neighbors.push(clampedFace + 1)
    }
    if (clampedFace > 0 && !cacheRef.current.has(clampedFace - 1)) {
      neighbors.push(clampedFace - 1)
    }
    if (!needCurrent && neighbors.length === 0) {
      setLoading(false)
      return
    }

    const requestKey = cacheKey
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    const run = async () => {
      const fetcher = fetchRef.current
      if (!fetcher || controller.signal.aborted) return
      if (needCurrent) {
        setLoading(true)
        setFailed(false)
      }
      try {
        const longSide =
          zoomMode === 'fit'
            ? baseLongSidePx
            : Math.min(
                1600,
                Math.max(baseLongSidePx, Math.round((baseLongSidePx * zoomMode) / 100)),
              )
        if (needCurrent) {
          const res = await fetcher([clampedFace], longSide, controller.signal)
          if (controller.signal.aborted || activeKeyRef.current !== requestKey) return
          setTotalFaces(res.totalFaces)
          for (const f of res.faces) putCache(f.index, f)
          setLoading(false)
          setCacheVersion((v) => v + 1)
          // Prefetch next/prev after showing current face
          const nextList: number[] = []
          if (clampedFace + 1 < res.totalFaces && !cacheRef.current.has(clampedFace + 1)) {
            nextList.push(clampedFace + 1)
          }
          if (clampedFace > 0 && !cacheRef.current.has(clampedFace - 1)) {
            nextList.push(clampedFace - 1)
          }
          if (nextList.length > 0 && !controller.signal.aborted) {
            const pref = await fetcher(nextList, baseLongSidePx, controller.signal)
            if (controller.signal.aborted || activeKeyRef.current !== requestKey) return
            for (const f of pref.faces) putCache(f.index, f)
            setCacheVersion((v) => v + 1)
          }
        } else if (neighbors.length > 0) {
          const pref = await fetcher(neighbors, baseLongSidePx, controller.signal)
          if (controller.signal.aborted || activeKeyRef.current !== requestKey) return
          setTotalFaces(pref.totalFaces)
          for (const f of pref.faces) putCache(f.index, f)
          setCacheVersion((v) => v + 1)
        }
      } catch {
        if (controller.signal.aborted || activeKeyRef.current !== requestKey) return
        setLoading(false)
        if (needCurrent) setFailed(true)
      }
    }

    const delay = needCurrent ? DEBOUNCE_MS : 80
    const timer = setTimeout(() => void run(), delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    cacheKey,
    clampedFace,
    effectiveTotal,
    showDiagram,
    problemText,
    baseLongSidePx,
    zoomMode,
    putCache,
  ])

  // Ctrl+wheel zoom on the preview viewport.
  const currentEntry = cacheRef.current.get(clampedFace)
  void cacheVersion

  const pxWidth = currentEntry ? (currentEntry.widthPt * 96) / 72 : 595
  const pxHeight = currentEntry ? (currentEntry.heightPt * 96) / 72 : 842
  const availW = Math.max(120, viewport.width - 32)
  const availH = Math.max(120, viewport.height - 32)
  const fitScale = Math.min(availW / pxWidth, availH / pxHeight, 1.5)
  const effectiveScale = zoomMode === 'fit' ? (viewport.width > 0 ? fitScale : 0.6) : zoomMode / 100
  const percent = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(effectiveScale * 100)))

  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomWheelRef.current ??= createZoomWheelClassifier()
      const intent = zoomWheelRef.current.feed(e, e.timeStamp)
      if (!intent) return
      const dir = intent === 'zoom-in' ? 1 : -1
      setZoomMode(wheelZoomStepPercent(percent, dir, MIN_ZOOM, MAX_ZOOM))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [percent])

  const go = (next: number) => {
    const max = effectiveTotal !== null && effectiveTotal > 0 ? effectiveTotal - 1 : 0
    setCurrentFace(Math.min(max, Math.max(0, next)))
  }

  return (
    <section className="gs-pl-live" aria-label={t('livePreviewLabel')} data-pl="live-preview">
      <div className="gs-pl-live-bar">
        <div className="gs-pl-live-nav">
          <button
            type="button"
            className="gs-pl-btn gs-pl-live-icon"
            data-pl="live-prev"
            aria-label={t('prevFace')}
            title={t('prevFace')}
            disabled={clampedFace <= 0}
            onClick={() => go(clampedFace - 1)}
          >
            ‹
          </button>
          <input
            type="number"
            className="gs-pl-live-page-input"
            data-pl="live-page"
            min={1}
            max={Math.max(1, effectiveTotal ?? 1)}
            value={clampedFace + 1}
            disabled={!effectiveTotal || effectiveTotal <= 1}
            aria-label={t('faceCaption', { face: clampedFace + 1 })}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 1) go(Math.round(v) - 1)
            }}
          />
          <span className="gs-pl-live-total" data-pl="live-total">
            / {effectiveTotal ?? '…'}
          </span>
          <button
            type="button"
            className="gs-pl-btn gs-pl-live-icon"
            data-pl="live-next"
            aria-label={t('nextFace')}
            title={t('nextFace')}
            disabled={effectiveTotal === null || clampedFace >= effectiveTotal - 1}
            onClick={() => go(clampedFace + 1)}
          >
            ›
          </button>
        </div>

        <div className="gs-pl-live-zoom">
          <button
            type="button"
            className="gs-pl-btn gs-pl-live-icon"
            data-pl="live-zoom-out"
            aria-label={t('zoomOut')}
            title={t('zoomOut')}
            disabled={showDiagram || percent <= MIN_ZOOM}
            onClick={() => setZoomMode(nextZoomStep(percent, -1))}
          >
            −
          </button>
          <button
            type="button"
            className={`gs-pl-btn gs-pl-live-zoom-fit${zoomMode === 'fit' ? ' active' : ''}`}
            data-pl="live-zoom-fit"
            disabled={showDiagram}
            onClick={() => setZoomMode('fit')}
          >
            {zoomMode === 'fit' ? t('zoomFit') : `${percent}%`}
          </button>
          <button
            type="button"
            className="gs-pl-btn gs-pl-live-icon"
            data-pl="live-zoom-in"
            aria-label={t('zoomIn')}
            title={t('zoomIn')}
            disabled={showDiagram || percent >= MAX_ZOOM}
            onClick={() => setZoomMode(nextZoomStep(percent, 1))}
          >
            +
          </button>
          <button
            type="button"
            className={`gs-pl-btn gs-pl-live-diagram-btn${showDiagram ? ' active' : ''}`}
            data-pl="live-toggle-diagram"
            aria-pressed={showDiagram}
            onClick={() => setShowDiagram((v) => !v)}
          >
            {t('toggleSchematic')}
          </button>
        </div>
      </div>

      <div className="gs-pl-live-stage" ref={paneRef}>
        {problemText ? (
          <p className="gs-pl-issue gs-pl-live-msg" role="alert">
            {problemText}
          </p>
        ) : showDiagram || !fetchFaces ? (
          <div className="gs-pl-live-diagram-wrap">
            <PrintLayoutSchematic lang={lang} pages={pages} options={options} />
          </div>
        ) : failed && !currentEntry ? (
          <p className="gs-pl-issue gs-pl-live-msg" role="alert">
            {t('previewFailed')}
          </p>
        ) : currentEntry ? (
          <div className={`gs-pl-live-sheet${loading ? ' loading' : ''}`}>
            <img
              className="gs-pl-live-img"
              data-pl="live-img"
              src={currentEntry.url}
              alt={t('faceCaption', { face: clampedFace + 1 })}
              draggable={false}
              style={{
                width: Math.max(40, Math.round(pxWidth * effectiveScale)),
                height: Math.max(40, Math.round(pxHeight * effectiveScale)),
              }}
            />
          </div>
        ) : (
          <div className="gs-pl-live-placeholder">
            {pages && pages.length > 0 && (
              <PrintLayoutSchematic lang={lang} pages={pages} options={options} />
            )}
            <span className="gs-pl-hint">{t('renderingPreview')}</span>
          </div>
        )}
        {loading && currentEntry && (
          <div className="gs-pl-live-pill" role="status">
            {t('renderingPreview')}
          </div>
        )}
      </div>
    </section>
  )
}
