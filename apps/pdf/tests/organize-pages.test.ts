import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { organizePdfBytes } from '../src/main/organize-pages'
import { renderPageThumbs, renderPdfPagesAtDpi } from '../src/main/page-thumbs'
import type { BlankPagesPdfium } from '../src/main/blank-pages'
import { readPdfText } from '../src/main/read-text'
import { loadPdfium, withDocument } from '../src/main/text-edit'

async function makeLabeledPdf(labels: string[], rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = doc.addPage([400, 600])
    if (rotate) page.setRotation(degrees(rotate))
    page.drawText(label, { x: 40, y: 540, size: 16, font })
  }
  return doc.save({ useObjectStreams: false })
}

describe('organizePdfBytes', () => {
  it('reorders, rotates, duplicates, inserts blank and external PDF pages, and extracts subsets', async () => {
    const pdfA = await makeLabeledPdf(['A1', 'A2', 'A3'], 90)
    const pdfB = await makeLabeledPdf(['B1', 'B2'], 0)
    const snapA = new Uint8Array(pdfA)
    const sources = new Map([
      ['a', pdfA],
      ['b', pdfB],
    ])

    const assembled = await organizePdfBytes(sources, [
      { sourceId: 'a', sourcePageIndex: 2, extraRotation: 90 }, // A3, 90+90=180
      { sourceId: 'blank', sourcePageIndex: 0, extraRotation: 0, widthPt: 500, heightPt: 700 },
      { sourceId: 'b', sourcePageIndex: 1, extraRotation: 270 }, // B2, 270
      { sourceId: 'a', sourcePageIndex: 0, extraRotation: 0 }, // A1, 90
      { sourceId: 'a', sourcePageIndex: 0, extraRotation: 180 }, // A1 duplicated, 90+180=270
    ])
    expect(pdfA).toEqual(snapA)

    const outDoc = await PDFDocument.load(assembled)
    expect(outDoc.getPageCount()).toBe(5)
    expect(outDoc.getPage(0).getRotation().angle).toBe(180)
    expect(outDoc.getPage(1).getWidth()).toBe(500)
    expect(outDoc.getPage(1).getHeight()).toBe(700)
    expect(outDoc.getPage(2).getRotation().angle).toBe(270)
    expect(outDoc.getPage(3).getRotation().angle).toBe(90)
    expect(outDoc.getPage(4).getRotation().angle).toBe(270)

    const text = await readPdfText(assembled)
    expect(text.pages.map((p) => p.text.trim())).toEqual(['A3', '', 'B2', 'A1', 'A1'])

    // Extract selected subset (just B2)
    const subset = await organizePdfBytes(sources, [
      { sourceId: 'b', sourcePageIndex: 1, extraRotation: 0 },
    ])
    const subText = await readPdfText(subset)
    expect(subText.pages.map((p) => p.text.trim())).toEqual(['B2'])
  })

  it('rejects empty plan and out-of-range page index', async () => {
    const pdfA = await makeLabeledPdf(['A1'])
    const sources = new Map([['a', pdfA]])
    await expect(organizePdfBytes(sources, [])).rejects.toThrow('empty-organize')
    await expect(
      organizePdfBytes(sources, [{ sourceId: 'a', sourcePageIndex: 3, extraRotation: 0 }]),
    ).rejects.toThrow()
  })
})

describe('renderPageThumbs & renderPdfPagesAtDpi', () => {
  it('renders requested thumbnail chunks and DPI pages with real PDFium', async () => {
    const pdf = await makeLabeledPdf(['Page 1', 'Page 2', 'Page 3', 'Page 4'])
    const m = (await loadPdfium()) as unknown as BlankPagesPdfium

    await withDocument(m as unknown as Parameters<typeof withDocument>[0], pdf, async (doc) => {
      const thumbs = renderPageThumbs(m, doc, { startPage: 2, endPage: 3, longSide: 200 })
      expect(thumbs.pageCount).toBe(4)
      expect(thumbs.thumbs.map((t) => t.page)).toEqual([2, 3])
      for (const t of thumbs.thumbs) {
        expect(Math.max(t.width, t.height)).toBe(200)
        expect(t.bgra.length).toBe(t.width * t.height * 4)
        expect(Math.round(t.widthPt)).toBe(400)
        expect(Math.round(t.heightPt)).toBe(600)
      }

      const rendered = renderPdfPagesAtDpi(m, doc, { pages: [1, 4], dpi: 150 })
      expect(rendered.pageCount).toBe(4)
      expect(rendered.pages.map((p) => p.page)).toEqual([1, 4])
      for (const p of rendered.pages) {
        expect(p.width).toBe(Math.round((400 * 150) / 72))
        expect(p.height).toBe(Math.round((600 * 150) / 72))
        expect(p.bgra.length).toBe(p.width * p.height * 4)
      }
    })
  })
})
