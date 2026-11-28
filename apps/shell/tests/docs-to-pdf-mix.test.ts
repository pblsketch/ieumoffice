import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  MIX_ORPHAN_MAX_AGE_MS,
  createMixQueue,
  mixTempRoot,
  sweepOrphanMixFiles,
} from '../src/main/pdf-tools/mix-queue'
import type { PdfMixStatusEvent } from '../src/shared/pdf-tools-api'

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 300])
  return doc.save({ useObjectStreams: false })
}

describe('mixed-file merge background conversion queue', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mix-queue-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('converts images and documents to temp PDFs, reports status/pages, and removes temp files on remove & clearAll', async () => {
    const events: PdfMixStatusEvent[] = []
    const pdf3 = await makePdf(3)
    const pdf1 = await makePdf(1)

    const queue = createMixQueue({
      tempRoot: mixTempRoot(root),
      convertDocument: async (_inPath, outPath) => {
        writeFileSync(outPath, pdf3)
        return { ok: true }
      },
      convertImage: async () => pdf1,
      inspectPdfPages: async (pdfPath) => {
        const doc = await PDFDocument.load(
          new Uint8Array(await (await import('node:fs/promises')).readFile(pdfPath)),
        )
        return doc.getPageCount()
      },
      renderFirstThumb: async () => 'data:image/png;base64,AA==',
      onStatus: (ev) => events.push(ev),
    })

    queue.enqueue('doc-1', 'document', '/fake/memo.docx')
    queue.enqueue('img-1', 'image', '/fake/photo.webp')
    await queue.whenIdle()

    expect(queue.hasActive()).toBe(false)
    const docEntry = queue.get('doc-1')
    const imgEntry = queue.get('img-1')
    expect(docEntry?.state).toBe('ready')
    expect(docEntry?.pages).toBe(3)
    expect(existsSync(docEntry!.pdfPath)).toBe(true)
    expect(imgEntry?.state).toBe('ready')
    expect(imgEntry?.pages).toBe(1)
    expect(existsSync(imgEntry!.pdfPath)).toBe(true)

    expect(events.map((e) => `${e.inputId}:${e.state}`)).toEqual([
      'doc-1:pending',
      'doc-1:converting',
      'img-1:pending',
      'doc-1:ready',
      'img-1:converting',
      'img-1:ready',
    ])

    // Removing one row immediately deletes its temp PDF
    const docPdfPath = docEntry!.pdfPath
    await queue.remove('doc-1')
    expect(existsSync(docPdfPath)).toBe(false)

    // Clearing all immediately deletes remaining temp PDFs
    const imgPdfPath = imgEntry!.pdfPath
    await queue.clearAll()
    expect(existsSync(imgPdfPath)).toBe(false)
  })

  it('marks failed conversions as error and cleans partial files', async () => {
    const events: PdfMixStatusEvent[] = []
    const queue = createMixQueue({
      tempRoot: mixTempRoot(root),
      convertDocument: async () => ({ ok: false, error: 'corrupt file' }),
      convertImage: async () => {
        throw new Error('bad image')
      },
      inspectPdfPages: async () => 1,
      onStatus: (ev) => events.push(ev),
    })
    queue.enqueue('bad-doc', 'document', '/fake/bad.docx')
    await queue.whenIdle()
    expect(queue.get('bad-doc')?.state).toBe('error')
    expect(queue.get('bad-doc')?.error).toBe('corrupt file')
    expect(events.at(-1)).toMatchObject({
      inputId: 'bad-doc',
      state: 'error',
      error: 'corrupt file',
    })
  })

  it('sweeps orphaned mix temp files older than 24 hours while keeping fresh ones', async () => {
    const dir = mixTempRoot(root)
    mkdirSync(dir, { recursive: true })
    const oldFile = join(dir, 'orphan.pdf')
    const freshFile = join(dir, 'fresh.pdf')
    writeFileSync(oldFile, 'old')
    writeFileSync(freshFile, 'fresh')

    const now = Date.now()
    const oldTime = new Date(now - MIX_ORPHAN_MAX_AGE_MS - 60_000)
    utimesSync(oldFile, oldTime, oldTime)

    const removed = await sweepOrphanMixFiles(root, now)
    expect(removed).toBe(1)
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
  })
})
