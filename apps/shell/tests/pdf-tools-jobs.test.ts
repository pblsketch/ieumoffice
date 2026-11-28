/**
 * The PDF tools window's add password, remove password and repair, run as
 * structure jobs in-process with the real qpdf and PDFium: what the window
 * sends (tools.ts jobFor) comes back as a file that keeps the tool's promise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'
import { rhwpWasmPath } from '@genoffice/file-parse'
import { loadPdfium } from '../../../packages/pdf-structure/tests/helpers/fixtures'
import { qpdfWasmPath } from '../../pdf/src/main/wasm-path'
import { runStructureJob, type JobDeps } from '../src/main/pdf-structure/jobs'
import {
  errorMessageOf,
  type OcrPdfJobValue,
  type RenderPagesJobValue,
  type RenderThumbsJobValue,
} from '../src/main/pdf-structure/protocol'
import { JPG_QUALITY_BY_PRESET, exportPdfPagesToImages } from '../src/main/pdf-tools/pdf-to-images'
import { checkOptions, inspectPdf, jobBytesOf, jobFor } from '../src/main/pdf-tools/tools'

const deps: JobDeps = {
  pdfium: loadPdfium,
  ocr: () => null,
  now: () => new Date('2026-01-02T03:04:05Z'),
  structuredTextFormatter: null,
  translatedPdfWriter: null,
  qpdfWasmPath: qpdfWasmPath(),
  rhwpWasmPath: rhwpWasmPath(),
}
const noProgress = () => {}

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300])
  return doc.save({ useObjectStreams: false })
}

let dir: string
const write = (name: string, bytes: Uint8Array) => {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

/** run the job the window would send for `tool` with these options, as the window checks them */
async function runTool(
  tool: 'encrypt' | 'decrypt' | 'repair',
  path: string,
  options: Record<string, unknown> = {},
  jobDeps: JobDeps = deps,
): Promise<Uint8Array> {
  const checked = checkOptions(tool, options, 1)
  if (!checked.ok) throw new Error(checked.error)
  const value = await runStructureJob(jobFor(tool, path, checked.options), jobDeps, noProgress)
  const bytes = jobBytesOf(value)
  if (!bytes) throw new Error('no bytes')
  return bytes
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdf-tools-jobs-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('add password and remove password', () => {
  it('locks a PDF and opens it again only with the password', async () => {
    const source = write('a.pdf', await pdf(3))
    const locked = await runTool('encrypt', source, { password: '열려라 참깨' })
    expect(await inspectPdf(locked)).toEqual({ ok: false, problem: 'encrypted' })

    const lockedPath = write('a-locked.pdf', locked)
    const wrong = await runStructureJob(
      jobFor('decrypt', lockedPath, { password: 'nope' }),
      deps,
      noProgress,
    ).catch((err: unknown) => err)
    // the window shows "the password is not correct" for this, and nothing else
    expect(errorMessageOf(wrong).error).toBe('password-required')
    expect(errorMessageOf(wrong).message).not.toContain('nope')

    const open = await runTool('decrypt', lockedPath, { password: '열려라 참깨' })
    expect(await inspectPdf(open)).toEqual({ ok: true, pages: 3 })
  })

  it('sends the permission password only when blocking is asked for', () => {
    expect(jobFor('encrypt', 'x.pdf', { password: 'a', permissionPassword: 'b' })).toEqual({
      op: 'encrypt',
      source: { pdfPath: 'x.pdf' },
      userPassword: 'a',
    })
    expect(
      jobFor('encrypt', 'x.pdf', { password: 'a', restrict: true, permissionPassword: 'b' }),
    ).toEqual({
      op: 'encrypt',
      source: { pdfPath: 'x.pdf' },
      userPassword: 'a',
      ownerPassword: 'b',
    })
  })

  it('is not offered without qpdf', async () => {
    const source = write('a.pdf', await pdf(1))
    const err = await runStructureJob(
      jobFor('encrypt', source, { password: 'a' }),
      { ...deps, qpdfWasmPath: null },
      noProgress,
    ).catch((e: unknown) => e)
    expect(errorMessageOf(err).error).toBe('not-available')
  })
})

describe('repair', () => {
  it('rewrites a PDF whose cross-reference table points at the wrong places', async () => {
    const text = Buffer.from(await pdf(2)).toString('latin1')
    // every offset in the table now points 7 bytes off, and the startxref too
    const broken = text
      .replace(
        /(\d{10}) 00000 n/g,
        (_m, offset: string) => `${String(Number(offset) + 7).padStart(10, '0')} 00000 n`,
      )
      .replace(/startxref\s+(\d+)/, (_m, at: string) => `startxref\n${Number(at) + 7}`)
    expect(broken).not.toBe(text)
    const path = write('broken.pdf', new Uint8Array(Buffer.from(broken, 'latin1')))
    const repaired = await runTool('repair', path)
    expect(await inspectPdf(repaired)).toEqual({ ok: true, pages: 2 })
  })

  it('keeps the whole pages of a file cut short, which PDFium gives up on', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 3; i++) {
      doc.addPage([200, 200]).drawText(`page ${i + 1}`, { x: 20, y: 100, size: 12, font })
    }
    const whole = await doc.save({ useObjectStreams: false })
    // the last page and the cross-reference table are gone, an object is cut off partway,
    // and neither PDFium nor the other tools read what is left
    const cut = whole.slice(0, Math.floor(whole.length * 0.7))
    expect(await inspectPdf(cut)).toEqual({ ok: false, problem: 'unreadable' })
    const path = write('cut.pdf', cut)
    const repaired = await runTool('repair', path)
    expect(await inspectPdf(repaired)).toEqual({ ok: true, pages: 2 })
  })

  it('names a file it cannot read at all', async () => {
    const path = write('junk.pdf', new TextEncoder().encode('%PDF-1.7\nnothing here'))
    const err = await runStructureJob(jobFor('repair', path, {}), deps, noProgress).catch(
      (e: unknown) => e,
    )
    expect(errorMessageOf(err).error).toBe('failed')
  })
})

describe('PDF tools v2 structure jobs', () => {
  async function textPdf(lines: string[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.setTitle('Secret Title')
    doc.setAuthor('Secret Author')
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const line of lines) {
      const page = doc.addPage([400, 500])
      if (line) page.drawText(line, { x: 40, y: 420, size: 16, font })
    }
    return doc.save({ useObjectStreams: false })
  }

  it('optimizes with qpdf linearization and strips metadata', async () => {
    const src = write('meta.pdf', await textPdf(['Hello world', 'Second page']))
    const value = await runStructureJob(
      { op: 'optimize', source: { pdfPath: src }, linearize: true, stripMetadata: true },
      deps,
      noProgress,
    )
    const bytes = jobBytesOf(value)
    expect(bytes).not.toBeNull()
    const head = Buffer.from(bytes!.subarray(0, 1024)).toString('latin1')
    expect(head).toContain('/Linearized')
    const loaded = await PDFDocument.load(bytes!)
    expect(loaded.getTitle()).toBeUndefined()
    expect(loaded.getAuthor()).toBeUndefined()
  })

  it('runs ocrPdf job with injected OCR engine and rejects when no engine is present', async () => {
    const src = write('scan.pdf', await textPdf(['', 'Already text']))
    const noEngineErr = await runStructureJob(
      { op: 'ocrPdf', source: { pdfPath: src }, reocrExisting: false },
      deps,
      noProgress,
    ).catch((e: unknown) => e)
    expect(errorMessageOf(noEngineErr).error).toBe('not-available')

    const mockOcrDeps: JobDeps = {
      ...deps,
      ocr: () => () => ({
        lines: [{ text: 'Scanned Invoice', box: { x0: 0.1, y0: 0.8, x1: 0.5, y1: 0.86 } }],
      }),
    }
    const res = (await runStructureJob(
      { op: 'ocrPdf', source: { pdfPath: src }, reocrExisting: false },
      mockOcrDeps,
      noProgress,
    )) as OcrPdfJobValue
    expect(res.ocredPages).toBe(1)
    expect(res.skippedPages).toBe(1)
    expect(res.bytes.length).toBeGreaterThan(0)
  })

  it('renders chunked thumbnails and DPI pages, and exports PNG/JPG/ZIP/folder with quality presets and cancel', async () => {
    const src = write('five.pdf', await textPdf(['P1', 'P2', 'P3', 'P4', 'P5']))
    const thumbsRes = (await runStructureJob(
      { op: 'renderThumbs', source: { pdfPath: src }, startPage: 2, endPage: 4, longSide: 160 },
      deps,
      noProgress,
    )) as RenderThumbsJobValue
    expect(thumbsRes.pageCount).toBe(5)
    expect(thumbsRes.thumbs.map((t) => t.page)).toEqual([2, 3, 4])
    expect(thumbsRes.thumbs[0]!.widthPt).toBeCloseTo(400, 0)
    expect(thumbsRes.thumbs[0]!.bgra.length).toBe(
      thumbsRes.thumbs[0]!.width * thumbsRes.thumbs[0]!.height * 4,
    )

    // Verify chunked renderPages -> ZIP (JPG quality presets 90/80/65) and folder (PNG)
    const seenChunks: number[][] = []
    const seenQualities: number[] = []
    const zipPath = join(dir, 'five-images.zip')
    const exportedZip = await exportPdfPagesToImages({
      pageNumbers: [1, 3, 5],
      dpi: 300,
      format: 'jpg',
      qualityPreset: 'small',
      outMode: 'zip',
      outPath: zipPath,
      baseName: 'five',
      renderChunk: async (pages, dpi) => {
        seenChunks.push(pages)
        return (await runStructureJob(
          { op: 'renderPages', source: { pdfPath: src }, pages, dpi },
          deps,
          noProgress,
        )) as RenderPagesJobValue
      },
      encodePage: (_bgra, w, h, format, quality) => {
        seenQualities.push(quality)
        return new TextEncoder().encode(`${format}:${w}x${h}:q${quality}`)
      },
    })
    expect(JPG_QUALITY_BY_PRESET).toEqual({ high: 90, medium: 80, small: 65 })
    // 300 DPI uses chunk size 2 -> [1,3], [5]
    expect(seenChunks).toEqual([[1, 3], [5]])
    expect(seenQualities).toEqual([65, 65, 65])
    expect(exportedZip.exportedPages).toBe(3)
    const loadedZip = await JSZip.loadAsync(readFileSync(zipPath))
    expect(Object.keys(loadedZip.files).sort()).toEqual([
      'five-01.jpg',
      'five-03.jpg',
      'five-05.jpg',
    ])

    const folderOut = join(dir, 'pages-folder')
    const exportedFolder = await exportPdfPagesToImages({
      pageNumbers: [2, 4],
      dpi: 150,
      format: 'png',
      qualityPreset: 'high',
      outMode: 'folder',
      outPath: folderOut,
      baseName: 'five',
      renderChunk: async (pages, dpi) =>
        (await runStructureJob(
          { op: 'renderPages', source: { pdfPath: src }, pages, dpi },
          deps,
          noProgress,
        )) as RenderPagesJobValue,
      encodePage: (_bgra, w, h, format, quality) =>
        new TextEncoder().encode(`${format}:${w}x${h}:q${quality}`),
    })
    expect(exportedFolder.writtenPaths).toHaveLength(2)
    expect(existsSync(join(folderOut, 'five-02.png'))).toBe(true)
    expect(existsSync(join(folderOut, 'five-04.png'))).toBe(true)

    // Re-exporting into the same folder avoids overwriting existing files
    const exportedSecond = await exportPdfPagesToImages({
      pageNumbers: [2],
      dpi: 150,
      format: 'png',
      qualityPreset: 'high',
      outMode: 'folder',
      outPath: folderOut,
      baseName: 'five',
      renderChunk: async (pages, dpi) =>
        (await runStructureJob(
          { op: 'renderPages', source: { pdfPath: src }, pages, dpi },
          deps,
          noProgress,
        )) as RenderPagesJobValue,
      encodePage: (_bgra, w, h, format, quality) =>
        new TextEncoder().encode(`${format}:${w}x${h}:q${quality}`),
    })
    expect(exportedSecond.writtenPaths[0]).toBe(join(folderOut, 'five-02 (2).png'))
    expect(existsSync(join(folderOut, 'five-02 (2).png'))).toBe(true)

    // Cancellation mid-chunks stops before second chunk
    const controller = new AbortController()
    let calls = 0
    await expect(
      exportPdfPagesToImages({
        pageNumbers: [1, 2, 3, 4],
        dpi: 300,
        format: 'jpg',
        qualityPreset: 'medium',
        outMode: 'zip',
        outPath: join(dir, 'cancelled.zip'),
        baseName: 'five',
        signal: controller.signal,
        renderChunk: async (pages, dpi) => {
          calls++
          if (calls === 1) controller.abort()
          return (await runStructureJob(
            { op: 'renderPages', source: { pdfPath: src }, pages, dpi },
            deps,
            noProgress,
          )) as RenderPagesJobValue
        },
        encodePage: () => new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  it('converts PDF via convertDoc to docx, xlsx, pptx and hwpx', async () => {
    const src = write('doc.pdf', await textPdf(['Title Line', 'Row 1  Value 100']))
    for (const format of ['docx', 'xlsx', 'pptx', 'hwpx'] as const) {
      const outPath = join(dir, `converted.${format}`)
      const res = await runStructureJob(
        { op: 'convertDoc', source: { pdfPath: src, pages: [1] }, format, outPath },
        deps,
        noProgress,
      )
      expect(res).toMatchObject({ outPath, pages: 1 })
      expect(existsSync(outPath)).toBe(true)
      const bytes = readFileSync(outPath)
      // All four output formats are ZIP containers (PK..)
      expect(bytes[0]).toBe(0x50)
      expect(bytes[1]).toBe(0x4b)
    }

    // Encrypted PDF with source.password can be re-encrypted AND page-range converted via convertDoc
    const lockedRes = (await runStructureJob(
      { op: 'encrypt', source: { pdfPath: src }, userPassword: 'oldpw' },
      deps,
      noProgress,
    )) as { bytes: Uint8Array }
    const lockedPath = write('locked-doc.pdf', lockedRes.bytes)
    const relocked = (await runStructureJob(
      { op: 'encrypt', source: { pdfPath: lockedPath, password: 'oldpw' }, userPassword: 'newpw' },
      deps,
      noProgress,
    )) as { bytes: Uint8Array }
    const relockedPath = write('relocked-doc.pdf', relocked.bytes)
    const decryptedNew = (await runStructureJob(
      { op: 'decrypt', source: { pdfPath: relockedPath }, password: 'newpw' },
      deps,
      noProgress,
    )) as { bytes: Uint8Array }
    expect((await PDFDocument.load(decryptedNew.bytes)).getPageCount()).toBe(2)

    const encDocxPath = join(dir, 'locked-p1.docx')
    const encConvertRes = await runStructureJob(
      {
        op: 'convertDoc',
        source: { pdfPath: lockedPath, password: 'oldpw', pages: [1] },
        format: 'docx',
        outPath: encDocxPath,
      },
      deps,
      noProgress,
    )
    expect(encConvertRes).toMatchObject({ outPath: encDocxPath, pages: 1 })
    expect(existsSync(encDocxPath)).toBe(true)
  })
})
