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

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head><meta charset="UTF-8"><title>보고서</title></head>',
  '<body>',
  '  <h1 class="t">제목 &amp; 부제</h1>',
  '  <p>앞 <b>굵게</b> 뒤</p>',
  '  <div class="pic"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></div>',
  '  <p id="last">마지막 문단</p>',
  '</body>',
  '</html>',
  '',
].join('\n')

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fileSession(): MobileDocSession {
  return {
    sessionId: 'ext-html',
    docKey: 'doc-html-file',
    name: 'page.html',
    ext: 'html',
    format: 'html',
    writable: true,
    ephemeral: false,
    uriHint: 'content://docs/page.html',
  }
}

function fakeTransport(fileBytes: Uint8Array, pendingIntent: MobileDocSession) {
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
  let pending: MobileDocSession | null = pendingIntent
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: b64(fileBytes) } as T
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

const ko = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

const cleanups: Array<() => void> = []

beforeAll(async () => {
  // the app and the HTML document chunk the kind loads when a document opens
  await import('../src/renderer/App')
  await import('../src/renderer/editors/html/htmlDocument')
  await import('@genoffice/mobile-bridge/html')
}, 120_000)

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function openInApp(text = PAGE) {
  const client = fakeTransport(utf8(text), fileSession())
  const { MobileApp } = await import('../src/renderer/App')
  const div = document.createElement('div')
  document.body.appendChild(div)
  const root = createRoot(div)
  await act(async () => {
    root.render(<MobileApp client={client} />)
    await new Promise((r) => setTimeout(r, 80))
  })
  for (let i = 0; i < 100 && !div.querySelector('[data-editor="html"]'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
  }
  cleanups.push(() => {
    act(() => root.unmount())
    div.remove()
  })
  expect(div.querySelector('[data-editor="html"]')).not.toBeNull()
  return div
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 20))
  })
}

function typeInto(field: HTMLTextAreaElement | null, value: string) {
  expect(field).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(field, value)
    field!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const q = (div: HTMLElement, testId: string) => div.querySelector(`[data-testid="${testId}"]`)
const frame = (div: HTMLElement) =>
  div.querySelector<HTMLIFrameElement>('[data-testid="web-html-preview"]')
const selectionBox = (div: HTMLElement) => q(div, 'web-html-selection')
/** A tool of the edit-mode toolbar: the phone's quick bar or the tablet's bar (jsdom is wide). */
const toolbarButton = (div: HTMLElement, key: Parameters<typeof translateMobile>[1]) =>
  div.querySelector(
    ['phone-quick-toolbar', 'tablet-toolbar']
      .map((id) => `[data-testid="${id}"] button[aria-label="${ko(key)}"]`)
      .join(', '),
  )
const headerButton = (div: HTMLElement, key: 'undo' | 'redo') =>
  div.querySelector(`[data-testid="editor-header"] button[aria-label="${ko(key)}"]`)
const sheetField = (i: number) =>
  document.querySelector<HTMLTextAreaElement>(`[data-testid="web-html-text-field-${i}"]`)
const toastText = () => document.querySelector('[data-testid="mobile-toast"]')?.textContent ?? ''

/**
 * jsdom does not load `srcdoc`: write the frame's preview copy into its document and fire the
 * load event the way the webview would after every new copy.
 */
async function loadFrame(div: HTMLElement): Promise<Document> {
  const iframe = frame(div)
  expect(iframe).not.toBeNull()
  const doc = iframe!.contentDocument!
  doc.open()
  doc.write(iframe!.getAttribute('srcdoc') ?? '')
  doc.close()
  await act(async () => {
    iframe!.dispatchEvent(new Event('load'))
  })
  return doc
}

async function press(doc: Document, selector: string) {
  const target = doc.querySelector(selector)
  expect(target, selector).not.toBeNull()
  await act(async () => {
    target!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 10))
  })
}

/** The current source, read through the source view (then back to the preview). */
async function readSource(div: HTMLElement): Promise<string> {
  await click(toolbarButton(div, 'webHtmlShowSource'))
  const value =
    div.querySelector<HTMLTextAreaElement>('[data-testid="web-html-source"]')?.value ?? ''
  await click(toolbarButton(div, 'webHtmlShowPreview'))
  return value
}

describe('selecting an element in the HTML preview', () => {
  it('does nothing in view mode', async () => {
    const div = await openInApp()
    const doc = await loadFrame(div)
    await press(doc, 'h1')
    expect(selectionBox(div)).toBeNull()
    expect(q(div, 'phone-quick-toolbar')).toBeNull()
    expect(q(div, 'tablet-toolbar')).toBeNull()
  })

  it('selects in edit mode with a box over the frame, not in it, and keeps the sandbox', async () => {
    const div = await openInApp()
    await click(q(div, 'editor-mode-toggle'))
    const doc = await loadFrame(div)
    // no element tools without a selection
    expect(toolbarButton(div, 'webHtmlEditText')).toBeNull()
    expect(toolbarButton(div, 'webHtmlDelete')).toBeNull()

    const before = doc.documentElement.outerHTML
    const attrsBefore = Array.from(doc.querySelectorAll('*')).map((el) =>
      Array.from(el.attributes)
        .map((a) => `${a.name}=${a.value}`)
        .join(' '),
    )
    await press(doc, 'h1')
    const box = selectionBox(div)
    expect(box).not.toBeNull()
    expect(box?.getAttribute('data-sid')).toBe(doc.querySelector('h1')!.getAttribute('data-gx-sid'))
    // the box lives in the parent, outside the frame document, which is unchanged
    expect(frame(div)!.contains(box)).toBe(false)
    expect(doc.contains(box)).toBe(false)
    expect(doc.documentElement.outerHTML).toBe(before)
    expect(
      Array.from(doc.querySelectorAll('*')).map((el) =>
        Array.from(el.attributes)
          .map((a) => `${a.name}=${a.value}`)
          .join(' '),
      ),
    ).toEqual(attrsBefore)
    expect(frame(div)?.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(toolbarButton(div, 'webHtmlEditText')).not.toBeNull()
    expect(toolbarButton(div, 'webHtmlDelete')).not.toBeNull()

    // leaving edit mode drops the selection
    await click(q(div, 'editor-mode-toggle'))
    expect(selectionBox(div)).toBeNull()
  })
})

describe('editing an element’s text', () => {
  it('set_text: one undo step, the rest of the source unchanged, the selection found again', async () => {
    const div = await openInApp()
    await click(q(div, 'editor-mode-toggle'))
    let doc = await loadFrame(div)
    await press(doc, 'h1')
    await click(toolbarButton(div, 'webHtmlEditText'))
    expect(sheetField(0)?.value).toBe('제목 & 부제')
    expect(sheetField(1)).toBeNull()
    typeInto(sheetField(0), '새 제목 <끝> & 더')
    await click(document.querySelector('[data-testid="web-html-text-apply"]'))
    expect(document.querySelector('[data-testid="web-html-text-sheet"]')).toBeNull()

    const expected = PAGE.replace(
      '<h1 class="t">제목 &amp; 부제</h1>',
      '<h1 class="t">새 제목 &lt;끝&gt; &amp; 더</h1>',
    )
    const at = PAGE.indexOf('제목 &amp; 부제')
    const edited = await readSource(div)
    expect(edited).toBe(expected)
    expect(edited.slice(0, at)).toBe(PAGE.slice(0, at))
    expect(edited.endsWith(PAGE.slice(at + '제목 &amp; 부제'.length))).toBe(true)

    // the preview is drawn again from the new source, and the h1 is still the selection
    expect(frame(div)?.getAttribute('srcdoc')).toContain('새 제목 &lt;끝&gt; &amp; 더')
    doc = await loadFrame(div)
    expect(selectionBox(div)?.getAttribute('data-sid')).toBe(
      doc.querySelector('h1')!.getAttribute('data-gx-sid'),
    )
    expect(toolbarButton(div, 'webHtmlEditText')).not.toBeNull()

    // one undo restores the original; there was only one step
    await click(headerButton(div, 'undo'))
    expect(await readSource(div)).toBe(PAGE)
    await click(headerButton(div, 'undo'))
    expect(await readSource(div)).toBe(PAGE)
    doc = await loadFrame(div)
    expect(selectionBox(div)?.getAttribute('data-sid')).toBe(
      doc.querySelector('h1')!.getAttribute('data-gx-sid'),
    )
    await click(headerButton(div, 'redo'))
    expect(await readSource(div)).toBe(expected)
  })

  it('set_text_node: one field per text run, the child element stays', async () => {
    const div = await openInApp()
    await click(q(div, 'editor-mode-toggle'))
    const doc = await loadFrame(div)
    await press(doc, 'p')
    await click(toolbarButton(div, 'webHtmlEditText'))
    expect(sheetField(0)?.value).toBe('앞 ')
    expect(sheetField(1)?.value).toBe(' 뒤')
    expect(sheetField(2)).toBeNull()
    typeInto(sheetField(1), ' 뒤에 & 덧붙임')
    await click(document.querySelector('[data-testid="web-html-text-apply"]'))
    const edited = await readSource(div)
    expect(edited).toBe(PAGE.replace('<b>굵게</b> 뒤</p>', '<b>굵게</b> 뒤에 &amp; 덧붙임</p>'))
    await click(headerButton(div, 'undo'))
    expect(await readSource(div)).toBe(PAGE)
  })

  it('an element without text runs points to the source view', async () => {
    const div = await openInApp()
    await click(q(div, 'editor-mode-toggle'))
    const doc = await loadFrame(div)
    await press(doc, 'div.pic')
    await click(toolbarButton(div, 'webHtmlEditText'))
    expect(document.querySelector('[data-testid="web-html-text-source-hint"]')?.textContent).toBe(
      ko('webHtmlEditInSource'),
    )
    expect(sheetField(0)).toBeNull()
    await click(document.querySelector('[data-testid="web-html-text-to-source"]'))
    expect(document.querySelector('[data-testid="web-html-text-sheet"]')).toBeNull()
    const source = div.querySelector<HTMLTextAreaElement>('[data-testid="web-html-source"]')
    expect(source?.value).toBe(PAGE)
    expect(source?.readOnly).toBe(false)
  })
})

describe('deleting an element', () => {
  it('removes it in one undo step and clears the selection', async () => {
    const div = await openInApp()
    await click(q(div, 'editor-mode-toggle'))
    let doc = await loadFrame(div)
    await press(doc, '#last')
    await click(toolbarButton(div, 'webHtmlDelete'))
    expect(toastText()).toContain(ko('webHtmlDeleted'))
    const expected = PAGE.replace('  <p id="last">마지막 문단</p>\n', '')
    expect(await readSource(div)).toBe(expected)
    doc = await loadFrame(div)
    expect(doc.querySelector('#last')).toBeNull()
    expect(selectionBox(div)).toBeNull()
    expect(toolbarButton(div, 'webHtmlDelete')).toBeNull()

    await click(headerButton(div, 'undo'))
    expect(await readSource(div)).toBe(PAGE)
    await click(headerButton(div, 'redo'))
    expect(await readSource(div)).toBe(expected)
  })

  it('refuses the document body', async () => {
    const div = await openInApp()
    await click(q(div, 'editor-mode-toggle'))
    const doc = await loadFrame(div)
    await press(doc, 'body')
    expect(selectionBox(div)?.getAttribute('data-sid')).toBe(doc.body.getAttribute('data-gx-sid'))
    await click(toolbarButton(div, 'webHtmlDelete'))
    expect(toastText()).toContain(ko('webHtmlCannotDelete'))
    expect(await readSource(div)).toBe(PAGE)
  })
})
