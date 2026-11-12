/**
 * Word hiding marks (the Word editor's `go:redact` element in a run's rPr)
 * become hiding memos in the Hangul copy: anchored on the same words, one per
 * stretch of one label in one paragraph, written by the product. What cannot
 * be carried is reported, never silent.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import { readHidingMemoLabel } from '@genoffice/agent-core/hiding-memo'
import { REDACT_EL, REDACT_NS, REDACT_PREFIX } from '@genoffice/agent-core/redact-range'
import { PRODUCT_NAME } from '@genoffice/i18n'
import { withNewDocument, withOpenedDocument, exportDocument } from '../src/engine'
import { HwpEngine, docxToHwp, type HwpFormat } from '../src/index'
import { LossLedger } from '../src/losses'
import type { CharShape, HwpPlan } from '../src/model'
import { writePlan } from '../src/write'
import { FIXTURES } from './helpers/paths'
import { readBack } from './helpers/read-back'

let engine: HwpEngine
beforeAll(async () => {
  engine = await HwpEngine.start(
    readFileSync(createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')),
  )
})

/** the run the Word editor writes for a hidden span */
const marked = (text: string, label: string, extra = ''): string =>
  `<w:r><w:rPr>${extra}<w:bdr w:val="single" w:sz="6" w:color="6B4FC0"/>` +
  `<${REDACT_EL} w:label="${label}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`
const plain = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`

/** nested.docx with marks in body paragraphs, a top-level cell and nested cells */
async function markedNested(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(readFileSync(`${FIXTURES}/nested.docx`))
  let xml = await zip.file('word/document.xml')!.async('string')
  const swap = (from: string, to: string) => {
    expect(xml).toContain(from)
    xml = xml.replace(from, to)
  }
  swap(
    '<w:document ',
    `<w:document xmlns:${REDACT_PREFIX}="${REDACT_NS}" mc:PreserveElements="${REDACT_EL}" `,
  )
  swap('mc:Ignorable="w14 wp14"', `mc:Ignorable="w14 wp14 ${REDACT_PREFIX}"`)
  swap(
    '<w:p><w:r><w:t>중첩 표 시험</w:t></w:r></w:p>',
    '<w:p>' +
      plain('담임 ') +
      marked('홍길', '학생 이름') +
      marked('동', '학생 이름', '<w:b/>') +
      plain(' 선생님, 연락처 ') +
      marked('010-1234-5678', '전화 &amp; 번호') +
      plain('.') +
      '</w:p>' +
      `<w:p>${marked('쪽 앞', '주소')}<w:r><w:br w:type="page"/></w:r>${marked('쪽 뒤', '주소')}</w:p>`,
  )
  swap('<w:r><w:t>바깥 1</w:t></w:r>', marked('바깥 1', '칸'))
  swap('<w:r><w:t>깊은 2</w:t></w:r>', marked('깊은 2', '깊은 칸'))
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'uint8array' })
}

interface MemoEntry {
  text: string
  author: string
  paraIndex: number
  startCharIdx: number
  endCharIdx: number
  path?: unknown
}

function memosOf(bytes: Uint8Array): MemoEntry[] {
  return withOpenedDocument(engine, bytes, (doc) => JSON.parse(doc.getMemoList()) as MemoEntry[])
}

describe.each(['hwpx', 'hwp'] as const)('%s', (format: HwpFormat) => {
  let bytes: Uint8Array
  let losses: unknown
  beforeAll(async () => {
    ;({ bytes, losses } = await docxToHwp(await markedNested(), format, engine, {
      hidingLang: 'ko',
    }))
  })

  it('carries every mark as a hiding memo, losing nothing', () => {
    expect(losses).toEqual([])
    const memos = memosOf(bytes)
    expect(memos.map((m) => readHidingMemoLabel(m.text))).toEqual([
      '학생 이름',
      '전화 & 번호',
      '주소',
      '주소',
      '칸',
      '깊은 칸',
    ])
    expect(memos[0].text).toBe('[민감정보 가리기] 학생 이름')
    expect(new Set(memos.map((m) => m.author))).toEqual(new Set([PRODUCT_NAME]))
  })

  it('anchors each memo on the converted words, inside one paragraph', async () => {
    const back = await readBack(engine, bytes)
    const memos = memosOf(bytes)
    const body = memos.filter((m) => !m.path || (Array.isArray(m.path) && m.path.length === 0))
    const anchored = body.map((m) =>
      [...back.body[m.paraIndex].text].slice(m.startCharIdx, m.endCharIdx).join(''),
    )
    // two runs of one label are one memo; a page break splits a span in two paragraphs
    expect(anchored).toEqual(['홍길동', '010-1234-5678', '쪽 앞', '쪽 뒤'])
    expect(back.body[0].text).toBe('담임 홍길동 선생님, 연락처 010-1234-5678.')
    const pageParas = body.filter((m) => readHidingMemoLabel(m.text) === '주소')
    expect(pageParas[0].paraIndex).not.toBe(pageParas[1].paraIndex)
  })

  it('anchors memos in a table cell and in a table nested in a cell', () => {
    const inCells = memosOf(bytes).filter((m) => Array.isArray(m.path) && m.path.length > 0)
    expect(
      inCells.map((m) => [readHidingMemoLabel(m.text), m.endCharIdx - m.startCharIdx]),
    ).toEqual([
      ['칸', [...'바깥 1'].length],
      ['깊은 칸', [...'깊은 2'].length],
    ])
  })

  it('does not report the mark border as a text effect', () => {
    expect(JSON.stringify(losses)).not.toContain('text_effect')
  })
})

it('writes the memo prefix in the language asked for, English by default', async () => {
  const docx = await markedNested()
  const en = memosOf((await docxToHwp(docx, 'hwpx', engine)).bytes)
  expect(en[0].text).toBe('[Hide sensitive info] 학생 이름')
  const ja = memosOf((await docxToHwp(docx, 'hwpx', engine, { hidingLang: 'ja' })).bytes)
  expect(ja[0].text).toBe('[機密情報を隠す] 학생 이름')
})

const CHARS: CharShape = {
  eastAsiaFace: '함초롬바탕',
  latinFace: '함초롬바탕',
  size: 1000 as unknown as CharShape['size'],
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  script: 'normal',
  color: 0 as unknown as CharShape['color'],
  shade: null,
  spacing: 0,
  ratio: 100,
}

it('reports a mark in a header, which takes no memo, as not carried', async () => {
  const docx = await markedNested()
  const { parseDocx } = await import('@genoffice/docx-engine')
  const { lowerDocument } = await import('../src/lower')
  const ledger = new LossLedger()
  const plan: HwpPlan = lowerDocument(await parseDocx(docx), ledger)
  const shape = plan.body.find((b) => b.kind === 'para')!
  const withHeader: HwpPlan = {
    ...plan,
    header: [
      {
        ...(shape as Extract<typeof shape, { kind: 'para' }>),
        inlines: [{ kind: 'text', text: '비밀', chars: CHARS, hide: '머리말' }],
      },
    ],
  }
  withNewDocument(engine, (doc) => {
    writePlan(doc, withHeader, ledger, { text: (l) => `[Hide sensitive info] ${l}`, author: 'x' })
    return exportDocument(doc, 'hwpx').bytes
  })
  expect(ledger.list()).toEqual([{ feature: 'hiding_mark', kind: 'dropped', count: 1 }])
})

it('reports a marked block whose words reach the copy without the mark', async () => {
  const docx = await markedNested()
  const { parseDocx } = await import('@genoffice/docx-engine')
  const { lowerDocument } = await import('../src/lower')
  const parsed = await parseDocx(docx)
  // the first block's runs gone, its XML still marked: as for a block kept as plain text
  const stripped = {
    ...parsed,
    blocks: parsed.blocks.map((b, i) => (i === 0 ? { ...b, runs: [] } : b)),
  }
  const ledger = new LossLedger()
  lowerDocument(stripped, ledger)
  expect(ledger.list()).toEqual([{ feature: 'hiding_mark', kind: 'dropped', count: 1 }])
})

it('leaves a document without marks as it was: no memo, no report', async () => {
  const { bytes, losses } = await docxToHwp(
    new Uint8Array(readFileSync(`${FIXTURES}/nested.docx`)),
    'hwpx',
    engine,
    { hidingLang: 'ko' },
  )
  expect(losses).toEqual([])
  expect(memosOf(bytes)).toEqual([])
})
