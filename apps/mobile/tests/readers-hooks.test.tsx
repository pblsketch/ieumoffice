import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import {
  pickKeepScreenOn,
  useReaderKeepScreenOn,
  type KeepScreenOnHook,
} from '../src/renderer/editors/readers/shared/keepScreenOn'
import {
  copyText,
  isOpenableExternalUrl,
  pickExternalUrlOpener,
  readerExternalUrlOpener,
} from '../src/renderer/editors/readers/shared/externalUrl'

// Pins the "link if present" hooks of track T5 to track T6: the keep-screen-on hook and the
// outside-link opener are picked from T6's modules when they exist, and do nothing otherwise.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = { transport: { invoke: vi.fn() } } as unknown as MobileClient

function renderHook(hook: KeepScreenOnHook, active: boolean): () => void {
  function Probe() {
    hook(client, active)
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<Probe />))
  return () => {
    act(() => root.unmount())
    host.remove()
  }
}

// jsdom has no navigator.clipboard; each copy test defines its own and removes it afterwards.
function setClipboard(value: Clipboard): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

describe('pickKeepScreenOn', () => {
  it('uses the T6 hook when the module exports useKeepScreenOn', () => {
    const useKeepScreenOn = vi.fn()
    const hook = pickKeepScreenOn({ '../../../home/keepScreenOn.ts': { useKeepScreenOn } })
    expect(hook).toBe(useKeepScreenOn)
    const cleanup = renderHook(hook, true)
    expect(useKeepScreenOn).toHaveBeenCalledWith(client, true)
    cleanup()
    const cleanupOff = renderHook(hook, false)
    expect(useKeepScreenOn).toHaveBeenLastCalledWith(client, false)
    cleanupOff()
  })

  it('falls back to a no-op hook when the module is absent or has the wrong shape', () => {
    const maps: Record<string, unknown>[] = [
      {},
      { '../../../home/keepScreenOn.ts': {} },
      { '../../../home/keepScreenOn.ts': { useKeepScreenOn: 'not a function' } },
      { '../../../home/keepScreenOn.ts': null },
      { '../../../home/keepScreenOn.ts': 42 },
    ]
    for (const modules of maps) {
      const hook = pickKeepScreenOn(modules)
      expect(() => hook(client, true)).not.toThrow()
      expect(hook(client, true)).toBeUndefined()
      const cleanup = renderHook(hook, true)
      cleanup()
    }
  })

  it('exports a reader hook that renders without T6 on this branch', () => {
    expect(typeof useReaderKeepScreenOn).toBe('function')
    const cleanup = renderHook(useReaderKeepScreenOn, true)
    cleanup()
  })
})

describe('pickExternalUrlOpener', () => {
  it('wraps the bridge openExternalUrl when it is present', async () => {
    const openExternalUrl = vi.fn(async () => ({ ok: true }))
    const opener = pickExternalUrlOpener({ openExternalUrl })
    expect(opener).not.toBeNull()
    await expect(opener!(client, '  https://example.com/a  ')).resolves.toBeUndefined()
    expect(openExternalUrl).toHaveBeenCalledWith(client, 'https://example.com/a')
  })

  it('refuses a URL that is not openable without calling the bridge', async () => {
    const openExternalUrl = vi.fn(async () => ({ ok: true }))
    const opener = pickExternalUrlOpener({ openExternalUrl })
    await expect(opener!(client, 'javascript:alert(1)')).rejects.toThrow()
    expect(openExternalUrl).not.toHaveBeenCalled()
  })

  it('passes a bridge rejection on', async () => {
    const opener = pickExternalUrlOpener({
      openExternalUrl: vi.fn(async () => {
        throw new Error('refused')
      }),
    })
    await expect(opener!(client, 'https://example.com')).rejects.toThrow('refused')
  })

  it('is null when the function is missing', () => {
    expect(pickExternalUrlOpener({})).toBeNull()
    expect(pickExternalUrlOpener({ openExternalUrl: 'nope' })).toBeNull()
    expect(pickExternalUrlOpener(null)).toBeNull()
    expect(pickExternalUrlOpener(undefined)).toBeNull()
    expect(pickExternalUrlOpener(7)).toBeNull()
  })

  it('matches the bridge module on this branch (null until T6 lands, a function after)', () => {
    expect(readerExternalUrlOpener === null || typeof readerExternalUrlOpener === 'function').toBe(
      true,
    )
  })
})

describe('isOpenableExternalUrl', () => {
  it.each([
    ['http://example.com', true],
    ['https://example.com/path?q=1#x', true],
    ['  https://example.com  ', true],
    ['mailto:someone@example.com', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['data:text/html,<b>x</b>', false],
    ['chapter2.xhtml#sec', false],
    ['/absolute/path', false],
    ['//example.com/protocol-relative', false],
    ['ftp://example.com', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isOpenableExternalUrl(url)).toBe(expected)
  })
})

describe('copyText', () => {
  it('uses the clipboard API when it works', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText } as unknown as Clipboard)
    await expect(copyText('https://example.com')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://example.com')
  })

  it('falls back to a hidden textarea when the clipboard API fails', async () => {
    setClipboard({
      writeText: vi.fn(async () => {
        throw new Error('denied')
      }),
    } as unknown as Clipboard)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      await expect(copyText('text')).resolves.toBe(true)
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(document.querySelector('textarea')).toBeNull()
    } finally {
      Reflect.deleteProperty(document, 'execCommand')
    }
  })

  it('resolves false when nothing can copy', async () => {
    setClipboard(undefined as unknown as Clipboard)
    const execCommand = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      await expect(copyText('text')).resolves.toBe(false)
    } finally {
      Reflect.deleteProperty(document, 'execCommand')
    }
  })
})
