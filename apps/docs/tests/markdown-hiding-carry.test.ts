/**
 * Word → Markdown export keeps hidden words and their hiding mark: the copy
 * holds the text inside the Markdown editor's hiding span, so nothing is lost,
 * and reading that copy for an AI still replaces it with its marker. The AI's
 * own view of the Word document is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { documentToMarkdown } from '../src/renderer/export-markdown'
import { serializeRangeToHtml } from '../src/renderer/ai/protocol'
import { redactMarkdownSource } from '../../../packages/file-parse/src/markdown-redaction'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function editorWith(content: unknown[]): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content: content as JSONContent[] },
  })
  editors.push(editor)
  return editor
}

const para = (...content: unknown[]) => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content,
})

function hide(editor: Editor, words: string, label: string): void {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(words)) at = pos + node.text.indexOf(words)
  })
  if (at < 0) throw new Error(`no ${words}`)
  editor
    .chain()
    .setTextSelection({ from: at, to: at + words.length })
    .setRedaction(label)
    .run()
}

describe('Word → Markdown with hidden spans', () => {
  it('writes the words inside the hiding span, and the copy reads back hidden', () => {
    const editor = editorWith([
      para({ type: 'text', text: '담임 홍길동 선생님께 전화 010-1234-5678' }),
    ])
    hide(editor, '홍길동', '이름')
    hide(editor, '010-1234-5678', '학부모 전화')
    const { markdown } = documentToMarkdown(editor)
    expect(markdown).toBe(
      '담임 <span class="redact-span" data-redaction="" data-label="이름">홍길동</span> 선생님께 전화 ' +
        '<span class="redact-span" data-redaction="" data-label="학부모 전화">010-1234-5678</span>\n',
    )
    const forAi = redactMarkdownSource(markdown)
    expect(forAi).toContain('{{이름}}')
    expect(forAi).toContain('{{학부모 전화}}')
    expect(forAi).not.toContain('홍길동')
    expect(forAi).not.toContain('010-1234-5678')
  })

  it('keeps formatting around the span and escapes what could close it early', () => {
    const editor = editorWith([
      para({
        type: 'text',
        text: 'a<b> c:\\',
        marks: [{ type: 'bold' }],
      }),
      para({ type: 'text', text: 'plain' }),
    ])
    hide(editor, 'a<b> c:\\', 'secret')
    const { markdown } = documentToMarkdown(editor)
    expect(markdown).toContain(
      '**<span class="redact-span" data-redaction="" data-label="secret">a&lt;b&gt; c:&#92;</span>**',
    )
    const forAi = redactMarkdownSource(markdown)
    expect(forAi).toContain('{{secret}}')
    expect(forAi).not.toContain('a<b>')
  })

  it('carries hidden spans inside table cells', () => {
    const editor = editorWith([
      {
        type: 'docTable',
        content: [
          {
            type: 'docTableRow',
            content: [{ type: 'docTableCell', content: [para({ type: 'text', text: '성명' })] }],
          },
          {
            type: 'docTableRow',
            content: [{ type: 'docTableCell', content: [para({ type: 'text', text: '홍길동' })] }],
          },
        ],
      },
    ])
    hide(editor, '홍길동', '이름-01')
    const { markdown } = documentToMarkdown(editor)
    expect(markdown).toContain(
      '<span class="redact-span" data-redaction="" data-label="이름-01">홍길동</span>',
    )
    expect(redactMarkdownSource(markdown)).not.toContain('홍길동')
  })

  it('a document without hidden spans exports exactly as before', () => {
    const editor = editorWith([para({ type: 'text', text: 'Plain <tag> text' })])
    expect(documentToMarkdown(editor).markdown).toBe('Plain \\<tag> text\n')
  })

  it('the AI still reads the Word document with markers, not the words', () => {
    const editor = editorWith([para({ type: 'text', text: '담임 홍길동 선생님' })])
    hide(editor, '홍길동', '이름')
    const html = serializeRangeToHtml(editor, 0, 0)
    expect(html).toBe('<p>담임 {{이름}} 선생님</p>')
    expect(html).not.toContain('data-redaction')
  })
})
