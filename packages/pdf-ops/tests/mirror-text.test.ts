// @vitest-environment node
/**
 * readPdfTextWith is a mirror of the PC's readPdfText (apps/pdf/src/main/read-text.ts,
 * shared with upstream GenOffice and so left where it is). These tests run both on the
 * same inputs and options and require the same answer, character for character. When
 * an upstream change moves readPdfText, this fails and the mirror is changed to match.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  readPdfTextWith,
  type PdfTextDoc,
  type PdfTextPdfium,
  type ReadPdfTextOptions,
} from '../src/mirror-text'

/**
 * The PC code this mirrors, loaded by a computed path so the app's whole type graph
 * (Electron, React, Node) stays out of this package's type check.
 */
const PC_READ_TEXT = fileURLToPath(
  new URL('../../../apps/pdf/src/main/read-text.ts', import.meta.url),
)
const PC_TEXT_EDIT = fileURLToPath(
  new URL('../../../apps/pdf/src/main/text-edit.ts', import.meta.url),
)
let readPdfText: (bytes: Uint8Array, options?: ReadPdfTextOptions) => Promise<PdfTextDoc>

const encoder = new TextEncoder()

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/** UTF-16BE hex of `text`, code unit by code unit (lone surrogates kept) */
const utf16Hex = (text: string) => {
  let out = ''
  for (let i = 0; i < text.length; i++) out += hex4(text.charCodeAt(i))
  return out
}

/**
 * The characters of a test font: each entry is one glyph, and its text is what the
 * glyph's ToUnicode entry says (one character, a surrogate pair, or a lone surrogate).
 */
class CidFont {
  readonly glyphs = new Map<string, number>()

  /** Hex string for a Tj operator drawing `glyphs` */
  show(glyphs: string[]): string {
    return `<${glyphs.map((g) => hex4(this.cid(g))).join('')}>`
  }

  cid(glyph: string): number {
    let cid = this.glyphs.get(glyph)
    if (cid === undefined) {
      cid = this.glyphs.size + 1
      this.glyphs.set(glyph, cid)
    }
    return cid
  }

  toUnicode(): string {
    const entries = [...this.glyphs].map(([g, cid]) => `<${hex4(cid)}> <${utf16Hex(g)}>`)
    return [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      `${Math.max(1, entries.length)} beginbfchar`,
      ...(entries.length ? entries : ['<0000> <0020>']),
      'endbfchar',
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n')
  }
}

/** split into code points, so a pair stays one glyph */
const glyphsOf = (text: string) => [...text]

interface RawOptions {
  /** PDF string objects, written as they are (e.g. `<FEFF...>` or `(...)`) */
  title?: string
  author?: string
  mediaBox?: [number, number]
}

/**
 * A PDF of raw page content streams. /F1 is Helvetica, /F2 a Type0 font with no
 * embedded program whose ToUnicode map comes from `font` (PDFium reads text from it).
 */
function rawPdf(pages: string[], font: CidFont, options: RawOptions = {}): Uint8Array {
  const [w, h] = options.mediaBox ?? [612, 792]
  const toUnicode = font.toUnicode()
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '', // pages, filled below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /TestCid /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestCid /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 /CIDToGIDMap /Identity >>',
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
    '<< /Type /FontDescriptor /FontName /TestCid /Flags 4 /FontBBox [0 -120 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ]
  const info: string[] = []
  if (options.title !== undefined) info.push(`/Title ${options.title}`)
  if (options.author !== undefined) info.push(`/Author ${options.author}`)
  const infoRef = info.length ? objects.push(`<< ${info.join(' ')} >>`) : 0
  const kids: number[] = []
  for (const content of pages) {
    const contentRef = objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    )
    kids.push(
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${contentRef} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
      ),
    )
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  const infoEntry = infoRef ? ` /Info ${infoRef} 0 R` : ''
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoEntry} >>\nstartxref\n${xref}\n%%EOF\n`
  // every character above is ASCII
  return encoder.encode(body)
}

/** one line of glyphs drawn together */
const line = (font: CidFont, text: string, x: number, y: number, size = 24) =>
  `BT /F2 ${size} Tf ${x} ${y} Td ${font.show(glyphsOf(text))} Tj ET`

/** glyphs placed one by one, each `step` after the previous (inside it when step < size) */
const stepped = (font: CidFont, text: string, x: number, y: number, step: number, size = 24) =>
  glyphsOf(text)
    .map((g, i) => `BT /F2 ${size} Tf ${x + i * step} ${y} Td ${font.show([g])} Tj ET`)
    .join(' ')

/** the same with Helvetica, for Latin text */
const latin = (text: string, x: number, y: number, size = 24) =>
  `BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET`
const latinStepped = (text: string, x: number, y: number, step: number, size = 24) =>
  [...text].map((c, i) => latin(c, x + i * step, y, size)).join(' ')

const utf16be = (text: string) => `<FEFF${utf16Hex(text)}>`

let pdfium: PdfTextPdfium

beforeAll(async () => {
  const pc = (await import(/* @vite-ignore */ PC_READ_TEXT)) as { readPdfText: typeof readPdfText }
  readPdfText = pc.readPdfText
  const edit = (await import(/* @vite-ignore */ PC_TEXT_EDIT)) as {
    loadPdfium(): Promise<unknown>
  }
  pdfium = (await edit.loadPdfium()) as PdfTextPdfium
})

type Outcome = { ok: true; doc: unknown } | { ok: false }

async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, doc: await run() }
  } catch {
    return { ok: false }
  }
}

/** both readers on the same input: the same document or both refusing */
async function expectSame(bytes: Uint8Array, options?: ReadPdfTextOptions): Promise<Outcome> {
  const before = Uint8Array.from(bytes)
  const pc = await outcome(() => readPdfText(bytes, options))
  const mirror = await outcome(() => readPdfTextWith(pdfium, bytes, options))
  expect(mirror).toStrictEqual(pc)
  // neither reader writes into the caller's bytes
  expect(bytes).toStrictEqual(before)
  return pc
}

const textOf = (o: Outcome) =>
  o.ok ? (o.doc as { pages: { text: string }[] }).pages.map((p) => p.text).join('\f') : ''

const fixturesDir = join(__dirname, '../../../apps/pdf/tests/fixtures')
const shellFixturesDir = join(__dirname, '../../../apps/shell/tests/fixtures')
const fixture = (dir: string, name: string) => new Uint8Array(readFileSync(join(dir, name)))

describe('readPdfTextWith gives what readPdfText gives', () => {
  it('reads plain Latin lines', async () => {
    const font = new CidFont()
    const bytes = rawPdf(
      [[latin('First line', 72, 700), latin('Second line', 72, 650)].join(' ')],
      font,
    )
    expect(textOf(await expectSame(bytes))).toBe('First line\nSecond line')
  })

  it('reads kerned Latin glyphs back onto their lines', async () => {
    const font = new CidFont()
    const content = [
      latinStepped('Word', 72, 700, 12),
      latinStepped('Next', 72, 650, 12),
      `${latinStepped('Menu', 72, 600, 12)} ${latinStepped('Price', 300, 600, 12)}`,
    ].join(' ')
    const text = textOf(await expectSame(rawPdf([content], font)))
    expect(text.split('\n').map((l) => l.replace(/ /g, ''))).toEqual(['Word', 'Next', 'MenuPrice'])
  })

  it('reads Korean text', async () => {
    const font = new CidFont()
    const content = [
      line(font, '가정통신문 안내', 72, 700),
      line(font, '한글 문서를 읽습니다', 72, 650),
      line(font, '띄어 쓰기 없음', 72, 600, 12),
    ].join(' ')
    const text = textOf(await expectSame(rawPdf([content], font)))
    expect(text).toContain('가정통신문')
    expect(text).toContain('한글')
  })

  it('reads kerned Korean glyphs, and a wide gap on one line as a space', async () => {
    const font = new CidFont()
    const content = [
      stepped(font, '테스트입니다', 72, 700, 12),
      stepped(font, '다음줄', 72, 650, 20),
      `${stepped(font, '메뉴', 72, 600, 12)} ${stepped(font, '가격', 360, 600, 12)}`,
      // a step back of a whole glyph: not the same line any more
      stepped(font, '뒤로', 300, 550, -40),
    ].join(' ')
    const text = textOf(await expectSame(rawPdf([content], font)))
    expect(text.split('\n')[0]!.replace(/ /g, '')).toBe('테스트입니다')
  })

  it('reads characters outside the basic plane (surrogate pairs)', async () => {
    const font = new CidFont()
    const content = [line(font, '그림 😀 끝', 72, 700), line(font, '𠀀𠀁 한자', 72, 650)].join(' ')
    const text = textOf(await expectSame(rawPdf([content], font)))
    expect(text).toContain('😀')
  })

  it('keeps unpaired surrogates as they are, in page text and in the title', async () => {
    const font = new CidFont()
    // single glyphs whose ToUnicode is a lone high or low surrogate
    const content = [
      `BT /F2 24 Tf 72 700 Td ${font.show(['가', '\uD800', '나', '\uDC00', '다'])} Tj ET`,
      `BT /F2 24 Tf 72 650 Td ${font.show(['\uDBFF', '라'])} Tj ET`,
    ].join(' ')
    const bytes = rawPdf([content], font, {
      title: `<FEFF${utf16Hex('제')}D800${utf16Hex('목')}>`,
      author: `<FEFF${utf16Hex('저자')}DC00>`,
    })
    const pc = await expectSame(bytes)
    // the test is only worth something when PDFium hands the lone surrogates on
    expect(pc.ok).toBe(true)
    const all = JSON.stringify(pc)
    const lone =
      /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i
    expect(all).toMatch(lone)
  })

  it('reads every page of a multi-page document, with its title and author', async () => {
    const font = new CidFont()
    const pages = [
      line(font, '첫째 쪽', 72, 700),
      '', // an empty page: no text layer
      [line(font, '셋째 쪽', 72, 700), latin('Third page', 72, 650)].join(' '),
      latin('Fourth', 72, 700),
      stepped(font, '다섯째', 72, 700, 12),
    ]
    const bytes = rawPdf(pages, font, {
      title: utf16be('한글 제목'),
      author: '(Writer)',
      mediaBox: [595, 842],
    })
    const doc = await expectSame(bytes)
    expect(doc.ok && (doc.doc as { pageCount: number }).pageCount).toBe(5)
  })

  it('reads a document pdf-lib wrote, rotated pages and an empty author included', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false })
    doc.setTitle('보고서 Report')
    doc.setAuthor('')
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 4; i++) {
      const page = doc.addPage([300 + i * 50, 400])
      page.drawText(`Page ${i + 1}\nsecond line of ${i + 1}`, { x: 20, y: 300, size: 14, font })
      if (i % 2) page.setRotation(degrees(90 * i))
    }
    doc.addPage([200, 200])
    await expectSame(await doc.save({ useObjectStreams: false }))
  })

  it('agrees on every fixture PDF, with and without each password, wrong ones included', async () => {
    const files: [string, string][] = [
      ...[
        'plain-sample.pdf',
        'enc256.pdf',
        'enc128.pdf',
        'encrc4.pdf',
        'enc-r3-rc4.pdf',
        'enc-r4-aes128.pdf',
        'enc-r5-aes256.pdf',
        'enc-r5-owneronly.pdf',
      ].map((n): [string, string] => [fixturesDir, n]),
      ...['testPassword4Spaces.pdf', 'certEncrypted.pdf', 'corruptExample.pdf'].map(
        (n): [string, string] => [shellFixturesDir, n],
      ),
    ]
    const passwords = [undefined, '', 'user123', 's3cret', '    ', 'wrong']
    let opened = 0
    let refused = 0
    for (const [dir, name] of files) {
      const bytes = fixture(dir, name)
      for (const password of passwords) {
        const result = await expectSame(bytes, password === undefined ? {} : { password })
        if (result.ok) opened++
        else refused++
      }
    }
    // both outcomes are covered: encrypted files open with their password only
    expect(opened).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)
  }, 60_000)

  it('opens an encrypted file with its password and reads the same text', async () => {
    const result = await expectSame(fixture(fixturesDir, 'enc256.pdf'), { password: 'user123' })
    expect(textOf(result)).toContain('confidential')
    expect((await expectSame(fixture(fixturesDir, 'enc256.pdf'))).ok).toBe(false)
  })

  it('agrees on every page span, page list and character budget', async () => {
    const font = new CidFont()
    const pages = [
      line(font, '하나 둘 셋', 72, 700),
      [latin('alpha beta', 72, 700), line(font, '넷 다섯', 72, 650)].join(' '),
      '',
      stepped(font, '여섯일곱', 72, 700, 12),
      latin('the end', 72, 700),
    ]
    const bytes = rawPdf(pages, font)
    const full = await expectSame(bytes)
    const firstLength = full.ok
      ? (full.doc as { pages: { text: string }[] }).pages[0]!.text.length
      : 0
    expect(firstLength).toBeGreaterThan(0)
    const cases: ReadPdfTextOptions[] = [
      {},
      { fromPage: 2 },
      { toPage: 1 },
      { fromPage: 2, toPage: 4 },
      { fromPage: 0, toPage: 99 },
      { fromPage: 5, toPage: 2 },
      { fromPage: 9 },
      { toPage: -3 },
      { pages: [4, 1, 4, 99, 0, -1] },
      { pages: [] },
      { pages: [3], fromPage: 1, toPage: 1 },
      { charBudget: 0 },
      { charBudget: 1 },
      { charBudget: 5 },
      { charBudget: firstLength },
      { charBudget: firstLength + 1 },
      { charBudget: 10_000 },
      { pages: [5, 2], charBudget: 3 },
      { fromPage: 2, toPage: 3, charBudget: 4 },
      { password: '' },
      { password: 'not needed' },
    ]
    for (const options of cases) await expectSame(bytes, options)
  })

  it('agrees on files PDFium cannot read', async () => {
    await expectSame(new Uint8Array())
    await expectSame(encoder.encode('not a pdf at all'))
    const cut = fixture(fixturesDir, 'plain-sample.pdf').subarray(0, 4000)
    await expectSame(cut)
  })
})

describe('readPdfTextWith decodes UTF-16LE code unit by code unit', () => {
  /**
   * A module over the real one whose metadata answers are `title`'s raw bytes: the
   * decode path then sees exactly these code units. Buffer's utf16le (what the PC
   * uses) keeps every unit and drops an odd last byte; TextDecoder would not.
   */
  function withTitleBytes(raw: Uint8Array): PdfTextPdfium {
    const m = pdfium
    return new Proxy(m, {
      get(target, key, receiver) {
        if (key === '_FPDF_GetMetaText') {
          return (doc: number, tag: number, buf: number, len: number) => {
            const name = String.fromCharCode(...target.HEAPU8.subarray(tag, tag + 5))
            if (name !== 'Title') return target._FPDF_GetMetaText(doc, tag, buf, len)
            if (buf && len >= raw.length) target.HEAPU8.set(raw, buf)
            return raw.length
          }
        }
        const value = Reflect.get(target, key, receiver) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
  }

  const bytesOf = (units: number[], extra: number[] = []) => {
    const out = new Uint8Array(units.length * 2 + extra.length)
    units.forEach((u, i) => {
      out[i * 2] = u & 0xff
      out[i * 2 + 1] = u >> 8
    })
    out.set(extra, units.length * 2)
    return out
  }

  const bytes = () => rawPdf([latin('x', 72, 700)], new CidFont())

  it.each([
    ['a lone high surrogate', [0xac00, 0xd800, 0x0041, 0], []],
    ['a lone low surrogate', [0xdc00, 0xac01, 0], []],
    ['a reversed pair', [0xdc00, 0xd800, 0], []],
    ['a surrogate pair', [0xd83d, 0xde00, 0], []],
    ['a high surrogate at the end', [0x0041, 0xdbff, 0], []],
    ['an odd last byte', [0x0041, 0x0042, 0], [0x43]],
    ['trailing NULs', [0x0041, 0, 0, 0], []],
  ])('%s', async (_name, units, extra) => {
    const raw = bytesOf(units, extra)
    const doc = await readPdfTextWith(withTitleBytes(raw), bytes())
    const expected = Buffer.from(raw).toString('utf16le').replace(/\0+$/, '')
    if (expected) expect(doc.info.title).toBe(expected)
    else expect(doc.info.title).toBeUndefined()
  })
})
