import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPdfOverlays,
  arrangePrintJob,
  buildStoreZip,
  changesSheetArrangement,
  createDefaultImageExportOptions,
  createDefaultOptions,
  encodeBgrxToJpeg,
  encodeJpeg,
  encodePng,
  hasFaceOverlays,
  isDefaultOptions,
  needsLivePreview,
  numberedImagePaths,
  planSheets,
  runRasterJob,
  validateImageExportOptions,
  validateOptions,
  type PageSize,
  type PrintLayoutOptions,
} from '../src/index'
import { resetPrintLayoutWasmForTests } from '../src/wasm'
import { A3, A4, A5, makeJob, readFaces } from './helpers/pdf'

const MM = 72 / 25.4
const A4_PT: PageSize = { widthPt: 210 * MM, heightPt: 297 * MM }
const A5_PT: PageSize = { widthPt: 148 * MM, heightPt: 210 * MM }

const savedRust = process.env.GENOFFICE_PRINT_LAYOUT_RUST
const tempDirs: string[] = []

afterEach(async () => {
  if (savedRust === undefined) delete process.env.GENOFFICE_PRINT_LAYOUT_RUST
  else process.env.GENOFFICE_PRINT_LAYOUT_RUST = savedRust
  resetPrintLayoutWasmForTests()
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function opts(patch: (o: PrintLayoutOptions) => void): PrintLayoutOptions {
  const o = createDefaultOptions()
  patch(o)
  return o
}

describe('extended print-layout plan options', () => {
  it('supports 4 scaling modes (actual, fit, shrink, custom) and orientation override', () => {
    // A5 on A4: fit scales UP, shrink stays at 100%, custom scales by %
    const fitPlan = planSheets(
      [A5_PT],
      opts((o) => {
        o.paper = 'A4'
        o.scaling = 'fit'
      }),
    )
    expect(fitPlan.output[0]!.cells[0]!.content!.height).toBeCloseTo(A4_PT.heightPt, 1)
    expect(fitPlan.output[0]!.cells[0]!.content!.width).toBeGreaterThan(A5_PT.widthPt)

    const shrinkPlan = planSheets(
      [A5_PT],
      opts((o) => {
        o.paper = 'A4'
        o.scaling = 'shrink'
      }),
    )
    expect(shrinkPlan.output[0]!.cells[0]!.content!.width).toBeCloseTo(A5_PT.widthPt, 1)

    const customPlan = planSheets(
      [A4_PT],
      opts((o) => {
        o.scaling = 'custom'
        o.scalePercent = 50
      }),
    )
    expect(customPlan.output[0]!.cells[0]!.content!.width).toBeCloseTo(A4_PT.widthPt * 0.5, 1)

    // Forced landscape on portrait A4 swaps sheet dimensions
    const landscapePlan = planSheets(
      [A4_PT],
      opts((o) => {
        o.orientation = 'landscape'
      }),
    )
    expect(landscapePlan.output[0]!.width).toBeCloseTo(A4_PT.heightPt, 1)
    expect(landscapePlan.output[0]!.height).toBeCloseTo(A4_PT.widthPt, 1)
  })

  it('emits N-up cellBorders and poster tileLabels when enabled', () => {
    const nup = planSheets(
      [A4_PT, A4_PT, A4_PT],
      opts((o) => {
        o.mode = 'nup'
        o.nup = { count: 4, order: 'row', border: true }
      }),
    )
    expect(nup.output[0]!.cellBorders).toHaveLength(3)

    const poster = planSheets(
      [A4_PT],
      opts((o) => {
        o.mode = 'poster'
        o.poster = { cols: 2, rows: 2, overlapMm: 5, cutMarks: true, tileLabels: true }
      }),
    )
    expect(poster.output.map((f) => f.tileLabel)).toEqual(['(1-1)', '(1-2)', '(2-1)', '(2-2)'])
  })

  it('tracks watermark and headerFooter in isDefaultOptions / hasFaceOverlays / needsLivePreview', () => {
    const emptyWm = opts((o) => {
      o.watermark.kind = 'text'
      o.watermark.text = '   '
    })
    expect(hasFaceOverlays(emptyWm)).toBe(false)
    expect(isDefaultOptions(emptyWm)).toBe(true)

    const activeWm = opts((o) => {
      o.watermark.kind = 'text'
      o.watermark.text = 'CONFIDENTIAL'
    })
    expect(hasFaceOverlays(activeWm)).toBe(true)
    expect(isDefaultOptions(activeWm)).toBe(false)
    expect(changesSheetArrangement(activeWm)).toBe(false)
    expect(needsLivePreview(activeWm)).toBe(true)

    const activeHf = opts((o) => {
      o.headerFooter.enabled = true
    })
    expect(hasFaceOverlays(activeHf)).toBe(true)
    expect(isDefaultOptions(activeHf)).toBe(false)
    expect(needsLivePreview(activeHf)).toBe(true)
  })

  it('validates custom scale range and image export options', () => {
    expect(validateOptions({ scaling: 'custom', scalePercent: 5 }, 1).ok).toBe(false)
    expect(validateOptions({ scaling: 'custom', scalePercent: 500 }, 1).ok).toBe(false)
    expect(validateOptions({ scaling: 'custom', scalePercent: 125 }, 1).ok).toBe(true)

    expect(validateImageExportOptions(undefined)).toEqual({
      ok: true,
      options: createDefaultImageExportOptions(),
    })
    expect(validateImageExportOptions({ format: 'jpg', quality: 80, bundle: 'zip' })).toEqual({
      ok: true,
      options: { format: 'jpg', quality: 80, bundle: 'zip' },
    })
    expect(validateImageExportOptions({ format: 'webp' }).ok).toBe(false)
    expect(validateImageExportOptions({ quality: 55 }).ok).toBe(false)
  })
})

describe('JPEG encoding, STORE ZIP, overlays, and save-images job', () => {
  it('encodes valid JFIF JPEG in both Rust WASM and JS fallback modes', () => {
    const width = 16
    const height = 16
    const stride = width * 4 + 4
    const bgrx = new Uint8Array(stride * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * stride + x * 4
        bgrx[at] = (x * 16) & 0xff
        bgrx[at + 1] = (y * 16) & 0xff
        bgrx[at + 2] = 200
        bgrx[at + 3] = 255
      }
    }
    for (const rust of ['1', '0']) {
      process.env.GENOFFICE_PRINT_LAYOUT_RUST = rust
      resetPrintLayoutWasmForTests()
      for (const gray of [false, true]) {
        const jpg = encodeBgrxToJpeg(bgrx, stride, width, height, gray, 80)
        expect(jpg[0]).toBe(0xff)
        expect(jpg[1]).toBe(0xd8)
        expect(jpg[jpg.length - 2]).toBe(0xff)
        expect(jpg[jpg.length - 1]).toBe(0xd9)
      }
    }
    const direct = encodeJpeg(new Uint8Array(4 * 4 * 3).fill(128), 4, 4, 3, 90)
    expect(direct[0]).toBe(0xff)
    expect(direct[1]).toBe(0xd8)
  })

  it('builds a valid UTF-8 STORE ZIP archive', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([5, 6, 7, 8, 9])
    const zip = buildStoreZip([
      { name: '보고서-01.png', data: a },
      { name: '보고서-02.jpg', data: b },
    ])
    // Local file header signature + End of Central Directory signature
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
    expect(zip[2]).toBe(0x03)
    expect(zip[3]).toBe(0x04)
    expect(zip[zip.length - 22]).toBe(0x50)
    expect(zip[zip.length - 21]).toBe(0x4b)
    expect(zip[zip.length - 20]).toBe(0x05)
    expect(zip[zip.length - 19]).toBe(0x06)
  })

  it('stamps PNG overlays onto arranged PDFs in both Rust WASM and JS fallback', async () => {
    const job = await makeJob([
      { ...A4, label: 'P1' },
      { ...A3, rotate: 90, label: 'P2' },
    ])
    const stampPng = encodePng(new Uint8Array(4 * 4 * 3).fill(180), 4, 4, 3)
    const bundle = {
      stamps: [stampPng],
      perFace: [
        [{ stampIndex: 0, x: 20, y: 20, width: 100, height: 100, opacity: 0.25 }],
        [{ stampIndex: 0, x: 20, y: 20, width: 100, height: 100, opacity: 0.25 }],
      ],
    }
    for (const rust of ['1', '0']) {
      process.env.GENOFFICE_PRINT_LAYOUT_RUST = rust
      resetPrintLayoutWasmForTests()
      const stamped = await applyPdfOverlays(job, bundle)
      const faces = await readFaces(stamped)
      expect(faces).toHaveLength(2)
      expect(faces[0]!.texts.some((t) => t.str === 'P1')).toBe(true)
      expect(faces[1]!.texts.some((t) => t.str === 'P2')).toBe(true)
    }
  })

  it('renders arranged PDFs with borders/tileLabels and supports on-demand preview + save-images (files & zip)', async () => {
    const job = await makeJob([
      { ...A5, label: 'P1' },
      { ...A5, label: 'P2' },
      { ...A5, label: 'P3' },
    ])
    const arranged = await arrangePrintJob(
      job,
      opts((o) => {
        o.mode = 'poster'
        o.poster = { cols: 2, rows: 1, overlapMm: 0, cutMarks: false, tileLabels: true }
      }),
    )
    const posterFaces = await readFaces(arranged)
    expect(posterFaces).toHaveLength(6)
    expect(posterFaces[0]!.texts.some((t) => t.str.includes('(1-1)'))).toBe(true)

    // On-demand arrange + preview-arranged for a single face index
    const arrangedRes = await runRasterJob({
      kind: 'arrange',
      jobPdf: job,
      options: createDefaultOptions(),
    })
    expect(arrangedRes.kind).toBe('arrange')
    if (arrangedRes.kind !== 'arrange') return
    expect(arrangedRes.faceSizes).toHaveLength(3)

    const previewOne = await runRasterJob({
      kind: 'preview-arranged',
      arrangedPdf: arrangedRes.pdf,
      dpi: 'auto',
      grayscale: false,
      longSidePx: 200,
      faceIndices: [1],
    })
    expect(previewOne.kind).toBe('preview-arranged')
    if (previewOne.kind !== 'preview-arranged') return
    expect(previewOne.totalFaces).toBe(3)
    expect(previewOne.faces).toHaveLength(1)
    expect(previewOne.faces[0]!.index).toBe(1)

    // save-images as numbered JPGs and as PNG ZIP
    const dir = await mkdtemp(join(tmpdir(), 'ieum-print-save-images-'))
    tempDirs.push(dir)

    const jpgRes = await runRasterJob({
      kind: 'save-images',
      jobPdf: job,
      options: opts((o) => (o.dpi = 150)),
      format: 'jpg',
      quality: 80,
      bundle: 'files',
      outPath: join(dir, 'doc.jpg'),
    })
    expect(jpgRes.kind).toBe('save-images')
    if (jpgRes.kind !== 'save-images') return
    expect(jpgRes.paths).toEqual(numberedImagePaths(join(dir, 'doc.jpg'), 3))
    const firstJpg = await readFile(jpgRes.paths[0]!)
    expect(firstJpg[0]).toBe(0xff)
    expect(firstJpg[1]).toBe(0xd8)

    const zipRes = await runRasterJob({
      kind: 'save-images',
      jobPdf: job,
      options: opts((o) => (o.dpi = 150)),
      format: 'png',
      quality: 90,
      bundle: 'zip',
      outPath: join(dir, 'doc.zip'),
    })
    expect(zipRes.kind).toBe('save-images')
    if (zipRes.kind !== 'save-images') return
    expect(zipRes.paths).toEqual([join(dir, 'doc.zip')])
    const zipBytes = await readFile(zipRes.paths[0]!)
    expect(zipBytes[0]).toBe(0x50)
    expect(zipBytes[1]).toBe(0x4b)
  })
})
