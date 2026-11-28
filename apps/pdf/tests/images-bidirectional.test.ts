import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  composeRotationWithExif,
  imagesToPdfBytes,
  isSupportedWebImageBytes,
} from '../src/main/images-to-pdf'

/** Minimal valid uncompressed RGB PNG generator for tests */
function makePng(width: number, height: number): Uint8Array {
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf: Uint8Array) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length, false)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false)
    return out
  }
  const ihdr = new Uint8Array(13)
  const idv = new DataView(ihdr.buffer)
  idv.setUint32(0, width, false)
  idv.setUint32(4, height, false)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const stride = 1 + width * 3
  const raw = new Uint8Array(stride * height)
  const idat = new Uint8Array(deflateSync(raw))
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const c1 = chunk('IHDR', ihdr)
  const c2 = chunk('IDAT', idat)
  const c3 = chunk('IEND', new Uint8Array(0))
  const res = new Uint8Array(sig.length + c1.length + c2.length + c3.length)
  let off = 0
  for (const part of [sig, c1, c2, c3]) {
    res.set(part, off)
    off += part.length
  }
  return res
}

describe('images-to-pdf v2', () => {
  it('sniffs JPG, PNG, WebP, BMP, and GIF magic bytes and rejects unknown data', () => {
    expect(isSupportedWebImageBytes(makePng(10, 10))).toBe('png')
    expect(isSupportedWebImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(
      isSupportedWebImageBytes(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('webp')
    const bmp = new Uint8Array(26)
    bmp[0] = 0x42
    bmp[1] = 0x4d
    expect(isSupportedWebImageBytes(bmp)).toBe('bmp')
    expect(isSupportedWebImageBytes(new TextEncoder().encode('GIF89a123456'))).toBe('gif')
    expect(isSupportedWebImageBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })

  it('composes EXIF orientation with 0/90/180/270 clockwise rotations', () => {
    expect(composeRotationWithExif(1, 0)).toBe(1)
    expect(composeRotationWithExif(1, 90)).toBe(6)
    expect(composeRotationWithExif(1, 180)).toBe(3)
    expect(composeRotationWithExif(1, 270)).toBe(8)
    expect(composeRotationWithExif(6, 90)).toBe(3)
    expect(composeRotationWithExif(6, 270)).toBe(1)
  })

  it('honors per-image rotations and explicit portrait/landscape orientation modes', async () => {
    const widePng = makePng(200, 100)
    // Auto mode turns A4 to landscape for wide image; rotating 90 deg makes it tall -> portrait A4
    const autoPdf = await imagesToPdfBytes([widePng, widePng], {
      paper: { w: 595, h: 842 },
      marginPt: 18,
      orientation: 'auto',
      rotations: [0, 90],
    })
    const docAuto = await PDFDocument.load(autoPdf)
    expect(docAuto.getPage(0).getWidth()).toBe(842)
    expect(docAuto.getPage(0).getHeight()).toBe(595)
    expect(docAuto.getPage(1).getWidth()).toBe(595)
    expect(docAuto.getPage(1).getHeight()).toBe(842)

    // Forced portrait keeps A4 portrait even for wide image
    const portraitPdf = await imagesToPdfBytes([widePng], {
      paper: { w: 595, h: 842 },
      marginPt: 18,
      orientation: 'portrait',
    })
    const docPort = await PDFDocument.load(portraitPdf)
    expect(docPort.getPage(0).getWidth()).toBe(595)
    expect(docPort.getPage(0).getHeight()).toBe(842)

    // Forced landscape turns paper landscape even for rotated tall image
    const landPdf = await imagesToPdfBytes([widePng], {
      paper: { w: 595, h: 842 },
      marginPt: 18,
      orientation: 'landscape',
      rotations: [90],
    })
    const docLand = await PDFDocument.load(landPdf)
    expect(docLand.getPage(0).getWidth()).toBe(842)
    expect(docLand.getPage(0).getHeight()).toBe(595)
  })
})
