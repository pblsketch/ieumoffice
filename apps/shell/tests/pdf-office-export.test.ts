/**
 * Parity and runner-integration tests for routing PDF -> Word/PowerPoint/Excel
 * exports through the pdf-structure utility-process runner (`convertDoc` job)
 * instead of running PDFium + sync OCR inside the shell main process.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  convertPdfToDocx,
  convertPdfToPptx,
  convertPdfToXlsx,
  PdfLoadError,
  type OcrEngine,
} from '../../../packages/pdf2docx/src'
import { loadPdfium } from '../../../packages/pdf-structure/tests/helpers/fixtures'
import { convertPdfFileViaJobWithPrompt } from '../src/main/pdf2docx-local'
import { runStructureJob, type JobDeps } from '../src/main/pdf-structure/jobs'
import {
  errorMessageOf,
  type ConvertDocJobValue,
  type ProcessSetup,
  type RunMessage,
  type StructureJob,
} from '../src/main/pdf-structure/protocol'
import { StructureJobRunner, type JobProcess } from '../src/main/pdf-structure/runner'

const FIXTURE_PASSWORD = fileURLToPath(
  new URL('./fixtures/testPassword4Spaces.pdf', import.meta.url),
)
const FIXTURE_CERT = fileURLToPath(new URL('./fixtures/certEncrypted.pdf', import.meta.url))
const FIXTURE_CORRUPT = fileURLToPath(new URL('./fixtures/corruptExample.pdf', import.meta.url))

const SETUP: ProcessSetup = { wasmPath: '/fake/pdfium.wasm', ocrHelperPaths: [] }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdf-office-export-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

/** Fake child process that runs `runStructureJob` asynchronously like utilityProcess */
function createInProcessJobChild(deps: JobDeps): JobProcess {
  const emitter = new EventEmitter()
  let killed = false
  return {
    postMessage(raw: unknown) {
      const msg = raw as RunMessage
      queueMicrotask(() => {
        if (killed) return
        runStructureJob(msg.job, deps, (done, total) => {
          if (!killed) emitter.emit('message', { type: 'progress', done, total })
        }).then(
          (value) => {
            if (!killed) emitter.emit('message', { type: 'result', value })
          },
          (err: unknown) => {
            if (!killed) emitter.emit('message', errorMessageOf(err))
          },
        )
      })
    },
    kill() {
      if (killed) return false
      killed = true
      queueMicrotask(() => emitter.emit('exit', 0))
      return true
    },
    on(event: 'message' | 'exit', listener: (...args: unknown[]) => void) {
      emitter.on(event, listener)
      return emitter
    },
  }
}

const realDeps = (ocr: OcrEngine | null = null): JobDeps => ({
  pdfium: loadPdfium,
  ocr: () => ocr,
  structuredTextFormatter: null,
  translatedPdfWriter: null,
})

describe('PDF -> Office export parity (in-process vs convertDoc job)', () => {
  it('produces byte-identical docx, pptx, and xlsx outputs and identical metadata', async () => {
    // Pin Date so JSZip DOS timestamps are identical across both runs
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-02T03:04:05Z') })

    const pdfium = await loadPdfium()
    const raw = readFileSync(FIXTURE_PASSWORD)
    const pdfBytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const deps = realDeps()
    const noProgress = () => {}

    // DOCX
    const directDocx = await convertPdfToDocx(pdfBytes, { pdfium, password: '    ' })
    const jobDocxPath = join(dir, 'out.docx')
    const jobDocx = (await runStructureJob(
      {
        op: 'convertDoc',
        source: { pdfPath: FIXTURE_PASSWORD, password: '    ' },
        format: 'docx',
        outPath: jobDocxPath,
      },
      deps,
      noProgress,
    )) as ConvertDocJobValue
    expect(Buffer.compare(Buffer.from(directDocx.docx), readFileSync(jobDocxPath))).toBe(0)
    expect(jobDocx).toEqual({
      outPath: jobDocxPath,
      pages: directDocx.pages,
      warnings: directDocx.warnings,
      pageResults: directDocx.pageResults,
      scannedDocument: directDocx.scannedDocument,
    })

    // PPTX: pin creationId UUIDs so pptx-engine's random a16:creationId matches across both runs
    let uuidSeq = 0
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      const n = String(++uuidSeq).padStart(12, '0')
      return `00000000-0000-4000-8000-${n}` as `${string}-${string}-${string}-${string}-${string}`
    })
    const directPptx = await convertPdfToPptx(pdfBytes, { pdfium, password: '    ' })
    uuidSeq = 0
    const jobPptxPath = join(dir, 'out.pptx')
    const jobPptx = (await runStructureJob(
      {
        op: 'convertDoc',
        source: { pdfPath: FIXTURE_PASSWORD, password: '    ' },
        format: 'pptx',
        outPath: jobPptxPath,
      },
      deps,
      noProgress,
    )) as ConvertDocJobValue
    uuidSpy.mockRestore()
    expect(Buffer.compare(Buffer.from(directPptx.pptx), readFileSync(jobPptxPath))).toBe(0)
    expect(jobPptx).toEqual({
      outPath: jobPptxPath,
      pages: directPptx.pages,
      warnings: directPptx.warnings,
      pageResults: directPptx.pageResults,
      scannedDocument: directPptx.scannedDocument,
    })

    // XLSX
    const directXlsx = await convertPdfToXlsx(pdfBytes, { pdfium, password: '    ' })
    const jobXlsxPath = join(dir, 'out.xlsx')
    const jobXlsx = (await runStructureJob(
      {
        op: 'convertDoc',
        source: { pdfPath: FIXTURE_PASSWORD, password: '    ' },
        format: 'xlsx',
        outPath: jobXlsxPath,
      },
      deps,
      noProgress,
    )) as ConvertDocJobValue
    expect(Buffer.compare(Buffer.from(directXlsx.xlsx), readFileSync(jobXlsxPath))).toBe(0)
    expect(jobXlsx).toEqual({
      outPath: jobXlsxPath,
      pages: directXlsx.pages,
      warnings: directXlsx.warnings,
      pageResults: directXlsx.pageResults,
      scannedDocument: directXlsx.scannedDocument,
    })
  }, 60000)

  it('passes the OCR engine identically for docx and returns OCR pageResults', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-02T03:04:05Z') })

    // Build a 1-page PDF with an embedded image and no text layer (scanned candidate)
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
      'base64',
    )
    const img = await doc.embedPng(png1x1)
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
    const pdfBytes = await doc.save({ useObjectStreams: false })
    const pdfPath = join(dir, 'scan.pdf')
    writeFileSync(pdfPath, pdfBytes)

    let ocrCalls = 0
    const fakeOcr: OcrEngine = () => {
      ocrCalls++
      return {
        paperShare: 0.95,
        lines: [
          {
            text: 'Scanned document body line with enough characters',
            confidence: 0.95,
            box: { x0: 0.1, y0: 0.7, x1: 0.85, y1: 0.76 },
          },
        ],
      }
    }

    const pdfium = await loadPdfium()
    const direct = await convertPdfToDocx(pdfBytes, { pdfium, ocr: fakeOcr })
    const outPath = join(dir, 'scan.docx')
    const viaJob = (await runStructureJob(
      { op: 'convertDoc', source: { pdfPath }, format: 'docx', outPath },
      realDeps(fakeOcr),
      () => {},
    )) as ConvertDocJobValue

    expect(ocrCalls).toBe(2)
    expect(viaJob.pageResults).toEqual(direct.pageResults)
    expect(viaJob.pageResults[0]?.status).toBe('ocr')
    expect(viaJob.scannedDocument).toBe(direct.scannedDocument)
    expect(Buffer.compare(Buffer.from(direct.docx), readFileSync(outPath))).toBe(0)
  }, 60000)
})

describe('convertPdfFileViaJobWithPrompt (runner flow, password loop, errors, cancel)', () => {
  it('handles encrypted retry, progress forwarding, cert-encrypted and corrupt errors through StructureJobRunner', async () => {
    const runner = new StructureJobRunner(
      () => createInProcessJobChild(realDeps()),
      () => SETUP,
    )
    let jobSeq = 0
    const runJob = (
      job: Extract<StructureJob, { op: 'convertDoc' }>,
      onProgress?: (page: number, total: number) => void,
    ) => runner.run(1, `test-export-${++jobSeq}`, job, onProgress)

    // 1. Encrypted PDF: wrong password -> retry -> right password -> progress + file written
    const prompts: boolean[] = []
    const answers = ['wrong', '    ']
    const progressEvents: Array<[number, number]> = []
    const outPath = join(dir, 'unlocked.docx')
    const ok = await convertPdfFileViaJobWithPrompt(
      runJob,
      'docx',
      FIXTURE_PASSWORD,
      outPath,
      (retry) => {
        prompts.push(retry)
        return Promise.resolve(answers.shift() ?? null)
      },
      (page, total) => progressEvents.push([page, total]),
    )
    expect(prompts).toEqual([false, true])
    expect(ok).not.toBeNull()
    expect(ok!.outPath).toBe(outPath)
    expect(ok!.pages).toBeGreaterThan(0)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(Array.from(readFileSync(outPath).subarray(0, 2))).toEqual([0x50, 0x4b])

    // 2. Prompt cancelled -> resolves null silently
    const cancelledPrompt = await convertPdfFileViaJobWithPrompt(
      runJob,
      'docx',
      FIXTURE_PASSWORD,
      join(dir, 'cancelled.docx'),
      () => Promise.resolve(null),
    )
    expect(cancelledPrompt).toBeNull()

    // 3. Certificate-encrypted -> PdfLoadError('unsupported'), never prompts
    const certPrompt = vi.fn()
    await expect(
      convertPdfFileViaJobWithPrompt(
        runJob,
        'pptx',
        FIXTURE_CERT,
        join(dir, 'cert.pptx'),
        certPrompt,
      ),
    ).rejects.toSatisfy((err: unknown) => err instanceof PdfLoadError && err.code === 'unsupported')
    expect(certPrompt).not.toHaveBeenCalled()

    // 4. Corrupt PDF -> PdfLoadError('corrupt'), never prompts
    const corruptPrompt = vi.fn()
    await expect(
      convertPdfFileViaJobWithPrompt(
        runJob,
        'xlsx',
        FIXTURE_CORRUPT,
        join(dir, 'corrupt.xlsx'),
        corruptPrompt,
      ),
    ).rejects.toSatisfy((err: unknown) => err instanceof PdfLoadError && err.code === 'corrupt')
    expect(corruptPrompt).not.toHaveBeenCalled()
  }, 60000)

  it('resolves null when the runner cancels an in-flight export (tab close or app quit)', async () => {
    const outPath = join(dir, 'aborted.docx')
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage([400, 400]).drawText('hello', { x: 20, y: 300, size: 12, font })
    const pdfPath = join(dir, 'plain.pdf')
    writeFileSync(pdfPath, await doc.save({ useObjectStreams: false }))

    const runner = new StructureJobRunner(
      () => {
        const emitter = new EventEmitter()
        return {
          postMessage() {},
          kill() {
            queueMicrotask(() => emitter.emit('exit', 1))
            return true
          },
          on(event, listener) {
            emitter.on(event, listener)
            return emitter
          },
        }
      },
      () => SETUP,
    )

    const pending = convertPdfFileViaJobWithPrompt(
      (job, onProgress) => runner.run(42, 'export-1', job, onProgress),
      'docx',
      pdfPath,
      outPath,
      () => Promise.resolve(null),
    )
    expect(runner.cancelOwner(42)).toBe(1)
    expect(await pending).toBeNull()
  })
})
