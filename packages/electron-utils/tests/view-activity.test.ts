import { expect, it, vi } from 'vitest'
import { createViewActivity } from '../src/view-activity'

it('waits without polling, obeys both native and OS visibility, and cancels individual waiters', async () => {
  let osVisible = true
  let osChange!: () => void
  let push!: (visible: boolean) => void
  let reply!: (visible: boolean) => void
  const off = vi.fn()
  const doc = {
    get visibilityState() {
      return osVisible ? 'visible' : 'hidden'
    },
    addEventListener: (_name: string, handler: () => void) => {
      osChange = handler
    },
    removeEventListener: vi.fn(),
  }
  const activity = createViewActivity(doc, {
    getVisible: () =>
      new Promise((resolve) => {
        reply = resolve
      }),
    onChanged: (handler) => {
      push = handler
      return off
    },
  })
  const first = activity.wait()
  const aborted = new AbortController()
  const second = activity.wait(aborted.signal)
  aborted.abort()
  expect(await second).toBe(false)
  push(false)
  reply(true)
  await Promise.resolve()
  expect(activity.isVisible()).toBe(false)
  osVisible = false
  push(true)
  expect(activity.isVisible()).toBe(false)
  osVisible = true
  osChange()
  expect(await first).toBe(true)
  expect(await activity.wait()).toBe(true)
  push(false)
  const closed = activity.wait()
  activity.dispose()
  expect(await closed).toBe(false)
  expect(off).toHaveBeenCalledOnce()
  expect(await activity.wait()).toBe(false)
})
