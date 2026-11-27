// First-use tips (track T6, spec 3.14): one non-blocking bubble next to an editor element, closed
// by any touch or key; each tip shows once and is remembered in `tipsSeen`.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { useMobileLocale } from '../../i18n'
import {
  getHomePrefs,
  HOME_TIP_IDS,
  updateHomePrefs,
  useHomePrefs,
  type HomeTipId,
} from '../prefsStore'
import { modalOpen, nextTip, tipAnchor, TIP_TEXT_KEYS } from './tipModel'
import { useDomTick } from './useDomTick'
import './layer.css'

// Distance between the bubble and its element, and from the window edges (CSS pixels).
const GAP = 8
const EDGE = 16
const TIP_TOP_INSET_VAR = '--m-tip-inset-top'
const READONLY_STRIP_VAR = '--m-readonly-strip-h'

interface Placement {
  readonly top: number
  readonly left: number
  /** The bubble sits below the element (else above it). */
  readonly below: boolean
}

function place(anchor: HTMLElement, bubble: HTMLElement | null): Placement {
  const rect = anchor.getBoundingClientRect()
  const height = typeof window === 'undefined' ? 0 : window.innerHeight
  const width = typeof window === 'undefined' ? 0 : window.innerWidth
  const below = rect.top + rect.height / 2 < height / 2
  const bubbleWidth = bubble?.offsetWidth ?? 0
  const center = rect.left + rect.width / 2
  const maxLeft = Math.max(EDGE, width - bubbleWidth - EDGE)
  const left = Math.min(Math.max(center - bubbleWidth / 2, EDGE), maxLeft)
  let topBottom = rect.bottom
  // Keep header-anchored tips below any tablet formatting toolbar or top notice strip.
  if (below && typeof document !== 'undefined' && anchor.closest('[data-testid="editor-header"]')) {
    for (const selector of [
      '[data-testid="tablet-toolbar"]',
      '[data-testid="editor-notice-banner"]',
      '[data-testid="home-run-readonly-strip"]',
    ]) {
      const bar = document.querySelector(selector)
      if (bar instanceof HTMLElement) {
        const barRect = bar.getBoundingClientRect()
        if (barRect.height > 0 && barRect.bottom > topBottom) {
          topBottom = barRect.bottom
        }
      }
    }
  }
  return { top: below ? topBottom + GAP : rect.top - GAP, left, below }
}

export interface TipLayerProps {
  /** False while the editor is not shown or something of the app layer covers it. */
  readonly active: boolean
  readonly mode: DocumentMode
  readonly client: MobileClient
}

export function TipLayer({ active, mode, client }: TipLayerProps) {
  const { t } = useMobileLocale()
  const { prefs, loaded } = useHomePrefs()
  // Closed in this run; kept even if saving `tipsSeen` fails.
  const closedRef = useRef(new Set<string>())
  // Once every tip was seen, stop watching the editor's DOM for the rest of the run.
  const tipsLeft = HOME_TIP_IDS.some(
    (id) => !prefs.tipsSeen.includes(id) && !closedRef.current.has(id),
  )
  const tick = useDomTick(active && loaded && tipsLeft)
  const [current, setCurrent] = useState<HomeTipId | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const pageViewLabel = t('pageView')

  useLayoutEffect(() => {
    if (!active || !loaded || typeof document === 'undefined') {
      setCurrent(null)
      setPlacement(null)
      return
    }
    const context = { mode, pageViewLabel }
    let id = current
    let anchor = id ? tipAnchor(id, context) : null
    if (!anchor) {
      const next = modalOpen() ? null : nextTip([...prefs.tipsSeen, ...closedRef.current], context)
      id = next?.id ?? null
      anchor = next?.anchor ?? null
    }
    if (!id || !anchor) {
      setCurrent(null)
      setPlacement(null)
      return
    }
    const nextPlacement = place(anchor, bubbleRef.current)
    setCurrent(id)
    setPlacement((prev) =>
      prev &&
      prev.top === nextPlacement.top &&
      prev.left === nextPlacement.left &&
      prev.below === nextPlacement.below
        ? prev
        : nextPlacement,
    )
  }, [active, loaded, mode, pageViewLabel, prefs.tipsSeen, tick, current])

  // Reserve space above the editor stage while a top-anchored tip is visible so it never covers
  // the first line of an editor (e.g. a new Markdown document's first line).
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const bubble = bubbleRef.current
    if (!active || !current || !placement?.below || !bubble) {
      root.style.removeProperty(TIP_TOP_INSET_VAR)
      return
    }
    const sync = () => {
      const stage = document.querySelector('.mobile-editor-stage')
      if (!(stage instanceof HTMLElement)) {
        root.style.removeProperty(TIP_TOP_INSET_VAR)
        return
      }
      const bubbleRect = bubble.getBoundingClientRect()
      if (bubbleRect.height <= 0) {
        root.style.removeProperty(TIP_TOP_INSET_VAR)
        return
      }
      const stageRect = stage.getBoundingClientRect()
      const stripH = Number.parseFloat(root.style.getPropertyValue(READONLY_STRIP_VAR)) || 0
      const contentTop = stageRect.top + stripH
      const overlap = Math.ceil(bubbleRect.bottom + GAP - contentTop)
      if (overlap > 0) root.style.setProperty(TIP_TOP_INSET_VAR, `${overlap}px`)
      else root.style.removeProperty(TIP_TOP_INSET_VAR)
    }
    sync()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    observer?.observe(bubble)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(TIP_TOP_INSET_VAR)
    }
  }, [active, current, placement])

  useEffect(() => {
    if (!current || typeof window === 'undefined') return
    const close = () => {
      closedRef.current.add(current)
      setCurrent(null)
      setPlacement(null)
      const seen = getHomePrefs().tipsSeen
      if (!seen.includes(current)) {
        void updateHomePrefs({ tipsSeen: [...seen, current] }, client).catch(() => {})
      }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close, true)
    }
  }, [current, client])

  const text = current ? t(TIP_TEXT_KEYS[current]) : ''
  return (
    <>
      <div className="mobile-sr-only" aria-live="polite" data-testid="home-run-tip-live">
        {text}
      </div>
      {current && placement && (
        <div
          ref={bubbleRef}
          className="home-run-tip"
          data-testid="home-run-tip"
          data-tip={current}
          data-side={placement.below ? 'below' : 'above'}
          aria-hidden="true"
          style={{ top: placement.top, left: placement.left }}
        >
          {text}
        </div>
      )}
    </>
  )
}
