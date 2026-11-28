import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx } from '@genoffice/docx-engine'
import { convertLegacyDocToDocx, openLegacyDoc, parseFloatingPictures } from '../src/index'
import { buildSyntheticDoc, type SyntheticBlip } from './helpers/synthetic-doc'

function minimalPng(): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = new Uint8Array(8 + 13 + 4)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, 13, false)
  ihdr.set([0x49, 0x48, 0x44, 0x52], 4)
  ihdrView.setUint32(8, 1, false)
  ihdrView.setUint32(12, 1, false)
  const iend = Uint8Array.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  const out = new Uint8Array(signature.length + ihdr.length + iend.length)
  out.set(signature, 0)
  out.set(ihdr, signature.length)
  out.set(iend, signature.length + ihdr.length)
  return out
}

function utf16z(text: string): Uint8Array {
  const out = new Uint8Array((text.length + 1) * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true)
  return out
}

const PNG: SyntheticBlip = { kind: 'png', bytes: minimalPng() }

describe('legacy .doc watermarks, picture effects, alignment, and opacity', () => {
  it('preserves header picture watermark washout, centering, rotation, and behind-text through parseDocx', async () => {
    const bytes = buildSyntheticDoc({
      pieces: [{ text: 'Body paragraph\r' }],
      headerStories: [undefined, '\u0008', undefined, undefined, undefined, undefined],
      floatingShapes: [
        {
          story: 'header',
          cp: 0,
          rect: [0, 0, 4320, 4320],
          bx: 0,
          by: 0,
          wr: 3,
          belowText: true,
          blip: PNG,
          props: [
            // OPT_ROTATION: 315 deg in 16.16 fixed point
            [0x0004, (315 * 65536) >>> 0],
            // OPT_PICTURE_CONTRAST: 0.30 (0x4ccd) -> lum contrast = -0.70
            [0x0108, 0x4ccd],
            // OPT_PICTURE_BRIGHTNESS: +0.35 (0x5999) -> lum bright = +0.70
            [0x0109, 0x5999],
            // OPT_POS_H = 2 (center), OPT_POS_REL_H = 0 (margin)
            [0x038f, 2],
            [0x0390, 0],
            // OPT_POS_V = 2 (center), OPT_POS_REL_V = 0 (margin)
            [0x0391, 2],
            [0x0392, 0],
          ],
        },
      ],
    })

    const doc = openLegacyDoc(bytes)
    const parsed = parseFloatingPictures(doc)
    expect(parsed.header).toHaveLength(1)
    expect(parsed.header[0]).toMatchObject({
      kind: 'picture',
      behindText: true,
      horizontalAlign: 'center',
      verticalAlign: 'center',
      rotationDeg: 315,
    })

    const converted = await convertLegacyDocToDocx(bytes)
    const zip = await JSZip.loadAsync(converted.docx)
    const hdrXml = await zip.file('word/header1.xml')?.async('string')
    expect(hdrXml).toContain('<wp:align>center</wp:align>')
    expect(hdrXml).toContain('<a:lum')
    expect(hdrXml).toContain('rot="18900000"')

    const docx = await parseDocx(converted.docx)
    const img = docx.headerImages?.[0]
    expect(img).toBeDefined()
    expect(img?.floating).toBe(true)
    expect(img?.behind).toBe(true)
    expect(img?.posH).toBe('center')
    expect(img?.posV).toBe('center')
    expect(img?.rotationDeg).toBe(315)
    expect(img?.effects?.bright).toBeCloseTo(0.7, 2)
    expect(img?.effects?.contrast).toBeCloseTo(-0.7, 2)
  })

  it('converts legacy header WordArt text watermarks with opacity and diagonal rotation', async () => {
    const bytes = buildSyntheticDoc({
      pieces: [{ text: 'Body paragraph\r' }],
      headerStories: [undefined, '\u0008', undefined, undefined, undefined, undefined],
      floatingShapes: [
        {
          story: 'header',
          cp: 0,
          rect: [0, 0, 7200, 1800],
          bx: 0,
          by: 0,
          wr: 3,
          belowText: true,
          props: [
            [0x0004, (315 * 65536) >>> 0],
            // OPT_FILL_COLOR = RGB(0xc0, 0xc0, 0xc0)
            [0x0181, 0x00c0c0c0],
            // OPT_FILL_OPACITY = 0.5 (0x8000 / 0x10000)
            [0x0182, 0x8000],
            [0x038f, 2],
            [0x0390, 0],
            [0x0391, 2],
            [0x0392, 0],
          ],
          complexProps: [
            [0x00c0, utf16z('대외비')],
            [0x00c5, utf16z('Malgun Gothic')],
          ],
        },
      ],
    })

    const converted = await convertLegacyDocToDocx(bytes)
    const docx = await parseDocx(converted.docx)
    expect(docx.watermarkText).toBe('대외비')
    const img = docx.headerImages?.find((h) => h.wordArt)
    expect(img).toBeDefined()
    expect(img?.posH).toBe('center')
    expect(img?.posV).toBe('center')
    expect(img?.rotationDeg).toBe(315)
    expect(img?.behind).toBe(true)
    expect(img?.wordArt?.text).toBe('대외비')
    expect(img?.wordArt?.opacity).toBeCloseTo(0.5, 2)
    expect(img?.wordArt?.colorHex).toBe('C0C0C0')
    expect(img?.wordArt?.fontFamily).toBe('Malgun Gothic')
  })

  it('emits fill alpha for semi-transparent floating text boxes', async () => {
    const bytes = buildSyntheticDoc({
      pieces: [{ text: '\u0008Body paragraph\r' }],
      floatingShapes: [
        {
          story: 'body',
          cp: 0,
          spid: 2048,
          rect: [720, 720, 4320, 2160],
          bx: 0,
          by: 0,
          wr: 3,
          belowText: true,
          props: [
            // OPT_FILL_COLOR = RGB(0xff, 0x00, 0x00)
            [0x0181, 0x000000ff],
            // OPT_FILL_OPACITY = 0.5
            [0x0182, 0x8000],
          ],
        },
      ],
      textBoxStories: [{ story: 'body', spid: 2048, text: 'Overlay note' }],
    })

    const converted = await convertLegacyDocToDocx(bytes)
    const zip = await JSZip.loadAsync(converted.docx)
    const docXml = await zip.file('word/document.xml')?.async('string')
    expect(docXml).toContain('<a:alpha val="50000"/>')
  })
})
