import { describe, expect, it, vi } from 'vitest'
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib'
import { applyImageEdits, listPageImages, verifyImageEdits } from '../src/main/image-edit'
import { redactPdf } from '../src/main/redaction'
import { applySaveRequest } from '../src/main/save-pdf'
import { analyzeStreamStrokedText } from '../src/main/stroke-ctm'
import { applyTextEdits, applyTextInserts, loadPdfium, withDocument } from '../src/main/text-edit'

vi.mock('electron', () => ({ nativeImage: {} }))

// 2x2 opaque PNG (same fixture as image-edit-form-xobject.test.ts)
const PNG_2X2 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBNBAAAFRNB/8GxGIYAAAAAElFTkSuQmCC'

async function makePdfWithStream(
  streamStr: string,
  opts: {
    extGState?: Record<string, unknown>
    multiStream?: string[]
  } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText(' ', { x: 0, y: 0, size: 1, font })
  const res = page.node.Resources()!
  const fontDict = res.lookup(PDFName.of('Font')) as unknown as { keys(): PDFName[] }
  const fontKey = fontDict.keys()[0]!.asString()
  if (opts.extGState) {
    res.set(PDFName.of('ExtGState'), doc.context.obj(opts.extGState))
  }
  if (opts.multiStream) {
    const refs = opts.multiStream.map((s) =>
      doc.context.register(doc.context.stream(s.replaceAll('/F1', fontKey))),
    )
    page.node.set(PDFName.of('Contents'), doc.context.obj(refs))
  } else {
    const replaced = streamStr.replaceAll('/F1', fontKey)
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(replaced)))
  }
  return doc.save({ useObjectStreams: false })
}

/**
 * Render a sub-rectangle of page 0 at 200 DPI via PDFium and count pixels that
 * differ from the reference render (channel delta > 10). Restricting to the
 * existing text's region isolates untouched form text from newly inserted fills.
 */
async function regionDiffPixels(
  bytesA: Uint8Array,
  bytesB: Uint8Array,
  region?: { x1: number; y1: number; x2: number; y2: number },
  dpi = 200,
): Promise<{ darkA: number; darkB: number; diffPx: number }> {
  const m = await loadPdfium()
  const scale = dpi / 72
  const w = Math.round(595 * scale)
  const h = Math.round(842 * scale)
  const render = (bytes: Uint8Array) =>
    withDocument(m, bytes, async (doc) => {
      const page = m._FPDF_LoadPage(doc, 0)
      const buf = m._malloc(w * h * 4)
      const bmp = m._FPDFBitmap_CreateEx(w, h, 4, buf, w * 4)
      m._FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff)
      m._FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0)
      const copy = new Uint8Array(w * h * 4)
      copy.set(m.HEAPU8.subarray(buf, buf + w * h * 4))
      m._FPDFBitmap_Destroy(bmp)
      m._free(buf)
      m._FPDF_ClosePage(page)
      return copy
    })

  const a = await render(bytesA)
  const b = await render(bytesB)
  const pxLeft = region ? Math.max(0, Math.floor(region.x1 * scale)) : 0
  const pxRight = region ? Math.min(w, Math.ceil(region.x2 * scale)) : w
  // PDF y is bottom-up; bitmap y is top-down
  const pxTop = region ? Math.max(0, Math.floor((842 - region.y2) * scale)) : 0
  const pxBottom = region ? Math.min(h, Math.ceil((842 - region.y1) * scale)) : h

  let darkA = 0
  let darkB = 0
  let diffPx = 0
  for (let y = pxTop; y < pxBottom; y++) {
    for (let x = pxLeft; x < pxRight; x++) {
      const i = (y * w + x) * 4
      if (a[i]! < 240 || a[i + 1]! < 240 || a[i + 2]! < 240) darkA++
      if (b[i]! < 240 || b[i + 1]! < 240 || b[i + 2]! < 240) darkB++
      if (
        Math.abs(a[i]! - b[i]!) > 10 ||
        Math.abs(a[i + 1]! - b[i + 1]!) > 10 ||
        Math.abs(a[i + 2]! - b[i + 2]!) > 10
      ) {
        diffPx++
      }
    }
  }
  return { darkA, darkB, diffPx }
}

/** Region covering the standard sample text around (60, 600) in PDF user space */
const TEXT_BAND = { x1: 40, y1: 560, x2: 320, y2: 660 }

describe('analyzeStreamStrokedText', () => {
  it('tracks nested q/Q, chained cm, w, ExtGState /LW, strings, TJ, and inline images', () => {
    const stream = Buffer.from(
      `
      % comment with 99 w (ignored)
      q
        0.5 0 0 0.5 0 0 cm
        q
          0.24 0 0 0.24 0 0 cm
          /GS1 gs
          BT /F1 100 Tf 2 Tr 1 0 0 1 500 5000 Tm (Escaped \\(paren\\) and \\
continued) Tj ET
          BI /W 1 /H 1 /CS /G /BPC 8 ID X EI
          2.5 w
          BT /F1 100 Tf 2 Tr 1 0 0 1 500 4800 Tm [() -50 <4142>] TJ ET
        Q
        BT /F1 100 Tf 0 Tr 1 0 0 1 100 1000 Tm () Tj (Plain) Tj ET
      Q
      `,
      'latin1',
    )
    const entries = analyzeStreamStrokedText(stream, new Map([['GS1', 3]]))
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      renderMode: 2,
      lineWidth: 3,
      hasGsLw: true,
    })
    expect(entries[0]!.ctmScale).toBeCloseTo(0.12, 5)
    expect(entries[1]).toMatchObject({
      renderMode: 2,
      lineWidth: 2.5,
      hasGsLw: false,
    })
    expect(entries[1]!.ctmScale).toBeCloseTo(0.12, 5)
    expect(entries[2]).toMatchObject({
      renderMode: 0,
      lineWidth: 1,
      hasGsLw: false,
    })
    expect(entries[2]!.ctmScale).toBeCloseTo(0.5, 5)
  })
})

describe('stroked text CTM preservation on save', () => {
  it('keeps existing form content untouched on static form fill (insertImage above text) and preserves stroke on subsequent transform', async () => {
    const origStream =
      'q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg BT /F1 100 Tf 2 Tr 1 0 0 1 500 5000 Tm (Form Header) Tj ET Q'
    const orig = await makePdfWithStream(origStream)

    // 1. Static form fill: inserts transparent PNG above text
    const { bytes: filled } = await applySaveRequest(orig, {
      path: '/tmp/form.pdf',
      markups: [],
      drawings: [],
      formValues: [],
      stamps: [],
      imageEdits: [
        { kind: 'insertImage', pageIndex: 0, rect: [100, 200, 180, 220], image: PNG_2X2 },
      ],
    })
    // Original content stream is wrapped, never rewritten
    const filledDoc = await PDFDocument.load(filled, { updateMetadata: false })
    const contents = filledDoc.getPage(0).node.Contents() as PDFArray
    expect(contents.size()).toBeGreaterThanOrEqual(4)
    const preserved = filledDoc.context.lookup(contents.get(1)) as PDFStream
    const preservedRaw = Buffer.from(
      preserved instanceof PDFRawStream
        ? decodePDFRawStream(preserved).decode()
        : preserved.getContents(),
    ).toString('latin1')
    expect(preservedRaw).toContain('0.12 0 0 0.12 0 0 cm')

    // Inserted image is discoverable and verifiable by PDFium
    const imgs = await listPageImages(filled)
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.rect[0]).toBeCloseTo(100, 1)
    expect(imgs[0]!.rect[2]).toBeCloseTo(180, 1)
    expect(await verifyImageEdits(filled, [{ pageIndex: 0, rect: [100, 200, 180, 220] }])).toEqual(
      [],
    )
    expect((await regionDiffPixels(orig, filled, TEXT_BAND)).diffPx).toBe(0)

    // 2. Moving the saved form fill forces PDFium FPDFPage_GenerateContent — still zero drift!
    const { bytes: moved, skipped } = await applyImageEdits(filled, [
      {
        kind: 'transformImage',
        pageIndex: 0,
        oldRect: [100, 200, 180, 220],
        rect: [120, 240, 200, 260],
      },
    ])
    expect(skipped).toEqual([])
    const diffAfterMove = await regionDiffPixels(orig, moved, TEXT_BAND)
    expect(diffAfterMove.darkA).toBeGreaterThan(500)
    expect(diffAfterMove.diffPx).toBe(0)
  })

  it('preserves stroked text across applyTextInserts for 600 DPI, default 1 w, HWP 0.01 cm, Y-flip, rotated, upscaled, and multi-stream PDFs', async () => {
    const cases: {
      name: string
      stream?: string
      multiStream?: string[]
      region?: typeof TEXT_BAND
    }[] = [
      {
        name: '600dpi_explicit_2w',
        stream:
          'q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg BT /F1 100 Tf 2 Tr 1 0 0 1 500 5000 Tm (Sample Form) Tj ET Q',
      },
      {
        name: '600dpi_default_1w',
        stream:
          'q 0.12 0 0 0.12 0 0 cm 0 0 0 RG 0 0 0 rg BT /F1 100 Tf 2 Tr 1 0 0 1 500 5000 Tm (Sample Form) Tj ET Q',
      },
      {
        name: 'hwp_0.01_20w',
        stream:
          'q 0.01 0 0 0.01 0 0 cm 20 w 0 0 0 RG 0 0 0 rg BT /F1 1200 Tf 2 Tr 1 0 0 1 6000 60000 Tm (Sample Form) Tj ET Q',
      },
      {
        name: 'hwp_yflip_0.1',
        stream:
          'q 1 0 0 1 0 842 cm 0.1 0 0 -0.1 0 0 cm q 1 0 0 -1 600 2420 cm 2 w 0 0 0 RG 0 0 0 rg BT /F1 120 Tf 2 Tr (Sample Form) Tj ET Q Q',
      },
      {
        name: 'rotated_0.12_2Tr',
        stream:
          'q 0 0.12 -0.12 0 150 600 cm 2 w 0 0 0 RG 0 0 0 rg BT /F1 100 Tf 2 Tr 1 0 0 1 0 0 Tm (Sample Form) Tj ET Q',
        region: { x1: 100, y1: 560, x2: 200, y2: 750 },
      },
      {
        name: 'upscaled_2.0_0.5w',
        stream:
          'q 2 0 0 2 0 0 cm 0.5 w 0 0 0 RG 0 0 0 rg BT /F1 6 Tf 2 Tr 1 0 0 1 30 300 Tm (Sample Form) Tj ET Q',
      },
      {
        name: 'ctm_0.12_with_Tm_2.0',
        stream:
          'q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg BT /F1 50 Tf 2 Tr 2 0 0 2 500 5000 Tm (Sample Form) Tj ET Q',
      },
      {
        name: 'ctm_1.0_with_Tm_0.12',
        stream:
          'q 0.24 w 0 0 0 RG 0 0 0 rg BT /F1 100 Tf 2 Tr 0.12 0 0 0.12 60 600 Tm (Sample Form) Tj ET Q',
      },
      {
        name: 'stroke_only_1Tr_and_clip_6Tr',
        stream:
          'q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg BT /F1 100 Tf 1 Tr 1 0 0 1 500 5100 Tm (One) Tj 6 Tr 1 0 0 1 500 4900 Tm (Six) Tj ET Q',
      },
      {
        name: 'multi_stream_ctm',
        multiStream: [
          'q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg',
          'BT /F1 100 Tf 2 Tr 1 0 0 1 500 5000 Tm (Sample Form) Tj ET Q',
        ],
      },
    ]

    for (const c of cases) {
      const orig = await makePdfWithStream(c.stream ?? '', { multiStream: c.multiStream })
      const { bytes: saved1, skipped: skipped1 } = await applyTextInserts(orig, [
        { pageIndex: 0, text: 'Filled 1', origin: [72, 120], fontSize: 12, color: [0, 0, 0] },
      ])
      expect(skipped1, c.name).toEqual([])
      const diff1 = await regionDiffPixels(orig, saved1, c.region ?? TEXT_BAND)
      expect(diff1.darkA, c.name).toBeGreaterThan(200)
      expect(diff1.diffPx, c.name).toBe(0)

      // Repeated save must stay idempotent
      const { bytes: saved2, skipped: skipped2 } = await applyTextInserts(saved1, [
        { pageIndex: 0, text: 'Filled 2', origin: [72, 100], fontSize: 12, color: [0, 0, 0] },
      ])
      expect(skipped2, `${c.name} repeat`).toEqual([])
      const diff2 = await regionDiffPixels(orig, saved2, c.region ?? TEXT_BAND)
      expect(diff2.diffPx, `${c.name} repeat`).toBe(0)
    }
  })

  it('preserves both text and path strokes when /LW comes from ExtGState (including scaled width == 1.0)', async () => {
    for (const [ctm, lw] of [
      [0.12, 2],
      [0.5, 2], // scaled width becomes 1.0, which PDFium omits from explicit `w`
    ] as const) {
      const tf = Math.round(12 / ctm)
      const x = Math.round(60 / ctm)
      const y = Math.round(600 / ctm)
      const lx1 = Math.round(60 / ctm)
      const lx2 = Math.round(260 / ctm)
      const ly = Math.round(570 / ctm)
      const orig = await makePdfWithStream(
        `q ${ctm} 0 0 ${ctm} 0 0 cm /GS1 gs 0 0 0 RG 0 0 0 rg ${lx1} ${ly} m ${lx2} ${ly} l S BT /F1 ${tf} Tf 2 Tr 1 0 0 1 ${x} ${y} Tm (ExtGState Form) Tj ET Q`,
        { extGState: { GS1: { Type: 'ExtGState', LW: lw } } },
      )
      const { bytes: saved, skipped } = await applyTextInserts(orig, [
        { pageIndex: 0, text: 'Added', origin: [72, 120], fontSize: 12, color: [0, 0, 0] },
      ])
      expect(skipped).toEqual([])
      const diff = await regionDiffPixels(orig, saved, { x1: 40, y1: 550, x2: 320, y2: 660 })
      expect(diff.darkA).toBeGreaterThan(500)
      expect(diff.diffPx).toBe(0)
    }
  })

  it('preserves untouched stroked text and authored outline stroke width in applyTextEdits', async () => {
    const orig = await makePdfWithStream(`
      q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg
      BT /F1 100 Tf 2 Tr
      1 0 0 1 500 5000 Tm (Untouched Title) Tj
      ET
      1 0 0 RG 0 0 0 rg
      BT /F1 100 Tf 2 Tr
      1 0 0 1 500 3000 Tm (Edit Target) Tj
      ET Q
    `)
    const { bytes: saved, skipped } = await applyTextEdits(orig, [
      {
        pageIndex: 0,
        rect: [55, 350, 200, 380],
        oldText: 'Edit Target',
        newText: 'Edited Line',
        fontSize: 12,
      },
    ])
    expect(skipped).toEqual([])
    // Untouched stroked text at y=600 stays pixel-identical
    const titleDiff = await regionDiffPixels(orig, saved, TEXT_BAND)
    expect(titleDiff.darkA).toBeGreaterThan(500)
    expect(titleDiff.diffPx).toBe(0)
    // Edited authored-outline run inherited scaled stroke width (0.24 pt), not unscaled 2.0 pt
    const m = await loadPdfium()
    const editedStroke = await withDocument(m, saved, async (doc) => {
      const page = m._FPDF_LoadPage(doc, 0)
      const pW = m._malloc(4)
      let maxW = 0
      try {
        const n = m._FPDFPage_CountObjects(page)
        for (let i = 0; i < n; i++) {
          const obj = m._FPDFPage_GetObject(page, i)
          if (m._FPDFPageObj_GetType(obj) === 1 && m._FPDFPageObj_GetStrokeWidth(obj, pW)) {
            maxW = Math.max(maxW, m.HEAPF32[pW >> 2]!)
          }
        }
      } finally {
        m._free(pW)
        m._FPDF_ClosePage(page)
      }
      return maxW
    })
    expect(editedStroke).toBeCloseTo(0.24, 2)
  })

  it('preserves stroked text inside a dirtied Form XObject when lifting a sibling out', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([595, 842])
    page.drawText(' ', { x: 0, y: 0, size: 1, font })
    const res = page.node.Resources()!
    const fontDict = res.lookup(PDFName.of('Font')) as unknown as { keys(): PDFName[] }
    const fontKey = fontDict.keys()[0]!.asString()
    const fm = doc.context.stream(
      `q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg
       BT ${fontKey} 100 Tf 2 Tr
       1 0 0 1 500 5000 Tm (Sibling Stays) Tj
       1 0 0 1 500 3000 Tm (Lift Target) Tj
       ET Q`,
      {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 595, 842],
        Resources: doc.context.obj({ Font: res.get(PDFName.of('Font')) }),
      },
    )
    res.set(PDFName.of('XObject'), doc.context.obj({ Fm1: doc.context.register(fm) }))
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(doc.context.stream('q 1 0 0 1 0 0 cm /Fm1 Do Q')),
    )
    const orig = await doc.save({ useObjectStreams: false })

    const { bytes: saved, skipped } = await applyTextEdits(orig, [
      {
        pageIndex: 0,
        rect: [55, 350, 200, 380],
        oldText: 'Lift Target',
        newText: 'Lifted OK',
        fontSize: 12,
      },
    ])
    expect(skipped).toEqual([])
    const siblingDiff = await regionDiffPixels(orig, saved, TEXT_BAND)
    expect(siblingDiff.darkA).toBeGreaterThan(500)
    expect(siblingDiff.diffPx).toBe(0)
  })

  it('preserves unredacted stroked text on a redacted page', async () => {
    const orig = await makePdfWithStream(`
      q 0.12 0 0 0.12 0 0 cm 2 w 0 0 0 RG 0 0 0 rg
      BT /F1 100 Tf 2 Tr
      1 0 0 1 500 5000 Tm (Keep Visible) Tj
      1 0 0 1 500 2000 Tm (Secret Text) Tj
      ET Q
    `)
    const redacted = await redactPdf(orig, [{ pageIndex: 0, rect: [50, 220, 200, 265] }])
    const diff = await regionDiffPixels(orig, redacted, TEXT_BAND)
    expect(diff.darkA).toBeGreaterThan(500)
    expect(diff.diffPx).toBe(0)
  })
})
