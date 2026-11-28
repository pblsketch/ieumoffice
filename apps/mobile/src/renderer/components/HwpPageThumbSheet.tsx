/**
 * Page thumbnail navigation sheet for HWP page view (mirrors PDF PagesSheet and PPTX SlideListSheet).
 *
 * Fetches SVG previews lazily only for cells visible inside the sheet through a bounded
 * concurrency queue (max 2), downscales them to compact JPEG data URLs when Canvas 2D is
 * available so large embedded-image SVGs do not stay pinned in WebView memory, and jumps
 * directly to the tapped page.
 */
import { useEffect, useRef, useState } from 'react'
import { useMobileLocale } from '../i18n'
import { Sheet } from './Sheet'
import './hwpPageThumbSheet.css'

export interface HwpPagePreviewData {
  readonly pageCount: number
  readonly page: number
  readonly svg: string
  readonly width: number
  readonly height: number
}

export interface HwpPageThumbSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly getPageCount: () => Promise<number>
  readonly loadPreviewPage: (pageIndex: number) => Promise<HwpPagePreviewData | null>
  readonly onSelectPage: (pageIndex: number) => void
}

const MAX_CONCURRENT_PREVIEWS = 2
const THUMB_MAX_WIDTH_PX = 200

function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0
  const queue: Array<() => void> = []
  const pump = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const next = queue.shift()
      if (!next) break
      active += 1
      next()
    }
  }
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active = Math.max(0, active - 1)
            pump()
          })
      })
      pump()
    })
  }
}

/** Rasterizes an HWP preview SVG to a small JPEG data URL when Canvas 2D is supported, else SVG object URL. */
async function svgToThumbSrc(
  svg: string,
  width: number,
  height: number,
): Promise<{ src: string; revoke: boolean }> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(blob)
  if (typeof document === 'undefined') {
    return { src: svgUrl, revoke: true }
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { src: svgUrl, revoke: true }
  }
  const safeW = Math.max(1, width || 794)
  const safeH = Math.max(1, height || 1123)
  const outW = Math.min(THUMB_MAX_WIDTH_PX, Math.round(safeW))
  const outH = Math.max(1, Math.round((outW * safeH) / safeW))
  canvas.width = outW
  canvas.height = outH
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('svg preview decode failed'))
      el.src = svgUrl
    })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78)
    URL.revokeObjectURL(svgUrl)
    return { src: dataUrl, revoke: false }
  } catch {
    return { src: svgUrl, revoke: true }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function ThumbCell({
  index,
  loadPreviewPage,
  enqueue,
  onSelect,
}: {
  readonly index: number
  readonly loadPreviewPage: (pageIndex: number) => Promise<HwpPagePreviewData | null>
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly onSelect: (pageIndex: number) => void
}) {
  const { t } = useMobileLocale()
  const cellRef = useRef<HTMLButtonElement | null>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [thumbSrc, setThumbSrc] = useState<string | null>(null)

  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return
    const el = cellRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let alive = true
    let revocableUrl: string | null = null
    void enqueue(async () => {
      if (!alive) return null
      const res = await loadPreviewPage(index)
      if (!alive || !res?.svg) return null
      return svgToThumbSrc(res.svg, res.width, res.height)
    })
      .then((rendered) => {
        if (!rendered) return
        if (!alive) {
          if (rendered.revoke) URL.revokeObjectURL(rendered.src)
          return
        }
        if (rendered.revoke) revocableUrl = rendered.src
        setThumbSrc(rendered.src)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (revocableUrl) URL.revokeObjectURL(revocableUrl)
    }
  }, [visible, index, loadPreviewPage, enqueue])

  return (
    <li className="hwp-thumb-item">
      <button
        ref={cellRef}
        type="button"
        className="hwp-thumb-cell"
        data-testid={`hwp-page-thumb-${index}`}
        onClick={() => onSelect(index)}
      >
        <span className="hwp-thumb-paper">
          {thumbSrc ? (
            <img className="hwp-thumb-img" src={thumbSrc} alt="" />
          ) : (
            <span className="hwp-thumb-placeholder" aria-hidden="true">
              {index + 1}
            </span>
          )}
        </span>
        <span className="hwp-thumb-label">{t('homePageThumbCount', { n: index + 1 })}</span>
      </button>
    </li>
  )
}

export function HwpPageThumbSheet({
  open,
  onClose,
  getPageCount,
  loadPreviewPage,
  onSelectPage,
}: HwpPageThumbSheetProps) {
  const { t } = useMobileLocale()
  const [pageCount, setPageCount] = useState(0)
  const enqueueRef = useRef<ReturnType<typeof createConcurrencyLimiter> | null>(null)
  if (!enqueueRef.current) {
    enqueueRef.current = createConcurrencyLimiter(MAX_CONCURRENT_PREVIEWS)
  }

  useEffect(() => {
    if (!open) return
    let alive = true
    void getPageCount()
      .then((count) => {
        if (alive) setPageCount(Math.max(0, Math.trunc(count)))
      })
      .catch(() => {
        if (alive) setPageCount(0)
      })
    return () => {
      alive = false
    }
  }, [open, getPageCount])

  return (
    <Sheet
      open={open}
      title={t('homePageThumbnails')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="hwp-page-thumb-sheet"
    >
      <ul className="hwp-thumb-grid" data-testid="hwp-page-thumb-grid">
        {Array.from({ length: pageCount }, (_, i) => (
          <ThumbCell
            key={i}
            index={i}
            loadPreviewPage={loadPreviewPage}
            enqueue={enqueueRef.current!}
            onSelect={(page) => {
              onClose()
              onSelectPage(page)
            }}
          />
        ))}
      </ul>
    </Sheet>
  )
}
