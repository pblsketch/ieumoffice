import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileAppPrefs,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { MOBILE_STUDIO_SETTINGS_KEY } from '@genoffice/mobile-bridge/hwp'
import { applyDocumentTheme, isResolvedThemeDark, resolveMobileTheme } from '../src/renderer/theme'
import { MobileApp } from '../src/renderer/App'

const studioExecuteSpy = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@rhwp/editor', () => ({
  createStudio: vi.fn(async (container: HTMLElement) => {
    const iframe = document.createElement('iframe')
    container.appendChild(iframe)
    return {
      element: iframe,
      chrome: { set: vi.fn(async () => {}) },
      commands: {
        execute: studioExecuteSpy,
        context: vi.fn(async () => ({ isDirty: false })),
      },
      plugins: { load: vi.fn(async () => {}) },
      loadFile: vi.fn(async () => {}),
      exportHwp: vi.fn(async () => new Uint8Array([1])),
      exportHwpx: vi.fn(async () => new Uint8Array([1])),
      exportHwpVerify: vi.fn(async () => ({ bytes: new Uint8Array([1]), ok: true })),
      notifySaved: vi.fn(async () => {}),
      destroy: vi.fn(() => {
        iframe.remove()
      }),
    }
  }),
}))

vi.mock('../src/renderer/assets/fonts', () => ({
  registerMobileKoreanFonts: vi.fn(async () => {}),
}))

import { HwpMobileEditor } from '../src/renderer/editors/HwpMobileEditor'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..', 'src-tauri', 'plugins', 'tauri-plugin-ieum-mobile')

const cleanups: Array<() => void> = []

function setNativeSystemDark(value: boolean | undefined): void {
  const win = window as { __ieumSystemDark?: boolean }
  if (typeof value === 'boolean') {
    win.__ieumSystemDark = value
    window.dispatchEvent(new CustomEvent('ieum:system-dark', { detail: value }))
  } else {
    delete win.__ieumSystemDark
  }
}

function ensureColorSchemeMeta(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'color-scheme'
    meta.content = 'light dark'
    document.head.appendChild(meta)
  }
  return meta
}

beforeEach(() => {
  ensureColorSchemeMeta().setAttribute('content', 'light dark')
  document.documentElement.removeAttribute('data-theme')
  delete (window as { __ieumSystemDark?: boolean }).__ieumSystemDark
  localStorage.clear()
  studioExecuteSpy.mockClear()
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  document.documentElement.removeAttribute('data-theme')
  delete (window as { __ieumSystemDark?: boolean }).__ieumSystemDark
})

function createPrefsTransport(initial: Partial<MobileAppPrefs> = {}): MobileTransport {
  let prefs: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwpx',
    aiEnabled: false,
    ...initial,
  }
  return {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      switch (command) {
        case 'mobile_get_app_prefs':
          return { ...prefs } as T
        case 'mobile_set_app_prefs': {
          prefs = {
            ...prefs,
            ...(typeof args?.lang === 'string' ? { lang: args.lang } : {}),
            ...(typeof args?.theme === 'string'
              ? { theme: args.theme as MobileAppPrefs['theme'] }
              : {}),
            ...(typeof args?.aiEnabled === 'boolean' ? { aiEnabled: args.aiEnabled } : {}),
          }
          return { ...prefs } as T
        }
        case 'mobile_list_recent_docs':
        case 'mobile_recovery_list':
        case 'mobile_hwp_backup_list':
        case 'mobile_home_list_folders':
        case 'mobile_home_list_favorites':
        case 'mobile_home_list_groups':
          return [] as T
        case 'mobile_home_recent_meta':
          return {} as T
        case 'mobile_get_ai_settings':
          return {
            selectedProvider: 'auto',
            modelByProvider: {},
            configuredProviders: {},
            chatgptVisible: false,
            subscriptionNoticeVersion: 0,
          } as T
        case 'mobile_chatgpt_status':
          return { state: 'signedOut', account: null, sharing: false } as T
        case 'mobile_consume_pending_open_intent':
        case 'mobile_home_take_incoming':
          return null as T
        case 'mobile_set_openable_formats':
          return undefined as T
        default:
          return undefined as T
      }
    },
    listen: async () => () => {},
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolveFn) => setTimeout(resolveFn, 0))
  })
}

describe('mobile theme resolution and document attributes', () => {
  it('resolves explicit light/dark regardless of OS night mode, and follows OS only in system mode', () => {
    // Device dark + app light -> light
    expect(resolveMobileTheme('light', true)).toBe('light')
    expect(isResolvedThemeDark('light', true)).toBe(false)

    // Device light + app dark -> dark
    expect(resolveMobileTheme('dark', false)).toBe('dark')
    expect(isResolvedThemeDark('dark', false)).toBe(true)

    // Device dark + app system -> dark
    expect(resolveMobileTheme('system', true)).toBe('dark')
    expect(isResolvedThemeDark('system', true)).toBe(true)

    // Device light + app system -> light
    expect(resolveMobileTheme('system', false)).toBe('light')
    expect(isResolvedThemeDark('system', false)).toBe(false)

    // Unknown native flag (e.g. iOS/desktop) + app system -> system
    expect(resolveMobileTheme('system', undefined)).toBe('system')
  })

  it('syncs both <html data-theme> and <meta name="color-scheme">', () => {
    const meta = ensureColorSchemeMeta()

    applyDocumentTheme(document, 'light', true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(meta.getAttribute('content')).toBe('light')

    applyDocumentTheme(document, 'dark', false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(meta.getAttribute('content')).toBe('dark')

    applyDocumentTheme(document, 'system', true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(meta.getAttribute('content')).toBe('dark')

    applyDocumentTheme(document, 'system', undefined)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(meta.getAttribute('content')).toBe('light dark')
  })

  it('keeps MobileApp locked to explicit light under Android dark mode and follows OS only in system mode', async () => {
    setNativeSystemDark(true)
    const client = createMobileClient(createPrefsTransport({ theme: 'light' }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    cleanups.push(() => {
      act(() => root.unmount())
      host.remove()
    })

    act(() => {
      root.render(<MobileApp client={client} />)
    })
    await flush()

    const meta = ensureColorSchemeMeta()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(meta.getAttribute('content')).toBe('light')

    // Toggling OS dark mode does not override explicit light.
    act(() => setNativeSystemDark(false))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(meta.getAttribute('content')).toBe('light')

    act(() => setNativeSystemDark(true))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(meta.getAttribute('content')).toBe('light')
  })

  it('seeds HwpMobileEditor studio settings with resolved theme and updates live without reload', async () => {
    setNativeSystemDark(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root: Root = createRoot(host)
    cleanups.push(() => {
      act(() => root.unmount())
      host.remove()
    })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

    act(() => {
      root.render(
        <HwpMobileEditor
          fileName="sample.hwpx"
          documentBytes={bytes}
          mode="view"
          lang="ko"
          theme="light"
          onDirty={() => {}}
        />,
      )
    })
    await flush()

    const lightSeeded = JSON.parse(localStorage.getItem(MOBILE_STUDIO_SETTINGS_KEY) ?? '{}') as {
      theme?: { mode?: string }
    }
    expect(lightSeeded.theme?.mode).toBe('light')

    // Switching app theme to system while device is dark resolves studio to dark.
    act(() => {
      root.render(
        <HwpMobileEditor
          fileName="sample.hwpx"
          documentBytes={bytes}
          mode="view"
          lang="ko"
          theme="system"
          onDirty={() => {}}
        />,
      )
    })
    await flush()

    const systemSeeded = JSON.parse(localStorage.getItem(MOBILE_STUDIO_SETTINGS_KEY) ?? '{}') as {
      theme?: { mode?: string }
    }
    expect(systemSeeded.theme?.mode).toBe('dark')
    expect(studioExecuteSpy).toHaveBeenCalledWith('view:theme-dark')
  })
})

describe('native mobile theme plugins', () => {
  it('disables Android WebView algorithmic darkening and handles setAppTheme', () => {
    const ktPath = resolve(
      PLUGIN_ROOT,
      'android/src/main/java/com/ieumoffice/mobile/plugin/IeumFilePlugin.kt',
    )
    const kt = readFileSync(ktPath, 'utf8')
    expect(kt).toContain('isAlgorithmicDarkeningAllowed = false')
    expect(kt).not.toContain('isAlgorithmicDarkeningAllowed = true')
    expect(kt).toContain('fun setAppTheme(')
    expect(kt).toContain('isEffectiveDark')
  })

  it('applies overrideUserInterfaceStyle on iOS for explicit light/dark/system themes', () => {
    const swiftPath = resolve(PLUGIN_ROOT, 'ios/Sources/IeumFilePlugin.swift')
    const swift = readFileSync(swiftPath, 'utf8')
    expect(swift).toContain('func setAppTheme(')
    expect(swift).toContain('overrideUserInterfaceStyle = style')
    expect(swift).toContain('case "light":')
    expect(swift).toContain('case "dark":')
    expect(swift).toContain('style = .unspecified')
  })
})
