// First-use tips (track T6, spec 3.14): one non-blocking bubble next to an editor element, closed
// by any touch or key; each tip shows once and is remembered in `tipsSeen`.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import { useMobileLocale } from '../../i18n'
import { getHomePrefs, updateHomePrefs, useHomePrefs, type HomeTipId } from '../prefsStore'
import { modalOpen, nextTip, tipAnchor, TIP_TEXT_KEYS } from './tipModel'
import { useDomTick } from './useDomTick'
import './layer.css'

// Distance between the bubble and its element, and from the window edges (CSS pixels).
const GAP = 8
const EDGE = 16

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
  return { top: below ? rect.bottom + GAP : rect.top - GAP, left, below }
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
  const tick = useDomTick(active && loaded)
  const [current, setCurrent] = useState<HomeTipId | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  // Closed in this run; kept even if saving `tipsSeen` fails.
  const closedRef = useRef(new Set<string>())
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
