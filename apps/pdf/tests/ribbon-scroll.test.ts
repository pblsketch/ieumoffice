import { describe, expect, it, vi } from 'vitest'
import {
  ribbonScrollState,
  ribbonScrollStep,
  scrollRibbonOnWheel,
} from '../src/renderer/ribbon-scroll'

describe('ribbonScrollState', () => {
  it('hides both chevrons when the band fits', () => {
    expect(ribbonScrollState({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 1200 })).toEqual({
      canLeft: false,
      canRight: false,
    })
    expect(ribbonScrollState({ scrollLeft: 0, scrollWidth: 1001, clientWidth: 1000 })).toEqual({
      canLeft: false,
      canRight: false,
    })
  })

  it('tracks LTR left, middle, and right scroll positions', () => {
    expect(ribbonScrollState({ scrollLeft: 0, scrollWidth: 1500, clientWidth: 1000 })).toEqual({
      canLeft: false,
      canRight: true,
    })
    expect(ribbonScrollState({ scrollLeft: 250, scrollWidth: 1500, clientWidth: 1000 })).toEqual({
      canLeft: true,
      canRight: true,
    })
    expect(ribbonScrollState({ scrollLeft: 500, scrollWidth: 1500, clientWidth: 1000 })).toEqual({
      canLeft: true,
      canRight: false,
    })
  })

  it('tracks Chromium RTL negative scrollLeft coordinates', () => {
    expect(
      ribbonScrollState({ scrollLeft: 0, scrollWidth: 1500, clientWidth: 1000, rtl: true }),
    ).toEqual({
      canLeft: true,
      canRight: false,
    })
    expect(
      ribbonScrollState({ scrollLeft: -250, scrollWidth: 1500, clientWidth: 1000, rtl: true }),
    ).toEqual({
      canLeft: true,
      canRight: true,
    })
    expect(
      ribbonScrollState({ scrollLeft: -500, scrollWidth: 1500, clientWidth: 1000, rtl: true }),
    ).toEqual({
      canLeft: false,
      canRight: true,
    })
  })
})

describe('ribbonScrollStep', () => {
  it('advances roughly half the viewport with a sensible minimum', () => {
    expect(ribbonScrollStep(200)).toBe(160)
    expect(ribbonScrollStep(1000)).toBe(550)
  })
})

describe('scrollRibbonOnWheel', () => {
  const makeRibbon = (scrollWidth = 1600, clientWidth = 1000) =>
    ({ scrollWidth, clientWidth, scrollLeft: 0 }) as unknown as HTMLElement

  const makeWheel = (
    ribbon: HTMLElement,
    init: Partial<WheelEvent> = {},
    list?: { scrollHeight: number; clientHeight: number },
  ) =>
    ({
      deltaX: 0,
      deltaY: 120,
      ctrlKey: false,
      metaKey: false,
      target: {
        scrollHeight: list?.scrollHeight ?? 20,
        clientHeight: list?.clientHeight ?? 20,
        parentElement: ribbon,
      },
      preventDefault: vi.fn(),
      ...init,
    }) as unknown as WheelEvent

  it('scrolls horizontally in LTR when vertical wheel runs over an overflowing band', () => {
    vi.stubGlobal('getComputedStyle', () => ({ direction: 'ltr', overflowY: 'visible' }))
    const ribbon = makeRibbon()
    const event = makeWheel(ribbon)
    expect(scrollRibbonOnWheel(event, ribbon)).toBe(true)
    expect(ribbon.scrollLeft).toBe(120)
    expect(event.preventDefault).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('advances forward (negative scrollLeft) in RTL on positive vertical wheel', () => {
    vi.stubGlobal('getComputedStyle', () => ({ direction: 'rtl', overflowY: 'visible' }))
    const ribbon = makeRibbon()
    const event = makeWheel(ribbon)
    expect(scrollRibbonOnWheel(event, ribbon)).toBe(true)
    expect(ribbon.scrollLeft).toBe(-120)
    vi.unstubAllGlobals()
  })

  it('leaves non-overflowing bands, zoom chords, and horizontal trackpad swipes alone', () => {
    vi.stubGlobal('getComputedStyle', () => ({ direction: 'ltr', overflowY: 'visible' }))
    const fits = makeRibbon(900, 1000)
    expect(scrollRibbonOnWheel(makeWheel(fits), fits)).toBe(false)

    const wide = makeRibbon()
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { deltaX: 200 }]) {
      const event = makeWheel(wide, init)
      expect(scrollRibbonOnWheel(event, wide)).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    expect(wide.scrollLeft).toBe(0)
    vi.unstubAllGlobals()
  })

  it('yields to an open dropdown list that scrolls vertically itself', () => {
    vi.stubGlobal('getComputedStyle', () => ({ direction: 'ltr', overflowY: 'auto' }))
    const ribbon = makeRibbon()
    const event = makeWheel(ribbon, {}, { scrollHeight: 400, clientHeight: 180 })
    expect(scrollRibbonOnWheel(event, ribbon)).toBe(false)
    expect(ribbon.scrollLeft).toBe(0)
    expect(event.preventDefault).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
