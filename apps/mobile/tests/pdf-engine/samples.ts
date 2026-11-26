/**
 * Sample PDFs and requests of the parity test, built with pdf-lib (and the
 * repo's encrypted fixtures). Runs in the Vitest process before either run,
 * with the clock already fixed; the files are then read by both runs.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import type { SavePdfRequest } from '../../../pdf/src/shared/ipc'
import type { ParityCase } from './cases'

const PC_FIXTURES = resolve(__dirname, '../../../pdf/tests/fixtures')
/** Password of the qpdf-made fixtures (apps/pdf/tests/pdf-crypt-real.test.ts) */
const FIXTURE_PASSWORD = 'user123'

const FONT_SIZE = 14

const request = (over: Partial<SavePdfRequest> = {}): SavePdfRequest => ({
  path: 'source.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** A small RGBA PNG (a dark stroke on transparency), like a drawn signature */
export function signaturePng(): string {
  const size = 16
  const rows: number[] = []
  for (let y = 0; y < size; y++) {
    rows.push(0)
    for (let x = 0; x < size; x++) {
      const ink = Math.abs(x - y) <= 1 || Math.abs(x + y - size) <= 1
      rows.push(20, 20, 80, ink ? 255 : 0)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from(rows))),
    pngChunk('IEND', new Uint8Array(0)),
  ])
  return png.toString('base64')
}

interface TextRun {
  text: string
  page: number
  x: number
  y: number
  rect: [number, number, number, number]
}

/** Three pages of Helvetica text and an AcroForm (text, checkbox, radio, dropdown) */
async function baseDocument(): Promise<{ bytes: Uint8Array; runs: TextRun[] }> {
  const doc = await PDFDocument.create()
  doc.setTitle('Parity sample')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const runs: TextRun[] = []
  for (let p = 0; p < 3; p++) {
    const page = doc.addPage([595, 842])
    for (const [i, text] of [`Hello World page ${p + 1}`, 'Amount due 500'].entries()) {
      const x = 50
      const y = 700 - i * 50
      page.drawText(text, { x, y, size: FONT_SIZE, font })
      const w = font.widthOfTextAtSize(text, FONT_SIZE)
      runs.push({ text, page: p, x, y, rect: [x - 5, y - 6, x + w + 5, y + FONT_SIZE + 4] })
    }
  }
  const form = doc.getForm()
  const first = doc.getPage(0)
  form.createTextField('name').addToPage(first, { x: 50, y: 400, width: 200, height: 24 })
  form.createCheckBox('agree').addToPage(first, { x: 50, y: 360, width: 18, height: 18 })
  const radio = form.createRadioGroup('choice')
  radio.addOptionToPage('a', first, { x: 50, y: 320, width: 18, height: 18 })
  radio.addOptionToPage('b', first, { x: 80, y: 320, width: 18, height: 18 })
  const city = form.createDropdown('city')
  city.addOptions(['Seoul', 'Busan'])
  city.addToPage(first, { x: 50, y: 280, width: 120, height: 24 })
  return { bytes: await doc.save({ useObjectStreams: false }), runs }
}

/** One page carrying saved annotations (highlight with appearance, note, link) */
async function annotatedDocument(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  const ap = doc.context.register(
    doc.context.stream('1 1 0 rg 0 0 100 20 re f', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 100, 20],
    }),
  )
  const highlight = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [50, 200, 150, 220],
    QuadPoints: [50, 220, 150, 220, 50, 200, 150, 200],
    C: [1, 1, 0],
    AP: { N: ap },
  })
  const note = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [200, 250, 220, 270],
    Contents: PDFString.of('a saved note'),
    C: [1, 0.8, 0],
  })
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [10, 10, 50, 50],
    Border: [0, 0, 0],
    A: { S: 'URI', URI: PDFString.of('https://example.com') },
  })
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([highlight, note, link].map((a) => doc.context.register(a))),
  )
  return doc.save({ useObjectStreams: false })
}

export interface Samples {
  /** File name → bytes, written into the run folder */
  files: Record<string, Uint8Array>
  cases: ParityCase[]
}

export async function buildSamples(): Promise<Samples> {
  const { bytes: base, runs } = await baseDocument()
  const annotated = await annotatedDocument()
  const fixture = (name: string) => new Uint8Array(readFileSync(join(PC_FIXTURES, name)))
  const files: Record<string, Uint8Array> = {
    'base.pdf': base,
    'annotated.pdf': annotated,
    'enc256.pdf': fixture('enc256.pdf'),
    'enc128.pdf': fixture('enc128.pdf'),
    'encrc4.pdf': fixture('encrc4.pdf'),
  }
  const hello = runs[0]!
  const amount = runs[1]!
  const quad = (r: TextRun) => [
    r.x,
    r.y + FONT_SIZE,
    r.rect[2] - 5,
    r.y + FONT_SIZE,
    r.x,
    r.y - 3,
    r.rect[2] - 5,
    r.y - 3,
  ]
  const highlightAll = request({
    markups: [{ pageIndex: 0, type: 'highlight', color: [1, 0.87, 0.35], quads: [quad(hello)] }],
  })
  const png = signaturePng()

  const save = (name: string, source: string, over: Partial<SavePdfRequest>): ParityCase => ({
    name,
    kind: 'save',
    source,
    request: request(over),
  })

  const cases: ParityCase[] = [
    save('markups', 'base.pdf', {
      annotationAuthor: 'Mobile tester',
      markups: [
        { pageIndex: 0, type: 'highlight', color: [1, 0.87, 0.35], quads: [quad(hello)] },
        { pageIndex: 0, type: 'underline', color: [0, 0.4, 1], quads: [quad(amount)] },
        { pageIndex: 1, type: 'strikeout', color: [1, 0, 0], quads: [quad(runs[2]!)] },
        { pageIndex: 1, type: 'squiggly', color: [0, 0.6, 0], quads: [quad(runs[3]!)] },
      ],
    }),
    save('ink drawing', 'base.pdf', {
      drawings: [
        {
          kind: 'ink',
          pageIndex: 0,
          color: [0.1, 0.1, 0.8],
          width: 2,
          paths: [
            [100, 100, 120, 130, 140, 110, 160, 150],
            [200, 200, 210, 220],
          ],
        },
      ],
    }),
    save('shapes', 'base.pdf', {
      drawings: [
        { kind: 'rect', pageIndex: 0, color: [1, 0, 0], width: 1.5, rect: [60, 60, 160, 120] },
        { kind: 'ellipse', pageIndex: 0, color: [0, 0.5, 0], width: 1, rect: [200, 60, 300, 140] },
        { kind: 'line', pageIndex: 1, color: [0, 0, 0], width: 1, from: [50, 50], to: [250, 90] },
        {
          kind: 'arrow',
          pageIndex: 1,
          color: [0, 0, 1],
          width: 2,
          from: [50, 150],
          to: [250, 190],
        },
      ],
    }),
    save('note and reply', 'base.pdf', {
      drawings: [
        {
          kind: 'note',
          pageIndex: 0,
          color: [1, 0.8, 0],
          at: [300, 600],
          contents: '메모 한 줄',
          author: '작성자',
          createdMs: Date.UTC(2026, 0, 1),
          localId: 'n1',
        },
        {
          kind: 'note',
          pageIndex: 0,
          color: [1, 0.8, 0],
          at: [300, 600],
          contents: 'A reply',
          createdMs: Date.UTC(2026, 0, 1, 1),
          localId: 'n2',
          replyToLocalId: 'n1',
        },
      ],
    }),
    save('image signature', 'base.pdf', {
      drawings: [{ kind: 'image', pageIndex: 0, image: png, rect: [300, 100, 400, 150] }],
      stamps: [{ pageIndex: 1, image: png, rect: [400, 700, 450, 750], opacity: 0.5 }],
    }),
    save('form values', 'base.pdf', {
      formValues: [
        { name: 'name', kind: 'text', value: 'Mobile Kim' },
        { name: 'agree', kind: 'checkbox', checked: true },
        { name: 'choice', kind: 'radio', value: 'b' },
        { name: 'city', kind: 'choice', value: 'Busan' },
      ],
    }),
    save('static check and cross marks', 'base.pdf', {
      drawings: [
        {
          kind: 'line',
          pageIndex: 0,
          color: [0, 0, 0],
          width: 1.5,
          from: [400, 400],
          to: [410, 390],
        },
        {
          kind: 'line',
          pageIndex: 0,
          color: [0, 0, 0],
          width: 1.5,
          from: [410, 390],
          to: [425, 412],
        },
      ],
      staticFormFills: [
        { id: 'c1', kind: 'check', pageIndex: 0, rect: [398, 388, 428, 414] },
        { id: 'x1', kind: 'cross', pageIndex: 0, rect: [440, 388, 470, 414] },
        {
          id: 't1',
          kind: 'text',
          pageIndex: 0,
          rect: [480, 388, 560, 414],
          text: 'OK',
          fontSize: 12,
        },
      ],
    }),
    save('page operations', 'base.pdf', {
      rotations: [{ pageIndex: 1, delta: 90 }],
      deletedPages: [2],
      blankPages: [{ pageIndex: 3, width: 595, height: 842 }],
      pageOrder: [1, 0, 3],
    }),
    save('links', 'base.pdf', {
      drawings: [
        { kind: 'link', pageIndex: 0, rect: [50, 500, 200, 520], url: 'https://ieumoffice.com' },
        { kind: 'link', pageIndex: 0, rect: [50, 470, 200, 490], destPage: 3 },
      ],
    }),
    save('text insert in bundled fonts', 'base.pdf', {
      textInserts: [
        {
          pageIndex: 0,
          origin: [60, 560],
          text: '한글 넣기 Sans',
          fontSize: 16,
          color: [0, 0, 0],
          font: 'arial',
        },
        {
          pageIndex: 0,
          origin: [60, 530],
          text: '명조 글자\n둘째 줄',
          fontSize: 12,
          color: [0.2, 0.2, 0.6],
          font: 'times',
        },
        {
          pageIndex: 1,
          origin: [60, 560],
          text: '굵은 고딕',
          fontSize: 14,
          color: [0, 0, 0],
          font: 'courier',
          bold: true,
        },
      ],
    }),
    save('text edit', 'base.pdf', {
      textEdits: [
        {
          pageIndex: 0,
          rect: hello.rect,
          oldText: hello.text,
          newText: '안녕하세요 World',
          fontSize: FONT_SIZE,
        },
        {
          pageIndex: 1,
          rect: runs[3]!.rect,
          oldText: runs[3]!.text,
          newText: '금액 900',
          fontSize: FONT_SIZE,
          newFont: 'times',
        },
      ],
    }),
    save('fresh password protection', 'base.pdf', {
      ...highlightAll,
      encryption: {
        userPassword: 'open-me',
        ownerPassword: 'own-me',
        permissions: { printing: true, modifying: false, annotating: true, copying: false },
      },
      protectionDirty: true,
    }),
    ...(['enc256.pdf', 'enc128.pdf', 'encrc4.pdf'] as const).map((name) =>
      save(`encrypted ${name} keeps its protection`, name, {
        markups: [
          {
            pageIndex: 0,
            type: 'highlight',
            color: [1, 1, 0],
            quads: [[72, 720, 200, 720, 72, 700, 200, 700]],
          },
        ],
        decryption: { userPassword: FIXTURE_PASSWORD },
        protectionDirty: false,
      }),
    ),
    save('save as with flatten', 'base.pdf', {
      ...highlightAll,
      drawings: [
        { kind: 'rect', pageIndex: 0, color: [1, 0, 0], width: 1, rect: [60, 60, 160, 120] },
      ],
      annotations: 'flatten',
    }),
    save('save as with strip', 'annotated.pdf', { annotations: 'strip' }),
    save('unchanged save keeps the source bytes', 'base.pdf', {}),
    save('a refused request fails the same way', 'base.pdf', {
      blankPages: [{ pageIndex: 7, width: 100, height: 100 }],
    }),
    {
      name: 'apply edits (recovery copy shape)',
      kind: 'apply',
      source: 'base.pdf',
      request: highlightAll,
    },
    { name: 'has edits: empty request', kind: 'hasEdits', request: request() },
    { name: 'has edits: one markup', kind: 'hasEdits', request: highlightAll },
    {
      name: 'insert pages of another PDF',
      kind: 'insertPdf',
      source: 'base.pdf',
      other: 'annotated.pdf',
      afterPageIndex: 0,
    },
    { name: 'insert a blank page', kind: 'insertBlankPage', source: 'base.pdf', afterPageIndex: 1 },
    { name: 'blank PDF', kind: 'blankPdf' },
    { name: 'flatten saved annotations', kind: 'flatten', source: 'annotated.pdf' },
    { name: 'strip saved comments', kind: 'strip', source: 'annotated.pdf' },
    { name: 'edit fonts', kind: 'listEditFonts' },
    {
      name: 'can draw: common Hangul in Sans',
      kind: 'canDraw',
      text: '안녕하세요 Hello 123',
      font: 'arial',
    },
    {
      name: 'can draw: common Hangul in Serif bold',
      kind: 'canDraw',
      text: '가나다',
      font: 'times',
      bold: true,
    },
    { name: 'can draw: common Hangul without a font', kind: 'canDraw', text: '한글' },
    { name: 'can draw: rare Hangul', kind: 'canDraw', text: '뷁', font: 'arial' },
    { name: 'can draw: Hanja', kind: 'canDraw', text: '漢字', font: 'arial' },
    { name: 'can draw: circled digit', kind: 'canDraw', text: '①', font: 'courier' },
  ]
  return { files, cases }
}

/** Cases whose answer must be false/true regardless of the PC run (spec 2.3) */
export const EXPECTED_VALUES: Readonly<Record<string, unknown>> = {
  'has edits: empty request': false,
  'has edits: one markup': true,
  'can draw: common Hangul in Sans': true,
  'can draw: common Hangul in Serif bold': true,
  'can draw: common Hangul without a font': true,
  'can draw: rare Hangul': false,
  'can draw: Hanja': false,
  'can draw: circled digit': false,
  'edit fonts': ['arial', 'times', 'courier'],
}
