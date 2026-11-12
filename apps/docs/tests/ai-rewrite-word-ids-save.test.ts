import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  parseDocx,
  saveDocx,
} from '@genoffice/docx-engine'
import { buildDocx, TABLE_XML } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { buildDocContext, getSelectionScope } from '../src/renderer/ai/protocol'
import { executeTool, markDocSeen } from '../src/renderer/ai/tools'

/**
 * Word refuses a document.xml that holds one footnote id twice, or one comment
 * id with two ranges ("파일이 손상되었습니다"). These tests save AI rewrites of
 * a paragraph holding a footnote mark, a comment, a link and a picture, and
 * count what document.xml holds per id.
 */

const NUM_IDS = { bullet: BLANK_BULLET_NUM_ID, ordered: BLANK_ORDERED_NUM_ID }
const TRACK = { author: 'AI Assistant' }
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
const PICTURE_RUN =
  '<w:r><w:drawing><wp:inline><wp:extent cx="133350" cy="133350"/><wp:docPr id="1" name="Picture 1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:blipFill><a:blip r:embed="rId10"/></pic:blipFill></pic:pic>' +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'

const PARAGRAPH =
  '<w:p>' +
  run('이번 주에는 신규 시스템 도입') +
  '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
  run('을 위한 준비를 마쳤고 ') +
  '<w:commentRangeStart w:id="0"/>' +
  run('예산 문제') +
  '<w:commentRangeEnd w:id="0"/>' +
  '<w:r><w:commentReference w:id="0"/></w:r>' +
  run('는 남았다 ') +
  PICTURE_RUN +
  run(' ') +
  '<w:hyperlink r:id="rId30"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>위키</w:t></w:r></w:hyperlink>' +
  run(' 끝.') +
  '</w:p>'

/** the comment and the link without the atoms: a range with a table may hold no note mark or picture */
const PLAIN_PARAGRAPH =
  '<w:p>' +
  run('준비를 마쳤고 ') +
  '<w:commentRangeStart w:id="0"/>' +
  run('예산 문제') +
  '<w:commentRangeEnd w:id="0"/>' +
  '<w:r><w:commentReference w:id="0"/></w:r>' +
  run('는 남았다 ') +
  '<w:hyperlink r:id="rId30"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>위키</w:t></w:r></w:hyperlink>' +
  '</w:p>'

async function fixtureDocx(bodyXml: string) {
  return buildDocx({
    withImage: true,
    bodyXml: bodyXml + `<w:p>${run('다음 문단.')}</w:p>`,
    extraRels:
      '<Relationship Id="rId30" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/wiki" TargetMode="External"/>' +
      '<Relationship Id="rId40" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
      '<Relationship Id="rId41" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
    extraParts: [
      {
        path: 'word/footnotes.xml',
        xml: `${XML_DECL}<w:footnotes ${W}><w:footnote w:id="1"><w:p>${run('출처')}</w:p></w:footnote></w:footnotes>`,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
      },
      {
        path: 'word/comments.xml',
        xml: `${XML_DECL}<w:comments ${W}><w:comment w:id="0" w:author="Reviewer"><w:p>${run('확인')}</w:p></w:comment></w:comments>`,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
      },
    ],
  })
}

const liveEditors: Editor[] = []
afterEach(() => {
  for (const editor of liveEditors.splice(0)) editor.destroy()
})

async function openFixture(bodyXml = PARAGRAPH) {
  const parsed = await parseDocx(await fixtureDocx(bodyXml))
  const { editorExtensions } = await import('../src/renderer/editor/extensions')
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
  })
  liveEditors.push(editor)
  editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
  markDocSeen(editor)
  return { parsed, editor }
}

async function savedDocumentXml(parsed: Awaited<ReturnType<typeof parseDocx>>, editor: Editor) {
  const saved = await saveDocx(
    parsed,
    pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks).saveBlocks,
  )
  return (await JSZip.loadAsync(saved)).file('word/document.xml')!.async('string')
}

/** document position of the first character of `needle` inside one text node */
function textPos(editor: Editor, needle: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    const at = node.isText ? (node.text ?? '').indexOf(needle) : -1
    if (at !== -1) found = pos + at
  })
  expect(found, needle).not.toBe(-1)
  return found
}

function count(xml: string, element: string, id: string): number {
  return xml.match(new RegExp(`<w:${element}\\b[^>]*\\bw:id="${id}"`, 'g'))?.length ?? 0
}

function expectOneComment(xml: string) {
  expect(count(xml, 'commentRangeStart', '0'), 'comment 0 range starts').toBe(1)
  expect(count(xml, 'commentRangeEnd', '0'), 'comment 0 range ends').toBe(1)
  expect(count(xml, 'commentReference', '0'), 'comment 0 references').toBe(1)
  expect(xml).toContain('준비 작업')
  expect(xml).toMatch(/<w:hyperlink\b[^>]*r:id="rId30"/)
}

function expectOneOfEach(xml: string) {
  expect(count(xml, 'footnoteReference', '1'), 'footnote 1 references').toBe(1)
  expectOneComment(xml)
  expect(xml).toContain('r:embed="rId10"')
}

async function rewriteBlocks(editor: Editor, end: number, track?: typeof TRACK) {
  const read = await executeTool(
    editor,
    { id: 'r', name: 'read_blocks', input: { startBlockIndex: 0, endBlockIndex: end } },
    NUM_IDS,
  )
  const html = String(read.output).split('\n…(truncated')[0].trim()
  const rewritten = html.replace('준비를', '준비 작업을')
  expect(rewritten).not.toBe(html)
  const r = await executeTool(
    editor,
    {
      id: 't',
      name: 'replace_blocks',
      input: { startBlockIndex: 0, endBlockIndex: end, html: rewritten },
    },
    NUM_IDS,
    track,
  )
  expect(r.isError, String(r.output)).toBeFalsy()
}

describe('an AI rewrite saves a document.xml Word opens', () => {
  it.each([
    ['untracked', undefined],
    ['tracked', TRACK],
  ] as const)('replace_blocks over the paragraph (%s)', async (_label, track) => {
    const { parsed, editor } = await openFixture()
    await rewriteBlocks(editor, 0, track)
    expectOneOfEach(await savedDocumentXml(parsed, editor))
  })

  it.each([
    ['untracked', undefined],
    ['tracked', TRACK],
  ] as const)(
    'replace_blocks over a paragraph and a table, whole blocks as revisions (%s)',
    async (_label, track) => {
      const { parsed, editor } = await openFixture(PLAIN_PARAGRAPH + TABLE_XML)
      await rewriteBlocks(editor, 1, track)
      expectOneComment(await savedDocumentXml(parsed, editor))
    },
  )

  it.each([
    ['untracked', undefined],
    ['tracked', TRACK],
  ] as const)('replace_selection over most of the paragraph (%s)', async (_label, track) => {
    const { parsed, editor } = await openFixture()
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, textPos(editor, '주에는'), textPos(editor, ' 끝.')),
      ),
    )
    const scope = getSelectionScope(editor)
    const context = buildDocContext(editor, scope)
    const selected = /<p>[^\n]*?<sel>((?:(?!<sel>)[\s\S])*?)<\/sel>/.exec(context)?.[1] ?? ''
    expect(selected).toContain('준비를')

    const r = await executeTool(
      editor,
      {
        id: 't',
        name: 'replace_selection',
        input: { html: selected.replace('준비를', '준비 작업을') },
      },
      NUM_IDS,
      track,
      undefined,
      { scope, doc: editor.state.doc },
    )
    expect(r.isError, String(r.output)).toBeFalsy()
    expectOneOfEach(await savedDocumentXml(parsed, editor))
  })
})
