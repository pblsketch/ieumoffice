// Spec 4.4: "AI에게 숨기기" / "숨김 풀기" in the mobile Markdown editor, the preview of
// hidden spans, and the AI run that refuses an unverifiable mark.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HIDDEN_TEXT_UNVERIFIED_MESSAGE,
  hideSelection,
  revealHiddenSpans,
  unhideSpan,
  hiddenSpanAt,
} from '@genoffice/mobile-bridge/markdown'
import {
  createMobileClient,
  type MobileDocSession,
  type MobileTransport,
} from '@genoffice/mobile-bridge/transport'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { ToastRequest } from '../src/renderer/components/Toast'
import { markdownEditorKind } from '../src/renderer/editors/markdownKind'
import type {
  EditorDocument,
  EditorFrameProps,
  EditorHost,
} from '../src/renderer/editors/editorKind'
import { MobileLocaleProvider, translateMobile } from '../src/renderer/i18n'

/** The exact span the PC Markdown editor writes (apps/markdown editor/Redaction.ts). */
const pc = (label: string, words: string) =>
  `<span class="redact-span" data-redaction="" data-label="${label}">${words}</span>`

const ko = (key: Parameters<typeof translateMobile>[1]) => translateMobile('ko', key)

const NOTE: MobileDocSession = {
  sessionId: 'md-hide',
  docKey: 'doc-md-hide',
  name: 'note.md',
  ext: 'md',
  format: 'md',
  writable: true,
  ephemeral: false,
  uriHint: 'content://notes/note.md',
}

function clientFor(text: string) {
  const transport: MobileTransport = {
    async invoke<T>(command: string): Promise<T> {
      if (command === 'mobile_read_file_bytes') {
        return { bytesBase64: Buffer.from(text, 'utf8').toString('base64') } as T
      }
      return { ok: true } as T
    },
    async listen() {
      return () => {}
    },
  }
  return createMobileClient(transport)
}

interface Harness {
  readonly el: HTMLElement
  readonly doc: EditorDocument
  readonly toasts: Array<ToastRequest | string>
  readonly contentChanges: number
  q(testId: string): HTMLElement | null
  textarea(): HTMLTextAreaElement
  rerender(next: { aiEnabled?: boolean; mode?: DocumentMode }): void
}

const cleanups: Array<() => void> = []
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
  const client = clientFor(text)
  const opened = await markdownEditorKind.open({ session: NOTE, client, isUntitled: false })
  const toasts: Array<ToastRequest | string> = []
  let contentChanges = 0
  const host: EditorHost = {
    client,
    markDirty: () => {},
    updateSession: () => {},
    setNotice: () => {},
    showToast: (toast) => {
      toasts.push(toast)
    },
    contentChanged: () => {
      contentChanges++
    },
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
    docTitle: NOTE.name,
    docFormat: 'md',
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
  const q = (testId: string) => el.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  return {
    el,
    doc,
    toasts,
    get contentChanges() {
      return contentChanges
    },
    q,
    textarea: () => el.querySelector<HTMLTextAreaElement>('[data-editor="markdown"] textarea')!,
    rerender(next) {
      props = { ...props, ...next }
      render()
    },
  }
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

async function click(el: Element | null) {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 20))
  })
}

/** Selects `[start, end)` of the source as the reader would, and lets the editor see it. */
async function select(h: Harness, start: number, end: number) {
  const ta = h.textarea()
  await act(async () => {
    ta.focus()
    ta.setSelectionRange(start, end)
    ta.dispatchEvent(new Event('select'))
    await new Promise((r) => setTimeout(r, 10))
  })
}

/** Presses the more menu's entry `id`; null when the menu does not have it. */
async function pressMore(h: Harness, id: string): Promise<boolean> {
  await click(h.q('editor-more-btn'))
  const item = h.q(`editor-more-${id}`)
  if (!item) {
    // close the menu again
    await click(
      h.el.querySelector(`[data-testid="editor-more-sheet"] button[aria-label="${ko('cancel')}"]`),
    )
    return false
  }
  await click(item)
  return true
}

const errorToast = (key: Parameters<typeof translateMobile>[1]) => ({
  message: ko(key),
  tone: 'error',
})

describe('web markdown hide from AI: the editor writes the PC span format', () => {
  it('hides the selection with the next free label "가림N" in the PC span format', async () => {
    const before = `전화 ${pc('가림1', '010-1111')} 계좌 123-456 끝`
    const h = await setup(before, { aiEnabled: true, mode: 'edit' })
    const from = before.indexOf('123-456')
    await select(h, from, from + '123-456'.length)
    expect(await pressMore(h, 'webHideFromAi')).toBe(true)
    const label = h.q('web-hide-label') as HTMLInputElement
    expect(label).not.toBeNull()
    expect(label.value).toBe('가림2')
    expect(h.q('web-hide-marker')?.textContent).toBe('{{가림2}}')
    await click(h.q('web-hide-confirm'))
    expect(h.q('web-hide-sheet')).toBeNull()
    expect(h.textarea().value).toBe(
      `전화 ${pc('가림1', '010-1111')} 계좌 ${pc('가림2', '123-456')} 끝`,
    )
    expect(h.toasts).toEqual([])
  })

  it('sanitizes the typed label the way agent-core does', async () => {
    const before = '이름 홍길동 님'
    const h = await setup(before, { aiEnabled: true, mode: 'edit' })
    await select(h, 3, 6)
    await pressMore(h, 'webHideFromAi')
    const input = h.q('web-hide-label') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, '  고객 "이름" <b>  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(h.q('web-hide-marker')?.textContent).toBe('{{고객 이름 b}}')
    await click(h.q('web-hide-confirm'))
    expect(h.textarea().value).toBe(`이름 ${pc('고객 이름 b', '홍길동')} 님`)
  })

  it('the hide entry is in the format panel too, and hiding is one undo step', async () => {
    const before = '비밀 문구 하나'
    const h = await setup(before, { aiEnabled: true, mode: 'edit' })
    await select(h, 3, 5)
    await click(h.q('format-panel-btn'))
    const formatSheet = h.q('editor-format-sheet')!
    const hideBtn = [...formatSheet.querySelectorAll('button')].find(
      (b) => b.textContent === ko('webHideFromAi'),
    )
    await click(hideBtn ?? null)
    await click(h.q('web-hide-confirm'))
    expect(h.textarea().value).toBe(`비밀 ${pc('가림1', '문구')} 하나`)
    const undo = h.el.querySelector(
      `[data-testid="editor-header"] button[aria-label="${ko('undo')}"]`,
    )
    await click(undo)
    expect(h.textarea().value).toBe(before)
  })

  it('unhides the span the caret is in: the tags go, the words stay, one undo step', async () => {
    const before = `앞 ${pc('가림1', '숨긴 말')} 뒤`
    const h = await setup(before, { aiEnabled: true, mode: 'edit' })
    const inside = before.indexOf('숨긴') + 1
    await select(h, inside, inside)
    // the same entry now offers "unhide"
    await click(h.q('editor-more-btn'))
    expect(h.q('editor-more-webHideFromAi')).toBeNull()
    await click(h.q('editor-more-webUnhide'))
    expect(h.textarea().value).toBe('앞 숨긴 말 뒤')
    const undo = h.el.querySelector(
      `[data-testid="editor-header"] button[aria-label="${ko('undo')}"]`,
    )
    await click(undo)
    expect(h.textarea().value).toBe(before)
  })

  const refusals: Array<[string, string, (text: string) => [number, number], string]> = [
    ['an empty selection', '아무 글', () => [2, 2], 'webHideNoSelection'],
    [
      'a selection across a line break',
      '첫 줄\n둘째 줄',
      (t) => [2, t.length - 1],
      'webHideMultiLine',
    ],
    [
      'a selection overlapping a hidden span',
      `앞 글 ${pc('가림1', '숨김')} 뒤`,
      (t) => [2, t.indexOf('숨김') + 1],
      'webHideOverlap',
    ],
    [
      'a selection the reader could not read back (raw tag)',
      '앞 <b>굵게</b> 뒤',
      (t) => [t.indexOf('<b>'), t.indexOf('</b>')],
      'webHideCannot',
    ],
    [
      'a selection ending in a backslash',
      '경로 C:\\temp\\ 끝',
      (t) => [t.indexOf('C:'), t.indexOf(' 끝')],
      'webHideCannot',
    ],
  ]

  it.each(refusals)(
    'refuses %s with a notice and changes nothing',
    async (_n, text, range, key) => {
      const h = await setup(text, { aiEnabled: true, mode: 'edit' })
      const [start, end] = range(text)
      await select(h, start, end)
      expect(await pressMore(h, 'webHideFromAi')).toBe(true)
      expect(h.q('web-hide-sheet')).toBeNull()
      expect(h.textarea().value).toBe(text)
      expect(h.toasts).toEqual([errorToast(key as Parameters<typeof translateMobile>[1])])
    },
  )

  it('the hide entry is absent when the AI is off, and in view mode', async () => {
    const text = `앞 ${pc('가림1', '숨김')} 뒤 보통 글`
    const h = await setup(text, { aiEnabled: false, mode: 'edit' })
    await select(h, text.length - 2, text.length)
    expect(await pressMore(h, 'webHideFromAi')).toBe(false)
    expect(await pressMore(h, 'webUnhide')).toBe(false)
    await click(h.q('format-panel-btn'))
    const labels = [...h.el.querySelectorAll('[data-testid="editor-format-sheet"] button')].map(
      (b) => b.textContent,
    )
    expect(labels).not.toContain(ko('webHideFromAi'))
    expect(labels).not.toContain(ko('webUnhide'))

    h.rerender({ aiEnabled: true, mode: 'view' })
    expect(await pressMore(h, 'webHideFromAi')).toBe(false)
    h.rerender({ aiEnabled: true, mode: 'edit' })
    await select(h, text.length - 2, text.length)
    expect(await pressMore(h, 'webHideFromAi')).toBe(true)
  })
})

describe('web markdown hide from AI: preview and AI run', () => {
  it('the preview shows hidden words as plain text; the source keeps the markup', async () => {
    const text = `# 메모\n\n고객 ${pc('가림1', '홍길동')} 님과 **${pc('가림2', '내일')}** 통화.\n`
    const h = await setup(text, { aiEnabled: false, mode: 'view' })
    const preview = h.el.querySelector('.mobile-markdown-preview')!
    expect(preview.textContent).toContain('고객 홍길동 님과 내일 통화.')
    expect(preview.textContent).not.toContain('redact-span')
    expect(preview.textContent).not.toContain('<span')
    expect(preview.innerHTML).not.toContain('data-redaction')
    // nothing was written: the preview change is not an edit
    expect(h.contentChanges).toBe(0)
    h.rerender({ mode: 'edit' })
    expect(h.textarea().value).toBe(text)
  })

  it('createAiRun throws for a document with an unverifiable mark, with no notice of its own', async () => {
    const text = `앞 <span class="redact-span" data-redaction="" data-label="x">닫히지 않은 비밀\n`
    const h = await setup(text, { aiEnabled: true, mode: 'view' })
    const ctx = {
      getMode: () => 'view' as const,
      getCapabilities: () => ({
        writable: true,
        encrypted: false,
        distribution: false,
        isUntitled: false,
      }),
      switchToEdit: () => {},
      setUndo: () => {},
      getLang: () => 'ko' as const,
    }
    await expect(h.doc.createAiRun!(ctx)).rejects.toThrow(HIDDEN_TEXT_UNVERIFIED_MESSAGE)
    await flush()
    expect(h.toasts).toEqual([])
  })

  it('createAiRun for a verified document gives the model only placeholders', async () => {
    const text = `고객 ${pc('가림1', '홍길동')} 님\n`
    const h = await setup(text, { aiEnabled: true, mode: 'view' })
    const run = await h.doc.createAiRun!({
      getMode: () => 'view',
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
    const read = await run.skill.executeTool({ id: 'r', name: 'read_document', input: {} })
    expect(context).toContain('고객 {{가림1}} 님')
    expect(read.output).toBe('고객 {{가림1}} 님\n')
    for (const out of [context, read.output, run.skill.systemPrompt]) {
      expect(out).not.toContain('홍길동')
    }
  })
})

describe('web markdown hide helpers', () => {
  it('hideSelection refuses when the new span would not cover exactly the selected words', () => {
    // a closing tag among the words would end the span early and leave the rest readable
    const text = '앞 </span> 뒤'
    expect(hideSelection(text, 0, text.length, '가림1')).toEqual({
      ok: false,
      reason: 'unreadable',
    })
    // unpaired span markup: everything after it may already be hidden
    const open = '앞 <span data-redaction>x 뒤'
    expect(hideSelection(open, 0, 1, '가림1')).toEqual({ ok: false, reason: 'unreadable' })
    expect(hideSelection(open, open.length - 1, open.length, '가림1')).toEqual({
      ok: false,
      reason: 'overlap',
    })
  })

  it('hideSelection, hiddenSpanAt and unhideSpan round-trip', () => {
    const text = '하나 둘 셋'
    const r = hideSelection(text, 3, 4, '가림1')
    expect(r).toEqual({
      ok: true,
      source: `하나 ${pc('가림1', '둘')} 셋`,
      wordsStart: 3 + pc('가림1', '').indexOf('</span>'),
      wordsEnd: 4 + pc('가림1', '').indexOf('</span>'),
    })
    if (!r.ok) return
    const span = hiddenSpanAt(r.source, r.wordsStart, r.wordsStart)
    expect(span).not.toBeNull()
    expect(unhideSpan(r.source, span!).source).toBe(text)
    // a caret just outside the span is not in it
    expect(hiddenSpanAt(r.source, 3, 3)).toBeNull()
    expect(revealHiddenSpans(r.source)).toBe(text)
  })
})
