import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { REDACT_MARK } from '../src/renderer/ai/redact'
import { executeTool, markDocSeen } from '../src/renderer/ai/tools'

/**
 * A withheld span is the reader's own words under a mark; the model only ever
 * sees its `{{label}}`. A rewrite that hands the placeholder back must land the
 * real words again, never the literal marker, and one that leaves it out must
 * not silently delete what the model was never shown.
 */

const SECRET = '13800138000'
const LABEL = 'client phone'
const NUM_IDS = { bullet: null, ordered: null }

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function marked(): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: null },
          content: [
            { type: 'text', text: 'Call ' },
            { type: 'text', text: SECRET, marks: [{ type: REDACT_MARK, attrs: { label: LABEL } }] },
            { type: 'text', text: ' now' },
          ],
        },
      ],
    },
  })
  editors.push(editor)
  markDocSeen(editor)
  return editor
}

function run(editor: Editor, name: string, input: Record<string, unknown>) {
  const out = executeTool(editor, { id: 't', name, input }, NUM_IDS)
  if (out instanceof Promise) throw new Error(`${name} should be sync`)
  return out
}

function withheldText(editor: Editor): string[] {
  const found: string[] = []
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((m) => m.type.name === REDACT_MARK)
    if (mark && node.isText) found.push(`${node.text}|${String(mark.attrs.label)}`)
  })
  return found
}

describe('an AI rewrite over a withheld span', () => {
  it('replace_blocks with the placeholder lands the real words, still withheld', () => {
    const editor = marked()
    const read = run(editor, 'read_blocks', { startBlockIndex: 0, endBlockIndex: 0 })
    const html = String(read.output)
    expect(html).toContain(`{{${LABEL}}}`)
    expect(html).not.toContain(SECRET)

    const out = run(editor, 'replace_blocks', {
      startBlockIndex: 0,
      endBlockIndex: 0,
      html: html.replace('now', 'today'),
    })
    expect(out.isError, String(out.output)).toBeFalsy()
    expect(String(out.output)).not.toContain(SECRET)
    expect(editor.state.doc.textContent).toBe(`Call ${SECRET} today`)
    expect(withheldText(editor)).toEqual([`${SECRET}|${LABEL}`])
  })

  it('replace_blocks that leaves the placeholder out is refused and changes nothing', () => {
    const editor = marked()
    run(editor, 'read_blocks', { startBlockIndex: 0, endBlockIndex: 0 })
    const before = editor.state.doc

    const out = run(editor, 'replace_blocks', {
      startBlockIndex: 0,
      endBlockIndex: 0,
      html: '<p>Call them today</p>',
    })
    expect(out.isError).toBe(true)
    expect(String(out.output)).toContain(`{{${LABEL}}}`)
    expect(String(out.output)).not.toContain(SECRET)
    expect(editor.state.doc.eq(before)).toBe(true)
  })

  it('replace_selection clipping into the span cannot overwrite part of it', () => {
    const editor = marked()
    const start = 1 + 'Call '.length
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, start + 3)),
    )
    const out = run(editor, 'replace_selection', { html: 'redacted' })
    expect(String(out.output)).not.toContain(SECRET)
    expect(withheldText(editor)).toEqual([`${SECRET}|${LABEL}`])
  })
})
