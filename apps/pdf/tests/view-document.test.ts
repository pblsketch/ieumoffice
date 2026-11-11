import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PdfViewApi } from '../src/shared/view-source'
import { PDF_VIEW_RANGE_CHUNK_BYTES as CHUNK } from '../src/shared/view-source'

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument,
  PDFDataRangeTransport: class {
    onDataRange = vi.fn()
    constructor(
      public length: number,
      public initialData: Uint8Array,
    ) {}
  },
}))
import { openViewDocument } from '../src/renderer/view-document'

afterEach(() => {
  getDocument.mockReset()
})
function fixture(pending = false) {
  const api = {
    openViewSource: vi.fn(async () => ({
      id: 'source',
      length: 4 * CHUNK,
      hasXfa: false,
      initialData: new ArrayBuffer(64),
    })),
    readViewRange: vi.fn(
      async (_id: string, offset: number, length: number) =>
        new Uint8Array(length).fill(offset % 251).buffer,
    ),
    closeViewSource: vi.fn(async () => {}),
  }
  const destroy = vi.fn(async () => {})
  const task = { promise: pending ? new Promise<never>(() => {}) : Promise.resolve({}), destroy }
  getDocument.mockReturnValueOnce(task)
  return { api, task, destroy }
}

describe('PDF.js document model over pinned file ranges', () => {
  it('does not send a full input buffer or enable background prefetch', async () => {
    const f = fixture()
    const opened = await openViewDocument(f.api as unknown as PdfViewApi, 'granted.pdf', 'password')
    await opened.task.promise
    const options = getDocument.mock.calls[0]![0]
    expect(options.data).toBeUndefined()
    expect(options.disableAutoFetch).toBe(true)
    expect(options.disableStream).toBe(true)
    expect(options.password).toBe('password')
    expect(options.range.initialData.byteLength).toBe(64)
    await opened.task.destroy()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.api.closeViewSource).toHaveBeenCalledWith('source')
    await opened.task.destroy()
    expect(f.api.closeViewSource).toHaveBeenCalledOnce()
  })

  it('bounds each IPC read and preserves a combined range without background reads', async () => {
    const f = fixture()
    const opened = await openViewDocument(f.api as unknown as PdfViewApi, 'granted.pdf')
    const range = getDocument.mock.calls[0]![0].range
    range.requestDataRange(3, 2 * CHUNK + 13)
    await vi.waitFor(() => expect(range.onDataRange).toHaveBeenCalledOnce())
    expect(f.api.readViewRange.mock.calls.map((args) => args.slice(1))).toEqual([
      [3, CHUNK],
      [3 + CHUNK, CHUNK],
      [3 + 2 * CHUNK, 10],
    ])
    const [begin, bytes] = range.onDataRange.mock.calls[0]
    expect(begin).toBe(3)
    expect(bytes.byteLength).toBe(2 * CHUNK + 10)
    expect(bytes[CHUNK - 1]).toBe(3 % 251)
    expect(bytes[CHUNK]).toBe((3 + CHUNK) % 251)
    await opened.task.destroy()
  })

  it('rejects a failed initial range and retires its loading task and capability', async () => {
    const f = fixture(true)
    f.api.readViewRange.mockRejectedValueOnce(new Error('disk range failed'))
    const opened = await openViewDocument(f.api as unknown as PdfViewApi, 'granted.pdf')
    const failed = expect(opened.task.promise).rejects.toThrow('disk range failed')
    getDocument.mock.calls[0]![0].range.requestDataRange(0, CHUNK)
    await failed
    await vi.waitFor(() => expect(f.api.closeViewSource).toHaveBeenCalledOnce())
    expect(f.destroy).toHaveBeenCalledOnce()
  })
})
