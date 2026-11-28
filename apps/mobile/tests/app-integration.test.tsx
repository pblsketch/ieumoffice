import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileChatGptStatus,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { MobileApp } from '../src/renderer/App'
import { applyAndroidConfig, applyIosConfig } from '../scripts/apply-native-config.mjs'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const containers: HTMLElement[] = []

afterEach(() => {
  while (containers.length > 0) {
    containers.pop()?.remove()
  }
})

function makeMockTransport(options?: { pendingIntent?: MobileDocSession | null }): {
  transport: MobileTransport
  calls: Array<{ command: string; args?: Record<string, unknown> }>
} {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  let prefs: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwp',
    aiEnabled: true,
  }
  const aiSettings: MobileAiSettingsSnapshot = {
    selectedProvider: 'auto',
    modelByProvider: {},
    configuredProviders: {},
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
  const chatgptStatus: MobileChatGptStatus = { state: 'hidden' }
  let pendingIntent = options?.pendingIntent ?? null

  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_get_app_prefs':
          return prefs as T
        case 'mobile_set_app_prefs':
          prefs = { ...prefs, ...(args as Partial<MobileAppPrefs>) }
          return prefs as T
        case 'mobile_get_ai_settings':
          return aiSettings as T
        case 'mobile_set_ai_settings':
          return aiSettings as T
        case 'mobile_chatgpt_status':
          return chatgptStatus as T
        case 'mobile_list_recent_docs':
          return [] as T
        case 'mobile_recovery_list':
          return [] as T
        case 'mobile_hwp_backup_list':
          return [] as T
        case 'mobile_consume_pending_open_intent': {
          const next = pendingIntent
          pendingIntent = null
          return next as T
        }
        case 'mobile_create_untitled_session':
          return {
            sessionId: 'untitled-1',
            docKey: 'untitled-abc',
            name: 'Untitled.md',
            ext: 'md',
            format: 'md',
            writable: false,
            ephemeral: false,
          } as T
        case 'mobile_read_file_bytes':
          return {
            bytesBase64: Buffer.from('# Shared Note\nBody text.', 'utf8').toString('base64'),
          } as T
        case 'mobile_recovery_discard':
        case 'mobile_ai_stream_cancel':
          return { ok: true } as T
        default:
          return { ok: true } as T
      }
    },
    async listen() {
      return () => {}
    },
  }
  return { transport, calls }
}

describe('MobileApp end-to-end integration', () => {
  it('opens an external ephemeral share intent in view mode and lets the user toggle to edit mode', async () => {
    const ephemeralDoc: MobileDocSession = {
      sessionId: 'ext-1',
      docKey: 'untitled-share-1',
      name: 'shared.md',
      ext: 'md',
      format: 'md',
      writable: false,
      ephemeral: true,
    }
    const { transport } = makeMockTransport({ pendingIntent: ephemeralDoc })
    const client = createMobileClient(transport)

    const div = document.createElement('div')
    document.body.appendChild(div)
    containers.push(div)
    const root = createRoot(div)

    await act(async () => {
      root.render(<MobileApp client={client} />)
      await new Promise((r) => setTimeout(r, 30))
    })

    const mdView = div.querySelector('[data-editor="markdown"]')
    expect(mdView).not.toBeNull()
    expect(mdView?.getAttribute('data-mode')).toBe('view')
  })

  it('creates a new Markdown document directly in edit mode from HomeScreen', async () => {
    const { transport } = makeMockTransport()
    const client = createMobileClient(transport)

    const div = document.createElement('div')
    document.body.appendChild(div)
    containers.push(div)
    const root = createRoot(div)

    await act(async () => {
      root.render(<MobileApp client={client} />)
      await new Promise((r) => setTimeout(r, 30))
    })

    const newMdBtn = div.querySelector<HTMLButtonElement>('[data-testid="home-new-md-btn"]')
    expect(newMdBtn).not.toBeNull()

    await act(async () => {
      newMdBtn?.click()
      await new Promise((r) => setTimeout(r, 30))
    })

    const mdEditor = div.querySelector('[data-editor="markdown"]')
    expect(mdEditor).not.toBeNull()
    expect(mdEditor?.getAttribute('data-mode')).toBe('edit')
  })
})

describe('apply-native-config idempotency for Android and iOS', () => {
  it('injects Android manifest + FileProvider and iOS Info.plist + Entitlements idempotently', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ieum-native-cfg-'))
    try {
      const androidApp = join(tmp, 'android', 'app')
      const androidMain = join(androidApp, 'src', 'main')
      mkdirSync(androidMain, { recursive: true })
      writeFileSync(
        join(androidMain, 'AndroidManifest.xml'),
        '<manifest><application><activity android:name=".MainActivity"></activity></application></manifest>',
        'utf8',
      )
      writeFileSync(
        join(androidApp, 'build.gradle.kts'),
        'android {\n  namespace = "com.ieumoffice.mobile"\n}\napply(from = file("tauri.build.gradle.kts"))\n',
        'utf8',
      )

      const iosApp = join(tmp, 'apple', 'ieumoffice-mobile_iOS')
      mkdirSync(iosApp, { recursive: true })
      writeFileSync(
        join(iosApp, 'Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict>\r\n  <key>CFBundleName</key>\r\n  <string>IeumOffice</string>\r\n</dict>\r\n</plist>',
        'utf8',
      )

      const a1 = applyAndroidConfig(tmp)
      const a2 = applyAndroidConfig(tmp)
      expect(a1.applied).toBe(true)
      expect(a2.applied).toBe(true)
      const manifest = readFileSync(join(androidMain, 'AndroidManifest.xml'), 'utf8')
      expect(manifest.match(/IEUM_MOBILE_INTENT_FILTERS_START/g)?.length).toBe(1)
      expect(manifest).toContain('com.ieumoffice.mobile.fileprovider')
      expect(manifest).toContain('ieumoffice.com')
      expect(existsSync(join(androidMain, 'res', 'drawable', 'ic_launcher_background.xml'))).toBe(
        true,
      )
      expect(existsSync(join(androidMain, 'res', 'mipmap-xxxhdpi', 'ic_launcher.png'))).toBe(true)
      const gradle = readFileSync(join(androidApp, 'build.gradle.kts'), 'utf8')
      expect(gradle.match(/IEUM_MOBILE_GRADLE_SIGNING_START/g)?.length).toBe(1)
      expect(gradle).toContain('ANDROID_KEYSTORE_PATH')
      expect(gradle).toContain('IEUM_ANDROID_VERSION_CODE')

      const i1 = applyIosConfig(tmp)
      const i2 = applyIosConfig(tmp)
      expect(i1.applied).toBe(true)
      expect(i2.applied).toBe(true)
      const plist = readFileSync(join(iosApp, 'Info.plist'), 'utf8')
      expect(plist.match(/IEUM_MOBILE_IOS_PLIST_START/g)?.length).toBe(1)
      expect(plist).toContain('LSSupportsOpeningDocumentsInPlace')
      expect(plist).toContain('ITSAppUsesNonExemptEncryption')
      expect(plist).toContain('com.hancom.hwp')
      expect(plist).not.toContain('NSLocalNetworkUsageDescription')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
