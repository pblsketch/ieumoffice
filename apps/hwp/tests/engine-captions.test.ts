/**
 * Read-only caption enumeration via HwpDocument.listObjectCaptions() (patch 0059).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)
const CORE = dirname(require.resolve('@rhwp/core'))

const TABLE_CAPTION_CELL_SENTINEL = 65534
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b8AAAAASUVORK5CYII=',
  'base64',
)

interface CellPathStep {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

interface ObjectCaptionEntry {
  kind: 'table' | 'picture' | 'equation' | 'shape' | string
  text: string
  paragraphs: string[]
  sec: number
  para: number
  controlIndex: number
  cellPath: CellPathStep[]
  direction: 'Left' | 'Right' | 'Top' | 'Bottom'
  hasCaption: boolean
}

beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(CORE, 'rhwp_bg.wasm')) })
})

function openFixture(name: string): HwpDocument {
  return new HwpDocument(new Uint8Array(readFileSync(join(__dirname, 'fixtures', name))))
}

function createBlankDoc(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  return doc
}

function listCaptions(doc: HwpDocument): ObjectCaptionEntry[] {
  return JSON.parse(doc.listObjectCaptions()) as ObjectCaptionEntry[]
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('HwpDocument.listObjectCaptions', () => {
  it('returns an empty array for documents without captions', () => {
    const empty = HwpDocument.createEmpty()
    expect(listCaptions(empty)).toEqual([])
    empty.free()

    const doc = createBlankDoc()
    doc.insertText(0, 0, 0, 'Plain objects')
    doc.createTable(0, 0, 13, 2, 2)
    doc.insertParagraph(0, 1)
    doc.insertPicture(0, 1, 0, '[]', PNG_1X1, 4000, 4000, 100, 100, 'png', 'plain')
    doc.insertParagraph(0, 2)
    doc.insertEquation(0, 2, 0, 'E = m c^2', 1100, 0)
    expect(listCaptions(doc)).toEqual([])
    doc.free()
  })

  it('reads table captions including auto-number text, location, direction, and removal', () => {
    const doc = createBlankDoc()
    doc.insertText(0, 0, 0, 'Table host')
    const table = JSON.parse(doc.createTable(0, 0, 10, 2, 2)) as {
      paraIdx: number
      controlIdx: number
    }

    doc.setTableProperties(
      0,
      table.paraIdx,
      table.controlIdx,
      JSON.stringify({ hasCaption: true, captionDirection: 2 }),
    )
    doc.insertTextInCell(
      0,
      table.paraIdx,
      table.controlIdx,
      TABLE_CAPTION_CELL_SENTINEL,
      0,
      3,
      ' Quarterly totals',
    )

    const captions = listCaptions(doc)
    expect(captions).toHaveLength(1)
    expect(captions[0]).toEqual({
      kind: 'table',
      text: '표 1 Quarterly totals',
      paragraphs: ['표 1 Quarterly totals'],
      sec: 0,
      para: table.paraIdx,
      controlIndex: table.controlIdx,
      cellPath: [],
      direction: 'Top',
      hasCaption: true,
    })

    // Removing the caption removes it from the list.
    doc.setTableProperties(
      0,
      table.paraIdx,
      table.controlIdx,
      JSON.stringify({ hasCaption: false }),
    )
    expect(listCaptions(doc)).toEqual([])
    doc.free()
  })

  it('reads picture and table captions in reading order from fixture documents', () => {
    const doc = openFixture('caption-footnote-flow.hwpx')
    const captions = listCaptions(doc)

    expect(captions).toHaveLength(4)
    expect(captions.map((c) => c.kind)).toEqual(['picture', 'table', 'picture', 'table'])
    expect(captions.map((c) => c.direction)).toEqual(['Bottom', 'Top', 'Bottom', 'Top'])
    expect(captions.every((c) => c.sec === 0 && c.cellPath.length === 0 && c.hasCaption)).toBe(true)

    expect(captions[0].text.startsWith('[그림 1]')).toBe(true)
    expect(captions[0].paragraphs).toHaveLength(1)

    expect(captions[1].text.startsWith('[표 1]')).toBe(true)
    expect(captions[1].paragraphs).toHaveLength(1)

    // Second picture carries a two-paragraph caption (title + note).
    expect(captions[2].paragraphs).toHaveLength(2)
    expect(captions[2].paragraphs[0].startsWith('[그림 2]')).toBe(true)
    expect(captions[2].paragraphs[1].startsWith('주:')).toBe(true)
    expect(captions[2].text).toBe(`${captions[2].paragraphs[0]}\n${captions[2].paragraphs[1]}`)

    expect(captions[3].text.startsWith('[표 2]')).toBe(true)
    expect(captions[3].paragraphs).toHaveLength(1)

    // Paragraph indices strictly follow document reading order.
    for (let i = 1; i < captions.length; i++) {
      expect(captions[i].para).toBeGreaterThanOrEqual(captions[i - 1].para)
    }
    doc.free()
  })

  it('reads freshly attached picture and shape captions and handles equations safely', () => {
    const doc = createBlankDoc()
    doc.insertText(0, 0, 0, 'Picture line')
    const pic = JSON.parse(
      doc.insertPicture(0, 0, 12, '[]', PNG_1X1, 5000, 5000, 100, 100, 'png', 'chart'),
    ) as { paraIdx: number; controlIdx: number }
    doc.setPictureProperties(
      0,
      pic.paraIdx,
      pic.controlIdx,
      JSON.stringify({ hasCaption: true, captionDirection: 'Bottom' }),
    )

    doc.insertParagraph(0, 1)
    doc.insertText(0, 1, 0, 'Shape line')
    const shape = JSON.parse(
      doc.createShapeControl(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: 1,
          charOffset: 10,
          width: 4000,
          height: 2000,
          horzOffset: 0,
          vertOffset: 0,
          treatAsChar: true,
          textWrap: 'Square',
        }),
      ),
    ) as { paraIdx: number; controlIdx: number }
    doc.attachCaptionAt(shape.paraIdx, shape.controlIdx)

    doc.insertParagraph(0, 2)
    doc.insertText(0, 2, 0, 'Equation line')
    doc.insertEquation(0, 2, 13, 'a^2 + b^2 = c^2', 1100, 0)

    const captions = listCaptions(doc)
    expect(captions).toHaveLength(2)

    expect(captions[0]).toMatchObject({
      kind: 'picture',
      text: '그림 1',
      paragraphs: ['그림 1'],
      sec: 0,
      para: pic.paraIdx,
      controlIndex: pic.controlIdx,
      cellPath: [],
      direction: 'Bottom',
      hasCaption: true,
    })

    expect(captions[1]).toMatchObject({
      kind: 'shape',
      text: '그림 1',
      paragraphs: ['그림 1'],
      sec: 0,
      para: shape.paraIdx,
      controlIndex: shape.controlIdx,
      cellPath: [],
      direction: 'Bottom',
      hasCaption: true,
    })
    doc.free()
  })

  it('reads captions on objects nested inside table cells with non-empty cellPath', async () => {
    const doc = createBlankDoc()
    const outer = JSON.parse(doc.createTable(0, 0, 0, 1, 2)) as {
      paraIdx: number
      controlIdx: number
    }
    const cell0Path = JSON.stringify([
      { controlIndex: outer.controlIdx, cellIndex: 0, cellParaIndex: 0 },
    ])
    const cell1Path = JSON.stringify([
      { controlIndex: outer.controlIdx, cellIndex: 1, cellParaIndex: 0 },
    ])
    doc.createTableInCellByPath(
      0,
      outer.paraIdx,
      cell0Path,
      0,
      JSON.stringify({ rowCount: 1, colCount: 1 }),
    )
    doc.insertPictureInCell(
      0,
      outer.paraIdx,
      0,
      cell1Path,
      PNG_1X1,
      3000,
      3000,
      100,
      100,
      'png',
      'inner',
    )

    // Inject HWPX captions on both the nested table (cell 0) and nested picture (cell 1).
    const baseHwpx = doc.exportHwpx()
    doc.free()

    const zip = await JSZip.loadAsync(baseHwpx)
    const sectionEntry = zip.file('Contents/section0.xml')
    expect(sectionEntry).not.toBeNull()
    let xml = await sectionEntry!.async('string')

    const makeCaptionXml = (text: string, side: 'TOP' | 'BOTTOM') =>
      `<hp:caption side="${side}" fullSz="0" width="8504" gap="850" lastWidth="12000">` +
      `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" ` +
      `linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" ` +
      `hasTextRef="0" hasNumRef="0"><hp:p id="0" paraPrIDRef="0" styleIDRef="0" ` +
      `pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">` +
      `<hp:t>${text}</hp:t></hp:run></hp:p></hp:subList></hp:caption>`

    // Insert caption into the nested (second) </hp:tbl> before its closing tag, and into </hp:pic>.
    let tblEndCount = 0
    xml = xml.replace(/<\/hp:tbl>/g, (match) => {
      tblEndCount += 1
      return tblEndCount === 1 ? `${makeCaptionXml('Nested table caption', 'TOP')}${match}` : match
    })
    xml = xml.replace('</hp:pic>', `${makeCaptionXml('Nested picture caption', 'BOTTOM')}</hp:pic>`)

    zip.file('Contents/section0.xml', xml)
    const nestedBytes = await zip.generateAsync({ type: 'uint8array' })

    const reloaded = new HwpDocument(nestedBytes)
    const captions = listCaptions(reloaded)
    expect(captions).toHaveLength(2)

    expect(captions[0]).toMatchObject({
      kind: 'table',
      text: 'Nested table caption',
      paragraphs: ['Nested table caption'],
      sec: 0,
      para: outer.paraIdx,
      controlIndex: 0,
      cellPath: [{ controlIndex: outer.controlIdx, cellIndex: 0, cellParaIndex: 0 }],
      direction: 'Top',
      hasCaption: true,
    })

    expect(captions[1]).toMatchObject({
      kind: 'picture',
      text: 'Nested picture caption',
      paragraphs: ['Nested picture caption'],
      sec: 0,
      para: outer.paraIdx,
      controlIndex: 0,
      cellPath: [{ controlIndex: outer.controlIdx, cellIndex: 1, cellParaIndex: 0 }],
      direction: 'Bottom',
      hasCaption: true,
    })
    reloaded.free()
  })

  it('is strictly read-only and leaves exported HWP and HWPX bytes identical', () => {
    for (const fixture of ['caption-footnote-flow.hwpx', 'caption-footnote-flow-ieum17.hwp']) {
      const doc = openFixture(fixture)
      const hwpBefore = doc.exportHwp()
      const hwpxBefore = doc.exportHwpx()

      const captions = listCaptions(doc)
      expect(captions.length).toBeGreaterThan(0)

      const hwpAfter = doc.exportHwp()
      const hwpxAfter = doc.exportHwpx()
      expect(sha256(hwpAfter)).toBe(sha256(hwpBefore))
      expect(sha256(hwpxAfter)).toBe(sha256(hwpxBefore))
      expect(Buffer.compare(Buffer.from(hwpAfter), Buffer.from(hwpBefore))).toBe(0)
      expect(Buffer.compare(Buffer.from(hwpxAfter), Buffer.from(hwpxBefore))).toBe(0)
      doc.free()
    }
  })
})
