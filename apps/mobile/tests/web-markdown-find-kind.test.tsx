import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
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

function sessionOf(name: string, ext: 'md' | 'txt'): MobileDocSession {
  return {
    sessionId: `s-${name}`,
    docKey: `doc-${name}`,
    name,
    ext,
    format: ext,
    writable: true,
    ephemeral: false,
    uriHint: `content://notes/${name}`,
  }
}

function fakeTransport(session: MobileDocSession, bytes: Uint8Array) {
  let pending: MobileDocSession | null = session
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
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: Buffer.from(bytes).toString('base64') } as T
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
  return createMobileClient(transport)
}

const cleanups: Array<() => void> = []

beforeAll(async () => {
  await import('../src/renderer/App')
}, 120_000)

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function openDoc(session: MobileDocSession, bytes: Uint8Array) {
  const client = fakeTransport(session, bytes)
  const { MobileApp } = await import('../src/renderer/App')
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={client} />)
    await new Promise((r) => setTimeout(r, 50))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    div.remove()
  })
  expect(div.querySelector('[data-editor="markdown"]')).not.toBeNull()
  return div
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 20))
  })
}

function typeInto(input: Element | null, value: string) {
  expect(input).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const ko = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string>) =>
  translateMobile('ko', key, params)
const q = (div: HTMLElement, testId: string) => div.querySelector(`[data-testid="${testId}"]`)
const textarea = (div: HTMLElement) =>
  div.querySelector<HTMLTextAreaElement>('[data-editor="markdown"] textarea')

async function openFind(div: HTMLElement) {
  await click(q(div, 'editor-more-btn'))
  await click(q(div, 'editor-more-webFindReplace'))
  expect(q(div, 'web-find-sheet')).not.toBeNull()
}

describe('Markdown [⋯] find and replace', () => {
  it('is in the menu in view and edit mode, for .md and .txt', async () => {
    for (const session of [sessionOf('note.md', 'md'), sessionOf('memo.txt', 'txt')]) {
      const div = await openDoc(session, Buffer.from('abc abc\n'))
      await click(q(div, 'editor-more-btn'))
      expect(q(div, 'editor-more-webFindReplace')?.textContent).toContain(ko('webFindReplace'))
      await click(q(div, 'editor-more-webFindReplace'))
      expect(q(div, 'web-find-sheet')).not.toBeNull()
      await click(q(div, 'web-find-sheet')?.querySelector('.mobile-sheet-header button') ?? null)
      expect(q(div, 'web-find-sheet')).toBeNull()
      await click(q(div, 'editor-mode-toggle'))
      await openFind(div)
      cleanups.pop()?.()
    }
  })

  it('replace all through the kind is one toolbar undo, with a count toast', async () => {
    const original = '회의 메모\n\n회의 결과와 회의 일정\n'
    const div = await openDoc(sessionOf('note.md', 'md'), Buffer.from(original))
    await openFind(div)
    // view mode: replace goes through edit mode
    expect(q(div, 'web-find-replacement')).toBeNull()
    typeInto(q(div, 'web-find-query'), '회의')
    await click(q(div, 'web-find-edit-to-replace'))
    expect(textarea(div)).not.toBeNull()
    typeInto(q(div, 'web-find-replacement'), '모임')
    await click(q(div, 'web-find-replace-all'))
    expect(textarea(div)?.value).toBe('모임 메모\n\n모임 결과와 모임 일정\n')
    expect(q(div, 'mobile-toast')?.textContent).toContain(
      ko('webFindReplacedCount', { count: '3' }),
    )
    await click(div.querySelector(`button[aria-label="${ko('undo')}"]`))
    expect(textarea(div)?.value).toBe(original)
  })

  it('a read-only (not UTF-8) document finds but offers no replace', async () => {
    // "abc " then an invalid UTF-8 byte
    const div = await openDoc(sessionOf('legacy.md', 'md'), new Uint8Array([97, 98, 99, 32, 0xff]))
    await openFind(div)
    typeInto(q(div, 'web-find-query'), 'abc')
    expect(q(div, 'web-find-count')?.textContent).toBe('1/1')
    expect(q(div, 'web-find-replacement')).toBeNull()
    expect(q(div, 'web-find-replace-all')).toBeNull()
    expect(q(div, 'web-find-edit-to-replace')).toBeNull()
  })
})
