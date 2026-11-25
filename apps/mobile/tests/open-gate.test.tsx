import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileChatGptStatus,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import { MobileApp } from '../src/renderer/App'

// The app's open wiring is pinned against a registry of only the two kinds S0 shipped, so the
// tracks registering their formats in the real registry never have to edit this file.
vi.mock('../src/renderer/editors/registry', async () => {
  const { hwpEditorKind } = await import('../src/renderer/editors/hwpKind')
  const { markdownEditorKind } = await import('../src/renderer/editors/markdownKind')
  const kinds = [hwpEditorKind, markdownEditorKind]
  return {
    EDITOR_KINDS: kinds,
    findEditorKind: (format: string) =>
      kinds.find((kind) => (kind.formats as readonly string[]).includes(format)) ?? null,
    openableExtensions: () => kinds.flatMap((kind) => kind.openExtensions),
  }
})

const NOT_OPENABLE_KO = '이 파일 형식은 열 수 없습니다.'
const NOT_OPENABLE_ERROR = {
  code: 'INVALID_ARGUMENT',
  messageKey: 'mobile.format.notOpenable',
  detail: 'pdf',
}

const containers: HTMLElement[] = []

afterEach(() => {
  vi.useRealTimers()
  while (containers.length > 0) {
    containers.pop()?.remove()
  }
})

interface MockOptions {
  readonly pendingIntent?: MobileDocSession | null
  readonly pickResult?: () => MobileDocSession
}

function makeMockTransport(options?: MockOptions): {
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
        case 'mobile_set_ai_settings':
          return aiSettings as T
        case 'mobile_chatgpt_status':
          return chatgptStatus as T
        case 'mobile_list_recent_docs':
        case 'mobile_recovery_list':
        case 'mobile_hwp_backup_list':
          return [] as T
        case 'mobile_consume_pending_open_intent': {
          const next = pendingIntent
          pendingIntent = null
          return next as T
        }
        case 'mobile_pick_open_file':
          if (!options?.pickResult) throw NOT_OPENABLE_ERROR
          return options.pickResult() as T
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
            bytesBase64: Buffer.from('# Note\nBody.', 'utf8').toString('base64'),
          } as T
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

async function renderApp(options?: MockOptions) {
  const { transport, calls } = makeMockTransport(options)
  const client = createMobileClient(transport)
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={client} />)
    await new Promise((r) => setTimeout(r, 30))
  })
  return { div, calls }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 30))
  })
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function recoveryWrites(calls: Array<{ command: string; args?: Record<string, unknown> }>) {
  return calls.filter((c) => c.command === 'mobile_recovery_write')
}

describe('the open gate in the app', () => {
  it('tells the backend which extensions open before it takes the incoming document', async () => {
    const { calls } = await renderApp()
    const gateIndex = calls.findIndex((c) => c.command === 'mobile_set_openable_formats')
    const intentIndex = calls.findIndex((c) => c.command === 'mobile_consume_pending_open_intent')
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(calls[gateIndex]?.args).toEqual({ exts: ['hwp', 'hwpx', 'md', 'markdown', 'txt'] })
    expect(intentIndex).toBeGreaterThan(gateIndex)
  })

  it('offers the registered extensions to the system picker', async () => {
    const { div, calls } = await renderApp()
    await click(div.querySelector('[data-testid="home-open-file-btn"]'))
    const pick = calls.find((c) => c.command === 'mobile_pick_open_file')
    expect(pick?.args).toEqual({ exts: ['hwp', 'hwpx', 'md', 'markdown', 'txt'] })
  })

  it('does not open an incoming document of an unregistered format and says so', async () => {
    const { div } = await renderApp({
      pendingIntent: {
        sessionId: 'ext-pdf',
        docKey: 'doc-pdf',
        name: 'paper.pdf',
        ext: 'pdf',
        format: 'pdf',
        writable: true,
        ephemeral: false,
      },
    })
    expect(div.querySelector('[data-testid="editor-header"]')).toBeNull()
    expect(div.querySelector('[data-editor]')).toBeNull()
    expect(div.querySelector('[data-testid="mobile-home-screen"]')).not.toBeNull()
    expect(div.textContent).toContain(NOT_OPENABLE_KO)
  })

  it('shows the same notice when the backend refuses the picked file', async () => {
    const { div } = await renderApp()
    await click(div.querySelector('[data-testid="home-open-file-btn"]'))
    expect(div.querySelector('[data-testid="editor-header"]')).toBeNull()
    expect(div.textContent).toContain(NOT_OPENABLE_KO)
  })
})

describe('the Markdown document outside its editor', () => {
  it('writes the recovery copy 2 seconds after the last keystroke', async () => {
    const { div, calls } = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    const textarea = div.querySelector<HTMLTextAreaElement>('[data-editor="markdown"] textarea')
    expect(textarea).not.toBeNull()

    vi.useFakeTimers()
    typeInto(textarea!, 'a')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    typeInto(textarea!, 'ab')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(recoveryWrites(calls)).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const writes = recoveryWrites(calls)
    expect(writes).toHaveLength(1)
    expect(Buffer.from(String(writes[0]?.args?.bytesBase64), 'base64').toString('utf8')).toBe('ab')
  })

  it('still writes the typed text while the settings screen is open', async () => {
    const { div, calls } = await renderApp()
    await click(div.querySelector('[data-testid="home-new-md-btn"]'))
    const textarea = div.querySelector<HTMLTextAreaElement>('[data-editor="markdown"] textarea')
    expect(textarea).not.toBeNull()
    typeInto(textarea!, 'kept text')

    // AI panel -> "open settings": the editor unmounts while the document stays open
    await click(div.querySelector('[data-testid="tablet-ai-toggle"]'))
    await click(div.querySelector('[data-testid="ai-connect-prompt"] button'))
    expect(div.querySelector('[data-testid="editor-header"]')).toBeNull()
    expect(div.querySelector('[data-editor="markdown"]')).toBeNull()

    const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise((r) => setTimeout(r, 30))
      })
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState
      if (visibility) expect(document.visibilityState).toBe('visible')
    }
    const writes = recoveryWrites(calls)
    expect(writes.length).toBeGreaterThan(0)
    expect(
      Buffer.from(String(writes[writes.length - 1]?.args?.bytesBase64), 'base64').toString('utf8'),
    ).toBe('kept text')
  })
})
