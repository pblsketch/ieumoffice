/**
 * A picture in a table cell turned from "treat as char" to Square wrap (어울림), in the patched
 * rhwp engine (vendor/rhwp-core, patch 0061). The fixture is a form Hangul 2024 made: one row,
 * the right cell 14.3 mm wide with "(서명)" centered. A seal picture goes in after "(서" the way
 * the editor pastes a picture in a cell (as text), then the properties dialog turns it to Square.
 *
 * Hangul relays the cell: the picture stays at the paragraph's top, there is no room beside it,
 * so the one line "(서명)" goes below the picture (stored vertpos 3675 = the picture's height)
 * and the row grows to 49.5 pt (66 px). The engine used to keep the rows of the inline picture:
 * "(서" alone, a 49 px row for the picture, "명)" on a third row drawn over the picture, a row of
 * about 96 px — in a real form that pushed the last lines onto a new page.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)
const CORE = dirname(require.resolve('@rhwp/core'))
const PATH = JSON.stringify([{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }])
/** 13 mm, the seal size of the reported form. */
const SEAL = 3675

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(CORE, 'rhwp_bg.wasm')) })
})

/** A small red PNG standing in for the seal. */
function png(size: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const rows: number[] = []
  for (let y = 0; y < size; y++) {
    rows.push(0)
    for (let x = 0; x < size; x++) rows.push(220, 30, 30)
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

function open(): HwpDocument {
  return new HwpDocument(
    new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'cell-square-seal.hwp'))),
  )
}

/** The editor's cell paste: the picture as text in a scratch paragraph, copied, pasted. */
function pasteSeal(doc: HwpDocument): void {
  const last = doc.getParagraphCount(0) - 1
  doc.splitParagraph(0, last, doc.getParagraphLength(0, last))
  const scratch = last + 1
  const placed = JSON.parse(
    doc.insertPicture(0, scratch, 0, '', png(40), SEAL, SEAL, 40, 40, 'png', ''),
  )
  doc.setPictureProperties(0, scratch, placed.controlIdx, JSON.stringify({ treatAsChar: true }))
  expect(JSON.parse(doc.copyControl(0, scratch, '', placed.controlIdx)).ok).toBe(true)
  doc.deletePictureControl(0, scratch, placed.controlIdx)
  doc.mergeParagraph(0, scratch)
  expect(JSON.parse(doc.pasteInternalInCellByPath(0, 1, PATH, 2)).ok).toBe(true)
}

function toSquare(doc: HwpDocument): void {
  doc.setCellPicturePropertiesByPath(
    0,
    1,
    PATH,
    0,
    JSON.stringify({ treatAsChar: false, textWrap: 'Square' }),
  )
}

type Box = { x: number; y: number; w: number; h: number }

function look(doc: HwpDocument) {
  const cell: Box = JSON.parse(doc.getTableCellBboxes(0, 1, 0)).find(
    (b: { cellIdx: number }) => b.cellIdx === 1,
  )
  const picture: Box = JSON.parse(doc.getPageControlLayout(0)).controls.find(
    (c: { type: string }) => c.type === 'image',
  )
  const text: Box[] = JSON.parse(doc.getPageTextLayout(0)).runs.filter(
    (r: Box & { text: string }) =>
      r.text.trim() !== '' && r.x >= cell.x - 1 && r.x < cell.x + cell.w && r.y >= cell.y - 1,
  )
  const lines = JSON.parse(doc.getLineInfoInCell(0, 1, 0, 1, 0, 0)).lineCount as number
  return { cell, picture, text, lines, pages: doc.pageCount() }
}

describe('a cell picture turned to Square wrap', () => {
  it('relays the cell: one line below the picture, the row as tall as Hangul makes it', () => {
    const doc = open()
    pasteSeal(doc)
    toSquare(doc)
    const { cell, picture, text, lines, pages } = look(doc)
    expect(lines).toBe(1)
    expect(new Set(text.map((r) => r.y)).size).toBe(1)
    // the text clears the picture, no overlap
    expect(text[0].y).toBeGreaterThanOrEqual(picture.y + picture.h - 0.5)
    // Hangul 2024 prints the row 49.5 pt high
    expect(cell.h).toBeGreaterThan(64)
    expect(cell.h).toBeLessThan(68)
    expect(pages).toBe(1)
  })

  it('keeps that layout through a save and reopen', () => {
    const doc = open()
    pasteSeal(doc)
    toSquare(doc)
    const again = new HwpDocument(doc.exportHwp())
    const { picture, text, lines } = look(again)
    expect(lines).toBe(1)
    expect(text[0].y).toBeGreaterThanOrEqual(picture.y + picture.h - 0.5)
  })

  it('brings the line back up when the picture goes in front of the text', () => {
    const doc = open()
    pasteSeal(doc)
    toSquare(doc)
    doc.setCellPicturePropertiesByPath(0, 1, PATH, 0, JSON.stringify({ textWrap: 'InFrontOfText' }))
    const { picture, text, lines } = look(doc)
    expect(lines).toBe(1)
    // nothing pushes the line below the picture any more
    expect(text[0].y).toBeLessThan(picture.y + picture.h - 1)
  })
})
