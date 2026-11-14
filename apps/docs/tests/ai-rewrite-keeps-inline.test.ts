import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  buildBlankDocx,
  parseDocx,
} from '@genoffice/docx-engine'
import { blocksToPmDoc, type PmNode } from '../src/renderer/editor/convert'
import { buildDocContext, getSelectionScope } from '../src/renderer/ai/protocol'
import { executeTool, markDocSeen } from '../src/renderer/ai/tools'

const NUM_IDS = { bullet: BLANK_BULLET_NUM_ID, ordered: BLANK_ORDERED_NUM_ID }
const TRACK = { author: 'AI Assistant' }
const PICTURE = 'data:image/png;base64,iVBORw0KGgo='
const RED = { color: 'C00000' }

const liveEditors: Editor[] = []
afterEach(() => {
  for (const editor of liveEditors.splice(0)) editor.destroy()
})

function richParagraph(): PmNode {
  return {
    type: 'docParagraph',
    attrs: { docxIndex: 3 },
    content: [
      { type: 'text', text: '이번 주에는 ' },
      { type: 'text', text: '신규 시스템', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' 도입' },
      { type: 'docNoteRef', attrs: { kind: 'footnote', id: '1', num: 1 } },
      { type: 'text', text: '을 위한 준비 ' },
      { type: 'text', text: '마감', marks: [{ type: 'docTextStyle', attrs: RED }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: '예산', marks: [{ type: 'comment', attrs: { ids: 'c7' } }] },
      { type: 'text', text: ' ' },
      { type: 'docInlineImage', attrs: { dataUrl: PICTURE, widthPx: 14, heightPx: 14 } },
      { type: 'text', text: ' ' },
      {
        type: 'text',
        text: '위키',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/wiki' } }],
      },
      { type: 'text', text: ' 끝.' },
    ],
  }
}

async function createEditor(blocks: PmNode[]) {
  const { editorExtensions } = await import('../src/renderer/editor/extensions')
  const parsed = await parseDocx(await buildBlankDocx())
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
  })
  liveEditors.push(editor)
  editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
  const pm = blocks.map((b) => editor.schema.nodeFromJSON(b))
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, pm))
  markDocSeen(editor)
  return editor
}

function call(editor: Editor, name: string, input: Record<string, unknown>, track?: typeof TRACK) {
  return executeTool(editor, { id: 't', name, input }, NUM_IDS, track)
}

async function readBlock(editor: Editor, index: number): Promise<string> {
  const r = await call(editor, 'read_blocks', { startBlockIndex: index, endBlockIndex: index })
  expect(r.isError).toBeFalsy()
  return String(r.output).split('\n…(truncated')[0].trim()
}

function inventory(editor: Editor) {
  const found = {
    noteIds: [] as string[],
    commentIds: [] as string[],
    pictures: [] as string[],
    redText: '',
    boldText: '',
    links: [] as string[],
  }
  editor.state.doc.descendants((node, _pos, parent) => {
    if (parent === editor.state.doc && node.attrs.blockRevision?.kind === 'del') return false
    if (node.marks.some((m) => m.type.name === 'del')) return
    if (node.type.name === 'docNoteRef') found.noteIds.push(String(node.attrs.id))
    if (node.type.name === 'docInlineImage') found.pictures.push(String(node.attrs.dataUrl))
    if (!node.isText) return
    for (const mark of node.marks) {
      if (mark.type.name === 'comment') found.commentIds.push(String(mark.attrs.ids))
      if (mark.type.name === 'docTextStyle' && mark.attrs.color === 'C00000')
        found.redText += node.text
      if (mark.type.name === 'bold') found.boldText += node.text
      if (mark.type.name === 'link') found.links.push(String(mark.attrs.href))
    }
  })
  return found
}

function struckCommentText(editor: Editor): Record<string, string> {
  const out: Record<string, string> = {}
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.marks.some((m) => m.type.name === 'del')) return
    const comment = node.marks.find((m) => m.type.name === 'comment')
    if (comment) out[String(comment.attrs.ids)] = (out[String(comment.attrs.ids)] ?? '') + node.text
  })
  return out
}

const ORIGINAL = {
  noteIds: ['1'],
  commentIds: ['c7'],
  pictures: [PICTURE],
  redText: '마감',
  boldText: '신규 시스템',
  links: ['https://example.com/wiki'],
}

describe('an AI rewrite keeps the inline objects of the text it rewrites', () => {
  it.each([
    ['untracked', undefined],
    ['tracked', TRACK],
  ] as const)(
    'replace_blocks with the read_blocks HTML, one word changed (%s)',
    async (_label, track) => {
      const editor = await createEditor([richParagraph()])
      const html = await readBlock(editor, 0)
      const rewritten = html.replace('준비', '준비 작업')
      expect(rewritten).not.toBe(html)

      const r = await call(
        editor,
        'replace_blocks',
        { startBlockIndex: 0, endBlockIndex: 0, html: rewritten },
        track,
      )
      expect(r.isError, String(r.output)).toBeFalsy()
      expect(editor.state.doc.textContent).toContain('준비 작업')
      if (!track) {
        expect(inventory(editor)).toEqual(ORIGINAL)
        return
      }
      expect(inventory(editor)).toEqual({ ...ORIGINAL, commentIds: [] })
      expect(struckCommentText(editor)).toEqual({ c7: '예산' })
      expect(String(r.output)).toContain('comments stay on the original (struck-through) text')
    },
  )

  it('replace_selection over a span holding a footnote mark keeps the mark', async () => {
    const editor = await createEditor([richParagraph()])
    const text = editor.state.doc.child(0).textContent
    const from = 1 + text.indexOf('신규')
    const to = 1 + text.indexOf('준비') + '준비'.length + 1
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    )
    const context = buildDocContext(editor, getSelectionScope(editor))
    const selected = /<p>[^\n]*?<sel>((?:(?!<sel>)[\s\S])*?)<\/sel>/.exec(context)?.[1] ?? ''
    expect(selected).not.toBe('')

    const r = await executeTool(
      editor,
      { id: 't', name: 'replace_selection', input: { html: selected.replace('위한 ', '') } },
      NUM_IDS,
      undefined,
      undefined,
      { scope: getSelectionScope(editor), doc: editor.state.doc },
    )
    expect(r.isError, String(r.output)).toBeFalsy()
    expect(inventory(editor).noteIds).toEqual(['1'])
  })

  it('a rewrite written from the plain preview never drops the objects silently', async () => {
    const editor = await createEditor([richParagraph()])
    const r = await call(editor, 'replace_blocks', {
      startBlockIndex: 0,
      endBlockIndex: 0,
      html: '<p>이번 주에는 신규 시스템 도입 준비를 했다. 마감 예산 위키 끝.</p>',
    })
    if (r.isError) {
      expect(inventory(editor)).toEqual(ORIGINAL)
    } else {
      const after = inventory(editor)
      expect(after.noteIds).toEqual(['1'])
      expect(after.commentIds).toEqual(['c7'])
      expect(after.pictures).toEqual([PICTURE])
    }
  })
})
