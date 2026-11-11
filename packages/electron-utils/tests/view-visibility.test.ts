import { expect, it, vi } from 'vitest'
import type { IpcRenderer, WebContents, WebContentsView } from 'electron'
import {
  setViewVisible,
  viewIsVisible,
  viewVisibilityBridge,
  VIEW_VISIBILITY_CHANNELS,
} from '../src/view-visibility'

it('keeps native state for late preloads, coalesces layout events, and follows detach/show', () => {
  const contents = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
  const view = { webContents: contents, setVisible: vi.fn() }
  const wc = contents as unknown as WebContents
  expect(viewIsVisible(wc)).toBe(true)
  setViewVisible(view as unknown as WebContentsView, false)
  expect(viewIsVisible(wc)).toBe(false)
  setViewVisible(view as unknown as WebContentsView, false)
  expect(contents.send).toHaveBeenCalledTimes(1)
  setViewVisible(view as unknown as WebContentsView, true)
  expect(viewIsVisible(wc)).toBe(true)
  expect(contents.send).toHaveBeenLastCalledWith(VIEW_VISIBILITY_CHANNELS.changed, true)
  contents.isDestroyed.mockReturnValue(true)
  setViewVisible(view as unknown as WebContentsView, false)
  expect(contents.send).toHaveBeenCalledTimes(2)
})

it('still records state if a frame is not ready to receive a push', () => {
  const contents = {
    send: () => {
      throw new Error('no frame')
    },
    isDestroyed: () => false,
  }
  const view = { webContents: contents, setVisible: vi.fn() }
  setViewVisible(view as unknown as WebContentsView, false)
  expect(viewIsVisible(contents as unknown as WebContents)).toBe(false)
})

it('validates pushed values, removes its listener and defaults standalone pulls to visible', async () => {
  let listener!: (_event: unknown, value: unknown) => void
  const ipc = {
    invoke: vi.fn(async () => false),
    on: vi.fn((_channel: string, handler: (_event: unknown, value: unknown) => void) => {
      listener = handler
    }),
    removeListener: vi.fn(),
  }
  const bridge = viewVisibilityBridge(ipc as unknown as IpcRenderer)
  const changed = vi.fn()
  const stop = bridge.onChanged(changed)
  listener({}, 'false')
  listener({}, false)
  expect(changed).toHaveBeenCalledExactlyOnceWith(false)
  expect(await bridge.getVisible()).toBe(false)
  ipc.invoke.mockRejectedValueOnce(new Error('no shell'))
  expect(await bridge.getVisible()).toBe(true)
  stop()
  expect(ipc.removeListener).toHaveBeenCalledWith(VIEW_VISIBILITY_CHANNELS.changed, listener)
})
