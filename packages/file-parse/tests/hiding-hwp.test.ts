import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { buildHidingMemoText } from '@genoffice/agent-core/hiding-memo'
import { parseFileToText } from '../src/index'
import { hwpToText } from '../src/hwp'
import { writeFixture } from './helpers/fixtures'

/**
 * A Hangul document read as another file's material: the anchor of every
 * hiding memo (`[<prefix>] <label>`, @genoffice/agent-core/hiding-memo) reads
 * as `{{label}}`, wherever the walk or the engine's plain-text export would
 * have carried it, and a memo that cannot be placed fails the read. The
 * documents are built with the engine itself, as the editor builds them.
 */
beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const NAME = '홍길동'
const PHONE = '010-1234-5678'

function blank(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  return doc
}

const memo = (text: string, author = 'IeumOffice') => JSON.stringify({ author, text })

function hideBody(doc: HwpDocument, para: number, start: number, end: number, label: string) {
  const created = JSON.parse(
    doc.insertMemo(0, para, start, end, memo(buildHidingMemoText(label, 'ko'))),
  ) as { ok: boolean }
  expect(created.ok).toBe(true)
}

describe('hwp: a hiding memo reads as its label', () => {
  it('swaps the anchor in a body paragraph, from .hwp and .hwpx files', async () => {
    const doc = blank(['담당 교사 홍길동 연락처', '둘째 줄'])
    hideBody(doc, 0, 6, 9, '이름')
    for (const [name, bytes] of [
      ['memo.hwp', doc.exportHwp()],
      ['memo.hwpx', doc.exportHwpx()],
    ] as const) {
      const result = await parseFileToText(writeFixture(name, bytes))
      expect(result, name).toMatchObject({ ok: true, kind: 'text' })
      expect(result.text!.split('\n'), name).toEqual([
        '담당 교사 {{이름}} 연락처',
        '둘째 줄',
        '### Comments',
        '- IeumOffice (p.1): [민감정보 가리기] 이름',
      ])
    }
  })

  it('swaps several anchors of one paragraph, and reads another language’s prefix', async () => {
    const doc = blank([`${NAME} ${PHONE}`])
    hideBody(doc, 0, 0, 3, '이름')
    const created = JSON.parse(
      doc.insertMemo(0, 0, 4, 4 + PHONE.length, memo('[Hide sensitive info] phone')),
    ) as { ok: boolean }
    expect(created.ok).toBe(true)
    const text = await hwpToText(doc.exportHwp())
    expect(text.split('\n')[0]).toBe('{{이름}} {{phone}}')
    expect(text).not.toContain(NAME)
    expect(text).not.toContain(PHONE)
  })

  it('swaps the anchor in a table cell', async () => {
    const doc = blank(['명단', ''])
    doc.pasteHtml(0, 1, 0, `<table><tr><td>이름</td><td>${NAME}</td></tr></table>`)
    const path = JSON.stringify([{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }])
    const created = JSON.parse(
      doc.insertMemoByPath(0, 1, path, 0, 3, memo(buildHidingMemoText('학생', 'ko'))),
    ) as { ok: boolean }
    expect(created.ok).toBe(true)
    const text = await hwpToText(doc.exportHwp())
    expect(text).not.toContain(NAME)
    expect(text.split('\n')).toContain('이름 | {{학생}}')
  })

  it('swaps the anchor in a text box, which the engine’s plain text carries', async () => {
    const doc = blank(['상자 앞'])
    const box = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 0,
          charOffset: 4,
          width: 8000,
          height: 3000,
          shapeType: 'textbox',
          textWrap: 'Square',
        }),
      ),
    ) as { controlIdx: number }
    const path = JSON.stringify([{ controlIndex: box.controlIdx, cellIndex: 0, cellParaIndex: 0 }])
    doc.insertTextInCellByPath(0, 0, path, 0, `연락 ${PHONE} 끝`)
    const created = JSON.parse(
      doc.insertMemoByPath(
        0,
        0,
        path,
        3,
        3 + PHONE.length,
        memo(buildHidingMemoText('전화', 'ko')),
      ),
    ) as { ok: boolean }
    expect(created.ok).toBe(true)
    const text = await hwpToText(doc.exportHwp())
    expect(text).not.toContain(PHONE)
    expect(text.split('\n')).toContain('연락 {{전화}} 끝')
  })

  it('keeps the anchor out when the plain text writes the paragraph differently', async () => {
    // an empty fill-in field puts its guide into the engine's plain text, so the
    // line there no longer matches the walked paragraph and is put back as is
    const doc = blank(['성명 홍길동 서명'])
    doc.insertClickHereField(0, 0, 0, '여기에 입력', '', 'f1', true)
    hideBody(doc, 0, 3, 6, '이름')
    const text = await hwpToText(doc.exportHwp())
    expect(text).not.toContain(NAME)
    expect(text).toContain('성명 {{이름}} 서명')
  })

  it('leaves a document whose memos are all ordinary exactly as it read before', async () => {
    const doc = blank(['본문 홍길동'])
    const created = JSON.parse(doc.insertMemo(0, 0, 3, 6, memo('확인 필요', '교사'))) as {
      ok: boolean
    }
    expect(created.ok).toBe(true)
    expect((await hwpToText(doc.exportHwp())).split('\n')).toEqual([
      '본문 홍길동',
      '### Comments',
      '- 교사 (p.1): 확인 필요',
    ])
  })

  it('leaves a document without memos exactly as it read before', async () => {
    expect(await hwpToText(blank(['하나', '둘']).exportHwp())).toBe('하나\n둘')
  })
})

describe('hwp: what cannot be placed is not read', () => {
  async function failsWithout(bytes: Uint8Array, secret: string, name: string) {
    const result = await parseFileToText(writeFixture(name, bytes))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Redaction marks/)
    expect(JSON.stringify(result)).not.toContain(secret)
  }

  it('refuses the file when the memo list cannot be read', async () => {
    const bytes = blank([`본문 ${NAME}`]).exportHwp()
    vi.spyOn(HwpDocument.prototype, 'getMemoList').mockImplementation(() => {
      throw new Error('memo list failed')
    })
    await failsWithout(bytes, NAME, 'no-memo-list.hwp')
  })

  it('refuses the file when the memo list is not a list', async () => {
    const bytes = blank([`본문 ${NAME}`]).exportHwp()
    vi.spyOn(HwpDocument.prototype, 'getMemoList').mockReturnValue('{"memos":1}')
    await failsWithout(bytes, NAME, 'odd-memo-list.hwp')
  })

  const hidingMemo = {
    id: 1,
    index: 1,
    author: 'IeumOffice',
    text: '[민감정보 가리기] 이름',
    place: 'body',
    sectionIndex: 0,
    paraIndex: 0,
    startCharIdx: 3,
    endCharIdx: 6,
    path: null,
    page: 1,
  }
  const unplaceable: Array<[string, Record<string, unknown>]> = [
    ['an anchor past the end of its paragraph', { endCharIdx: 99 }],
    ['an anchor with no range (a memo spanning paragraphs)', { startCharIdx: 0, endCharIdx: 0 }],
    ['a paragraph the document does not have', { paraIndex: 7 }],
    ['no position at all', { paraIndex: null, startCharIdx: null }],
    ['a place the reader does not walk', { place: 'header' }],
    ['a path of a kind it does not know', { place: 'tableCell', path: [{ type: 'equation' }] }],
  ]
  for (const [index, [name, change]] of unplaceable.entries()) {
    it(`refuses a hiding memo with ${name}`, async () => {
      const bytes = blank([`본문 ${NAME}`]).exportHwp()
      vi.spyOn(HwpDocument.prototype, 'getMemoList').mockReturnValue(
        JSON.stringify([{ ...hidingMemo, ...change }]),
      )
      await failsWithout(bytes, NAME, `unplaceable-${index}.hwp`)
    })
  }
})
