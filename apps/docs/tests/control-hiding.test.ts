/**
 * `ieumoffice selection` (and its MCP tool) reads the user's selection out of
 * the open Word tab. The text goes to a program, often a model, so a hidden
 * span in it reads as its `{{label}}` (민감정보 가리기).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { handleDocsControl } from '../src/renderer/control'

const SECRET = '13800138000'
const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.length = 0
})

const para = (text: string) => ({ type: 'docParagraph', content: [{ type: 'text', text }] })

describe('the selection of a Word tab with hidden words', () => {
  it('answers a hidden span as its label', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: { type: 'doc', content: [para(`Call ${SECRET} now`), para('Next.')] },
    })
    editors.push(editor)
    const start = 1 + 'Call '.length
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, start, start + SECRET.length),
      ),
    )
    editor.commands.setRedaction('client phone')
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
    const reply = handleDocsControl({ cmd: 'selection' }, editor, true)
    expect(JSON.stringify(reply)).not.toContain(SECRET)
    expect(reply).toEqual({
      status: 'ok',
      result: { blocks: [0, 1], text: 'Call {{client phone}} now\nNext.', collapsed: false },
    })
  })
})
