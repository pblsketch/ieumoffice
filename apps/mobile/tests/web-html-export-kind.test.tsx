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

// Only the HTML kind is registered, so the test does not depend on other tracks' kinds.
vi.mock('../src/renderer/editors/registry', async () => {
  const { htmlEditorKind: kind } = await import('../src/renderer/editors/html/kind')
  const kinds = [kind]
  return {
    EDITOR_KINDS: kinds,
    findEditorKind: (format: string) =>
      kinds.find((k) => (k.formats as readonly string[]).includes(format)) ?? null,
    openableExtensions: () => kinds.flatMap((k) => k.openExtensions),
  }
})

const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x07])
const ODT_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x08])

// The real conversion is covered by web-html-export-driver and web-html-export-chromium; here
// only the editor's flow matters.
const exporter = vi.hoisted(() => ({
  odtReport: [] as ConversionReport,
  lostCaptures: 0,
  fail: false,
}))
vi.mock('../src/renderer/editors/html/htmlExport', () => ({
  htmlToDocx: vi.fn(async (_html: string, _options?: { missingPictureText: string }) => {
    if (exporter.fail) throw new Error('conversion failed')
    return { bytes: DOCX_BYTES, lostCaptures: exporter.lostCaptures }
  }),
  htmlToOdt: vi.fn(async (_html: string, _options?: { missingPictureText: string }) => {
    if (exporter.fail) throw new Error('conversion failed')
    return { bytes: ODT_BYTES, lostCaptures: exporter.lostCaptures, report: exporter.odtReport }
  }),
}))

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ODT_MIME = 'application/vnd.oasis.opendocument.text'

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head><meta charset="UTF-8"><title>보고서</title></head>',
  '<body><h1>제목</h1><p>문단</p></body>',
  '</html>',
  '',
].join('\n')

function session(name = 'page.html'): MobileDocSession {
  return {
    sessionId: 'html-file',
    docKey: 'doc-html-file',
    name,
    ext: name.split('.').pop()!,
    format: 'html',
    writable: true,
    ephemeral: false,
    uriHint: `content://docs/${name}`,
  }
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

/**
 * Behaves like the Rust side where it matters: save as makes the new file the active session,
 * and a save of any other session fails ("no open session").
 */
function fakeTransport(
  options: { cancelNewFile?: boolean; pickedName?: string; name?: string } = {},
) {
  const calls: Call[] = []
  const opened = session(options.name)
  let activeSessionId = opened.sessionId
  let pending: MobileDocSession | null = opened
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
          return { bytesBase64: Buffer.from(PAGE).toString('base64') } as T
        case 'mobile_save_as_file_bytes':
          activeSessionId = 'other-file'
          return { ...opened, sessionId: 'other-file', name: 'other.html' } as T
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

const cleanups: Array<() => void> = []

// a slow disk: opening and the first export load chunks
vi.setConfig({ testTimeout: 30_000 })

// the first import of the whole app, and of the HTML document chunk, is slow on a cold disk
beforeAll(async () => {
  await import('../src/renderer/App')
  await import('../src/renderer/editors/html/htmlDocument')
}, 120_000)

beforeEach(() => {
  exporter.odtReport = []
  exporter.lostCaptures = 0
  exporter.fail = false
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  vi.clearAllMocks()
})

async function openPage(options?: Parameters<typeof fakeTransport>[0]) {
  const { client, calls } = fakeTransport(options)
  const { MobileApp } = await import('../src/renderer/App')
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={client} />)
    await new Promise((r) => setTimeout(r, 80))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    div.remove()
  })
  // the document chunk (parse5, the desktop document model) loads with the first open
  for (let i = 0; i < 400 && !div.querySelector('[data-editor="html"]'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
  }
  expect(div.querySelector('[data-editor="html"]')).not.toBeNull()
  return { div, calls }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 30))
  })
}

const q = (div: HTMLElement, testId: string) => div.querySelector(`[data-testid="${testId}"]`)
const ko = (key: Parameters<typeof translateMobile>[1], params?: Record<string, string>) =>
  translateMobile('ko', key, params)
const toolbarButton = (div: HTMLElement, key: Parameters<typeof translateMobile>[1]) =>
  div.querySelector(
    ['phone-quick-toolbar', 'tablet-toolbar']
      .map((id) => `[data-testid="${id}"] button[aria-label="${ko(key)}"]`)
      .join(', '),
  )
const sourceField = (div: HTMLElement) =>
  div.querySelector<HTMLTextAreaElement>('[data-testid="web-html-source"]')

async function pressMore(div: HTMLElement, id: string) {
  await click(q(div, 'editor-more-btn'))
  await click(q(div, `editor-more-${id}`))
  // the export chunk loads on first use
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150))
  })
}

function moreIds(div: HTMLElement): string[] {
  return Array.from(div.querySelectorAll('[data-testid^="editor-more-"]'))
    .map((el) => el.getAttribute('data-testid') ?? '')
    .filter((id) => id !== 'editor-more-btn' && id !== 'editor-more-sheet')
}

/** Edit mode, source view, the whole source replaced by `value`. */
async function editSource(div: HTMLElement, value: string) {
  await click(q(div, 'editor-mode-toggle'))
  await click(toolbarButton(div, 'webHtmlShowSource'))
  const field = sourceField(div)
  expect(field).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(field, value)
    field!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const toastText = (div: HTMLElement) => q(div, 'mobile-toast')?.textContent ?? ''
const errorToast = (div: HTMLElement) =>
  div.querySelector('[data-testid="mobile-toast"][data-tone="error"]')
const only = (calls: Call[], command: string) => calls.filter((c) => c.command === command)
const bytesOf = (call: Call | undefined) =>
  Array.from(Buffer.from(String(call?.args?.bytesBase64), 'base64'))

describe('HTML [⋯] export items', () => {
  it('offers Word and ODT after "view source" in view mode', async () => {
    const { div } = await openPage()
    await click(q(div, 'editor-more-btn'))
    expect(moreIds(div)).toEqual([
      'editor-more-webHtmlShowSource',
      'editor-more-webExportDocx',
      'editor-more-webExportOdt',
    ])
    expect(q(div, 'editor-more-webExportDocx')?.textContent).toContain(ko('webExportDocx'))
    expect(q(div, 'editor-more-webExportOdt')?.textContent).toContain(ko('webExportOdt'))
  })

  it('offers them in edit mode too', async () => {
    const { div } = await openPage()
    await click(q(div, 'editor-mode-toggle'))
    await click(q(div, 'editor-more-btn'))
    expect(moreIds(div)).toEqual(['editor-more-webExportDocx', 'editor-more-webExportOdt'])
  })
})

describe('HTML → Word export keeps the open document', () => {
  it('converts the source on screen, writes a new .docx, and saving still goes to the original file', async () => {
    const { div, calls } = await openPage()
    const edited = PAGE.replace('<p>문단</p>', '<p>고친 문단</p>')
    await editSource(div, edited)
    await pressMore(div, 'webExportDocx')

    const { htmlToDocx } = await import('../src/renderer/editors/html/htmlExport')
    expect(htmlToDocx).toHaveBeenCalledTimes(1)
    const converted = vi.mocked(htmlToDocx).mock.calls[0]![0]
    // a picture without words stands as a marker in the screen language, not in English
    expect(vi.mocked(htmlToDocx).mock.calls[0]![1]).toEqual({
      missingPictureText: ko('webExportPictureMissing'),
    })
    expect(ko('webExportPictureMissing')).toBe('[옮기지 못한 그림]')
    // the export copy of the source on screen: unsaved edits, the preview's policy, no element ids
    expect(converted).toContain('<p>고친 문단</p>')
    expect(converted).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(converted).not.toContain('data-gx-sid')

    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(DOCX_MIME)
    expect(exports[0]?.args?.suggestedName).toBe('page.docx')
    expect(bytesOf(exports[0])).toEqual(Array.from(DOCX_BYTES))
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    expect(toastText(div)).toContain(ko('webExportSaved', { name: 'page.docx' }))
    // the open document is as it was: same source, still unsaved
    expect(sourceField(div)?.value).toBe(edited)

    await click(q(div, 'editor-save-btn'))
    const saves = only(calls, 'mobile_save_file_bytes')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.args?.sessionId).toBe('html-file')
    expect(Buffer.from(String(saves[0]?.args?.bytesBase64), 'base64').toString('utf8')).toBe(edited)
    expect(toastText(div)).toContain(ko('savedNotice'))
  })

  it('names a .htm document’s export after it, and the toast after the file picked', async () => {
    const { div, calls } = await openPage({ name: 'page.htm', pickedName: '보고서.docx' })
    await pressMore(div, 'webExportDocx')
    expect(only(calls, 'mobile_web_save_new_file')[0]?.args?.suggestedName).toBe('page.docx')
    expect(toastText(div)).toContain(ko('webExportSaved', { name: '보고서.docx' }))
  })

  it('says when pictures could not be carried over', async () => {
    exporter.lostCaptures = 2
    const { div } = await openPage()
    await pressMore(div, 'webExportDocx')
    expect(toastText(div)).toContain(ko('webExportSavedShapeLoss', { name: 'page.docx' }))
    expect(ko('webExportSavedShapeLoss', { name: 'page.docx' })).toContain(
      '일부 모양은 옮기지 못했습니다',
    )
  })

  it('a dismissed save dialog writes nothing and shows no error', async () => {
    const { div, calls } = await openPage({ cancelNewFile: true })
    await pressMore(div, 'webExportDocx')
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(1)
    expect(only(calls, 'mobile_save_as_file_bytes')).toHaveLength(0)
    expect(only(calls, 'mobile_save_file_bytes')).toHaveLength(0)
    expect(errorToast(div)).toBeNull()
    expect(toastText(div)).not.toContain(ko('webExportDocxFailed'))
  })

  it('a failed conversion shows an error and writes nothing', async () => {
    exporter.fail = true
    const { div, calls } = await openPage()
    await pressMore(div, 'webExportDocx')
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)
    expect(errorToast(div)).not.toBeNull()
    expect(toastText(div)).toContain(ko('webExportDocxFailed'))
  })
})

describe('HTML → ODT export', () => {
  it('without a report writes the .odt right away', async () => {
    const { div, calls } = await openPage()
    await pressMore(div, 'webExportOdt')
    expect(q(div, 'web-odt-confirm-sheet')).toBeNull()
    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(ODT_MIME)
    expect(exports[0]?.args?.suggestedName).toBe('page.odt')
    expect(bytesOf(exports[0])).toEqual(Array.from(ODT_BYTES))
    expect(toastText(div)).toContain(ko('webExportSaved', { name: 'page.odt' }))
  })

  it('with a report asks first; [취소] writes nothing', async () => {
    exporter.odtReport = [{ kind: 'dropped', feature: 'page_color', count: 1 }]
    const { div, calls } = await openPage()
    await pressMore(div, 'webExportOdt')
    const sheet = q(div, 'web-odt-confirm-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet?.textContent).toContain(ko('webOdtLeftOut'))
    expect(sheet?.textContent).toContain(ko('webOdtFeatPageColor'))
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)

    await click(q(div, 'web-odt-confirm-cancel'))
    expect(q(div, 'web-odt-confirm-sheet')).toBeNull()
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)
    expect(errorToast(div)).toBeNull()
  })

  it('with a report, [저장] writes the .odt and says something changed', async () => {
    exporter.odtReport = [{ kind: 'dropped', feature: 'page_color', count: 1 }]
    const { div, calls } = await openPage()
    const edited = PAGE.replace('<h1>제목</h1>', '<h1>새 제목</h1>')
    await editSource(div, edited)
    await pressMore(div, 'webExportOdt')
    await click(q(div, 'web-odt-confirm-save'))
    expect(q(div, 'web-odt-confirm-sheet')).toBeNull()
    const exports = only(calls, 'mobile_web_save_new_file')
    expect(exports).toHaveLength(1)
    expect(exports[0]?.args?.mime).toBe(ODT_MIME)
    expect(toastText(div)).toContain(ko('webExportSavedLoss', { name: 'page.odt' }))

    // the original document still saves to its own file
    await click(q(div, 'editor-save-btn'))
    const saves = only(calls, 'mobile_save_file_bytes')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.args?.sessionId).toBe('html-file')
    expect(toastText(div)).toContain(ko('savedNotice'))
  })

  it('a failed conversion shows the ODT error', async () => {
    exporter.fail = true
    const { div, calls } = await openPage()
    await pressMore(div, 'webExportOdt')
    expect(only(calls, 'mobile_web_save_new_file')).toHaveLength(0)
    expect(toastText(div)).toContain(ko('webExportOdtFailed'))
  })
})
