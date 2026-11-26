/**
 * Deterministic sample files for the PDF tools baseline test
 * (pdf-tools-golden.test.ts). Every builder takes no randomness of its own:
 * pictures come from a fixed linear congruential sequence, and pdf-lib seeds
 * its own name suffixes per document. Call them with Date frozen, since
 * pdf-lib stamps the creation and modification dates of a new document.
 *
 * Only the standard fonts are used: an embedded font file would bring in
 * fontkit and its subsetting, which the tools do not exercise.
 */
import { crc32, deflateSync } from 'node:zlib'
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  type PDFDict,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib'

/** A fixed pseudo-random byte sequence (same constants as the compress tests) */
function noise(seed: number): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
    return (state >> 16) & 0xff
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

/**
 * A PNG of `width` x `height`. colourType 0 = grey, 2 = RGB, 6 = RGBA.
 * `fill` 'gradient' is smooth (small after Flate), 'noise' does not compress.
 */
export function png(
  width: number,
  height: number,
  colourType: 0 | 2 | 6 = 2,
  fill: 'gradient' | 'noise' = 'gradient',
  seed = 7,
): Uint8Array {
  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 : 4
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colourType
  const next = noise(seed)
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * channels + 1)
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const at = 1 + x * channels + c
        if (channels === 4 && c === 3) row[at] = 200
        else if (fill === 'noise') row[at] = next()
        else row[at] = (x * 7 + y * 3 + c * 60) & 0xff
      }
    }
    rows.push(row)
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/**
 * A JPEG pdf-lib embeds (it reads only the header, so the scan data is a
 * stub). `padding` adds comment segments so the picture is large;
 * `orientation` adds an APP1 Exif segment with that orientation.
 */
export function jpeg(width: number, height: number, padding = 0, orientation?: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8]
  if (orientation !== undefined) {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation]
    tiff.push(0, 0, 0, 0, 0, 0)
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body)
  }
  for (let left = padding; left > 0; left -= 65000) {
    const n = Math.min(65000, left)
    const fill = noise(n)
    parts.push(0xff, 0xfe, (n + 2) >> 8, (n + 2) & 0xff)
    // comment bytes that never form a marker (0xff), so the header still reads
    for (let i = 0; i < n; i++) parts.push(fill() & 0x7f)
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3)
  parts.push(1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9)
  return Uint8Array.from(parts)
}

/** Pages whose widths base, base + 1, ... tell them apart; no content */
export async function plainPages(count: number, base = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([base + i, 300])
  return doc.save({ useObjectStreams: false })
}

/** One line of Helvetica text per entry; '' makes a page without text */
export async function textPdf(lines: string[], size: [number, number] = [300, 300]) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const line of lines) {
    const page = doc.addPage(size)
    if (line) page.drawText(line, { x: 20, y: size[1] - 60, size: 14, font })
  }
  return doc.save({ useObjectStreams: false })
}

export interface OutlineSpec {
  title: string
  /** 0-based page index */
  page: number
  children?: OutlineSpec[]
}

/** Write an /Outlines tree by hand, so building it uses no code under test */
export function addOutlines(doc: PDFDocument, items: OutlineSpec[]): void {
  const ctx = doc.context
  const pages = doc.getPages()
  const rootRef = ctx.nextRef()
  const build = (
    list: OutlineSpec[],
    parent: PDFRef,
  ): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = list.map(() => ctx.nextRef())
    let count = 0
    list.forEach((item, i) => {
      const dict = ctx.obj({}) as PDFDict
      dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title))
      dict.set(PDFName.of('Parent'), parent)
      dict.set(
        PDFName.of('Dest'),
        ctx.obj([pages[item.page]!.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
      )
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]!)
      if (i < list.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]!)
      count++
      if (item.children?.length) {
        const sub = build(item.children, refs[i]!)
        dict.set(PDFName.of('First'), sub.first)
        dict.set(PDFName.of('Last'), sub.last)
        dict.set(PDFName.of('Count'), ctx.obj(sub.count))
        count += sub.count
      }
      ctx.assign(refs[i]!, dict)
    })
    return { first: refs[0]!, last: refs[refs.length - 1]!, count }
  }
  const top = build(items, rootRef)
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }),
  )
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
}

/** A small appearance stream (form XObject) drawing `ops` in a box */
function appearance(doc: PDFDocument, ops: string, w: number, h: number): PDFRef {
  return doc.context.register(
    doc.context.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h] }),
  )
}

/**
 * Every annotation kind the strip tool tells apart, on `page`: a comment with
 * a popup and a reply, a highlight, ink and a square with appearance streams,
 * a stamp, a free-text note, two links (web and in-document) and an
 * attachment counted as "other".
 */
function addAnnotations(doc: PDFDocument, page: PDFPage, linkTarget: PDFPage): void {
  const ctx = doc.context
  const note = ctx.nextRef()
  const popup = ctx.nextRef()
  ctx.assign(
    note,
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [20, 300, 40, 320],
      Contents: PDFString.of('A comment'),
      T: PDFString.of('Reviewer'),
      Popup: popup,
    }),
  )
  ctx.assign(
    popup,
    ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [45, 260, 165, 320], Parent: note }),
  )
  const reply = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [20, 300, 40, 320],
      Contents: PDFString.of('A reply'),
      IRT: note,
    }),
  )
  const highlight = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [20, 340, 200, 356],
      QuadPoints: [20, 356, 200, 356, 20, 340, 200, 340],
      C: [1, 1, 0],
    }),
  )
  const ink = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Ink',
      Rect: [60, 200, 100, 220],
      InkList: [[60, 200, 100, 220]],
      AP: { N: appearance(doc, '0 0 1 RG 2 w 0 0 m 40 20 l S', 40, 20) },
    }),
  )
  const square = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [120, 200, 160, 230],
      AP: { N: appearance(doc, '1 0 0 RG 1 w 1 1 38 28 re S', 40, 30) },
    }),
  )
  const stamp = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [180, 200, 260, 230], Name: 'Approved' }),
  )
  const freeText = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [20, 150, 200, 170],
      Contents: PDFString.of('Free text note'),
      DA: PDFString.of('/Helv 10 Tf 0 g'),
    }),
  )
  const webLink = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [20, 110, 120, 125],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') },
    }),
  )
  const pageLink = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [140, 110, 240, 125],
      Border: [0, 0, 0],
      Dest: [linkTarget.ref, 'Fit'],
    }),
  )
  const attachment = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'FileAttachment',
      Rect: [250, 300, 265, 320],
      Contents: PDFString.of('An attachment'),
    }),
  )
  for (const ref of [note, popup, reply, highlight, ink, square, stamp, freeText, webLink]) {
    page.node.addAnnot(ref)
  }
  page.node.addAnnot(pageLink)
  page.node.addAnnot(attachment)
}

/**
 * The main sample, 8 pages, with an outline two levels deep:
 * 1 cover text; 2 text and a picture; 3 annotations of every kind and form
 * fields; 4 turned by /Rotate 90; 5 text; 6 nothing at all; 7 scattered
 * specks only; 8 landscape with tiny text.
 */
export async function richPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Golden sample')
  doc.setAuthor('IeumOffice tests')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const size: [number, number] = [300, 400]

  const cover = doc.addPage(size)
  cover.drawText('Cover page', { x: 30, y: 340, size: 20, font: bold })
  cover.drawText('Prepared for the baseline test.', { x: 30, y: 310, size: 11, font })

  const picture = doc.addPage(size)
  picture.drawText('Part A: a picture', { x: 30, y: 350, size: 16, font: bold })
  const image = await doc.embedPng(png(64, 48, 2, 'gradient'))
  picture.drawImage(image, { x: 30, y: 180, width: 160, height: 120 })
  picture.drawRectangle({ x: 30, y: 150, width: 160, height: 4, color: rgb(0.2, 0.4, 0.8) })

  const annotated = doc.addPage(size)
  annotated.drawText('Section A.1: notes and a form', { x: 20, y: 370, size: 12, font })
  addAnnotations(doc, annotated, cover)
  const form = doc.getForm()
  const name = form.createTextField('applicant.name')
  name.setText('Filled value')
  name.addToPage(annotated, { x: 20, y: 40, width: 160, height: 22, font })
  const agree = form.createCheckBox('applicant.agree')
  agree.check()
  agree.addToPage(annotated, { x: 200, y: 40, width: 16, height: 16 })

  const turned = doc.addPage(size)
  turned.setRotation(degrees(90))
  turned.drawText('Section A.2: a turned page', { x: 30, y: 340, size: 12, font })

  const partB = doc.addPage(size)
  partB.drawText('Part B: plain text', { x: 30, y: 350, size: 16, font: bold })
  partB.drawText('Line one of part B.', { x: 30, y: 320, size: 11, font })
  partB.drawText('Line two of part B.', { x: 30, y: 305, size: 11, font })

  doc.addPage(size)

  const specks = doc.addPage(size)
  for (const [x, y] of [
    [40, 60],
    [250, 90],
    [150, 200],
    [70, 330],
    [230, 360],
  ] as const) {
    specks.drawRectangle({ x, y, width: 0.8, height: 0.8, color: rgb(0, 0, 0) })
  }

  const last = doc.addPage([400, 300])
  last.drawText('fine print on the last page', { x: 30, y: 150, size: 2, font })

  addOutlines(doc, [
    {
      title: 'Part A',
      page: 1,
      children: [
        { title: 'Section A.1', page: 2 },
        { title: 'Section A.2', page: 3 },
      ],
    },
    {
      title: '부록 B',
      page: 4,
      children: [
        { title: 'Section B.1', page: 6 },
        { title: 'Section B.2', page: 7 },
      ],
    },
  ])
  return doc.save({ useObjectStreams: false })
}

/**
 * Pages for the blank-page finder, each a different edge:
 * 1 text; 2 nothing; 3 scattered specks; 4 one dense mark; 5 only a space
 * drawn as text; 6 tiny text; 7 a white rectangle; 8 only a stamp
 * annotation; 9 nothing on a page turned by /Rotate 90; 10 a light grey wash.
 */
export async function blankCandidatesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const size: [number, number] = [300, 400]

  doc.addPage(size).drawText('Real content', { x: 30, y: 300, size: 14, font })
  doc.addPage(size)
  const specks = doc.addPage(size)
  for (const [x, y] of [
    [50, 50],
    [240, 80],
    [140, 210],
    [60, 340],
  ] as const) {
    specks.drawRectangle({ x, y, width: 0.6, height: 0.6, color: rgb(0, 0, 0) })
  }
  doc.addPage(size).drawRectangle({ x: 140, y: 190, width: 6, height: 6, color: rgb(0, 0, 0) })
  doc.addPage(size).drawText(' ', { x: 30, y: 300, size: 14, font })
  doc.addPage(size).drawText('tiny', { x: 30, y: 300, size: 1, font })
  doc.addPage(size).drawRectangle({ x: 20, y: 20, width: 260, height: 360, color: rgb(1, 1, 1) })
  const stamped = doc.addPage(size)
  stamped.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Square',
        Rect: [100, 150, 200, 250],
        AP: { N: appearance(doc, '0 0 0 rg 0 0 100 100 re f', 100, 100) },
      }),
    ),
  )
  doc.addPage([200, 300]).setRotation(degrees(90))
  doc
    .addPage(size)
    .drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(0.9, 0.9, 0.9) })
  return doc.save({ useObjectStreams: false })
}

/** Many empty pages: past the finder's thumbnail cap */
export async function manyEmptyPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([120, 160])
  return doc.save({ useObjectStreams: false })
}

/**
 * Pictures "make smaller" looks at: a large JPEG, a small one (below the
 * size worth trying), one with an EXIF orientation (left alone), a noisy
 * RGBA PNG (soft mask kept), a noisy grey PNG and a noisy RGB PNG; then a
 * text page.
 */
export async function compressSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([600, 800])
  page.drawImage(await doc.embedJpg(jpeg(1200, 900, 80_000)), {
    x: 0,
    y: 560,
    width: 300,
    height: 225,
  })
  page.drawImage(await doc.embedJpg(jpeg(100, 80, 2_000)), { x: 0, y: 500, width: 50, height: 40 })
  page.drawImage(await doc.embedJpg(jpeg(900, 1200, 80_000, 6)), {
    x: 320,
    y: 560,
    width: 150,
    height: 200,
  })
  page.drawImage(await doc.embedPng(png(220, 220, 6, 'noise', 11)), {
    x: 0,
    y: 250,
    width: 200,
    height: 200,
  })
  page.drawImage(await doc.embedPng(png(260, 260, 0, 'noise', 13)), {
    x: 220,
    y: 250,
    width: 200,
    height: 200,
  })
  const second = doc.addPage([600, 800])
  second.drawImage(await doc.embedPng(png(200, 200, 2, 'noise', 17)), {
    x: 50,
    y: 400,
    width: 200,
    height: 200,
  })
  second.drawText('Text stays as it is.', { x: 50, y: 300, size: 14, font })
  return doc.save({ useObjectStreams: false })
}

/** A background for overlay: two pages, each with a different mark */
export async function backgroundPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaOblique)
  const first = doc.addPage([300, 400])
  first.drawRectangle({ x: 10, y: 10, width: 280, height: 380, color: rgb(0.95, 0.9, 0.8) })
  first.drawText('LETTERHEAD', { x: 80, y: 370, size: 18, font })
  const second = doc.addPage([400, 300])
  second.drawText('DRAFT', { x: 120, y: 140, size: 40, font, rotate: degrees(20) })
  return doc.save({ useObjectStreams: false })
}

/** Every offset in the cross-reference table, and the startxref, moved 7 bytes */
export function shiftedXref(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString('latin1')
  const broken = text
    .replace(
      /(\d{10}) 00000 n/g,
      (_m, offset: string) => `${String(Number(offset) + 7).padStart(10, '0')} 00000 n`,
    )
    .replace(/startxref\s+(\d+)/, (_m, at: string) => `startxref\n${Number(at) + 7}`)
  return new Uint8Array(Buffer.from(broken, 'latin1'))
}

/** Only the startxref number points somewhere wrong */
export function wrongStartxref(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString('latin1')
  const broken = text.replace(/startxref\s+(\d+)/, 'startxref\n12')
  return new Uint8Array(Buffer.from(broken, 'latin1'))
}
