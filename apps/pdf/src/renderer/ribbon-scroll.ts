import { useCallback, useEffect, useState, type RefObject } from 'react'

export interface RibbonScrollMetrics {
  readonly scrollLeft: number
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly rtl?: boolean
}

export interface RibbonScrollEdges {
  readonly canLeft: boolean
  readonly canRight: boolean
}

const EDGE_EPSILON = 1

/**
 * Whether hidden ribbon items remain to the left or right of the visible band.
 * In Chromium RTL scroll containers, scrollLeft runs from 0 (right edge) down
 * to -(scrollWidth - clientWidth) (left edge); LTR runs from 0 to +max.
 */
export function ribbonScrollState({
  scrollLeft,
  scrollWidth,
  clientWidth,
  rtl = false,
}: RibbonScrollMetrics): RibbonScrollEdges {
  const max = Math.max(0, scrollWidth - clientWidth)
  if (max <= EDGE_EPSILON) return { canLeft: false, canRight: false }
  if (rtl) {
    return {
      canLeft: scrollLeft > -(max - EDGE_EPSILON),
      canRight: scrollLeft < -EDGE_EPSILON,
    }
  }
  return {
    canLeft: scrollLeft > EDGE_EPSILON,
    canRight: scrollLeft < max - EDGE_EPSILON,
  }
}

/** One click on a scroll chevron moves roughly half a band so context stays in sight. */
export function ribbonScrollStep(clientWidth: number): number {
  return Math.max(160, Math.round(clientWidth * 0.55))
}

/** True when an ancestor between `target` and `ribbon` scrolls vertically itself (an open dropdown). */
function scrollsVertically(target: Element, ribbon: Element): boolean {
  for (let el: Element | null = target; el && el !== ribbon; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight) continue
    const overflow = getComputedStyle(el).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return true
  }
  return false
}

/**
 * Turns a mouse's vertical wheel over an overflowing ribbon band into
 * horizontal scrolling (sheets parity). Trackpads scroll horizontally on
 * their own, and Ctrl/Cmd + wheel stays reserved for zoom.
 */
export function scrollRibbonOnWheel(event: WheelEvent, ribbon: HTMLElement | null): boolean {
  if (!ribbon) return false
  if (event.ctrlKey || event.metaKey) return false
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return false
  if (ribbon.scrollWidth <= ribbon.clientWidth + EDGE_EPSILON) return false
  const target = event.target as Element | null
  if (target && scrollsVertically(target, ribbon)) return false
  event.preventDefault()
  const rtl = typeof getComputedStyle === 'function' && getComputedStyle(ribbon).direction === 'rtl'
  ribbon.scrollLeft += rtl ? -event.deltaY : event.deltaY
  return true
}

export interface RibbonScrollControl extends RibbonScrollEdges {
  readonly scrollByDir: (dir: -1 | 1) => void
}

/**
 * Tracks horizontal overflow edges of `.ribbon-body`, resets scroll on tab
 * changes, and translates vertical mouse wheel movement into horizontal scroll.
 */
export function useRibbonScroll(
  bodyRef: RefObject<HTMLDivElement | null>,
  tabKey: string,
  layoutKey: string,
): RibbonScrollControl {
  const [edges, setEdges] = useState<RibbonScrollEdges>({ canLeft: false, canRight: false })

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollLeft = 0
  }, [bodyRef, tabKey])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return

    const measure = () => {
      const rtl = getComputedStyle(el).direction === 'rtl'
      const next = ribbonScrollState({
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        rtl,
      })
      setEdges((prev) =>
        prev.canLeft === next.canLeft && prev.canRight === next.canRight ? prev : next,
      )
    }

    measure()
    // Re-check on the next frame so late font/icon measurements settle too.
    const raf = requestAnimationFrame(measure)
    const onScroll = () => measure()
    const onWheel = (event: WheelEvent) => {
      if (scrollRibbonOnWheel(event, el)) measure()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', measure)

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
      el.querySelectorAll<HTMLElement>(':scope > .ribbon-group').forEach((g) => ro!.observe(g))
    }

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [bodyRef, tabKey, layoutKey])

  const scrollByDir = useCallback(
    (dir: -1 | 1) => {
      const el = bodyRef.current
      if (!el) return
      const delta = dir * ribbonScrollStep(el.clientWidth)
      if (typeof el.scrollBy === 'function') {
        el.scrollBy({ left: delta, behavior: 'smooth' })
      } else {
        el.scrollLeft += delta
      }
    },
    [bodyRef],
  )

  return { ...edges, scrollByDir }
}
