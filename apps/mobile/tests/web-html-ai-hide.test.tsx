// Spec 5.6: "AI에게 숨기기" / "숨김 풀기" on a selected HTML element writes and takes off the
// desktop mark `data-gx-redact`, one undo step each; the entry is there only with the AI on;
// hidden elements are marked over the preview, never in the frame document or the file.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import {
  createMobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { ToastRequest } from '../src/renderer/components/Toast'
import type {
  EditorDocument,
  EditorFrameProps,
  EditorHost,
} from '../src/renderer/editors/editorKind'
import { htmlEditorKind } from '../src/renderer/editors/html/kind'
import { mapDocument } from '../src/renderer/editors/html/htmlPreview'
import { MobileLocaleProvider, translateMobile } from '../src/renderer/i18n'

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head><meta charset="UTF-8"><title>명단</title></head>',
  '<body>',
  '  <h1>연락처</h1>',
  '  <p id="who">홍길동 010-1234-5678</p>',
  '  <p id="tail">끝 문단</p>',
  '</body>',
  '</html>',
  '',
].join('\n')

const ko = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

const SESSION: MobileDocSession = {
  sessionId: 'html-hide',
  docKey: 'doc-html-hide',
  name: 'page.html',
  ext: 'html',
  format: 'html',
  writable: true,
  ephemeral: false,
  uriHint: 'content://docs/page.html',
}

function activeDoc(): ActiveDocState {
  return {
    session: SESSION,
    dirty: true,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled: false,
  }
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

function clientFor(text: string) {
  const calls: Call[] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      if (command === 'mobile_read_file_bytes') {
        return { bytesBase64: Buffer.from(text, 'utf8').toString('base64') } as T
      }
      return { ok: true } as T
    },
    async listen() {
      return () => {}
    },
  }
  return { client: createMobileClient(transport), calls }
}

interface Harness {
  readonly el: HTMLElement
  readonly doc: EditorDocument
  readonly toasts: Array<ToastRequest | string>
  rerender(next: { aiEnabled?: boolean; mode?: DocumentMode }): void
  /** The current source, as share writes it. */
  source(): Promise<string>
}

const cleanups: Array<() => void> = []
beforeAll(async () => {
  await import('../src/renderer/editors/html/htmlDocument')
}, 120_000)
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
})
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function setup(
  text: string,
  options: { aiEnabled: boolean; mode: DocumentMode },
): Promise<Harness> {
  const { client, calls } = clientFor(text)
  const opened = await htmlEditorKind.open({ session: SESSION, client, isUntitled: false })
  const toasts: Array<ToastRequest | string> = []
  const host: EditorHost = {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: () => {},
    showToast: (toast) => {
      toasts.push(toast)
    },
    contentChanged: () => {},
    refreshHome: async () => {},
    openSession: async () => {},
    translate: (key, params) => translateMobile('ko', key, params),
    windowClass: () => 'compact',
  }
  const doc = opened.start(host)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root: Root = createRoot(el)
  let props = { ...options }
  const frame = (): EditorFrameProps => ({
    docTitle: SESSION.name,
    docFormat: 'html',
    saveState: 'saved',
    mode: props.mode,
    canEdit: true,
    aiEnabled: props.aiEnabled,
    aiPanelContent: null,
    onBack: () => {},
    onEnterEdit: () => {},
    onDone: () => {},
    onExitEdit: () => {},
    onSave: () => {},
    onSaveAs: () => {},
    onShare: () => {},
    onOpenBackups: () => {},
  })
  const render = () =>
    act(() =>
      root.render(
        <MobileLocaleProvider lang="ko">
          <doc.Workspace frame={frame()} mode={props.mode} canEdit lang="ko" theme="light" />
        </MobileLocaleProvider>,
      ),
    )
  render()
  cleanups.push(() => {
    act(() => root.unmount())
    el.remove()
    doc.dispose?.()
  })
  return {
    el,
    doc,
    toasts,
    rerender(next) {
      props = { ...props, ...next }
      render()
    },
    async source() {
      await doc.share(activeDoc())
      const shared = calls.filter((c) => c.command === 'mobile_share_file').at(-1)
      return Buffer.from(String(shared?.args?.bytesBase64), 'base64').toString('utf8')
    },
  }
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 20))
  })
}

const frameOf = (h: Harness) =>
  h.el.querySelector<HTMLIFrameElement>('[data-testid="web-html-preview"]')

/** jsdom does not load `srcdoc`: write the copy into the frame and fire its load event. */
async function loadFrame(h: Harness): Promise<Document> {
  const iframe = frameOf(h)
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

const toolbarButton = (h: Harness, key: Parameters<typeof translateMobile>[1]) =>
  h.el.querySelector(
    ['phone-quick-toolbar', 'tablet-toolbar']
      .map((id) => `[data-testid="${id}"] button[aria-label="${ko(key)}"]`)
      .join(', '),
  )
const headerButton = (h: Harness, key: 'undo' | 'redo') =>
  h.el.querySelector(`[data-testid="editor-header"] button[aria-label="${ko(key)}"]`)
const hiddenBoxes = (h: Harness) =>
  Array.from(h.el.querySelectorAll('[data-testid="web-html-hidden"]'))
const sheet = () => document.querySelector('[data-testid="web-hide-sheet"]')
const labelField = () => document.querySelector<HTMLInputElement>('[data-testid="web-hide-label"]')

const HIDDEN_WHO = PAGE.replace('<p id="who">', '<p id="who" data-gx-redact="가림1">')

describe('web HTML hide from AI', () => {
  it('hides the selected element with the desktop mark, in one undo step', async () => {
    const h = await setup(PAGE, { aiEnabled: true, mode: 'edit' })
    let frameDoc = await loadFrame(h)
    // no element tools before an element is selected
    expect(toolbarButton(h, 'webHideFromAi')).toBeNull()
    await press(frameDoc, '#who')
    await click(toolbarButton(h, 'webHideFromAi'))
    expect(sheet()).not.toBeNull()
    // the first free name, and the {{name}} the model will read
    expect(labelField()?.value).toBe('가림1')
    expect(document.querySelector('[data-testid="web-hide-marker"]')?.textContent).toBe('{{가림1}}')
    await click(document.querySelector('[data-testid="web-hide-confirm"]'))
    expect(await h.source()).toBe(HIDDEN_WHO)

    // marked over the preview, in the parent layer; the frame document carries no mark of ours
    frameDoc = await loadFrame(h)
    const boxes = hiddenBoxes(h)
    expect(boxes.map((b) => b.getAttribute('data-sid'))).toEqual([
      frameDoc.querySelector('#who')!.getAttribute('data-gx-sid'),
    ])
    expect(frameOf(h)!.contains(boxes[0]!)).toBe(false)
    expect(frameDoc.contains(boxes[0]!)).toBe(false)
    expect(frameOf(h)?.getAttribute('sandbox')).toBe('allow-same-origin')

    // the selected element is hidden now: the entry is "unhide"
    expect(toolbarButton(h, 'webHideFromAi')).toBeNull()
    expect(toolbarButton(h, 'webUnhide')).not.toBeNull()

    await click(headerButton(h, 'undo'))
    expect(await h.source()).toBe(PAGE)
    await click(headerButton(h, 'redo'))
    expect(await h.source()).toBe(HIDDEN_WHO)
  })

  it('the next name skips the ones the page already uses', async () => {
    const h = await setup(HIDDEN_WHO, { aiEnabled: true, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    await press(frameDoc, '#tail')
    await click(toolbarButton(h, 'webHideFromAi'))
    expect(labelField()?.value).toBe('가림2')
  })

  it('unhides: the mark goes, the words and other attributes stay, one undo step', async () => {
    const h = await setup(HIDDEN_WHO, { aiEnabled: true, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    await press(frameDoc, '#who')
    await click(toolbarButton(h, 'webUnhide'))
    expect(await h.source()).toBe(PAGE)
    expect(toolbarButton(h, 'webHideFromAi')).not.toBeNull()
    await loadFrame(h)
    expect(hiddenBoxes(h)).toEqual([])
    await click(headerButton(h, 'undo'))
    expect(await h.source()).toBe(HIDDEN_WHO)
  })

  it('takes every hide mark of the element itself off, also attribute marks', async () => {
    const text = PAGE.replace(
      '<p id="tail">',
      '<p id="tail" title="비밀" data-gx-redact-title="제목" data-gx-redact="본문">',
    )
    const h = await setup(text, { aiEnabled: true, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    await press(frameDoc, '#tail')
    await click(toolbarButton(h, 'webUnhide'))
    expect(await h.source()).toBe(PAGE.replace('<p id="tail">', '<p id="tail" title="비밀">'))
  })

  it('cancelling the sheet writes nothing', async () => {
    const h = await setup(PAGE, { aiEnabled: true, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    await press(frameDoc, '#who')
    await click(toolbarButton(h, 'webHideFromAi'))
    await click(document.querySelector('[data-testid="web-hide-cancel"]'))
    expect(sheet()).toBeNull()
    expect(await h.source()).toBe(PAGE)
  })

  it('refuses the document body with its own notice', async () => {
    const h = await setup(PAGE, { aiEnabled: true, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    await press(frameDoc, 'body')
    await click(toolbarButton(h, 'webHideFromAi'))
    expect(sheet()).toBeNull()
    expect(h.toasts).toContainEqual({ message: ko('webHtmlCannotHide'), tone: 'error' })
    expect(await h.source()).toBe(PAGE)
  })

  it('the entry is absent while the AI is off; hidden elements stay marked', async () => {
    const h = await setup(HIDDEN_WHO, { aiEnabled: false, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    expect(hiddenBoxes(h).length).toBe(1)
    await press(frameDoc, '#tail')
    // the element tools are there, the hide entry is not
    expect(toolbarButton(h, 'webHtmlEditText')).not.toBeNull()
    expect(toolbarButton(h, 'webHideFromAi')).toBeNull()
    await press(frameDoc, '#who')
    expect(toolbarButton(h, 'webUnhide')).toBeNull()

    h.rerender({ aiEnabled: true })
    expect(toolbarButton(h, 'webUnhide')).not.toBeNull()
    // view mode: no element tools at all, the mark stays drawn
    h.rerender({ mode: 'view' })
    expect(toolbarButton(h, 'webUnhide')).toBeNull()
    await loadFrame(h)
    expect(hiddenBoxes(h).length).toBe(1)
  })

  it('a hidden element is withheld from the model of the next run', async () => {
    const h = await setup(PAGE, { aiEnabled: true, mode: 'edit' })
    const frameDoc = await loadFrame(h)
    await press(frameDoc, '#who')
    await click(toolbarButton(h, 'webHideFromAi'))
    await click(document.querySelector('[data-testid="web-hide-confirm"]'))
    const run = await h.doc.createAiRun!({
      getMode: () => 'edit',
      getCapabilities: () => ({
        writable: true,
        encrypted: false,
        distribution: false,
        isUntitled: false,
      }),
      switchToEdit: () => {},
      setUndo: () => {},
      getLang: () => 'ko',
    })
    const context = run.skill.buildContext?.() ?? ''
    const read = await run.skill.executeTool({ id: 'r1', name: 'read_source', input: {} })
    for (const out of [context, read.output, run.skill.systemPrompt]) {
      expect(out).not.toContain('홍길동')
      expect(out).not.toContain('010-1234')
    }
    expect(read.output).toContain('{{가림1}}')
  })
})

describe('web HTML AI edits in the editor', () => {
  it('one edit batch of the AI is one undo step of the editor; the run undo restores', async () => {
    const h = await setup(PAGE, { aiEnabled: true, mode: 'edit' })
    const undo: Array<{ summary: string; undo: () => void } | null> = []
    const run = await h.doc.createAiRun!({
      getMode: () => 'edit',
      getCapabilities: () => ({
        writable: true,
        encrypted: false,
        distribution: false,
        isUntitled: false,
      }),
      switchToEdit: () => {},
      setUndo: (entry) => undo.push(entry),
      getLang: () => 'ko',
    })
    run.skill.buildContext?.()
    const map = mapDocument(PAGE, 0, null)
    const sid = (marker: string) =>
      map.elements.find((e) => PAGE.slice(e.startTag[0], e.startTag[1]).includes(marker))!.sid
    const result = await act(async () =>
      run.skill.executeTool({
        id: 'e1',
        name: 'apply_ops',
        input: {
          ops: [
            { op: 'set_text', sid: sid('<h1'), text: '새 연락처' },
            { op: 'set_text', sid: sid('id="tail"'), text: '새 끝' },
          ],
        },
      }),
    )
    expect(result.isError, result.output).toBeFalsy()
    const edited = PAGE.replace('<h1>연락처</h1>', '<h1>새 연락처</h1>').replace('끝 문단', '새 끝')
    expect(await h.source()).toBe(edited)

    await click(headerButton(h, 'undo'))
    expect(await h.source()).toBe(PAGE)
    await click(headerButton(h, 'redo'))
    expect(await h.source()).toBe(edited)

    // the run's own undo goes back to where the run started
    await act(async () => undo.at(-1)!.undo())
    expect(await h.source()).toBe(PAGE)
    expect(undo.at(-1)).toBeNull()
  })
})
