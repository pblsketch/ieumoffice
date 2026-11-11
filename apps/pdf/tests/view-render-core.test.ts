// @vitest-environment node
import { readFileSync, openSync, closeSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { init } from '@embedpdf/pdfium'
import { pdfiumWasmPath } from '../src/main/wasm-path'
import { PdfiumViewDocument, type ViewPdfium } from '../src/main/view-render-core'

let m: ViewPdfium
beforeAll(async () => {
  const wrapped = await init({
    wasmBinary: readFileSync(pdfiumWasmPath()),
    thisProgram: 'genoffice-view-test',
  })
  const raw = wrapped.pdfium as unknown as ViewPdfium & { _PDFiumExt_Init(): void }
  raw._PDFiumExt_Init()
  m = raw
})

async function withFile(bytes: Uint8Array, use: (fd: number) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-view-core-test-'))
  const path = join(dir, 'sample.pdf')
  await writeFile(path, bytes)
  const fd = openSync(path, 'r')
  try {
    use(fd)
  } finally {
    closeSync(fd)
    await rm(dir, { recursive: true, force: true })
  }
}
function pixel(rgba: Uint8Array, width: number, x: number, y: number) {
  return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
}

describe('file-backed PDFium page bitmaps', () => {
  it('shares one native page within a tile batch and releases it on page change or idle', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([200, 200])
    pdf.addPage([200, 200])
    const bytes = await pdf.save()
    const load = vi.spyOn(m, '_FPDF_LoadPage')
    const close = vi.spyOn(m, '_FPDF_ClosePage')
    try {
      await withFile(bytes, (fd) => {
        const doc = new PdfiumViewDocument(m, fd, bytes.length)
        const tile = { x: 0, y: 0, width: 100, height: 100 }
        try {
          doc.render(1, 400, 400, 0, false, tile)
          doc.render(1, 400, 400, 0, false, { ...tile, x: 100 })
          expect(load).toHaveBeenCalledTimes(1)
          doc.render(2, 400, 400, 0, false, tile)
          expect(load).toHaveBeenCalledTimes(2)
          expect(close).toHaveBeenCalledTimes(1)
          doc.releaseRasterPage()
          expect(close).toHaveBeenCalledTimes(2)
        } finally {
          doc.close()
        }
      })
    } finally {
      load.mockRestore()
      close.mockRestore()
    }
  })
  it.each([0, 1, 2, 3])(
    'renders clipped tiles with the same pixels at rotation %i',
    async (rotation) => {
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([200, 160])
      page.drawRectangle({ x: 19, y: 23, width: 120, height: 83, color: rgb(1, 0, 0.2) })
      page.drawLine({ start: { x: 0, y: 0 }, end: { x: 180, y: 160 }, thickness: 3 })
      const bytes = await pdf.save()
      await withFile(bytes, (fd) => {
        const doc = new PdfiumViewDocument(m, fd, bytes.length)
        try {
          const full = doc.render(1, 400, 320, rotation)
          const clip = { x: 51, y: 49, width: 137, height: 155 }
          const tile = doc.render(1, 400, 320, rotation, false, clip)
          const expected = new Uint8Array(clip.width * clip.height * 4)
          for (let y = 0; y < clip.height; y++)
            expected.set(
              full.rgba.subarray(
                ((clip.y + y) * full.width + clip.x) * 4,
                ((clip.y + y) * full.width + clip.x + clip.width) * 4,
              ),
              y * clip.width * 4,
            )
          // Translated PDFium clips can round antialias coverage by two color levels.
          let maxChannelError = 0
          let totalChannelError = 0
          for (let i = 0; i < expected.length; i++) {
            const error = Math.abs(tile.rgba[i]! - expected[i]!)
            maxChannelError = Math.max(maxChannelError, error)
            totalChannelError += error
          }
          expect(maxChannelError).toBeLessThanOrEqual(2)
          expect(totalChannelError / expected.length).toBeLessThan(0.05)
          expect(() =>
            doc.render(1, 400, 320, 0, false, { x: 399, y: 0, width: 2, height: 20 }),
          ).toThrow('invalid')
        } finally {
          doc.close()
        }
      })
    },
  )
  it.each([0, 90])(
    'preserves embedded rotation %i plus user rotation and RGBA color order',
    async (rotation) => {
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([200, 100])
      page.drawRectangle({ x: 0, y: 0, width: 100, height: 50, color: rgb(1, 0, 0) })
      page.drawRectangle({ x: 0, y: 50, width: 100, height: 50, color: rgb(0, 0, 1) })
      page.setRotation(degrees(rotation))
      const bytes = await pdf.save()
      await withFile(bytes, (fd) => {
        const doc = new PdfiumViewDocument(m, fd, bytes.length)
        try {
          const width = rotation ? 100 : 200,
            height = rotation ? 200 : 100
          const bitmap = doc.render(1, width, height, 0)
          expect(pixel(bitmap.rgba, width, 20, 20)).toEqual(
            rotation ? [255, 0, 0, 255] : [0, 0, 255, 255],
          )
          const turned = doc.render(1, height, width, 1)
          expect(pixel(turned.rgba, height, 20, 20)).toEqual(
            rotation ? [255, 255, 255, 255] : [255, 0, 0, 255],
          )
        } finally {
          doc.close()
          doc.close()
        }
      })
    },
  )

  it('leaves filled widgets out of the bitmap while retaining the static page', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([200, 200])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawRectangle({ x: 0, y: 0, width: 15, height: 15, color: rgb(1, 0, 0) })
    const field = pdf.getForm().createTextField('field')
    field.setText('VISIBLE WIDGET VALUE')
    field.addToPage(page, { x: 20, y: 60, width: 160, height: 60, font })
    const bytes = await pdf.save()
    await withFile(bytes, (fd) => {
      const doc = new PdfiumViewDocument(m, fd, bytes.length)
      try {
        const { rgba } = doc.render(1, 200, 200, 0)
        expect(pixel(rgba, 200, 5, 190)).toEqual([255, 0, 0, 255])
        for (let y = 85; y < 135; y++)
          for (let x = 25; x < 175; x++)
            expect(pixel(rgba, 200, x, y)).toEqual([255, 255, 255, 255])
        const thumbnail = doc.render(1, 200, 200, 0, true)
        let dark = 0
        for (let y = 85; y < 135; y++)
          for (let x = 25; x < 175; x++) if (pixel(thumbnail.rgba, 200, x, y)[0]! < 128) dark++
        expect(dark).toBeGreaterThan(20)
      } finally {
        doc.close()
      }
    })
  })

  it.each([
    [0, 100, 0],
    [100, 100, 4],
    [48000001, 1, 0],
    [100.5, 100, 0],
  ])('rejects invalid geometry %j', async (width, height, rotation) => {
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 100])
    const bytes = await pdf.save()
    await withFile(bytes, (fd) => {
      const doc = new PdfiumViewDocument(m, fd, bytes.length)
      try {
        expect(() => doc.render(1, width!, height!, rotation!)).toThrow('invalid')
      } finally {
        doc.close()
      }
    })
  })
})
