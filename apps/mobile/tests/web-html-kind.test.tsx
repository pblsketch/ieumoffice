import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { normalizeLang } from '@genoffice/i18n'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  type MobileAiSettingsSnapshot,
  type MobileAppPrefs,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { EditorHost } from '../src/renderer/editors/editorKind'
import { htmlEditorKinds } from '../src/renderer/editors/html'
import { htmlEditorKind } from '../src/renderer/editors/html/kind'
import { documentSkeleton } from '../../html/src/renderer/document/skeleton'
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

const BOM = [0xef, 0xbb, 0xbf]
/** "<p>한글</p>" in EUC-KR, then CRLF: not valid UTF-8. */
const EUC_KR = new Uint8Array([
  0x3c, 0x70, 0x3e, 0xc7, 0xd1, 0xb1, 0xdb, 0x3c, 0x2f, 0x70, 0x3e, 0x0d, 0x0a,
])

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

function textOf(value: unknown): string {
  return Buffer.from(String(value), 'base64').toString('utf8')
}

function page(eol: '\n' | '\r\n', trailing: boolean, body = '<p>문단</p>'): string {
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="ko">',
    '<head><meta charset="UTF-8"><title>보고서</title></head>',
    `<body><h1>제목</h1>${body}</body>`,
    '</html>',
  ]
  return lines.join(eol) + (trailing ? eol : '')
}

function fileSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'html-file',
    docKey: 'doc-html-file',
    name: 'page.html',
    ext: 'html',
    format: 'html',
    writable: true,
    ephemeral: false,
    uriHint: 'content://docs/page.html',
    ...overrides,
  }
}

const UNTITLED: MobileDocSession = {
  sessionId: 'untitled-1',
  docKey: 'untitled-abc',
  name: 'Untitled.html',
  ext: 'html',
  format: 'html',
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
          return fileSession({ sessionId: 'html-saved', docKey: 'doc-saved' }) as T
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
  return {
    client: createMobileClient(transport),
    calls,
    setPrefs: (p: Partial<MobileAppPrefs>) => (prefs = { ...prefs, ...p }),
  }
}

function fakeHost(client: EditorHost['client'], notices: Array<string | null> = []): EditorHost {
  return {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: (text) => notices.push(text),
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

const ko = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

const COMBOS = [false, true].flatMap((bom) =>
  (['\n', '\r\n'] as const).flatMap((eol) =>
    [false, true].map((trailing) => ({ bom, eol, trailing })),
  ),
)

describe('the HTML editor kind', () => {
  it('is the T4 kind for .html and .htm, editable, with a new-document skeleton', () => {
    expect(htmlEditorKinds).toEqual([htmlEditorKind])
    expect(htmlEditorKind.id).toBe('html')
    expect(htmlEditorKind.formats).toEqual(['html'])
    expect(htmlEditorKind.openExtensions).toEqual(['html', 'htm'])
    expect(htmlEditorKind.createFormats).toEqual(['html'])
    expect(htmlEditorKind.labelKey).toBe('webHtmlEditorLabel')
    expect(ko('webHtmlEditorLabel')).toBe('HTML')
    expect(htmlEditorKind.editable).toBe(true)
    expect(htmlEditorKind.hasAi).toBe(true)
    expect(htmlEditorKind.recoveryFormat('html')).toBe('html')
  })

  for (const { bom, eol, trailing } of COMBOS) {
    const label = `${bom ? 'BOM' : 'no BOM'}, ${eol === '\n' ? 'LF' : 'CRLF'}, ${
      trailing ? 'trailing newline' : 'none'
    }`
    it(`${label}: saves, shares and copies the unchanged bytes`, async () => {
      const original = utf8(page(eol, trailing), bom)
      const { client, calls } = fakeTransport(original)
      const session = fileSession()
      const opened = await htmlEditorKind.open({ session, client, isUntitled: false })
      expect(opened.noticeKey).toBeNull()
      const doc = opened.start(fakeHost(client))
      expect(doc.editable).not.toBe(false)
      // the HTML AI tools are offered (spec 5.6); the AI itself stays off by default
      expect(doc.aiAvailable).not.toBe(false)
      expect(typeof doc.createAiRun).toBe('function')

      expect(await doc.save?.(activeDoc(session), false)).toBe(true)
      expect(bytesOf(last(calls, 'mobile_save_file_bytes').args?.bytesBase64)).toEqual(
        Array.from(original),
      )
      await doc.share(activeDoc(session))
      expect(bytesOf(last(calls, 'mobile_share_file').args?.bytesBase64)).toEqual(
        Array.from(original),
      )
      await doc.writeRecovery?.(activeDoc(session))
      const recovery = last(calls, 'mobile_recovery_write').args
      expect(recovery?.format).toBe('html')
      expect(bytesOf(recovery?.bytesBase64)).toEqual(Array.from(original))
    })
  }

  it('reopens a recovery copy with that copy’s bytes and envelope', async () => {
    const recovered = utf8('<h1>복구</h1>\r\n<p>글</p>\r\n', true)
    const { client, calls } = fakeTransport(new Uint8Array())
    const opened = await htmlEditorKind.open({
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
    // untitled: saving goes through save as, in the html format, with the copy's BOM and CRLF
    expect(await doc.save?.(activeDoc(UNTITLED, true), false)).toBe(true)
    const saveAs = last(calls, 'mobile_save_as_file_bytes').args
    expect(saveAs?.format).toBe('html')
    expect(bytesOf(saveAs?.bytesBase64)).toEqual(Array.from(recovered))
    expect(calls.some((c) => c.command === 'mobile_read_file_bytes')).toBe(false)
  })

  it('starts a new document from the desktop skeleton in the screen language', async () => {
    const { client, calls } = fakeTransport(new Uint8Array())
    const opened = await htmlEditorKind.open({ session: UNTITLED, client, isUntitled: true })
    expect(opened.noticeKey).toBeNull()
    const doc = opened.start(fakeHost(client))
    await doc.writeRecovery?.(activeDoc(UNTITLED, true))
    expect(textOf(last(calls, 'mobile_recovery_write').args?.bytesBase64)).toBe(
      documentSkeleton(normalizeLang(document.documentElement.lang)),
    )
  })

  it('opens a non-UTF-8 file read-only with a notice, and shares the original bytes', async () => {
    const { client, calls } = fakeTransport(EUC_KR)
    const session = fileSession()
    const opened = await htmlEditorKind.open({ session, client, isUntitled: false })
    expect(opened.noticeKey).toBe('webNotUtf8Notice')
    const doc = opened.start(fakeHost(client))
    expect(doc.editable).toBe(false)
    await doc.share(activeDoc(session))
    expect(bytesOf(last(calls, 'mobile_share_file').args?.bytesBase64)).toEqual(Array.from(EUC_KR))
  })

  it('tells once when the source has a script', async () => {
    const withScript = utf8(page('\n', true, '<p>a</p><script>alert(1)</script>'))
    const { client } = fakeTransport(withScript)
    const opened = await htmlEditorKind.open({ session: fileSession(), client, isUntitled: false })
    expect(opened.noticeKey).toBe('webHtmlScriptNotice')
    expect(ko('webHtmlScriptNotice')).toBe('이 문서의 스크립트는 휴대폰에서 실행하지 않습니다.')

    // a script only inside a comment is no script element
    const commented = utf8(page('\n', true, '<!-- <script>x</script> --><p>a</p>'))
    const other = fakeTransport(commented)
    const quiet = await htmlEditorKind.open({
      session: fileSession(),
      client: other.client,
      isUntitled: false,
    })
    expect(quiet.noticeKey).toBeNull()
  })
})

// ---- in the app ----

const cleanups: Array<() => void> = []

beforeAll(async () => {
  await import('../src/renderer/App')
}, 120_000)

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function openInApp(bytes: Uint8Array, session = fileSession({ sessionId: 'ext-html' })) {
  const t = fakeTransport(bytes, session)
  const { MobileApp } = await import('../src/renderer/App')
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={t.client} />)
    await new Promise((r) => setTimeout(r, 80))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    div.remove()
  })
  expect(div.querySelector('[data-editor="html"]')).not.toBeNull()
  return { div, calls: t.calls }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 20))
  })
}

function typeSource(textarea: HTMLTextAreaElement | null, value: string) {
  expect(textarea).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea, value)
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const q = (div: HTMLElement, testId: string) => div.querySelector(`[data-testid="${testId}"]`)
const source = (div: HTMLElement) =>
  div.querySelector<HTMLTextAreaElement>('[data-testid="web-html-source"]')
/** A tool of the edit-mode toolbar: the phone's quick bar or the tablet's bar (jsdom is wide). */
const toolbarButton = (div: HTMLElement, key: Parameters<typeof translateMobile>[1]) =>
  div.querySelector(
    ['phone-quick-toolbar', 'tablet-toolbar']
      .map((id) => `[data-testid="${id}"] button[aria-label="${ko(key)}"]`)
      .join(', '),
  )
const frame = (div: HTMLElement) =>
  div.querySelector<HTMLIFrameElement>('[data-testid="web-html-preview"]')

describe('the HTML editor in the app', () => {
  it('shows the preview copy in a frame sandboxed with allow-same-origin only, no toolbar', async () => {
    const original = page('\r\n', true)
    const { div } = await openInApp(utf8(original, true))
    const iframe = frame(div)
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-same-origin')
    const srcdoc = iframe?.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain('<meta http-equiv="Content-Security-Policy"')
    expect(srcdoc).toMatch(/<h1 data-gx-sid="\d+">제목<\/h1>/)
    expect(srcdoc).not.toContain('data-gx-inspector')
    // view mode: preview only
    expect(q(div, 'phone-quick-toolbar')).toBeNull()
    expect(q(div, 'tablet-toolbar')).toBeNull()
    expect(source(div)).toBeNull()
    expect(q(div, 'editor-notice-banner')).toBeNull()
    // AI is off by default and HTML has no AI tools yet: no AI entry
    expect(q(div, 'phone-ai-open-btn')).toBeNull()
  })

  it('does not move the frame when a link in it is pressed', async () => {
    const { div } = await openInApp(utf8(page('\n', true)))
    const iframe = frame(div)!
    const frameDoc = iframe.contentDocument
    expect(frameDoc).not.toBeNull()
    // jsdom does not load srcdoc: put a link in the frame document and let the guards attach
    frameDoc!.body.innerHTML = '<p><a href="https://example.com/next"><b>다음</b></a></p>'
    act(() => {
      iframe.dispatchEvent(new Event('load'))
    })
    const press = new MouseEvent('click', { bubbles: true, cancelable: true })
    frameDoc!.querySelector('b')!.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
  })

  it('shows the read-only source from [⋯] in view mode', async () => {
    const original = page('\n', true)
    const { div } = await openInApp(utf8(original))
    await click(q(div, 'editor-more-btn'))
    await click(q(div, 'editor-more-webHtmlShowSource'))
    expect(source(div)?.value).toBe(original)
    expect(source(div)?.readOnly).toBe(true)
    expect(frame(div)).toBeNull()
    await click(q(div, 'editor-more-btn'))
    await click(q(div, 'editor-more-webHtmlShowPreview'))
    expect(frame(div)).not.toBeNull()
  })

  it('edits the whole source in edit mode, undoes and redoes, and saves in the file’s envelope', async () => {
    const original = page('\r\n', true)
    const { div, calls } = await openInApp(utf8(original, true))
    await click(q(div, 'editor-mode-toggle'))
    await click(toolbarButton(div, 'webHtmlShowSource'))
    const body = original.replace(/\r\n/g, '\n')
    expect(source(div)?.value).toBe(body)
    expect(source(div)?.readOnly).toBe(false)

    const edited = body.replace('<p>문단</p>', '<p>고친 문단</p>')
    typeSource(source(div), edited)
    expect(source(div)?.value).toBe(edited)

    const undoBtn = div.querySelector(
      `[data-testid="editor-header"] button[aria-label="${ko('undo')}"]`,
    )
    const redoBtn = div.querySelector(
      `[data-testid="editor-header"] button[aria-label="${ko('redo')}"]`,
    )
    await click(undoBtn)
    expect(source(div)?.value).toBe(body)
    await click(redoBtn)
    expect(source(div)?.value).toBe(edited)

    await click(q(div, 'editor-save-btn'))
    const saved = last(calls, 'mobile_save_file_bytes').args?.bytesBase64
    expect(bytesOf(saved)).toEqual(Array.from(utf8(edited.replace(/\n/g, '\r\n'), true)))
    const savedText = textOf(saved)
    expect(savedText).not.toContain('data-gx-sid')
    expect(savedText).not.toContain('Content-Security-Policy')

    // back to the preview: the new source in the frame
    await click(toolbarButton(div, 'webHtmlShowPreview'))
    expect(frame(div)?.getAttribute('srcdoc')).toContain('고친 문단')
  })

  it('shows the script notice when the source has a script, and once when one is typed in', async () => {
    const withScript = await openInApp(utf8(page('\n', true, '<script>x()</script>')))
    expect(q(withScript.div, 'editor-notice-banner')?.textContent).toContain(
      ko('webHtmlScriptNotice'),
    )
    cleanups.pop()?.()

    const { div } = await openInApp(utf8(page('\n', true)))
    expect(q(div, 'editor-notice-banner')).toBeNull()
    await click(q(div, 'editor-mode-toggle'))
    await click(toolbarButton(div, 'webHtmlShowSource'))
    typeSource(source(div), `${source(div)!.value}<script>y()</script>`)
    expect(q(div, 'editor-notice-banner')?.textContent).toContain(ko('webHtmlScriptNotice'))
    // the preview copy still has the CSP that keeps it from running
    await click(toolbarButton(div, 'webHtmlShowPreview'))
    expect(frame(div)?.getAttribute('srcdoc')).toContain("script-src 'none'")
  })

  it('opens a non-UTF-8 file with the reason and no edit button', async () => {
    const { div } = await openInApp(EUC_KR)
    expect(q(div, 'editor-notice-banner')?.textContent).toContain(ko('webNotUtf8Notice'))
    expect(q(div, 'editor-mode-toggle')).toBeNull()
    expect(frame(div)).not.toBeNull()
  })
})
