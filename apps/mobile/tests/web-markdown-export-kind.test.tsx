import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversionReport } from '@genoffice/odt-engine'
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

const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01])
const ODT_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x02])
const HWPX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x03])

// The real converters are covered by web-markdown-export.test.ts; here only the flow matters.
const converters = vi.hoisted(() => ({
  odtReport: [] as ConversionReport,
  hwpxLossCount: 0,
  fail: false,
}))
vi.mock('../src/renderer/editors/markdownToHwp', () => ({
  markdownToDocx: vi.fn(async () => {
    if (converters.fail) throw new Error('conversion failed')
    return DOCX_BYTES
  }),
  markdownToOdt: vi.fn(async () => ({ bytes: ODT_BYTES, report: converters.odtReport })),
  markdownToHwpx: vi.fn(async () => ({ bytes: HWPX_BYTES, lossCount: converters.hwpxLossCount })),
}))

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ODT_MIME = 'application/vnd.oasis.opendocument.text'
const HWPX_MIME = 'application/haansofthwpx'

const NOTE: MobileDocSession = {
  sessionId: 'md-file',
  docKey: 'doc-md-file',
  name: 'note.md',
  ext: 'md',
  format: 'md',
  writable: true,
  ephemeral: false,
  uriHint: 'content://notes/note.md',
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

/**
 * Behaves like the Rust side where it matters: save-as makes the new file the active
 * session, and a save of any other session fails ("no open session").
 */
function fakeTransport(options: { cancelNewFile?: boolean; pickedName?: string } = {}) {
  const calls: Call[] = []
  let activeSessionId = NOTE.sessionId
  let pending: MobileDocSession | null = NOTE
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
      calls.push({ command, args })
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: Buffer.from('# 제목\n\n- 항목\n').toString('base64') } as T
        case 'mobile_save_as_file_bytes':
          activeSessionId = 'converted-file'
          return { ...NOTE, sessionId: 'converted-file', name: 'note.hwpx' } as T
        case 'mobile_save_file_bytes':
          if (args?.sessionId !== activeSessionId) {
            throw { code: 'NO_ACTIVE_SESSION', messageKey: 'mobile.fs.noSession' }
          }
          return { ok: true } as T
        case 'mobile_web_save_new_file':
          if (options.cancelNewFile) {
            throw { code: 'USER_CANCELLED', messageKey: 'mobile.fs.cancelled' }
          }
          return { name: options.pickedName ?? String(args?.suggestedName) } as T
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

const containers: HTMLElement[] = []
const unmounts: Array<() => void> = []

// the first import of the whole app is slow on a cold disk
beforeAll(async () => {
  await import('../src/renderer/App')
}, 120_000)

beforeEach(() => {
  converters.odtReport = []
  converters.hwpxLossCount = 0
  converters.fail = false
})

afterEach(() => {
  while (unmounts.length > 0) unmounts.pop()?.()
  while (containers.length > 0) containers.pop()?.remove()
  vi.clearAllMocks()
})

async function renderNote(options?: Parameters<typeof fakeTransport>[0]) {
  const { client, calls } = fakeTransport(options)
  const { MobileApp } = await import('../src/renderer/App')
  const div = document.createElement('div')
  document.body.appendChild(div)
  containers.push(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={client} />)
    await new Promise((r) => setTimeout(r, 50))
  })
  unmounts.push(() => act(() => root.unmount()))
  expect(div.querySelector('[data-editor="markdown"]')).not.toBeNull()
  return { div, calls }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 30))
  })
}

async function pressMore(div: HTMLElement, id: string) {
  await click(div.querySelector('[data-testid="editor-more-btn"]'))
  await click(div.querySelector(`[data-testid="editor-more-${id}"]`))
}

async function editText(div: HTMLElement, value: string) {
  await click(div.querySelector('[data-testid="editor-mode-toggle"]'))
  const textarea = div.querySelector<HTMLTextAreaElement>('[data-editor="markdown"] textarea')
  expect(textarea).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, value)
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function toastText(div: HTMLElement): string {
  return div.querySelector('[data-testid="mobile-toast"]')?.textContent ?? ''
}

function only(calls: Call[], command: string): Call[] {
  return calls.filter((c) => c.command === command)
}

function bytesOf(call: Call | undefined): number[] {
  return Array.from(Buffer.from(String(call?.args?.bytesBase64), 'base64'))
}

const ko = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string>) =>
  translateMobile('ko', key, params)

describe('Markdown [⋯] export items', () => {
  it('lists Hangul, Word and ODT in that order for a .md document', async () => {
    const { div } = await renderNote()
    await click(div.querySelector('[data-testid="editor-more-btn"]'))
    const ids = Array.from(div.querySelectorAll('[data-testid^="editor-more-"]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'editor-more-btn')
    const exportIds = ids.filter((id) =>
      [
        'editor-more-markdownToHwp',
        'editor-more-webExportDocx',
        'editor-more-webExportOdt',
      ].includes(id ?? ''),
    )
    expect(exportIds).toEqual([
      'editor-more-markdownToHwp',
      'editor-more-webExportDocx',
      'editor-more-webExportOdt',
    ])
  })
})

describe('Markdown → Word export keeps the open document', () => {
  it('writes a new .docx file, then saving the Markdown still goes to the original session', async () => {
    const { div, calls } = await renderNote()
    await editText(div, '# 고친 제목\n')
    await pressMore(div, 'webExportDocx')

    const { markdownToDocx } = await import('../src/renderer/editors/markdownToHwp')
    // the text on screen, unsaved edits included
    expect(markdownToDocx).toHaveBeenCalledWith('# 고친 제목\n')
    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(DOCX_MIME)
    expect(exports[0]?.args?.suggestedName).toBe('note.docx')
    expect(bytesOf(exports[0])).toEqual(Array.from(DOCX_BYTES))
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    expect(toastText(div)).toContain(ko('webExportSaved', { name: 'note.docx' }))

    await click(div.querySelector('[data-testid="editor-save-btn"]'))
    const saves = only(calls, 'mobile_save_file_bytes')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.args?.sessionId).toBe(NOTE.sessionId)
    expect(Buffer.from(String(saves[0]?.args?.bytesBase64), 'base64').toString('utf8')).toBe(
      '# 고친 제목\n',
    )
    expect(toastText(div)).toContain(ko('savedNotice'))
  })

  it('names the toast after the file the user picked', async () => {
    const { div } = await renderNote({ pickedName: '회의록.docx' })
    await pressMore(div, 'webExportDocx')
    expect(toastText(div)).toContain(ko('webExportSaved', { name: '회의록.docx' }))
  })

  it('a dismissed save dialog writes nothing and shows no error', async () => {
    const { div, calls } = await renderNote({ cancelNewFile: true })
    await pressMore(div, 'webExportDocx')
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(1)
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    expect(only(calls, 'mobile_save_file_bytes')).toHaveLength(0)
    expect(toastText(div)).not.toContain(ko('webExportDocxFailed'))
    expect(div.querySelector('[data-testid="mobile-toast"][data-tone="error"]')).toBeNull()
  })

  it('a failed conversion shows an error and writes nothing', async () => {
    converters.fail = true
    const { div, calls } = await renderNote()
    await pressMore(div, 'webExportDocx')
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)
    expect(toastText(div)).toContain(ko('webExportDocxFailed'))
  })
})

describe('Markdown → Hangul export keeps the open document', () => {
  it('writes a new .hwpx file without an [open] action, and saving still goes to the original session', async () => {
    const { div, calls } = await renderNote()
    await editText(div, '# 한글로\n')
    await pressMore(div, 'markdownToHwp')

    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(HWPX_MIME)
    expect(exports[0]?.args?.suggestedName).toBe('note.hwpx')
    expect(bytesOf(exports[0])).toEqual(Array.from(HWPX_BYTES))
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    const toast = div.querySelector('[data-testid="mobile-toast"]')
    expect(toast?.textContent).toContain(ko('webExportSaved', { name: 'note.hwpx' }))
    expect(toast?.querySelector('button')?.textContent ?? '').not.toContain(ko('openNow'))

    await click(div.querySelector('[data-testid="editor-save-btn"]'))
    const saves = only(calls, 'mobile_save_file_bytes')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.args?.sessionId).toBe(NOTE.sessionId)
    expect(toastText(div)).toContain(ko('savedNotice'))
  })

  it('says when some content could not be carried over', async () => {
    converters.hwpxLossCount = 2
    const { div } = await renderNote()
    await pressMore(div, 'markdownToHwp')
    expect(toastText(div)).toContain(ko('webExportSavedLoss', { name: 'note.hwpx' }))
  })

  it('a dismissed save dialog is silent', async () => {
    const { div, calls } = await renderNote({ cancelNewFile: true })
    await pressMore(div, 'markdownToHwp')
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    expect(div.querySelector('[data-testid="mobile-toast"][data-tone="error"]')).toBeNull()
    expect(toastText(div)).not.toContain(ko('markdownToHwpFailed'))
  })
})

describe('Markdown → ODT export', () => {
  it('without a report writes the .odt right away', async () => {
    const { div, calls } = await renderNote()
    await pressMore(div, 'webExportOdt')
    expect(div.querySelector('[data-testid="web-odt-confirm-sheet"]')).toBeNull()
    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(ODT_MIME)
    expect(exports[0]?.args?.suggestedName).toBe('note.odt')
    expect(bytesOf(exports[0])).toEqual(Array.from(ODT_BYTES))
    expect(toastText(div)).toContain(ko('webExportSaved', { name: 'note.odt' }))
  })

  it('with a report asks first; [취소] writes nothing', async () => {
    converters.odtReport = [
      { kind: 'converted', feature: 'toc', count: 1 },
      { kind: 'dropped', feature: 'comment', count: 3 },
    ]
    const { div, calls } = await renderNote()
    await pressMore(div, 'webExportOdt')
    const sheet = div.querySelector('[data-testid="web-odt-confirm-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.textContent).toContain(ko('webOdtChanges'))
    expect(sheet?.textContent).toContain(ko('webOdtFeatToc'))
    expect(sheet?.textContent).toContain(ko('webOdtLeftOut'))
    expect(sheet?.textContent).toContain(`${ko('webOdtFeatComment')} (3)`)
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)

    await click(div.querySelector('[data-testid="web-odt-confirm-cancel"]'))
    expect(div.querySelector('[data-testid="web-odt-confirm-sheet"]')).toBeNull()
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    expect(div.querySelector('[data-testid="mobile-toast"][data-tone="error"]')).toBeNull()
  })

  it('with a report, [저장] opens the save dialog and writes the .odt', async () => {
    converters.odtReport = [{ kind: 'dropped', feature: 'comment', count: 1 }]
    const { div, calls } = await renderNote()
    await pressMore(div, 'webExportOdt')
    await click(div.querySelector('[data-testid="web-odt-confirm-save"]'))
    expect(div.querySelector('[data-testid="web-odt-confirm-sheet"]')).toBeNull()
    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(ODT_MIME)
    expect(toastText(div)).toContain(ko('webExportSavedLoss', { name: 'note.odt' }))
  })
})
