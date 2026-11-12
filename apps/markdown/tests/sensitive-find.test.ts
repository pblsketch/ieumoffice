/**
 * "Find sensitive info" in the Markdown editor: the document read as text
 * blocks in reading order (table cells under their column's first cell), the
 * candidates the shared finder returns, and a confirm through the editor's
 * own `setRedaction` — the mark that saves as the persisted span.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { docPieces, hideDocSpots, type DocSpotLocation } from '../src/renderer/editor/sensitive-doc'
import { findSensitive } from '../src/renderer/ai/sensitive-find'
import { REDACT_MARK } from '../src/renderer/editor/redact'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: {
        onOpen: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onClose: () => {},
      },
      slashItems: () => [],
    }),
    content: '',
  })
  editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

async function find(editor: Editor, isExcluded?: (kind: string) => boolean) {
  const { pieces, existingMarks } = docPieces(editor.state.doc)
  return findSensitive<DocSpotLocation>({
    pieces,
    existingMarks,
    lang: 'ko',
    locationText: (loc) => loc.heading ?? '문서 첫머리',
    ...(isExcluded ? { isExcluded } : {}),
  })
}

function marked(editor: Editor): Array<[string, string]> {
  const out: Array<[string, string]> = []
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((m) => m.type.name === REDACT_MARK)
    if (node.isText && mark) out.push([node.text ?? '', String(mark.attrs.label)])
  })
  return out
}

const DOC = [
  '연락처 010-1234-5678 로 주세요.',
  '',
  '## 명단',
  '',
  '| 성명 | 학번 |',
  '| --- | --- |',
  '| 김민수 | 20231234 |',
  '',
  '```',
  'mail hong@example.com',
  '```',
].join('\n')

describe('finding', () => {
  it('reads blocks in order, table cells under their header, and marks code as unhideable', async () => {
    const editor = createEditor(DOC)
    const found = await find(editor)
    const rows = found.rows.map((r) => [r.kind, r.value, r.location, r.hideable])
    expect(rows).toContainEqual(['phone', '010-1234-5678', '문서 첫머리', true])
    expect(rows).toContainEqual(['name', '김민수', '명단', true])
    expect(rows).toContainEqual(['email', 'hong@example.com', '명단', false])
    const phone = found.rows.find((r) => r.kind === 'phone')!
    expect(phone.label).toBe('전화-01')
    expect(phone.before).toContain('연락처')
  })

  it('a document with nothing sensitive yields nothing', async () => {
    expect((await find(createEditor('# 제목\n\n그냥 글입니다.'))).rows).toEqual([])
  })

  it('drops excluded values', async () => {
    const found = await find(createEditor(DOC), (kind) => kind === 'phone')
    expect(found.rows.map((r) => r.kind)).not.toContain('phone')
  })
})

describe('hiding', () => {
  it('marks exactly the confirmed words with the label, and they are not offered again', async () => {
    const editor = createEditor(DOC)
    const before = editor.getMarkdown()
    const found = await find(editor)
    const spots = [...found.spots.values()].filter((s) => s.hideable)
    expect(hideDocSpots(editor, spots)).toBe(spots.length)
    expect(marked(editor)).toEqual(
      expect.arrayContaining([
        ['010-1234-5678', '전화-01'],
        ['김민수', expect.stringMatching(/^이름-0[0-9]$/)],
      ]),
    )
    // the words themselves stay; the saved text carries the persisted span around them
    expect(editor.state.doc.textContent).toContain('010-1234-5678')
    const saved = editor.getMarkdown()
    expect(saved).not.toBe(before)
    expect(saved).toContain('data-label="전화-01">010-1234-5678</span>')

    const again = await find(editor)
    expect(again.rows.filter((r) => r.hideable)).toEqual([])

    // a reopen reads the mark back, and the next phone gets the next number
    const reopened = createEditor(`${saved}\n\n다른 번호 010-2222-3333, 같은 번호 01012345678`)
    const next = await find(reopened)
    expect(next.rows.filter((r) => r.kind === 'phone').map((r) => [r.value, r.label])).toEqual([
      ['010-2222-3333', '전화-02'],
      ['01012345678', '전화-01'],
    ])
  })

  it('skips a spot whose words moved since it was found', async () => {
    const editor = createEditor(DOC)
    const found = await find(editor)
    const phone = [...found.spots.values()].find((s) => s.kind === 'phone')!
    editor.commands.insertContentAt(1, '앞에 더한 글 ')
    expect(hideDocSpots(editor, [phone])).toBe(0)
    expect(marked(editor)).toEqual([])
  })
})
