import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { OcrEngine } from '../../../packages/pdf2docx/src/ocr'
import { buildOcrBakeInserts, ocrLinesToWords } from '../src/shared/ocr-bake'
import { hasOcrEngineHelper, ocrPdfBytes } from '../src/main/ocr-pdf'
import { readPdfText } from '../src/main/read-text'

async function makeMixedScanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  // Page 1: has existing text layer
  const p1 = doc.addPage([595, 842])
  p1.drawText('Existing Layer Page One', { x: 50, y: 760, size: 14, font })
  // Page 2: pure drawing (scanned-like, no text layer)
  const p2 = doc.addPage([595, 842])
  p2.drawRectangle({ x: 60, y: 700, width: 200, height: 30, color: rgb(0.2, 0.2, 0.2) })
  // Page 3: rotated 90 deg, no text layer
  const p3 = doc.addPage([595, 842])
  p3.setRotation(degrees(90))
  p3.drawRectangle({ x: 80, y: 400, width: 150, height: 24, color: rgb(0.3, 0.3, 0.3) })
  return doc.save({ useObjectStreams: false })
}

describe('shared ocr-bake & ocrPdfBytes', () => {
  it('maps normalized OCR lines across 0/90/180/270 rotations without DOM', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const geom = { pw: 595, ph: 842, rot }
      const words = ocrLinesToWords(
        [
          {
            text: 'Recognized Line',
            box: { x0: 0.1, y0: 0.8, x1: 0.5, y1: 0.86 },
            confidence: 0.95,
          },
        ],
        geom,
      )
      expect(words).toHaveLength(1)
      const inserts = buildOcrBakeInserts(0, words, geom)
      expect(inserts).toHaveLength(1)
      expect(inserts[0]!.invisible).toBe(true)
      expect(inserts[0]!.rotate).toBe(rot)
      expect(inserts[0]!.text).toBe('Recognized Line')
    }
  })

  it('skips pages with visible text by default, bakes searchable invisible text on scan pages, and supports reocrExisting', async () => {
    const pdf = await makeMixedScanPdf()
    let calls = 0
    const mockOcr: OcrEngine = () => {
      calls++
      return {
        lines: [
          {
            text: `ScannedTextCall${calls}`,
            confidence: 0.92,
            box: { x0: 0.1, y0: 0.82, x1: 0.6, y1: 0.88 },
          },
        ],
      }
    }

    const res = await ocrPdfBytes(pdf, mockOcr, { reocrExisting: false })
    expect(res.skippedPages).toBe(1)
    expect(res.ocredPages).toBe(2)
    expect(calls).toBe(2)

    const extracted = await readPdfText(res.bytes)
    expect(extracted.pages[0]?.text).toContain('Existing Layer Page One')
    expect(extracted.pages[1]?.text).toContain('ScannedTextCall1')
    expect(extracted.pages[2]?.text).toContain('ScannedTextCall2')

    // Re-OCR mode runs on all 3 pages including page 1
    calls = 0
    const forced = await ocrPdfBytes(pdf, mockOcr, { reocrExisting: true })
    expect(forced.skippedPages).toBe(0)
    expect(forced.ocredPages).toBe(3)
    expect(calls).toBe(3)
  })

  it('returns ocredPages=0 without rewriting when OCR detects nothing, and checks helper availability', async () => {
    const pdf = await makeMixedScanPdf()
    const emptyOcr: OcrEngine = () => ({ lines: [] })
    const res = await ocrPdfBytes(pdf, emptyOcr)
    expect(res.ocredPages).toBe(0)
    expect(res.bytes).toBe(pdf)
    expect(hasOcrEngineHelper(['Z:/nonexistent-ocr-binary-12345.exe'])).toBe(false)
  })
})
