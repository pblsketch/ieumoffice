// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { pollWhileVisible, observeViewVisibility } from '../src/renderer/visible-poll'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('delivers native visibility after its initial reply and disposes the display observer', async () => {
  let initial!: (visible: boolean) => void
  let notify!: (visible: boolean) => void
  const unsubscribe = vi.fn()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('aiOfficeViewVisibility', {
    getVisible: () =>
      new Promise<boolean>((resolve) => {
        initial = resolve
      }),
    onChanged: (listener: typeof notify) => {
      notify = listener
      return unsubscribe
    },
  })
  const listener = vi.fn()
  const stop = observeViewVisibility(listener)
  expect(listener).not.toHaveBeenCalled()
  initial(true)
  await Promise.resolve()
  await Promise.resolve()
  expect(listener).toHaveBeenLastCalledWith(true)
  notify(false)
  expect(listener).toHaveBeenLastCalledWith(false)
  stop()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('uses pushed native tab state, drops a stale initial answer and unsubscribes on stop', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  let notify!: (visible: boolean) => void
  let initial!: (visible: boolean) => void
  const unsubscribe = vi.fn()
  vi.stubGlobal('aiOfficeViewVisibility', {
    getVisible: () =>
      new Promise<boolean>((done) => {
        initial = done
      }),
    onChanged: (handler: typeof notify) => {
      notify = handler
      return unsubscribe
    },
  })
  const read = vi.fn(async () => {})
  const stop = pollWhileVisible(read, 100)
  expect(read).not.toHaveBeenCalled()
  notify(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(1)
  notify(false)
  initial(true)
  await vi.advanceTimersByTimeAsync(1000)
  expect(read).toHaveBeenCalledTimes(1)
  notify(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(2)
  stop()
  expect(unsubscribe).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(read).toHaveBeenCalledTimes(2)
})

it('sleeps in a hidden tab, resumes immediately, avoids overlapping reads and stops cleanly', async () => {
  vi.useFakeTimers()
  let hidden = true
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible',
  )
  let finish!: () => void
  const read = vi.fn(
    () =>
      new Promise<void>((done) => {
        finish = done
      }),
  )
  const stop = pollWhileVisible(read, 100)
  await vi.advanceTimersByTimeAsync(1000)
  expect(read).not.toHaveBeenCalled()
  hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(read).toHaveBeenCalledTimes(1)
  hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  finish()
  await vi.advanceTimersByTimeAsync(1000)
  expect(read).toHaveBeenCalledTimes(1)
  hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  expect(read).toHaveBeenCalledTimes(2)
  stop()
  finish()
  await vi.advanceTimersByTimeAsync(1000)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(read).toHaveBeenCalledTimes(2)
})
