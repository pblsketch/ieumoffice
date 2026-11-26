import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { markdownEditorKind } from '../src/renderer/editors/markdownKind'
import { translateMobile } from '../src/renderer/i18n'

// Only the Markdown kind is registered, so the test does not depend on other tracks' kinds.
vi.mock('../src/renderer/editors/registry', async () => {
  const { markdownEditorKind: kind } = await import('../src/renderer/editors/markdownKind')
  const kinds = [kind]
  return {
    EDITOR_KINDS: kinds,
    findEditorKind: (format: string) =>
      kinds.find((k) => (k.formats as readonly string[]).includes(format)) ?? null,
    openableExtensions: () => kinds.flatMap((k) => k.openExtensions),
  }
})

const BOM = [0xef, 0xbb, 0xbf]
/** "한글" in EUC-KR, then CRLF: not valid UTF-8. */
const EUC_KR = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x0d, 0x0a])

function utf8(text: string, bom = false): Uint8Array {
  const body = Array.from(new TextEncoder().encode(text))
  return new Uint8Array(bom ? [...BOM, ...body] : body)
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function bytesOf(value: unknown): number[] {
  return Array.from(Buffer.from(String(value), 'base64'))
}

function fileSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'md-file',
    docKey: 'doc-md-file',
    name: 'note.md',
    ext: 'md',
    format: 'md',
    writable: true,
    ephemeral: false,
    uriHint: 'content://notes/note.md',
    ...overrides,
  }
}

const UNTITLED: MobileDocSession = {
  sessionId: 'untitled-1',
  docKey: 'untitled-abc',
  name: 'Restored.md',
  ext: 'md',
  format: 'md',
  writable: false,
  ephemeral: false,
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

function fakeTransport(fileBytes: Uint8Array, pendingIntent: MobileDocSession | null = null) {
  const calls: Call[] = []
  let prefs: MobileAppPrefs = {
    lang: 'ko',
    theme: 'system',
    hwpDefaultFormat: 'hwp',
    aiEnabled: false,
  }
  const aiSettings: MobileAiSettingsSnapshot = {
    selectedProvider: 'auto',
    modelByProvider: {},
    configuredProviders: {},
    chatgptVisible: false,
    subscriptionNoticeVersion: 0,
  }
  let pending = pendingIntent
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: b64(fileBytes) } as T
        case 'mobile_save_as_file_bytes':
          return fileSession({
            sessionId: 'md-saved',
            docKey: 'doc-saved',
            name: 'Restored.md',
          }) as T
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
        case 'mobile_consume_pending_open_intent': {
          const next = pending
          pending = null
          return next as T
        }
        default:
          return { ok: true } as T
      }
    },
    async listen() {
      return () => {}
    },
  }
  return { client: createMobileClient(transport), calls }
}

function fakeHost(client: EditorHost['client']): EditorHost {
  return {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: () => {},
    showToast: () => {},
    contentChanged: () => {},
    refreshHome: async () => {},
    openSession: async () => {},
    translate: (key, params) => translateMobile('ko', key, params),
    windowClass: () => 'compact',
  }
}

function activeDoc(session: MobileDocSession, isUntitled = false): ActiveDocState {
  return {
    session,
    dirty: !isUntitled,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled,
  }
}

function last(calls: Call[], command: string): Call {
  const call = calls.filter((c) => c.command === command).at(-1)
  expect(call, `${command} was called`).toBeDefined()
  return call!
}

const COMBOS = [false, true].flatMap((bom) =>
  (['\n', '\r\n'] as const).flatMap((eol) =>
    [false, true].map((trailing) => ({ bom, eol, trailing })),
  ),
)

describe('Markdown kind keeps the bytes of the file it opened', () => {
  for (const { bom, eol, trailing } of COMBOS) {
    const label = `${bom ? 'BOM' : 'no BOM'}, ${eol === '\n' ? 'LF' : 'CRLF'}, ${
      trailing ? 'trailing newline' : 'none'
    }`
    it(`${label}: opens editable and saves, shares and copies unchanged bytes`, async () => {
      const original = utf8(['# 제목', '', '본문'].join(eol) + (trailing ? eol : ''), bom)
      const { client, calls } = fakeTransport(original)
      const session = fileSession()
      const opened = await markdownEditorKind.open({ session, client, isUntitled: false })
      expect(opened.noticeKey).toBeNull()
      const doc = opened.start(fakeHost(client))
      expect(doc.editable).not.toBe(false)

      expect(await doc.save?.(activeDoc(session), false)).toBe(true)
      expect(bytesOf(last(calls, 'mobile_save_file_bytes').args?.bytesBase64)).toEqual(
        Array.from(original),
      )
      await doc.share(activeDoc(session))
      expect(bytesOf(last(calls, 'mobile_share_file').args?.bytesBase64)).toEqual(
        Array.from(original),
      )
      await doc.writeRecovery?.(activeDoc(session))
      expect(bytesOf(last(calls, 'mobile_recovery_write').args?.bytesBase64)).toEqual(
        Array.from(original),
      )
    })
  }

  it('takes the envelope of a reopened recovery copy from its bytes', async () => {
    const recovered = utf8('# 복구\r\n본문\r\n', true)
    const { client, calls } = fakeTransport(new Uint8Array())
    const opened = await markdownEditorKind.open({
      session: UNTITLED,
      client,
      isUntitled: true,
      recoveryBytesBase64: b64(recovered),
    })
    expect(opened.noticeKey).toBeNull()
    const doc = opened.start(fakeHost(client))

    await doc.writeRecovery?.(activeDoc(UNTITLED, true))
    expect(bytesOf(last(calls, 'mobile_recovery_write').args?.bytesBase64)).toEqual(
      Array.from(recovered),
    )
    // untitled: saving goes through save as, with the copy's BOM and CRLF
    expect(await doc.save?.(activeDoc(UNTITLED, true), false)).toBe(true)
    expect(bytesOf(last(calls, 'mobile_save_as_file_bytes').args?.bytesBase64)).toEqual(
      Array.from(recovered),
    )
    expect(calls.some((c) => c.command === 'mobile_read_file_bytes')).toBe(false)
  })

  it('opens a non-UTF-8 file read-only with a notice, and shares the original bytes', async () => {
    const { client, calls } = fakeTransport(EUC_KR)
    const session = fileSession()
    const opened = await markdownEditorKind.open({ session, client, isUntitled: false })
    expect(opened.noticeKey).toBe('webNotUtf8Notice')
    const doc = opened.start(fakeHost(client))
    expect(doc.editable).toBe(false)

    await doc.share(activeDoc(session))
    expect(bytesOf(last(calls, 'mobile_share_file').args?.bytesBase64)).toEqual(Array.from(EUC_KR))
  })
})

describe('a non-UTF-8 Markdown file in the app', () => {
  const containers: HTMLElement[] = []
  afterEach(() => {
    while (containers.length > 0) containers.pop()?.remove()
  })

  it('shows the reason in the banner and offers no edit button', async () => {
    const { client } = fakeTransport(EUC_KR, fileSession({ sessionId: 'ext-md' }))
    const { MobileApp } = await import('../src/renderer/App')
    const div = document.createElement('div')
    document.body.appendChild(div)
    containers.push(div)
    const root = createRoot(div)
    await act(async () => {
      root.render(<MobileApp client={client} />)
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(div.querySelector('[data-testid="editor-header"]')).not.toBeNull()
    expect(div.querySelector('[data-testid="editor-notice-banner"]')?.textContent).toContain(
      translateMobile('ko', 'webNotUtf8Notice'),
    )
    expect(div.querySelector('[data-testid="editor-mode-toggle"]')).toBeNull()
    expect(div.querySelector('[data-editor="markdown"] textarea')).toBeNull()
    act(() => root.unmount())
  })
})
