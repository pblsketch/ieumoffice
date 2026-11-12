import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { REDACT_EL, REDACT_NS, REDACT_PREFIX } from '@genoffice/agent-core/redact-range'
import { docxToText, parseFileToText } from '../src/index'
import { writeFixture } from './helpers/fixtures'

/**
 * A Word file read as another file's material: the runs the word processor
 * withholds (a `go:redact` element with `w:label` inside the run's rPr, the
 * shape apps/docs `redaction.ts` writes) read as `{{label}}`, and a mark this
 * reader cannot place fails the read.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SECRET = '010-9876-5432'
const LABEL = '학생 전화'
const MARKER = `{{${LABEL}}}`

/** the rPr the word processor writes for a withheld run */
const markedRPr = (label = LABEL) =>
  `<w:rPr><w:bdr w:val="single" w:sz="6" w:color="6B4FC0"/><${REDACT_EL} w:label="${label}"/></w:rPr>`

const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`

function documentXml(body: string, declare = true): string {
  const ns = declare ? ` xmlns:${REDACT_PREFIX}="${REDACT_NS}"` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"${ns}><w:body>${body}</w:body></w:document>`
}

async function docx(body: string, parts: Record<string, string> = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('word/document.xml', documentXml(body))
  for (const [name, xml] of Object.entries(parts)) zip.file(name, xml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('docx: a withheld run reads as its label', () => {
  it('swaps the run and keeps the words around it', async () => {
    const bytes = await docx(para(run('전화: '), run(SECRET, markedRPr()), run(' 끝')))
    const path = writeFixture('withheld.docx', bytes)
    const result = await parseFileToText(path)
    expect(result).toMatchObject({ ok: true, kind: 'text' })
    expect(result.text).toBe(`전화: ${MARKER} 끝`)
  })

  it('reads one marker for adjacent runs of the same span', async () => {
    const bytes = await docx(
      para(run('a '), run('010-', markedRPr()), run('9876-5432', markedRPr()), run(' b')),
    )
    expect(await docxToText(bytes)).toBe(`a ${MARKER} b`)
  })

  it('keeps two different spans apart', async () => {
    const bytes = await docx(
      para(run('홍길동', markedRPr('이름')), run(' / '), run(SECRET, markedRPr('전화'))),
    )
    expect(await docxToText(bytes)).toBe('{{이름}} / {{전화}}')
  })

  it('withholds in a table cell, a footnote and a header too', async () => {
    const body =
      '<w:tbl><w:tr><w:tc>' +
      para(run('이름')) +
      '</w:tc><w:tc>' +
      para(run('김철수', markedRPr('이름'))) +
      '</w:tc></w:tr></w:tbl>'
    const footnotes =
      `<w:footnotes xmlns:w="${W}" xmlns:go="${REDACT_NS}"><w:footnote w:id="1">` +
      para(run('각주 '), run(SECRET, markedRPr())) +
      '</w:footnote></w:footnotes>'
    const zip = new JSZip()
    zip.file('word/document.xml', documentXml(body))
    zip.file('word/footnotes.xml', footnotes)
    zip.file(
      'word/_rels/document.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
        '</Relationships>',
    )
    zip.file(
      'word/header1.xml',
      `<w:hdr xmlns:w="${W}" xmlns:go="${REDACT_NS}">` +
        para(run('머리말 '), run('비밀 머리말', markedRPr('머리'))) +
        '</w:hdr>',
    )
    const text = await docxToText(await zip.generateAsync({ type: 'uint8array' }))
    expect(text).not.toContain('김철수')
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('비밀 머리말')
    expect(text).toContain('이름 | {{이름}}')
    expect(text).toContain(`각주 ${MARKER}`)
    expect(text).toContain('머리말 {{머리}}')
  })

  it('withholds a run whose earlier formatting carried the mark, as the editor does', async () => {
    const rPr = `<w:rPr><w:b/><w:rPrChange w:id="1" w:author="a">${markedRPr()}</w:rPrChange></w:rPr>`
    expect(await docxToText(await docx(para(run(SECRET, rPr))))).toBe(MARKER)
  })

  it('withholds the alt text and a text box inside a withheld picture run', async () => {
    const picture = `<w:r>${markedRPr('사진')}<w:drawing><wp:inline xmlns:wp="x"><wp:docPr id="1" name="p" descr="얼굴 사진 홍길동"/></wp:inline></w:drawing></w:r>`
    const text = await docxToText(await docx(para(run('사진: '), picture)))
    expect(text).toBe('사진: {{사진}}')
  })

  it('falls back to the default label, cleaned the way placeholders are', async () => {
    const bare = `<w:rPr><${REDACT_EL}/></w:rPr>`
    const odd = `<w:rPr><${REDACT_EL} w:label="  {a}&amp;b  "/></w:rPr>`
    expect(await docxToText(await docx(para(run(SECRET, bare))))).toBe('{{private}}')
    expect(await docxToText(await docx(para(run(SECRET, odd))))).toBe('{{a&b}}')
  })

  it('reads a mark on the paragraph mark alone, which has no words', async () => {
    const bytes = await docx(
      `<w:p><w:pPr><w:rPr>${`<${REDACT_EL} w:label="x"/>`}</w:rPr></w:pPr>${run('보이는 글')}</w:p>`,
    )
    expect(await docxToText(bytes)).toBe('보이는 글')
  })

  it('leaves a file with no marks exactly as it read before', async () => {
    const body = para(run('하나 ')) + para(run('둘'))
    const plain = new JSZip()
    plain.file(
      'word/document.xml',
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    )
    const declared = await docx(body)
    const before = await docxToText(await plain.generateAsync({ type: 'uint8array' }))
    expect(before).toBe('하나 \n둘')
    // the namespace left declared after every mark was taken off changes nothing
    expect(await docxToText(declared)).toBe(before)
  })
})

describe('docx: a mark that cannot be placed fails the read', () => {
  const cases: Array<[string, string]> = [
    ['a mark directly in a paragraph', `<w:p><${REDACT_EL} w:label="x"/>${run(SECRET)}</w:p>`],
    [
      'a mark in a run but outside its properties',
      `<w:p><w:r><w:t>${SECRET}</w:t><${REDACT_EL} w:label="x"/></w:r></w:p>`,
    ],
    [
      'a mark that does not close',
      `<w:p><w:r><w:rPr><${REDACT_EL} w:label="x"></w:rPr><w:t>${SECRET}</w:t></w:r></w:p>`,
    ],
    [
      'a mark under a prefix the editor does not write',
      `<w:p xmlns:zz="${REDACT_NS}"><w:r><w:rPr><zz:redact w:label="x"/></w:rPr><w:t>${SECRET}</w:t></w:r></w:p>`,
    ],
  ]
  for (const [index, [name, body]] of cases.entries()) {
    it(name, async () => {
      const path = writeFixture(`bad-mark-${index}.docx`, await docx(body))
      const result = await parseFileToText(path)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Redaction marks/)
      expect(JSON.stringify(result)).not.toContain(SECRET)
    })
  }

  it('throws from docxToText itself', async () => {
    await expect(docxToText(await docx(cases[0]![1]))).rejects.toThrow(/Redaction marks/)
  })
})
