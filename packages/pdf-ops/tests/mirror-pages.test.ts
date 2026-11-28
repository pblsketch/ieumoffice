// @vitest-environment node
/**
 * The page mirrors (mergePdfInOrder, extractPdfPages, rotateAllPdfPages,
 * removePdfPages) copy what apps/pdf/src/main/save-pdf.ts does, because that
 * file is shared with upstream GenOffice and stays where it is. These tests
 * run the PC original and the mirror on the same input and require the same
 * bytes. When an upstream change moves the original, this fails and the
 * mirror is changed to match.
 *
 * Only Date is frozen: pdf-lib stamps its dates from the clock and waits on
 * timer ticks while saving, so faking every timer would hang it.
 */
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractPdfPages,
  mergePdfInOrder,
  mirrorPageEngine,
  removePdfPages,
  rotateAllPdfPages,
} from '../src/mirror-pages'

const FIXED_NOW = new Date('2026-01-02T03:04:05Z')

/**
 * The PC code this mirrors, loaded by a computed path so the app's whole type graph
 * (Electron, React, Node) stays out of this package's type check.
 */
const PC_SAVE_PDF = fileURLToPath(
  new URL('../../../apps/pdf/src/main/save-pdf.ts', import.meta.url),
)

interface PcSaveRequest {
  path: string
  markups: never[]
  drawings: never[]
  formValues: never[]
  stamps: never[]
  rotations?: { pageIndex: number; delta: number }[]
  deletedPages?: number[]
}

interface PcSavePdf {
  mergePdfBytes(
    first: Uint8Array,
    others: Uint8Array[],
  ): Promise<{ merged: Uint8Array; appended: number }>
  extractPagesBytes(bytes: Uint8Array, pages: number[]): Promise<Uint8Array>
  applySaveRequest(bytes: Uint8Array, request: PcSaveRequest): Promise<{ bytes: Uint8Array }>
}

let pc: PcSavePdf

beforeAll(async () => {
  pc = (await import(/* @vite-ignore */ PC_SAVE_PDF)) as PcSavePdf
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const empty = { path: '', markups: [], drawings: [], formValues: [], stamps: [] }

/** what the PC tools window runs for "rotate all" */
async function pcRotate(bytes: Uint8Array, delta: 90 | 180 | 270): Promise<Uint8Array> {
  const count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
  const rotations = Array.from({ length: count }, (_, pageIndex) => ({ pageIndex, delta }))
  return (await pc.applySaveRequest(bytes, { ...empty, rotations })).bytes
}

/** what the PC tools window runs for "remove blank pages" */
async function pcRemove(bytes: Uint8Array, deletedPages: number[]): Promise<Uint8Array> {
  return (await pc.applySaveRequest(bytes, { ...empty, deletedPages })).bytes
}

/** pages whose widths 100, 101, … tell them apart, with a line of text on each */
async function plainPages(count: number, base = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([base + i, 300])
    page.drawText(`page ${i + 1}`, { x: 10, y: 250, size: 10, font })
  }
  return doc.save({ useObjectStreams: false })
}

/** pages that already carry a rotation, and one with a drawn box */
async function rotatedPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const angles = [0, 90, 180, 270, 90]
  angles.forEach((angle, i) => {
    const page = doc.addPage([200 + i * 10, 300])
    page.setRotation(degrees(angle))
    page.drawRectangle({ x: 20, y: 20, width: 50, height: 40, color: rgb(0.2, 0.4, 0.8) })
  })
  return doc.save({ useObjectStreams: false })
}

/**
 * A form (AcroForm): a text field with a written appearance, a check box, a
 * dropdown, and a text field whose Korean value has no appearance yet (saved
 * without appearances, so the per-field refresh fails on it and sets
 * NeedAppearances). Fields sit on several pages so removal drops some widgets.
 */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const pages = [doc.addPage([300, 400]), doc.addPage([300, 400]), doc.addPage([300, 400])]
  const form = doc.getForm()
  const name = form.createTextField('applicant.name')
  name.setText('Kim')
  name.addToPage(pages[0]!, { x: 20, y: 300, width: 200, height: 24 })
  const agree = form.createCheckBox('applicant.agree')
  agree.check()
  agree.addToPage(pages[1]!, { x: 20, y: 300, width: 18, height: 18 })
  const pick = form.createDropdown('applicant.city')
  pick.addOptions(['Seoul', 'Busan'])
  pick.select('Busan')
  pick.addToPage(pages[2]!, { x: 20, y: 200, width: 120, height: 24 })
  const note = form.createTextField('applicant.note')
  note.addToPage(pages[2]!, { x: 20, y: 100, width: 200, height: 24 })
  // the Korean value: Helvetica cannot encode it, so no appearance is written now
  note.setText('안녕하세요')
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/** a form whose fields all have appearances already (the refresh changes nothing) */
async function cleanFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 400])
  doc.addPage([300, 400])
  const field = doc.getForm().createTextField('only')
  field.setText('hello')
  field.addToPage(page, { x: 20, y: 300, width: 200, height: 24 })
  return doc.save({ useObjectStreams: false })
}

/** the same file written with object streams, as many producers do */
async function objectStreamPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await rotatedPages())
  return doc.save({ useObjectStreams: true })
}

interface Sample {
  name: string
  make(): Promise<Uint8Array>
}

const SAMPLES: Sample[] = [
  { name: 'one page', make: () => plainPages(1) },
  { name: 'plain pages', make: () => plainPages(4) },
  { name: 'many pages', make: () => plainPages(60, 120) },
  { name: 'rotated pages', make: rotatedPages },
  { name: 'form', make: formPdf },
  { name: 'form with appearances', make: cleanFormPdf },
  { name: 'object streams', make: objectStreamPdf },
]

const same = (a: Uint8Array, b: Uint8Array) => {
  expect(a.length).toBe(b.length)
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
}

describe('mergePdfInOrder', () => {
  it('writes the bytes mergePdfBytes(first, others) writes', async () => {
    const files = [await plainPages(3), await formPdf(), await rotatedPages(), await plainPages(2)]
    const want = await pc.mergePdfBytes(files[0]!, files.slice(1))
    const got = await mergePdfInOrder(files)
    expect(got.appended).toBe(want.appended)
    same(got.merged, want.merged)
  })

  it('writes the same bytes for two files and for a single file', async () => {
    const a = await plainPages(2)
    const b = await objectStreamPdf()
    same((await mergePdfInOrder([a, b])).merged, (await pc.mergePdfBytes(a, [b])).merged)
    const alone = await mergePdfInOrder([a])
    const pcAlone = await pc.mergePdfBytes(a, [])
    expect(alone.appended).toBe(0)
    same(alone.merged, pcAlone.merged)
  })

  it('reads one input at a time from an async iterable', async () => {
    const files = [await plainPages(2), await plainPages(3, 200), await formPdf()]
    const want = await pc.mergePdfBytes(files[0]!, files.slice(1))
    const load = vi.spyOn(PDFDocument, 'load')
    const loadsAtPull: number[] = []
    let pulling = false
    const inputs: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        let i = 0
        return {
          async next() {
            // the merge never asks for the next file while one is still on its way
            expect(pulling).toBe(false)
            pulling = true
            loadsAtPull.push(load.mock.calls.length)
            await Promise.resolve()
            pulling = false
            const value = files[i++]
            return value ? { done: false, value } : { done: true, value: undefined }
          },
        }
      },
    }
    const got = await mergePdfInOrder(inputs)
    // the file before was read into the merge before the next one is asked for
    expect(loadsAtPull).toEqual([0, 1, 2, 3])
    expect(got.appended).toBe(want.appended)
    same(got.merged, want.merged)
  })

  it('refuses no input at all', async () => {
    await expect(mergePdfInOrder([])).rejects.toThrow('no input')
  })
})

describe('extractPdfPages', () => {
  const lists = [[0], [2, 0, 1], [3, 3, 1], [-1, 0, 99], []]
  for (const sample of SAMPLES) {
    it(`writes the bytes extractPagesBytes writes: ${sample.name}`, async () => {
      const bytes = await sample.make()
      for (const pages of lists) {
        same(await extractPdfPages(bytes, pages), await pc.extractPagesBytes(bytes, pages))
      }
    })
  }
})

describe('rotateAllPdfPages', () => {
  for (const sample of SAMPLES) {
    it(`writes the bytes applySaveRequest writes for rotations: ${sample.name}`, async () => {
      const bytes = await sample.make()
      for (const delta of [90, 180, 270] as const) {
        same(await rotateAllPdfPages(bytes, delta), await pcRotate(bytes, delta))
      }
    })
  }

  it('leaves the source bytes as they were', async () => {
    const bytes = await formPdf()
    const before = Uint8Array.from(bytes)
    await rotateAllPdfPages(bytes, 90)
    same(bytes, before)
  })
})

describe('removePdfPages', () => {
  for (const sample of SAMPLES) {
    it(`writes the bytes applySaveRequest writes for deletedPages: ${sample.name}`, async () => {
      const bytes = await sample.make()
      const count = (await PDFDocument.load(bytes)).getPageCount()
      const all = Array.from({ length: count }, (_, i) => i)
      const cases = [
        [0],
        [count - 1],
        // several, out of order, with a repeat and pages that do not exist
        [count - 1, 0, 0, Math.floor(count / 2), -3, count + 4],
        // all but one
        all.slice(1),
        // every page: one is always kept
        all,
      ]
      for (const pages of cases) {
        same(await removePdfPages(bytes, pages), await pcRemove(bytes, pages))
      }
    })
  }

  it('removes several pages of a long document', async () => {
    const bytes = await plainPages(60, 120)
    const pages = [3, 7, 11, 20, 21, 22, 59]
    const got = await removePdfPages(bytes, pages)
    same(got, await pcRemove(bytes, pages))
    expect((await PDFDocument.load(got)).getPageCount()).toBe(60 - pages.length)
  })
})

describe('mirrorPageEngine', () => {
  it('uses the mirrors for page work and leaves the later tools out', async () => {
    const loadPdfium = vi.fn(async () => {
      throw new Error('not asked for')
    })
    const engine = mirrorPageEngine(loadPdfium)
    const a = await plainPages(2)
    const b = await plainPages(3, 200)
    const merged = await engine.mergePdfBytes(a, [b])
    const want = await pc.mergePdfBytes(a, [b])
    expect(merged.appended).toBe(want.appended)
    same(merged.merged, want.merged)
    same(await engine.extractPagesBytes(b, [2, 0]), await pc.extractPagesBytes(b, [2, 0]))
    same(await engine.rotateAllPages(b, 270), await pcRotate(b, 270))
    same(await engine.removePages(b, [1]), await pcRemove(b, [1]))
    // PDFium is loaded only for text
    expect(loadPdfium).not.toHaveBeenCalled()
    expect(engine.mergePagesBytes).toBeUndefined()
    expect(engine.setPageSizeBytes).toBeUndefined()
    expect(engine.splitPagesBytes).toBeUndefined()
  })
})
