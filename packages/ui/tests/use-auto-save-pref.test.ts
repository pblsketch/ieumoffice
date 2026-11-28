/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAutoSavePref,
  type AutoSaveDefault,
  type AutoSaveDefaultApi,
} from '../src/auto-save-pref'

describe('useAutoSavePref', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('settles without looping even when the caller passes an inline api wrapper', async () => {
    let renders = 0
    let getCalls = 0
    let subscribeCalls = 0
    let unsubscribeCalls = 0
    const listeners = new Set<(value: AutoSaveDefault) => void>()

    const getAutoSaveDefault = async (): Promise<AutoSaveDefault> => {
      getCalls += 1
      // IPC returns a freshly cloned object on every invoke.
      return { on: false, updatedAt: 1700000000000 }
    }
    const onAutoSaveDefaultChanged = (handler: (value: AutoSaveDefault) => void) => {
      subscribeCalls += 1
      listeners.add(handler)
      return () => {
        unsubscribeCalls += 1
        listeners.delete(handler)
      }
    }

    function InlineApiProbe() {
      renders += 1
      if (renders > 10) throw new Error('infinite render loop')
      useAutoSavePref('test.autoSave.inline', {
        getAutoSaveDefault: () => getAutoSaveDefault(),
        onAutoSaveDefaultChanged: (h) => onAutoSaveDefaultChanged(h),
      })
      return null
    }

    await act(async () => {
      root.render(createElement(InlineApiProbe))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Initial mount + one state update when updatedAt changes from 0 -> 1700000000000,
    // then the next equal IPC response bails out instead of looping forever.
    expect(renders).toBe(2)
    expect(getCalls).toBe(2)
    expect(subscribeCalls).toBe(2)
    expect(unsubscribeCalls).toBe(1)
    expect(listeners.size).toBe(1)
  })

  it('fetches once with a stable api and reacts to live default changes', async () => {
    let renders = 0
    let getCalls = 0
    const seen: boolean[] = []
    const listeners = new Set<(value: AutoSaveDefault) => void>()

    const stableApi: AutoSaveDefaultApi = {
      getAutoSaveDefault: async () => {
        getCalls += 1
        return { on: false, updatedAt: 100 }
      },
      onAutoSaveDefaultChanged: (handler) => {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    }

    function StableApiProbe() {
      renders += 1
      const [autoSave] = useAutoSavePref('test.autoSave.stable', stableApi)
      seen.push(autoSave)
      return null
    }

    await act(async () => {
      root.render(createElement(StableApiProbe))
      await Promise.resolve()
    })

    expect(getCalls).toBe(1)
    expect(renders).toBe(2)
    expect(seen.at(-1)).toBe(false)

    // Re-emitting an identical value must not trigger another render.
    const rendersBeforeSame = renders
    act(() => {
      for (const l of listeners) l({ on: false, updatedAt: 100 })
    })
    expect(renders).toBe(rendersBeforeSame)

    // Emitting a changed default updates autoSave.
    act(() => {
      for (const l of listeners) l({ on: true, updatedAt: 200 })
    })
    expect(seen.at(-1)).toBe(true)
  })
})
