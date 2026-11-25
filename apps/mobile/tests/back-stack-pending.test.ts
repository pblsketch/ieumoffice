import { describe, expect, it } from 'vitest'
import { createBackStack } from '../src/renderer/shell/backStack'

/**
 * A history like a browser's: pushState takes effect at once and cancels a back()
 * that is still on its way (as jsdom does; Chromium loses an entry there too),
 * back() is otherwise answered later by a popstate (here when flush() runs), and
 * a back past the first entry leaves the app.
 */
function fakeWindow() {
  const listeners: Array<() => void> = []
  const entries: unknown[] = ['app']
  let index = 0
  let pendingBacks = 0
  let leftApp = false
  const win = {
    history: {
      pushState(state: unknown) {
        pendingBacks = 0
        entries.splice(index + 1)
        entries.push(state)
        index += 1
      },
      back() {
        pendingBacks += 1
      },
    },
    addEventListener(type: string, listener: () => void) {
      if (type === 'popstate') listeners.push(listener)
    },
  }
  const pop = () => {
    if (index === 0) {
      leftApp = true
      return
    }
    index -= 1
    for (const listener of listeners) listener()
  }
  return {
    win: win as unknown as Window,
    /** Delivers the backs the app asked for, one popstate each. */
    flush() {
      while (pendingBacks > 0) {
        pendingBacks -= 1
        pop()
      }
    },
    /** The system Back key. */
    systemBack: pop,
    entriesAboveApp: () => index,
    leftApp: () => leftApp,
  }
}

describe('back stack with backs answered later', () => {
  it('keeps one entry per layer when a sheet closes and another opens in the same tap', () => {
    const fake = fakeWindow()
    const stack = createBackStack(fake.win)
    const calls: string[] = []
    stack.push(() => calls.push('screen'))
    const more = stack.push(() => calls.push('more'))

    for (let round = 0; round < 3; round += 1) {
      // a row of the [⋯] sheet closes it and opens another sheet before the back arrives
      stack.remove(more)
      const other = stack.push(() => calls.push('other'))
      fake.flush()
      expect(fake.entriesAboveApp()).toBe(stack.depth())
      stack.remove(other)
      fake.flush()
      expect(fake.entriesAboveApp()).toBe(stack.depth())
    }

    fake.systemBack()
    expect(calls).toEqual(['screen'])
    expect(fake.leftApp()).toBe(false)
  })

  it('keeps the entries aligned when a screen remounts its layers', () => {
    const fake = fakeWindow()
    const stack = createBackStack(fake.win)
    const a = stack.push(() => {})
    const b = stack.push(() => {})
    stack.remove(b)
    stack.remove(a)
    stack.push(() => {})
    stack.push(() => {})
    fake.flush()
    expect(stack.depth()).toBe(2)
    expect(fake.entriesAboveApp()).toBe(2)
  })

  it('pops nothing for a layer that closed before it got its entry', () => {
    const fake = fakeWindow()
    const stack = createBackStack(fake.win)
    stack.push(() => {})
    const sheet = stack.push(() => {})
    stack.remove(sheet)
    const quick = stack.push(() => {})
    stack.remove(quick)
    fake.flush()
    expect(stack.depth()).toBe(1)
    expect(fake.entriesAboveApp()).toBe(1)
  })
})
