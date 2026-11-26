// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { PdfiumOpenError, withPdfiumDocument, type PdfiumDocModule } from '../src/pdfium'

interface Counted {
  module: PdfiumDocModule & { _FPDF_GetPageCount(doc: number): number }
  /** pointers handed out and not freed yet, with their sizes */
  live: Map<number, number>
  opened: number[]
  closed: number[]
  /** for each freed block: whether it was all zero bytes when it was freed */
  freedZeroed: Map<number, boolean>
  mallocs: number[]
}

type RealModule = PdfiumDocModule & { _FPDF_GetPageCount(doc: number): number }

let real: RealModule

/** the PC's PDFium loader, by a computed path so the app's type graph stays out of this package */
const PC_TEXT_EDIT = fileURLToPath(
  new URL('../../../apps/pdf/src/main/text-edit.ts', import.meta.url),
)

beforeAll(async () => {
  const edit = (await import(/* @vite-ignore */ PC_TEXT_EDIT)) as {
    loadPdfium(): Promise<unknown>
  }
  real = (await edit.loadPdfium()) as RealModule
})

/** the real module with its allocations and documents counted */
function counted(): Counted {
  const live = new Map<number, number>()
  const opened: number[] = []
  const closed: number[] = []
  const freedZeroed = new Map<number, boolean>()
  const mallocs: number[] = []
  const module: RealModule = {
    get HEAPU8() {
      return real.HEAPU8
    },
    _malloc(size) {
      const ptr = real._malloc(size)
      if (ptr) {
        live.set(ptr, size)
        mallocs.push(ptr)
      }
      return ptr
    },
    _free(ptr) {
      const size = live.get(ptr)
      expect(size).toBeDefined()
      freedZeroed.set(
        ptr,
        real.HEAPU8.subarray(ptr, ptr + size!).every((b) => b === 0),
      )
      live.delete(ptr)
      real._free(ptr)
    },
    _FPDF_LoadMemDocument(ptr, size, password) {
      const doc = real._FPDF_LoadMemDocument(ptr, size, password)
      if (doc) opened.push(doc)
      return doc
    },
    _FPDF_CloseDocument(doc) {
      closed.push(doc)
      real._FPDF_CloseDocument(doc)
    },
    _FPDF_GetLastError: () => real._FPDF_GetLastError(),
    _FPDF_GetPageCount: (doc) => real._FPDF_GetPageCount(doc),
  }
  return { module, live, opened, closed, freedZeroed, mallocs }
}

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, '../../../apps/pdf/tests/fixtures', name)))

async function plainPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 200])
  return doc.save()
}

async function openError(run: () => Promise<unknown>): Promise<PdfiumOpenError> {
  try {
    await run()
  } catch (err) {
    expect(err).toBeInstanceOf(PdfiumOpenError)
    return err as PdfiumOpenError
  }
  throw new Error('expected the document not to open')
}

describe('withPdfiumDocument', () => {
  it('opens a document, hands it to fn and closes it and frees its memory after', async () => {
    const c = counted()
    const bytes = await plainPdf(3)
    const before = Uint8Array.from(bytes)
    const pages = await withPdfiumDocument(c.module, bytes, null, (doc) => {
      expect(c.opened).toEqual([doc])
      expect(c.closed).toEqual([])
      return c.module._FPDF_GetPageCount(doc)
    })
    expect(pages).toBe(3)
    expect(c.closed).toEqual(c.opened)
    expect(c.live.size).toBe(0)
    expect(bytes).toStrictEqual(before)
  })

  it('waits for an async fn before closing', async () => {
    const c = counted()
    const pages = await withPdfiumDocument(c.module, await plainPdf(2), null, async (doc) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(c.closed).toEqual([])
      return c.module._FPDF_GetPageCount(doc)
    })
    expect(pages).toBe(2)
    expect(c.closed).toEqual(c.opened)
    expect(c.live.size).toBe(0)
  })

  it('opens an encrypted document with its password, and wipes the password copy', async () => {
    const c = counted()
    const pages = await withPdfiumDocument(c.module, fixture('enc256.pdf'), 'user123', (doc) =>
      c.module._FPDF_GetPageCount(doc),
    )
    expect(pages).toBe(2)
    expect(c.live.size).toBe(0)
    // two blocks: the file and the password; the password is zeroed before it is freed
    expect(c.mallocs).toHaveLength(2)
    expect(c.freedZeroed.get(c.mallocs[1]!)).toBe(true)
  })

  it('reads a non-ASCII password as UTF-8', async () => {
    // a file opened with "" reads; any other password for a file without one is ignored
    const c = counted()
    const pages = await withPdfiumDocument(c.module, await plainPdf(1), '비밀번호', (doc) =>
      c.module._FPDF_GetPageCount(doc),
    )
    expect(pages).toBe(1)
    expect(c.live.size).toBe(0)
  })

  it.each([
    ['no password', null],
    ['a wrong password', 'nope'],
    ['an empty password', ''],
  ])('says wrong-password for an encrypted file and %s, freeing everything', async (_n, pw) => {
    const c = counted()
    let ran = false
    const err = await openError(() =>
      withPdfiumDocument(c.module, fixture('enc256.pdf'), pw, () => {
        ran = true
      }),
    )
    expect(err.code).toBe('wrong-password')
    expect(err.message).not.toContain('nope')
    expect(ran).toBe(false)
    expect(c.opened).toEqual([])
    expect(c.live.size).toBe(0)
  })

  it.each([
    ['empty bytes', new Uint8Array()],
    ['text that is not a PDF', new TextEncoder().encode('hello, not a pdf')],
    ['a truncated file', fixture('plain-sample.pdf').subarray(0, 300)],
  ])('says unreadable for %s, freeing everything', async (_n, bytes) => {
    const c = counted()
    const err = await openError(() => withPdfiumDocument(c.module, bytes, null, () => 1))
    expect(err.code).toBe('unreadable')
    expect(c.live.size).toBe(0)
  })

  it('closes the document and frees its memory when fn throws', async () => {
    const c = counted()
    const boom = new Error('boom')
    await expect(
      withPdfiumDocument(c.module, fixture('enc256.pdf'), 'user123', () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(c.opened).toHaveLength(1)
    expect(c.closed).toEqual(c.opened)
    expect(c.live.size).toBe(0)
  })

  it('closes the document and frees its memory when an async fn rejects', async () => {
    const c = counted()
    const boom = new Error('later')
    await expect(
      withPdfiumDocument(c.module, await plainPdf(1), null, async () => {
        await Promise.resolve()
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(c.closed).toEqual(c.opened)
    expect(c.live.size).toBe(0)
  })

  it('says unreadable and allocates nothing more when the heap is out of room', async () => {
    const c = counted()
    const module: RealModule = { ...c.module, _malloc: () => 0 }
    Object.defineProperty(module, 'HEAPU8', { get: () => real.HEAPU8 })
    const bytes = await plainPdf(1)
    const err = await openError(() => withPdfiumDocument(module, bytes, 'pw', () => 1))
    expect(err.code).toBe('unreadable')
    expect(c.live.size).toBe(0)
  })

  it('frees the file block when only the password block cannot be had', async () => {
    const c = counted()
    let calls = 0
    const module: RealModule = {
      ...c.module,
      _malloc: (size) => (++calls === 1 ? c.module._malloc(size) : 0),
    }
    Object.defineProperty(module, 'HEAPU8', { get: () => real.HEAPU8 })
    const bytes = await plainPdf(1)
    const err = await openError(() => withPdfiumDocument(module, bytes, 'pw', () => 1))
    expect(err.code).toBe('unreadable')
    expect(c.live.size).toBe(0)
  })
})
