import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from 'pdf-lib'
import {
  auditPdfSpace,
  bgraToGrayscaleInPlace,
  compressPdfV2Bytes,
  deduplicateImages,
  type ImageRecoder,
} from '../src/main/compress'
import { optimizePdfBytes } from '../src/main/qpdf'
import { qpdfWasmPath } from '../src/main/wasm-path'
import { readPdfText } from '../src/main/read-text'

/** Build a synthetic PDF with an embedded raw RGB Flate image repeated `repeats` times as distinct XObjects */
async function makePdfWithRepeatedImage(
  repeats: number,
  width = 200,
  height = 200,
  text = 'Hello Compress v2',
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  // Build deterministic high-entropy pixels so Flate stream exceeds MIN_STREAM_BYTES (48 KB)
  const raw = new Uint8Array(width * height * 3)
  let seed = 0x12345678
  for (let i = 0; i < raw.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    raw[i] = (seed >>> 24) & 0xff
  }
  // Low zlib level so Flate level-9 can also shrink it
  const flateData = new Uint8Array(deflateSync(raw, { level: 1 }))

  for (let p = 0; p < repeats; p++) {
    const page = doc.addPage([595, 842])
    page.drawText(`${text} page ${p + 1}`, { x: 40, y: 780, size: 12, font })
    const imgDict = doc.context.obj({
      Type: 'XObject',
      Subtype: 'Image',
      Width: width,
      Height: height,
      BitsPerComponent: 8,
      ColorSpace: 'DeviceRGB',
      Filter: 'FlateDecode',
      Length: flateData.length,
    })
    const imgRef = doc.context.register(PDFRawStream.of(imgDict, flateData))
    const name = page.node.newXObject('Image', imgRef)
    void name
  }
  doc.setTitle('Secret Title')
  doc.setAuthor('Secret Author')
  doc.setSubject('Secret Subject')
  return doc.save({ useObjectStreams: false })
}

/** Deterministic fake recoder producing smaller JPEG-like payloads proportional to quality/longSide */
const fakeRecoder: ImageRecoder = async (source, target) => {
  const scale = Math.min(1, target.longSide / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  // Size scales smoothly with quality and resolution so binary search can converge
  const factor = target.grayscale ? 0.55 : 1
  const outSize = Math.max(1200, Math.round(w * h * (target.quality / 100) * 0.25 * factor))
  const jpeg = new Uint8Array(outSize)
  jpeg[0] = 0xff
  jpeg[1] = 0xd8
  jpeg[outSize - 2] = 0xff
  jpeg[outSize - 1] = 0xd9
  return { jpeg, width: w, height: h, grayscale: target.grayscale === true }
}

describe('compress v2', () => {
  it('audits space and detects duplicate image savings without mutating source bytes', async () => {
    const pdf = await makePdfWithRepeatedImage(5, 220, 220)
    const snapshot = new Uint8Array(pdf)
    const audit = await auditPdfSpace(pdf)
    expect(pdf).toEqual(snapshot)
    expect(audit.totalBytes).toBe(pdf.length)
    expect(audit.imagesBytes).toBeGreaterThan(48 * 1024)
    expect(audit.duplicateImageCount).toBe(4)
    expect(audit.duplicateImageSavableBytes).toBeGreaterThan(0)
    expect(
      audit.imagesBytes + audit.fontsBytes + audit.contentBytes + audit.otherBytes,
    ).toBeGreaterThanOrEqual(audit.totalBytes)
  })

  it('deduplicates 5 identical images into one shared XObject and shrinks file size in lossless mode', async () => {
    const pdf = await makePdfWithRepeatedImage(5, 220, 220)
    const doc = await PDFDocument.load(pdf, { updateMetadata: false })
    const dedup = deduplicateImages(doc)
    expect(dedup.removed).toBe(4)
    expect(dedup.savedBytes).toBeGreaterThan(0)

    let recoderCalls = 0
    const res = await compressPdfV2Bytes(
      pdf,
      { mode: 'lossless', stripMetadata: true },
      async () => {
        recoderCalls++
        return null
      },
    )
    expect(recoderCalls).toBe(0)
    expect(res.deduped).toBe(4)
    expect(res.targetMet).toBe(true)
    expect(res.bytes.length).toBeLessThan(pdf.length * 0.5)

    // Metadata stripped
    const outDoc = await PDFDocument.load(res.bytes, { updateMetadata: false })
    expect(outDoc.getTitle()).toBeUndefined()
    expect(outDoc.getAuthor()).toBeUndefined()
    expect(outDoc.getPageCount()).toBe(5)
  })

  it('recompresses low-level FlateDecode non-image streams at level 9', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const payload = new Uint8Array(60_000)
    for (let i = 0; i < payload.length; i++) payload[i] = (i % 13) + 65
    const weakFlate = new Uint8Array(deflateSync(payload, { level: 1 }))
    const dict = doc.context.obj({ Filter: 'FlateDecode', Length: weakFlate.length })
    const ref = doc.context.register(PDFRawStream.of(dict, weakFlate))
    doc.catalog.set(PDFName.of('CustomData'), ref)
    const bytes = await doc.save({ useObjectStreams: false })

    const res = await compressPdfV2Bytes(bytes, { mode: 'lossless' }, fakeRecoder)
    expect(res.flateRecompressed).toBeGreaterThanOrEqual(1)
    expect(res.bytes.length).toBeLessThan(bytes.length)
  })

  it('converts images to grayscale while keeping text 100% searchable', async () => {
    const pdf = await makePdfWithRepeatedImage(1, 260, 260, 'Searchable Keep Text')
    const res = await compressPdfV2Bytes(
      pdf,
      { mode: 'medium', grayscaleImages: true },
      fakeRecoder,
    )
    expect(res.recoded).toBe(1)
    const outDoc = await PDFDocument.load(res.bytes, { updateMetadata: false })
    let sawGrayImage = false
    for (const [, obj] of outDoc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        const sub = obj.dict.lookup(PDFName.of('Subtype'))
        if (sub instanceof PDFName && sub.decodeText() === 'Image') {
          const cs = obj.dict.lookup(PDFName.of('ColorSpace'))
          if (cs instanceof PDFName && cs.decodeText() === 'DeviceGray') sawGrayImage = true
        }
      }
    }
    expect(sawGrayImage).toBe(true)
    const text = await readPdfText(res.bytes)
    expect(text.pages[0]?.text).toContain('Searchable Keep Text')
  })

  it('binary-searches target size and reports targetMet=false with smallest bytes when unreachable', async () => {
    const pdf = await makePdfWithRepeatedImage(1, 400, 400)
    // Achievable target
    const hit = await compressPdfV2Bytes(pdf, { mode: 'target', targetBytes: 25_000 }, fakeRecoder)
    expect(hit.targetMet).toBe(true)
    expect(hit.bytes.length).toBeLessThanOrEqual(25_000)

    // Unreachable tiny target (500 bytes): returns smallest achieved with targetMet=false
    const miss = await compressPdfV2Bytes(pdf, { mode: 'target', targetBytes: 500 }, fakeRecoder)
    expect(miss.targetMet).toBe(false)
    expect(miss.bytes.length).toBeLessThan(pdf.length)
  })

  it('converts BGRA pixels to Rec.601 luminance in place', () => {
    const px = new Uint8Array([0, 0, 255, 255]) // pure red in BGRA
    bgraToGrayscaleInPlace(px)
    const expected = Math.round(0.299 * 255)
    expect(px[0]).toBe(expected)
    expect(px[1]).toBe(expected)
    expect(px[2]).toBe(expected)
    expect(px[3]).toBe(255)
  })

  it('optimizes and linearizes a PDF via qpdf WASM', async () => {
    const pdf = await makePdfWithRepeatedImage(2, 200, 200)
    const optimized = await optimizePdfBytes(qpdfWasmPath(), pdf, { linearize: true })
    expect(optimized.length).toBeGreaterThan(0)
    const head = new TextDecoder('latin1').decode(optimized.subarray(0, 1024))
    expect(head).toContain('/Linearized')
    const outDoc = await PDFDocument.load(optimized, { updateMetadata: false })
    expect(outDoc.getPageCount()).toBe(2)
    // Ensure Page size numbers still valid
    const n = outDoc.getPage(0).node.get(PDFName.of('MediaBox'))
    expect(n).toBeDefined()
    void PDFNumber
  })
})
