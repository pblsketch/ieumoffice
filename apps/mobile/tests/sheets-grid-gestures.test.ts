// The grid's gesture rules (spec 2.2, 2.8-1): tap / double tap / swipe /
// long press thresholds, the handle guard (24 px screen edge, handle over the
// freeze divider), scrolling the edited cell above the keyboard, and the
// keyboard bar's input helpers (Σ, numeric keyboard, Korean composition).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DOUBLE_TAP_DISTANCE_PX,
  DOUBLE_TAP_GAP_MS,
  LONG_PRESS_MS,
  PressTracker,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  isDoubleTap,
  isLongPress,
  isTap,
} from '../src/renderer/editors/sheets/grid/gestureJudge'
import {
  EDGE_BAND_PX,
  decideHandleGuard,
  reachPoints,
} from '../src/renderer/editors/sheets/grid/handleGuard'
import { revealScrollDelta, visibleBottom } from '../src/renderer/editors/sheets/grid/revealCell'
import {
  COMPOSITION_END_WAIT_MS,
  createCompositionTracker,
} from '../src/renderer/editors/sheets/grid/composition'
import {
  FORMULA_KEYS,
  formulaKeyInput,
  opensNumericKeyboard,
  setNumericKeyboard,
} from '../src/renderer/editors/sheets/grid/formulaInput'
import {
  HEADER_MENU_COMMANDS,
  headerCommandFor,
  parseLineSize,
} from '../src/renderer/editors/sheets/grid/headerMenu'
import { axisSpanLabel } from '../src/renderer/editors/sheets/grid/HeaderMenuSheet'

const tap = (x: number, y: number, downAt: number, upAt = downAt + 80, travel = 0) => ({
  x,
  y,
  downAt,
  upAt,
  travel,
})

describe('tap, double tap and swipe', () => {
  it('a short still press is a tap; a moving or long one is not', () => {
    expect(isTap(tap(10, 10, 0))).toBe(true)
    expect(isTap(tap(10, 10, 0, 80, TAP_SLOP_PX + 1))).toBe(false)
    expect(isTap(tap(10, 10, 0, TAP_MAX_MS + 1))).toBe(false)
    expect(isTap({ ...tap(10, 10, 0), upAt: null })).toBe(false)
  })

  it('two taps close in time and place are a double tap', () => {
    const first = tap(100, 100, 0, 80)
    expect(isDoubleTap(first, { x: 104, y: 98, downAt: 80 + DOUBLE_TAP_GAP_MS })).toBe(true)
    expect(isDoubleTap(first, { x: 104, y: 98, downAt: 81 + DOUBLE_TAP_GAP_MS })).toBe(false)
    expect(isDoubleTap(first, { x: 100 + DOUBLE_TAP_DISTANCE_PX + 1, y: 100, downAt: 150 })).toBe(
      false,
    )
    expect(isDoubleTap(null, { x: 100, y: 100, downAt: 10 })).toBe(false)
  })

  it('fast swipes that start at the same spot never read as a double tap', () => {
    // The prototype's emulator run: swipes 0.1-0.2 s apart opened the editor.
    const tracker = new PressTracker()
    tracker.down(200, 400, 0)
    for (let step = 1; step <= 5; step += 1) tracker.move(200, 400 - step * 30)
    tracker.up(90)
    tracker.down(201, 401, 160)
    expect(tracker.lastDoubleTap).toBe(false)
    for (let step = 1; step <= 5; step += 1) tracker.move(201, 401 - step * 30)
    tracker.up(250)
    tracker.down(200, 400, 330)
    expect(tracker.lastDoubleTap).toBe(false)
  })

  it('two real taps open the editor; a swipe in between resets', () => {
    const tracker = new PressTracker()
    tracker.down(50, 50, 0)
    tracker.move(52, 51)
    tracker.up(70)
    tracker.down(51, 50, 200)
    expect(tracker.lastDoubleTap).toBe(true)
    tracker.up(260)
    // a cancelled press (second finger, system gesture) is no tap
    tracker.down(50, 50, 400)
    tracker.cancel()
    tracker.down(50, 50, 450)
    expect(tracker.lastDoubleTap).toBe(false)
  })

  it('a still press on a header becomes a long press after LONG_PRESS_MS', () => {
    const press = { x: 0, y: 0, downAt: 1000, travel: 3, upAt: null }
    expect(isLongPress(press, 1000 + LONG_PRESS_MS - 1)).toBe(false)
    expect(isLongPress(press, 1000 + LONG_PRESS_MS)).toBe(true)
    expect(isLongPress({ ...press, travel: TAP_SLOP_PX + 1 }, 5000)).toBe(false)
    expect(isLongPress({ ...press, upAt: 1200 }, 5000)).toBe(false)
  })
})

describe('the handle guard', () => {
  it('turns the selection handles off within 24 px of either screen edge', () => {
    expect(EDGE_BAND_PX).toBe(24)
    expect(decideHandleGuard({ clientX: 10, viewportWidth: 390, handleNear: true })).toBe(
      'handles-off',
    )
    expect(decideHandleGuard({ clientX: 380, viewportWidth: 390, handleNear: true })).toBe(
      'handles-off',
    )
    expect(decideHandleGuard({ clientX: 10, viewportWidth: 390, handleNear: false })).toBe('none')
  })

  it('lets a handle win over the freeze divider elsewhere', () => {
    expect(decideHandleGuard({ clientX: 200, viewportWidth: 390, handleNear: true })).toBe(
      'freeze-off',
    )
    expect(decideHandleGuard({ clientX: 200, viewportWidth: 390, handleNear: false })).toBe('none')
  })

  it('checks the press point and a ring around it', () => {
    const points = reachPoints(100, 100, 16)
    expect(points).toHaveLength(9)
    expect(points[0]).toEqual([100, 100])
    for (const [x, y] of points.slice(1)) {
      expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(16)
    }
  })
})

describe('scrolling the edited cell into view', () => {
  it('scrolls down just enough to lift a cell above the keyboard bar', () => {
    const bottom = visibleBottom({
      visualViewportBottom: 500,
      keyboardInset: 0,
      keyboardBarHeight: 48,
    })
    expect(bottom).toBe(452)
    expect(
      revealScrollDelta({
        cellTop: 600,
        cellBottom: 640,
        viewTop: 100,
        viewBottom: bottom,
        margin: 8,
      }),
    ).toBe(640 - (452 - 8))
  })

  it('leaves a visible cell alone and brings a cell above the view down', () => {
    expect(
      revealScrollDelta({ cellTop: 200, cellBottom: 240, viewTop: 100, viewBottom: 450 }),
    ).toBe(0)
    expect(
      revealScrollDelta({ cellTop: 50, cellBottom: 90, viewTop: 100, viewBottom: 450, margin: 8 }),
    ).toBe(50 - 108)
  })

  it('keeps the top of a cell taller than the view in sight', () => {
    expect(
      revealScrollDelta({
        cellTop: 300,
        cellBottom: 900,
        viewTop: 100,
        viewBottom: 450,
        margin: 0,
      }),
    ).toBe(200)
  })

  it('counts the keyboard inset the shell publishes', () => {
    expect(
      visibleBottom({ visualViewportBottom: 844, keyboardInset: 300, keyboardBarHeight: 48 }),
    ).toBe(496)
  })
})

describe('keyboard bar input', () => {
  const sum = FORMULA_KEYS.find((key) => key.id === 'sum')!

  it('Σ types =SUM() with the caret inside the brackets', () => {
    expect(formulaKeyInput(sum, '')).toEqual({ id: 'sum', text: '=SUM()', caretBack: 1 })
    expect(formulaKeyInput(sum, '12')).toMatchObject({ text: '=SUM()', caretBack: 1 })
  })

  it('Σ inside a formula already started adds SUM() without a second =', () => {
    expect(formulaKeyInput(sum, '=A1+')).toMatchObject({ text: 'SUM()', caretBack: 1 })
    expect(formulaKeyInput(FORMULA_KEYS[0]!, '=')).toMatchObject({ text: '=' })
  })

  it('a cell holding a plain number opens on the numeric keyboard', () => {
    expect(opensNumericKeyboard({ v: 42 })).toBe(true)
    expect(opensNumericKeyboard({ v: 3.5, f: '' })).toBe(true)
    expect(opensNumericKeyboard({ v: 42, f: '=A1*2' })).toBe(false)
    expect(opensNumericKeyboard({ v: 42, si: 'shared-1' })).toBe(false)
    expect(opensNumericKeyboard({ v: '42' })).toBe(false)
    expect(opensNumericKeyboard({})).toBe(false)
    expect(opensNumericKeyboard(null)).toBe(false)
  })

  it('switches inputmode and refocuses a focused field so the keyboard rereads it', () => {
    const input = document.createElement('div')
    input.contentEditable = 'true'
    input.tabIndex = 0
    document.body.appendChild(input)
    input.focus()
    const blur = vi.spyOn(input, 'blur')
    const focus = vi.spyOn(input, 'focus')
    setNumericKeyboard(input, true)
    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(blur).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
    setNumericKeyboard(input, true)
    expect(blur).toHaveBeenCalledTimes(1)
    setNumericKeyboard(input, false)
    expect(input.hasAttribute('inputmode')).toBe(false)
    input.remove()
  })
})

describe('finishing a Korean composition first', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs at once when nothing is being composed', () => {
    const tracker = createCompositionTracker(document)
    const action = vi.fn()
    tracker.afterComposition(action)
    expect(action).toHaveBeenCalledTimes(1)
    tracker.dispose()
  })

  it('waits for compositionend, committing it through blur and focus', async () => {
    const input = document.createElement('div')
    input.contentEditable = 'true'
    input.tabIndex = 0
    document.body.appendChild(input)
    input.focus()
    const tracker = createCompositionTracker(document)
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(tracker.composing).toBe(true)
    const blur = vi.spyOn(input, 'blur')
    const action = vi.fn()
    tracker.afterComposition(action)
    expect(action).not.toHaveBeenCalled()
    expect(blur).toHaveBeenCalledTimes(1)
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한' }))
    await Promise.resolve()
    expect(action).toHaveBeenCalledTimes(1)
    expect(tracker.composing).toBe(false)
    tracker.dispose()
    input.remove()
  })

  it('still runs when the IME never reports the end', () => {
    vi.useFakeTimers()
    const tracker = createCompositionTracker(document)
    document.dispatchEvent(new CompositionEvent('compositionstart'))
    const action = vi.fn()
    tracker.afterComposition(action)
    vi.advanceTimersByTime(COMPOSITION_END_WAIT_MS - 1)
    expect(action).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(action).toHaveBeenCalledTimes(1)
    tracker.dispose()
  })
})

describe('header menu entries', () => {
  it('sends the desktop header menu commands', () => {
    expect(HEADER_MENU_COMMANDS.row).toEqual({
      insertBefore: 'sheet.command.insert-multi-rows-above',
      insertAfter: 'sheet.command.insert-multi-rows-after',
      remove: 'sheet.command.remove-row-confirm',
      hide: 'sheet.command.hide-row-confirm',
      show: 'sheet.command.set-selected-rows-visible',
      size: 'sheet.command.set-row-height',
    })
    expect(HEADER_MENU_COMMANDS.column.size).toBe('sheet.command.set-worksheet-col-width')
  })

  it('inserts as many lines as are selected and sizes in px', () => {
    const span = { axis: 'row' as const, start: 2, end: 4, count: 3 }
    expect(headerCommandFor('row', 'insertBefore', span)).toEqual({
      id: 'sheet.command.insert-multi-rows-above',
      params: { value: 3 },
    })
    expect(headerCommandFor('row', 'size', span, 30)).toEqual({
      id: 'sheet.command.set-row-height',
      params: { value: 30 },
    })
    expect(headerCommandFor('row', 'remove', span)).toEqual({
      id: 'sheet.command.remove-row-confirm',
    })
  })

  it('clamps typed sizes to the menu bounds and labels the span', () => {
    expect(parseLineSize('30')).toBe(30)
    expect(parseLineSize('1')).toBe(2)
    expect(parseLineSize('5000')).toBe(1000)
    expect(parseLineSize('abc')).toBeNull()
    expect(parseLineSize(' ')).toBeNull()
    expect(axisSpanLabel({ axis: 'row', start: 2, end: 2, count: 1 })).toBe('3')
    expect(axisSpanLabel({ axis: 'row', start: 2, end: 4, count: 3 })).toBe('3–5')
    expect(axisSpanLabel({ axis: 'column', start: 1, end: 3, count: 3 })).toBe('B–D')
  })
})

describe('the gesture layer on the grid element', () => {
  function pointer(type: string, x: number, y: number, primary = true): Event {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: primary ? 1 : 2 })
    Object.defineProperty(event, 'isPrimary', { value: primary })
    return event
  }

  it('accepts a double tap and refuses two swipes, from the events Univer also gets', async () => {
    const { installGestureLayer } = await import('../src/renderer/editors/sheets/grid/gestureLayer')
    const element = document.createElement('div')
    const target = document.createElement('canvas')
    element.appendChild(target)
    document.body.appendChild(element)
    // No sheet render: the header menu and the handle guard stay out of the way.
    const runtime = {
      univer: { __getInjector: () => ({ get: () => ({ getCurrentUnitOfType: () => null }) }) },
    } as never
    let clock = 0
    const layer = installGestureLayer(element, runtime, {
      isViewMode: () => false,
      onHeaderLongPress: () => undefined,
      now: () => clock,
    })
    target.dispatchEvent(pointer('pointerdown', 100, 100))
    clock = 60
    target.dispatchEvent(pointer('pointerup', 101, 100))
    clock = 200
    target.dispatchEvent(pointer('pointerdown', 102, 101))
    expect(layer.acceptsDoubleTap()).toBe(true)
    target.dispatchEvent(pointer('pointerup', 102, 101))

    clock = 1000
    target.dispatchEvent(pointer('pointerdown', 100, 300))
    target.dispatchEvent(pointer('pointermove', 100, 200))
    clock = 1080
    target.dispatchEvent(pointer('pointerup', 100, 150))
    clock = 1200
    target.dispatchEvent(pointer('pointerdown', 100, 300))
    expect(layer.acceptsDoubleTap()).toBe(false)
    layer.dispose()
    element.remove()
  })
})
