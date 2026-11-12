import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { REDACT_NS } from '@genoffice/docx-engine'
import { FEATURE_LABEL } from '../src/formats/docx-hwp'
import { run, tempDir } from './helpers'

const NOTICE = fileURLToPath(new URL('../../docx2hwp/tests/fixtures/notice.docx', import.meta.url))
const KITCHEN_SINK = fileURLToPath(
  new URL(
    '../../../apps/docs/tests/pagination-corpus/docx/fixture-kitchen-sink.docx',
    import.meta.url,
  ),
)

const NOTICE_TEXTS = [
  '2026학년도 겨울방학 안내',
  '보통 글 굵게 기울임 밑줄 빨간 글 형광펜 취소선 위첨자 맑은 고딕 14pt',
  '1. 방학 기간',
  '방학식: 12월 31일',
  '개학식: 2월 2일',
  '2. 준비물',
  '필통',
  '연필 두 자루',
  '공책',
  '',
  '그림:',
  '',
  '오른쪽 정렬 문단',
  '',
  '',
  '쪽 나눔 뒤 문단',
]

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** the body paragraphs of a written file, opened the way the Hangul editor opens it */
function bodyTexts(path: string): string[] {
  const doc = new HwpDocument(new Uint8Array(readFileSync(path)))
  try {
    return Array.from({ length: doc.getParagraphCount(0) }, (_, p) => {
      const length = doc.getParagraphLength(0, p)
      return length ? doc.getTextRange(0, p, 0, length) : ''
    })
  } finally {
    doc.free()
  }
}

function copy(dir: string, from: string, name: string): string {
  const path = join(dir, name)
  copyFileSync(from, path)
  return path
}

describe.each(['hwpx', 'hwp'] as const)('convert a Word document --to %s', (format) => {
  it('writes a Hangul document beside the input with the same paragraphs', async () => {
    const dir = tempDir()
    const input = copy(dir, NOTICE, 'notice.docx')
    const r = await run(['convert', input, '--to', format, '--json'])
    expect(r.code).toBe(0)
    const json = r.json()
    expect(json).toMatchObject({ status: 'ok', command: 'convert' })
    expect(json.output_path).toBe(join(dir, `notice.${format}`))
    expect(json.warnings).toBeUndefined()
    expect(json.detail.hwp_report).toEqual([])
    const head = readFileSync(json.output_path).subarray(0, 4)
    // .hwpx is a zip package, .hwp a compound file
    expect([...head]).toEqual(
      format === 'hwpx' ? [0x50, 0x4b, 0x03, 0x04] : [0xd0, 0xcf, 0x11, 0xe0],
    )
    expect(bodyTexts(json.output_path)).toEqual(NOTICE_TEXTS)
  })

  it('reports what the copy does not carry, as warnings and detail.hwp_report', async () => {
    const dir = tempDir()
    const input = copy(dir, KITCHEN_SINK, 'sink.docx')
    const out = join(dir, 'out', `sink-copy.${format}`)
    const r = await run(['convert', input, '--to', format, '--out', out, '--json'])
    expect(r.code).toBe(0)
    const json = r.json()
    expect(json.output_path).toBe(out)
    expect(json.detail.hwp_report).toEqual([
      { kind: 'dropped', feature: 'equation', count: 1 },
      { kind: 'changed', feature: 'hyperlink', count: 1 },
    ])
    expect(json.warnings.map((w: { code: string }) => w.code)).toEqual([
      'hwp_dropped',
      'hwp_changed',
    ])
    expect(json.warnings[0].message).toContain('Equations (equation, 1)')
    expect(json.warnings[1].message).toContain('(hyperlink, 1)')
    expect(bodyTexts(out)).toContain('链接示例:示例网站')
  })

  it('never writes over an existing file without --force', async () => {
    const dir = tempDir()
    const input = copy(dir, NOTICE, 'notice.docx')
    const target = join(dir, `notice.${format}`)
    writeFileSync(target, 'keep')
    const r = await run(['convert', input, '--to', format, '--json'])
    expect(r.code).toBe(2)
    expect(r.json().error).toBe('output_exists')
    expect(readFileSync(target, 'utf8')).toBe('keep')
    expect((await run(['convert', input, '--to', format, '--force'])).code).toBe(0)
    expect(bodyTexts(target)).toEqual(NOTICE_TEXTS)
  })
})

describe('convert a Word document to Hangul: refusals', () => {
  it('answers a file Word cannot have written with exit 3 and writes nothing', async () => {
    const dir = tempDir()
    const input = join(dir, 'broken.docx')
    writeFileSync(input, 'not a zip at all')
    const r = await run(['convert', input, '--to', 'hwpx', '--json'])
    expect(r.code).toBe(3)
    expect(r.json()).toMatchObject({ error: 'conversion_failed', detail: { reason: 'not-docx' } })
    expect(r.json().suggestion).toBeTruthy()
    expect(existsSync(join(dir, 'broken.hwpx'))).toBe(false)
  })

  it('lists docx → hwp and hwpx among the routes', async () => {
    const dir = tempDir()
    const input = copy(dir, NOTICE, 'notice.docx')
    const r = await run(['convert', input, '--to', 'hwt', '--json'])
    expect(r.code).toBe(1)
    expect(r.json().detail.supported).toMatch(/docx→[^,]*\bhwp\b/)
    expect(r.json().detail.supported).toMatch(/docx→[^,]*\bhwpx\b/)
  })
})

describe('the published hwp_report ids', () => {
  it('docs/contracts.md lists every feature the command can report, in report order', () => {
    const contracts = readFileSync(
      fileURLToPath(new URL('../../../docs/contracts.md', import.meta.url)),
      'utf8',
    )
    const line = contracts.split('\n').find((l) => l.includes('`detail.hwp_report`의 `feature` 값'))
    const ids = [...(line ?? '').matchAll(/`([a-z_]+)`/g)]
      .map((m) => m[1])
      .filter((id) => id !== 'feature')
    expect(ids).toEqual(Object.keys(FEATURE_LABEL))
  })
})

describe('Word hiding marks', () => {
  it('become hiding memos in the Hangul file, without asking or warning', async () => {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(readFileSync(NOTICE))
    const xml = await zip.file('word/document.xml')!.async('string')
    const marked = xml
      .replace('<w:document ', `<w:document xmlns:go="${REDACT_NS}" `)
      .replace(
        /(<w:body>)/,
        '$1<w:p><w:r><w:t xml:space="preserve">담임 </w:t></w:r><w:r><w:rPr>' +
          '<w:bdr w:val="single" w:sz="6" w:color="6B4FC0"/><go:redact w:label="학생 이름"/>' +
          '</w:rPr><w:t>홍길동</w:t></w:r></w:p>',
      )
    expect(marked).toContain('<go:redact')
    zip.file('word/document.xml', marked)
    const dir = tempDir()
    const input = join(dir, 'marked.docx')
    writeFileSync(input, await zip.generateAsync({ type: 'uint8array' }))
    const r = await run(['convert', input, '--to', 'hwpx', '--json'])
    expect(r.code).toBe(0)
    const json = r.json()
    expect(json.status).toBe('ok')
    expect(json.warnings).toBeUndefined()
    expect(json.detail.hwp_report).toEqual([])
    const doc = new HwpDocument(new Uint8Array(readFileSync(json.output_path)))
    try {
      const memos = JSON.parse(doc.getMemoList()) as Array<{
        text: string
        author: string
        paraIndex: number
        startCharIdx: number
        endCharIdx: number
      }>
      expect(memos.map((m) => [m.text, m.author])).toEqual([
        ['[Hide sensitive info] 학생 이름', 'IeumOffice'],
      ])
      const [memo] = memos
      expect(doc.getTextRange(0, memo.paraIndex, memo.startCharIdx, 3)).toBe('홍길동')
    } finally {
      doc.free()
    }
  })
})
