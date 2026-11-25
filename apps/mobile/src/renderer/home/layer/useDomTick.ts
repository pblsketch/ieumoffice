// A small clock for the app layer's anchored parts (track T6): the read-only strip and the tips
// look for editor elements they do not own, so they re-measure when the page changes.
import { useEffect, useState } from 'react'

/** Wait this long after a change before re-measuring (changes in between are folded into one). */
export const DOM_TICK_MS = 50

// Attribute changes that can move, show or hide the elements the layer anchors to.
const WATCHED_ATTRIBUTES = [
  'style',
  'class',
  'hidden',
  'data-mode',
  'data-state',
  'data-layout',
  'aria-label',
]

/**
 * A number that goes up while `active` whenever the document's elements, the window size or the
 * keyboard inset (`--m-kb` on <html>) change, at most once per DOM_TICK_MS. It also goes up once
 * when it becomes active.
 */
export function useDomTick(active: boolean): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        setTick((value) => value + 1)
      }, DOM_TICK_MS)
    }
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(bump) : null
    observer?.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    })
    const viewport = window.visualViewport
    window.addEventListener('resize', bump)
    viewport?.addEventListener('resize', bump)
    bump()
    return () => {
      if (timer !== null) clearTimeout(timer)
      observer?.disconnect()
      window.removeEventListener('resize', bump)
      viewport?.removeEventListener('resize', bump)
    }
  }, [active])

  return tick
}
