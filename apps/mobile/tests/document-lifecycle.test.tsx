import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  MobileCommandError,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../src/renderer/editors/editorKind'
import { MobileApp } from '../src/renderer/App'

// Pins the per-document hooks a track's editor uses instead of editing App.tsx: a cancel while
// opening, dispose when the document closes, and a document that is read-only or keeps AI hidden.

const doc = vi.hoisted(() => ({
  cancelOpen: false,
  editable: undefined as boolean | undefined,
  aiAvailable: undefined as boolean | undefined,
  disposed: 0,
}))

vi.mock('../src/renderer/editors/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/editors/registry')>()
  const wrap = (kind: EditorKind): EditorKind => ({
    ...kind,
    async open(request) {
      if (doc.cancelOpen) {
        throw new MobileCommandError({ code: 'USER_CANCELLED', messageKey: 'test.cancelled' })
      }
      const opened = await kind.open(request)
      return {
        ...opened,
        start(host) {
          const started = opened.start(host)
          return {
            ...started,
            editable: doc.editable,
            aiAvailable: doc.aiAvailable,
            dispose: () => {
              doc.disposed += 1
            },
          }
        },
      }
    },
  })
  return {
    ...actual,
    findEditorKind: (format: Parameters<typeof actual.findEditorKind>[0]) => {
      const kind = actual.findEditorKind(format)
      return kind ? wrap(kind) : null
    },
  }
})

function makeClient() {
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
  let untitled = 0
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      switch (command) {
        case 'mobile_get_app_prefs':
          return prefs as T
        case 'mobile_set_app_prefs':
          prefs = { ...prefs, ...(args as Partial<MobileAppPrefs>) }
          return prefs as T
        case 'mobile_get_ai_settings':
        case 'mobile_set_ai_settings':
          return aiSettings as T
        case 'mobile_chatgpt_status':
          return { state: 'hidden' } as T
        case 'mobile_list_recent_docs':
        case 'mobile_recovery_list':
        case 'mobile_hwp_backup_list':
          return [] as T
        case 'mobile_consume_pending_open_intent':
          return null as T
        case 'mobile_create_untitled_session':
          untitled += 1
          return {
            sessionId: `untitled-${untitled}`,
            docKey: `untitled-key-${untitled}`,
            name: 'Untitled.md',
            ext: 'md',
            format: 'md',
            writable: false,
            ephemeral: false,
          } as T
        default:
          return { ok: true } as T
      }
    },
    async listen() {
      return () => {}
    },
  }
  return createMobileClient(transport)
}

const containers: HTMLElement[] = []
const originalWidth = window.innerWidth
const settle = () => new Promise((r) => setTimeout(r, 30))

beforeEach(() => {
  Object.assign(doc, {
    cancelOpen: false,
    editable: undefined,
    aiAvailable: undefined,
    disposed: 0,
  })
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
})

afterEach(() => {
  while (containers.length > 0) containers.pop()?.remove()
  Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
})

async function renderApp(): Promise<HTMLElement> {
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={makeClient()} />)
    await settle()
  })
  return div
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await settle()
  })
}

describe('the per-document hooks for the tracks', () => {
  it('stays on the home screen without an error when the user cancels while the editor opens', async () => {
    doc.cancelOpen = true
    const div = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    expect(div.querySelector('[data-testid="editor-header"]')).toBeNull()
    expect(div.querySelector('[data-testid="mobile-home-screen"]')).not.toBeNull()
    expect(div.querySelector('[data-testid="mobile-toast"]')).toBeNull()
  })

  it('disposes the document once when it is closed', async () => {
    const div = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    expect(doc.disposed).toBe(0)
    await click(div.querySelector('[data-testid="editor-back-btn"]'))
    expect(doc.disposed).toBe(1)
  })

  it('opens a read-only document in view mode without an edit button', async () => {
    doc.editable = false
    const div = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    expect(div.querySelector('[data-testid="editor-header"]')).not.toBeNull()
    expect(div.querySelector('[data-testid="editor-mode-toggle"]')).toBeNull()
  })

  it('hides the AI entry points for a document that keeps AI hidden, with AI on', async () => {
    doc.aiAvailable = false
    const div = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    expect(div.querySelector('[data-testid="phone-ai-open-btn"]')).toBeNull()
    expect(div.querySelector('[data-testid="phone-view-ai-btn"]')).toBeNull()
  })

  it('shows the AI entry points for an ordinary document with AI on', async () => {
    const div = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    expect(
      div.querySelector('[data-testid="phone-ai-open-btn"], [data-testid="phone-view-ai-btn"]'),
    ).not.toBeNull()
  })
})
