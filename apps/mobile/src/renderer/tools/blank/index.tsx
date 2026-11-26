/**
 * Choosing the blank pages to remove (spec 5.3, find and remove blank pages):
 * a grid of the candidates, each with its thumbnail (long side 240px, drawn
 * from the engine's RGBA pixels), its page number and why it was found. A
 * tap anywhere on a tile toggles it; [Select all] and [Select none] help with
 * long lists, and the count says how many are chosen.
 *
 * The flow keeps `chosen`, accepts only pages among the candidates and
 * disables [Remove] when nothing or every page is chosen.
 *
 * Long lists stay smooth: tiles are memoized, so a toggle redraws one tile,
 * and thumbnails are painted only when they come near the screen (one shared
 * IntersectionObserver; without one they are painted at once). No list is cut.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useMobileLocale } from '../../i18n'
import type { BlankCandidateView } from '../engine/types'
import './blank.css'

export interface BlankReviewProps {
  /** 1-based candidates in page order, with a thumbnail for the first ones */
  readonly candidates: readonly BlankCandidateView[]
  readonly pageCount: number
  readonly chosen: ReadonlySet<number>
  onChange(chosen: ReadonlySet<number>): void
}

/** What starts chosen: the pages with nothing on them, not the nearly white ones */
export function initialBlankChoice(candidates: readonly BlankCandidateView[]): Set<number> {
  return new Set(candidates.filter((c) => c.reason === 'empty').map((c) => c.page))
}

/** Calls `onVisible` once when `el` comes near the screen; returns the way to stop watching */
type Watch = (el: Element, onVisible: () => void) => () => void

/** One IntersectionObserver for every thumbnail of the grid, let go with the grid */
function useVisibilityWatch(): Watch {
  const observer = useRef<IntersectionObserver | null>(null)
  const waiting = useRef(new Map<Element, () => void>())
  useEffect(
    () => () => {
      observer.current?.disconnect()
      observer.current = null
      waiting.current.clear()
    },
    [],
  )
  return useCallback((el, onVisible) => {
    if (typeof IntersectionObserver !== 'function') {
      onVisible()
      return () => {}
    }
    observer.current ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const paint = waiting.current.get(entry.target)
          if (!paint) continue
          waiting.current.delete(entry.target)
          observer.current?.unobserve(entry.target)
          paint()
        }
      },
      // paint a screen's worth ahead so scrolling does not show empty tiles
      { rootMargin: '100% 0px' },
    )
    waiting.current.set(el, onVisible)
    observer.current.observe(el)
    return () => {
      waiting.current.delete(el)
      observer.current?.unobserve(el)
    }
  }, [])
}

function Thumb({ image, watch }: { readonly image: ImageData; readonly watch: Watch }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    return watch(canvas, () => {
      try {
        canvas.getContext('2d')?.putImageData(image, 0, 0)
      } catch {
        // a canvas that cannot draw leaves the tile's plain background
      }
    })
  }, [image, watch])
  return (
    <canvas
      ref={ref}
      className="pdf-tools-blank-thumb"
      width={image.width}
      height={image.height}
      aria-hidden="true"
    />
  )
}

interface TileProps {
  readonly candidate: BlankCandidateView
  readonly checked: boolean
  onToggle(page: number, on: boolean): void
  readonly watch: Watch
}

const Tile = memo(function Tile({ candidate, checked, onToggle, watch }: TileProps) {
  const { t } = useMobileLocale()
  return (
    <li>
      <label className="pdf-tools-blank-tile" data-testid="pdf-tools-blank-tile">
        {candidate.thumb ? (
          <Thumb image={candidate.thumb} watch={watch} />
        ) : (
          <span className="pdf-tools-blank-thumb pdf-tools-blank-placeholder" aria-hidden="true">
            {candidate.page}
          </span>
        )}
        <span className="pdf-tools-blank-meta">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(candidate.page, e.currentTarget.checked)}
          />
          <span className="pdf-tools-blank-page">
            {t('pdfToolsBlankPageLabel', { n: candidate.page })}
          </span>
        </span>
        <span className="pdf-tools-blank-reason">
          {t(candidate.reason === 'empty' ? 'pdfToolsBlankEmpty' : 'pdfToolsBlankNearlyWhite')}
        </span>
      </label>
    </li>
  )
})

export function BlankReview({ candidates, chosen, onChange }: BlankReviewProps) {
  const { t } = useMobileLocale()
  const watch = useVisibilityWatch()

  // the toggle keeps its identity so only the tapped tile draws again
  const latest = useRef({ chosen, onChange })
  latest.current = { chosen, onChange }
  const toggle = useCallback((page: number, on: boolean) => {
    const next = new Set(latest.current.chosen)
    if (on) next.add(page)
    else next.delete(page)
    latest.current.onChange(next)
  }, [])

  const pages = useMemo(() => candidates.map((c) => c.page), [candidates])
  const count = useMemo(() => pages.filter((page) => chosen.has(page)).length, [pages, chosen])

  return (
    <div className="pdf-tools-blank" data-testid="pdf-tools-blank-review">
      <div className="pdf-tools-blank-bar">
        <p className="pdf-tools-blank-count" aria-live="polite" data-testid="pdf-tools-blank-count">
          {t('pdfToolsBlankChosenCount', { n: count })}
        </p>
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary"
          disabled={count === pages.length}
          onClick={() => onChange(new Set(pages))}
        >
          {t('pdfToolsSelectAll')}
        </button>
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary"
          disabled={count === 0}
          onClick={() => onChange(new Set())}
        >
          {t('pdfToolsSelectNone')}
        </button>
      </div>
      <ul className="pdf-tools-blank-grid">
        {candidates.map((c) => (
          <Tile
            key={c.page}
            candidate={c}
            checked={chosen.has(c.page)}
            onToggle={toggle}
            watch={watch}
          />
        ))}
      </ul>
    </div>
  )
}
