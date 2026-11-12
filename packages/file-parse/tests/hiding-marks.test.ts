import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { REDACT_EL, REDACT_NS } from '@genoffice/agent-core/redact-range'
import { hidingMarksOf } from '../src/index'

/** Whether a file holds hiding marks, per format, without reading its text. */

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const bytes = (text: string) => new TextEncoder().encode(text)

async function zipOf(parts: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, xml] of Object.entries(parts)) zip.file(name, xml)
  return zip.generateAsync({ type: 'uint8array' })
}

const wordDoc = (body: string) =>
  zipOf({
    'word/document.xml': `<w:document xmlns:w="${W}" xmlns:go="${REDACT_NS}"><w:body>${body}</w:body></w:document>`,
  })

const workbook = (names: string) =>
  zipOf({ 'xl/workbook.xml': `<workbook><sheets/>${names}</workbook>` })

function hangul(memoText?: string): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, '본문 홍길동')
  if (memoText) doc.insertMemo(0, 0, 3, 6, JSON.stringify({ author: 'IeumOffice', text: memoText }))
  return doc.exportHwp()
}

describe('hidingMarksOf', () => {
  it('finds a Word mark, and none in a document whose namespace is only declared', async () => {
    const marked = await wordDoc(
      `<w:p><w:r><w:rPr><${REDACT_EL} w:label="x"/></w:rPr><w:t>a</w:t></w:r></w:p>`,
    )
    expect(await hidingMarksOf('a.docx', marked)).toBe('marked')
    expect(await hidingMarksOf('a.doc', marked)).toBe('marked')
    expect(await hidingMarksOf('a.docx', await wordDoc('<w:p><w:r><w:t>a</w:t></w:r></w:p>'))).toBe(
      'none',
    )
    const broken = await wordDoc(`<w:p><${REDACT_EL} w:label="x"/></w:p>`)
    expect(await hidingMarksOf('a.docx', broken)).toBe('unknown')
    expect(await hidingMarksOf('a.docx', bytes('not a zip'))).toBe('unknown')
  })

  it('finds a hiding name in a workbook, without case', async () => {
    const marked = await workbook(
      '<definedNames><definedName name="ieumhide_이름">S!$B:$B</definedName></definedNames>',
    )
    expect(await hidingMarksOf('a.xlsx', marked)).toBe('marked')
    expect(await hidingMarksOf('a.xlsm', marked)).toBe('marked')
    const plain = await workbook(
      '<definedNames><definedName name="Scores">S!$B:$B</definedName></definedNames>',
    )
    expect(await hidingMarksOf('a.xlsx', plain)).toBe('none')
    expect(await hidingMarksOf('a.xlsx', await zipOf({ 'x.xml': '<x/>' }))).toBe('unknown')
  })

  it('finds a hiding memo in a Hangul document, and not an ordinary one', async () => {
    expect(await hidingMarksOf('a.hwp', hangul('[민감정보 가리기] 이름'))).toBe('marked')
    expect(await hidingMarksOf('a.hwp', hangul('확인 필요'))).toBe('none')
    expect(await hidingMarksOf('a.hwp', hangul())).toBe('none')
    expect(await hidingMarksOf('a.hwpx', bytes('nope'))).toBe('unknown')
  })

  it('finds the marks of the markdown, HTML and deck editors', async () => {
    expect(
      await hidingMarksOf(
        'a.md',
        bytes('<span class="redact-span" data-redaction="" data-label="x">y</span>'),
      ),
    ).toBe('marked')
    expect(await hidingMarksOf('a.md', bytes('plain'))).toBe('none')
    expect(await hidingMarksOf('a.html', bytes('<p data-gx-redact="x">y</p>'))).toBe('marked')
    expect(await hidingMarksOf('a.html', bytes('<p>y</p>'))).toBe('none')
    const deck = await zipOf({
      'ppt/slides/slide1.xml':
        '<p:sld><a:ext uri="{9F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}"/></p:sld>',
    })
    expect(await hidingMarksOf('a.pptx', deck)).toBe('marked')
    expect(await hidingMarksOf('a.pdf', bytes('%PDF'))).toBe('none')
  })
})
