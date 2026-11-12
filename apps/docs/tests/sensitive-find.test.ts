/**
 * "Find sensitive info" in the Word editor: the finder over a real editor
 * document (reading order, table headers, text already hidden, the places the
 * mark cannot reach), the labels, confirming with the editor's own hiding mark,
 * and dismissing into the exclusion memory.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { REDACT_MARK } from '../src/renderer/ai/redact'
import { modelTextOf } from '../src/renderer/ai/redact-view'
import {
  candidateRows,
  existingHidingMarks,
  findDocSensitive,
  type DocSensitiveText,
} from '../src/renderer/sensitive/doc-sensitive'
import {
  countAttachmentCandidates,
  useDocSensitive,
  type DocSensitive,
  type DocSensitiveSources,
} from '../src/renderer/sensitive/use-doc-sensitive'

const TEXT: DocSensitiveText = {
  paragraph: (n) => `P${n}`,
  tableCell: (n, r, c) => `T${n}R${r}C${c}`,
  header: 'Header',
  footer: 'Footer',
  footnote: 'Footnote',
  endnote: 'Endnote',
  comment: 'Comment',
}

const para = (...content: unknown[]) => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content,
})
const text = (s: string) => ({ type: 'text', text: s })
const cell = (s: string) => ({ type: 'docTableCell', content: [para(text(s))] })
const row = (...cells: string[]) => ({ type: 'docTableRow', content: cells.map(cell) })

const editors: Editor[] = []
function makeEditor(content: unknown[]): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content: content as JSONContent[] },
  })
  editors.push(editor)
  return editor
}

/** hide the first occurrence of `words` with the editor's own command */
function hide(editor: Editor, words: string, label: string): void {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(words)) at = pos + node.text.indexOf(words)
  })
  if (at < 0) throw new Error(`no ${words}`)
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + words.length)),
  )
  editor.commands.setRedaction(label)
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  delete (window as unknown as { desktop?: unknown }).desktop
})

function sample(): Editor {
  return makeEditor([
    para(text('담당 전화 010-1234-5678, 메일 hong@example.com')),
    {
      type: 'docTable',
      content: [row('성명', '학번'), row('홍길동', '20231234'), row('김철수', '20231235')],
    },
    para(text('비상 연락 010-9999-8888')),
  ])
}

describe('finding in a Word document', () => {
  it('reads the body in order and gives table cells their column header', async () => {
    const editor = sample()
    const found = await findDocSensitive(editor.state.doc, {}, { lang: 'ko', text: TEXT })
    expect(found.map((c) => [c.kind, c.value, c.location])).toEqual([
      ['phone', '010-1234-5678', 'P1'],
      ['email', 'hong@example.com', 'P1'],
      ['name', '홍길동', 'T1R2C1'],
      ['id-number', '20231234', 'T1R2C2'],
      ['name', '김철수', 'T1R3C1'],
      ['id-number', '20231235', 'T1R3C2'],
      ['phone', '010-9999-8888', 'P2'],
    ])
    // every body candidate maps to the exact words in the document
    for (const c of found) {
      expect(c.hideable).toBe(true)
      expect(editor.state.doc.textBetween(c.range!.from, c.range!.to)).toBe(c.value)
    }
  })

  it('never offers text that is already hidden', async () => {
    const editor = sample()
    hide(editor, '010-1234-5678', '전화-01')
    const found = await findDocSensitive(editor.state.doc, {}, { lang: 'ko', text: TEXT })
    expect(found.map((c) => c.value)).not.toContain('010-1234-5678')
    expect(found.map((c) => c.value)).toContain('010-9999-8888')
  })

  it('lists headers, footers, notes and comments as places it cannot hide, and counts them', async () => {
    const editor = makeEditor([para(text('본문'))])
    const found = await findDocSensitive(
      editor.state.doc,
      {
        headers: ['담당 010-2222-3333'],
        footnotes: ['문의 a@b.co'],
        comments: ['전화 010-4444-5555'],
      },
      { lang: 'ko', text: TEXT },
    )
    expect(found.map((c) => [c.value, c.location, c.hideable, c.reason])).toEqual([
      ['010-2222-3333', 'Header', false, 'header-footer'],
      ['a@b.co', 'Footnote', false, 'note'],
      ['010-4444-5555', 'Comment', false, 'memo-text'],
    ])
  })

  it('numbers labels after the marks the document already has, same value same label', async () => {
    const editor = makeEditor([
      para(text('담임 010-1111-2222, 교무실 010-3333-4444, 다시 010-1111-2222')),
    ])
    hide(editor, '010-1111-2222', '전화-01')
    expect(existingHidingMarks(editor.state.doc).marks).toEqual([
      { label: '전화-01', value: '010-1111-2222' },
    ])
    const found = await findDocSensitive(editor.state.doc, {}, { lang: 'ko', text: TEXT })
    const rows = candidateRows(editor.state.doc, found, 'ko')
    expect(rows.map((r) => [r.value, r.label])).toEqual([
      ['010-3333-4444', '전화-02'],
      ['010-1111-2222', '전화-01'],
    ])
    // the label never carries the value; the context does, for the reader only
    expect(rows[0].before).toContain('교무실')
  })

  it('leaves out what the exclusion memory says was dismissed', async () => {
    const editor = sample()
    const isExcluded = vi.fn(async (items: { kind: string; value: string }[]) =>
      items.map((i) => i.value === 'hong@example.com'),
    )
    const found = await findDocSensitive(
      editor.state.doc,
      {},
      {
        lang: 'ko',
        text: TEXT,
        isExcluded,
      },
    )
    expect(isExcluded).toHaveBeenCalledTimes(1)
    expect(found.map((c) => c.value)).not.toContain('hong@example.com')
    expect(found).toHaveLength(6)
  })
})

describe('attachments of a request', () => {
  it('counts candidates in the text the hiding-aware reader returns, slice by slice', async () => {
    const files: Record<string, string> = {
      'a.docx': '연락처 010-1234-5678\n{{이름}} 님',
      'b.txt': 'x'.repeat(10) + '\nmail me@example.org',
    }
    const read = vi.fn(async (path: string, offset: number, max: number) => {
      const all = files[path]
      if (all === undefined) return { ok: false }
      return {
        ok: true,
        text: all.slice(offset, offset + Math.min(max, 12)),
        totalChars: all.length,
      }
    })
    expect(await countAttachmentCandidates(['a.docx', 'b.txt', 'gone.pdf'], read)).toBe(2)
  })
})

/** the hook, rendered so its state and callbacks can be driven */
function renderHook(sources: DocSensitiveSources): {
  current: () => DocSensitive
  unmount: () => void
} {
  let latest: DocSensitive | null = null
  function Probe() {
    latest = useDocSensitive(sources)
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => root.render(createElement(Probe)))
  return {
    current: () => latest!,
    unmount: () => act(() => root.unmount()),
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

describe('the list wired to the editor', () => {
  it('confirming hides the words with the editor mark and its label; the model sees the label', async () => {
    const editor = sample()
    const hook = renderHook({ editor, filePath: null, lang: 'ko', text: TEXT, extras: () => ({}) })
    act(() => hook.current().openList())
    await settle()
    const rows = hook.current().rows
    const phone = rows.find((r) => r.value === '010-9999-8888')!
    await act(async () => await hook.current().confirm([phone.id]))
    await settle()
    const model = modelTextOf(editor.getJSON() as never)
    expect(model).toContain(`{{${phone.label}}}`)
    expect(model).not.toContain('010-9999-8888')
    // the file keeps the words: the mark is over them, nothing was replaced
    expect(editor.state.doc.textContent).toContain('010-9999-8888')
    expect(hook.current().rows.map((r) => r.value)).not.toContain('010-9999-8888')
    hook.unmount()
  })

  it('"hide all" confirms every hideable row and leaves the unhideable ones listed', async () => {
    const editor = sample()
    const hook = renderHook({
      editor,
      filePath: null,
      lang: 'ko',
      text: TEXT,
      extras: () => ({ footers: ['010-7777-6666'] }),
    })
    act(() => hook.current().openList())
    await settle()
    const ids = hook
      .current()
      .rows.filter((r) => r.hideable)
      .map((r) => r.id)
    expect(ids).toHaveLength(7)
    await act(async () => await hook.current().confirm(ids))
    await settle()
    expect(hook.current().rows.map((r) => [r.value, r.hideable])).toEqual([
      ['010-7777-6666', false],
    ])
    let marked = 0
    editor.state.doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === REDACT_MARK)) marked++
    })
    expect(marked).toBe(7)
    expect(await hook.current().countDocument()).toBe(1)
    hook.unmount()
  })

  it('dismissing remembers kind and value for the document path and drops the row', async () => {
    const stored: { kind: string; value: string }[] = []
    const add = vi.fn(async (_path: string, item: { kind: string; value: string }) => {
      stored.push(item)
      return true
    })
    const check = vi.fn(async (_path: string, items: { kind: string; value: string }[]) =>
      items.map((i) => stored.some((s) => s.kind === i.kind && s.value === i.value)),
    )
    ;(window as unknown as { desktop: unknown }).desktop = {
      sensitiveExclusionAdd: add,
      sensitiveExclusionCheck: check,
    }
    const editor = sample()
    const sources = {
      editor,
      filePath: 'C:/docs/a.docx',
      lang: 'ko',
      text: TEXT,
      extras: () => ({}),
    }
    const hook = renderHook(sources)
    act(() => hook.current().openList())
    await settle()
    const mail = hook.current().rows.find((r) => r.kind === 'email')!
    await act(async () => await hook.current().exclude(mail.id))
    await settle()
    expect(add).toHaveBeenCalledWith('C:/docs/a.docx', { kind: 'email', value: 'hong@example.com' })
    expect(hook.current().rows.map((r) => r.kind)).not.toContain('email')
    hook.unmount()
    // the next time the document is opened, the memory still leaves it out
    const again = renderHook(sources)
    expect(await again.current().countDocument()).toBe(6)
    again.unmount()
  })

  it('an untitled document remembers dismissals for as long as the tab lives', async () => {
    const editor = sample()
    const hook = renderHook({ editor, filePath: null, lang: 'ko', text: TEXT, extras: () => ({}) })
    act(() => hook.current().openList())
    await settle()
    const first = hook.current().rows[0]
    await act(async () => await hook.current().exclude(first.id))
    await settle()
    expect(await hook.current().countDocument()).toBe(6)
    hook.unmount()
  })
})
