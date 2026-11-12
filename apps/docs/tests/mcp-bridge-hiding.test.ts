/**
 * A Word tab driven over MCP (the in-app server under Integrations and an agent
 * session's server) follows the in-app AI's hiding rule (민감정보 가리기):
 * reads show a hidden span as its `{{label}}`, text matching never sees hidden
 * words, and an edit that would change, remove, split, copy or move a hidden
 * span is refused with `hidden_content`, naming the labels, and leaves the
 * document as it was. Runs the real bridge on a real editor.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import type { FileActionContext } from '../src/renderer/file-actions'
import { installMcpBridge } from '../src/renderer/mcp-bridge'

const SECRET = '13800138000'
const LABEL = 'client phone'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.length = 0
})

interface Report {
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

let handler: ((message: unknown) => void) | null = null
let reports: Report[] = []
beforeEach(() => {
  handler = null
  reports = []
  ;(window as unknown as { desktop: unknown }).desktop = {
    onMcpCommand: (fn: (message: unknown) => void) => {
      handler = fn
      return () => {}
    },
    reportMcpResult: (r: Report) => reports.push(r),
    signalMcpReady: () => {},
  }
})

const para = (text: string) => ({ type: 'docParagraph', content: [{ type: 'text', text }] })

/** `Call <secret> now` with the number hidden, then two plain paragraphs */
function open(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [para(`Call ${SECRET} now`), para('Second paragraph.'), para('Third.')],
    },
  })
  editors.push(editor)
  const start = 1 + 'Call '.length
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, start, start + SECRET.length),
    ),
  )
  editor.commands.setRedaction(LABEL)
  editor.commands.setTextSelection(1)
  return editor
}

async function send(editor: Editor, command: string, payload: unknown): Promise<Report> {
  const ctx = {
    editor,
    doc: { parsed: { blocks: [] }, isBlank: false },
  } as unknown as FileActionContext
  const stop = installMcpBridge({ getCtx: () => ctx })
  const requestId = `r${reports.length + 1}`
  handler!({ requestId, command, payload })
  await expect.poll(() => reports.some((r) => r.requestId === requestId)).toBe(true)
  stop()
  return reports.find((r) => r.requestId === requestId)!
}

/** the hidden words and their label, wherever they are */
function hiddenSpans(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((m) => m.type.name === 'redaction')
    if (node.isText && mark) out.push(`${String(mark.attrs.label)}:${node.text}`)
  })
  return out
}

async function expectRefused(editor: Editor, command: string, payload: unknown): Promise<void> {
  const before = editor.state.doc
  const reply = await send(editor, command, payload)
  expect(reply.ok).toBe(false)
  expect(reply.error).toMatch(/^hidden_content: /)
  expect(reply.error).toContain(LABEL)
  expect(reply.error).not.toContain(SECRET)
  expect(editor.state.doc.eq(before)).toBe(true)
  expect(hiddenSpans(editor)).toEqual([`${LABEL}:${SECRET}`])
}

describe('MCP reads of a Word tab with hidden words', () => {
  it('reads a hidden span as its label', async () => {
    const editor = open()
    const reply = await send(editor, 'read_document', {})
    expect(reply.ok).toBe(true)
    const text = (reply.result as { text: string }).text
    expect(text).toContain(`{{${LABEL}}}`)
    expect(text).not.toContain(SECRET)
  })
})

describe('MCP edits of a Word tab with hidden words', () => {
  it('refuses replacing the block that holds a hidden span', async () => {
    const editor = open()
    await expectRefused(editor, 'replace_blocks', {
      startBlockIndex: 0,
      endBlockIndex: 0,
      html: `<p>Call {{${LABEL}}} today</p>`,
    })
  })

  it('lets a block without hidden words be replaced', async () => {
    const editor = open()
    const reply = await send(editor, 'replace_blocks', {
      startBlockIndex: 1,
      endBlockIndex: 1,
      html: '<p>Rewritten.</p>',
    })
    expect(reply.ok, reply.error).toBe(true)
    expect(editor.state.doc.child(1).textContent).toBe('Rewritten.')
    expect(hiddenSpans(editor)).toEqual([`${LABEL}:${SECRET}`])
  })

  it('never finds hidden words: finding them answers nothing found, not a refusal', async () => {
    const editor = open()
    const before = editor.state.doc
    const reply = await send(editor, 'apply_ops', {
      ops: [{ op: 'findReplace', find: SECRET, replace: 'the number' }],
    })
    expect(reply.ok, reply.error).toBe(true)
    expect(JSON.stringify(reply)).not.toContain('hidden_content')
    expect(editor.state.doc.eq(before)).toBe(true)
    const styled = await send(editor, 'apply_ops', {
      ops: [{ op: 'setMatchedFont', text: SECRET.slice(2, 6), bold: true }],
    })
    expect(styled.ok, styled.error).toBe(true)
    expect(editor.state.doc.eq(before)).toBe(true)
  })

  it('lets text beside a hidden span be replaced', async () => {
    const editor = open()
    const reply = await send(editor, 'apply_ops', {
      ops: [{ op: 'findReplace', find: 'now', replace: 'today' }],
    })
    expect(reply.ok, reply.error).toBe(true)
    expect(editor.state.doc.child(0).textContent).toBe(`Call ${SECRET} today`)
    expect(hiddenSpans(editor)).toEqual([`${LABEL}:${SECRET}`])
  })

  it('refuses a replacement that damages a marker', async () => {
    const editor = open()
    await expectRefused(editor, 'apply_ops', {
      ops: [{ op: 'findReplace', find: 'now', replace: `{{${LABEL}}} today` }],
    })
  })

  it('refuses deleting and moving the block that holds a hidden span', async () => {
    const editor = open()
    await expectRefused(editor, 'apply_ops', {
      ops: [{ op: 'deleteBlocks', target: { blockIndexes: [0] } }],
    })
    await expectRefused(editor, 'apply_ops', {
      ops: [{ op: 'deleteBlocks', target: { containsText: `{{${LABEL}}}` } }],
    })
    await expectRefused(editor, 'apply_ops', {
      ops: [{ op: 'moveBlocks', blockIndexes: [0], afterBlockIndex: 2 }],
    })
  })

  it('does not take a hiding mark from new content', async () => {
    // the restricted HTML has no hiding mark: the words land plain and the
    // document still holds exactly the one span it had
    const editor = open()
    const reply = await send(editor, 'insert_content', {
      afterBlockIndex: 2,
      html: `<p><span data-redaction="" data-label="${LABEL}">guess</span></p>`,
    })
    expect(reply.ok, reply.error).toBe(true)
    expect(editor.state.doc.child(3).textContent).toBe('guess')
    expect(hiddenSpans(editor)).toEqual([`${LABEL}:${SECRET}`])
  })

  it('lets formatting reach a hidden span, which keeps its words', async () => {
    const editor = open()
    const reply = await send(editor, 'apply_ops', {
      ops: [{ op: 'setFont', target: { blockIndexes: [0] }, bold: true }],
    })
    expect(reply.ok, reply.error).toBe(true)
    expect(hiddenSpans(editor)).toEqual([`${LABEL}:${SECRET}`])
  })

  it('lets new content be inserted', async () => {
    const editor = open()
    const reply = await send(editor, 'insert_content', {
      afterBlockIndex: 0,
      html: '<p>Inserted.</p>',
    })
    expect(reply.ok, reply.error).toBe(true)
    expect(editor.state.doc.child(1).textContent).toBe('Inserted.')
    expect(hiddenSpans(editor)).toEqual([`${LABEL}:${SECRET}`])
  })
})

describe('the withheld-content comparison behind the guard', () => {
  it('names a span that was split, relabelled, copied or reordered', async () => {
    const { hiddenContentChange, hiddenContentOf } = await import('../src/renderer/ai/hidden-guard')
    const editor = open()
    const before = hiddenContentOf(editor.state.doc)
    const at = 1 + 'Call '.length
    const mark = editor.schema.marks.redaction!
    const split = editor.state.tr.insertText('-', at + 3)
    expect(hiddenContentChange(before, hiddenContentOf(split.doc))).toEqual([LABEL])
    const relabel = editor.state.tr
      .removeMark(at, at + SECRET.length, mark)
      .addMark(at, at + SECRET.length, mark.create({ label: 'other' }))
    expect(hiddenContentChange(before, hiddenContentOf(relabel.doc))).toEqual([LABEL, 'other'])
    const copy = editor.state.tr.insert(
      editor.state.doc.content.size,
      editor.state.doc.child(0).copy(editor.state.doc.child(0).content),
    )
    expect(hiddenContentChange(before, hiddenContentOf(copy.doc))).toEqual([LABEL])
    const beside = editor.state.tr.insertText('!', editor.state.doc.child(0).nodeSize - 1)
    expect(hiddenContentChange(before, hiddenContentOf(beside.doc))).toBeNull()
  })
})
