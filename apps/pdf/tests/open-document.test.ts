import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { decryptDocument } from '../src/main/pdf-crypt'

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }))
import { loadPdfForView } from '../src/renderer/open-document'
import { documentFormFeatures, hasXfaMarker } from '../src/renderer/form-catalog'

// A real transferable boundary, like PDF.js handing document data to its worker.
// The reader itself is not needed to exercise the caller's buffer ownership.
function workerTakesInput() {
  const channel = new MessageChannel()
  getDocument.mockImplementation(({ data }) => {
    channel.port1.postMessage(data, [data.buffer])
    return { promise: Promise.resolve({ numPages: 2 }) }
  })
  return () => {
    channel.port1.close()
    channel.port2.close()
    getDocument.mockReset()
  }
}

describe('document loading transfers its input without a full-file copy', () => {
  it.each([
    ['encrc4.pdf', 'user123', 2],
    ['enc-r5-owneronly.pdf', '', 1],
  ])(
    'can decrypt a fresh read of %s after the view worker takes its input',
    async (file, password, pages) => {
      const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', file)))
      const original = bytes.slice()
      const before = await decryptDocument(original, password)
      const release = workerTakesInput()
      try {
        await loadPdfForView(bytes, password).promise
        const reopenedBytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', file)))
        const opened = await decryptDocument(reopenedBytes, password)
        const parsed = await PDFDocument.load(opened.bytes)
        expect(parsed.getPageCount()).toBe(pages)
        expect(bytes.byteLength).toBe(0)
        expect(reopenedBytes).toEqual(original)
        expect(opened.unlockedAs).toBe(before.unlockedAs)
        expect(opened.permissions).toEqual(before.permissions)
      } finally {
        release()
      }
    },
  )

  it('passes the original buffer to the worker and forwards the loading task', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'plain-sample.pdf')))
    const release = workerTakesInput()
    try {
      const task = loadPdfForView(bytes)
      await expect(task.promise).resolves.toEqual({ numPages: 2 })
      expect(getDocument.mock.calls.at(-1)![0].data).toBe(bytes)
      expect(bytes.byteLength).toBe(0)
    } finally {
      release()
    }
  })

  it('keeps raw XFA detection usable after transfer, including incomplete metadata', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 /XFA 3 0 R')
    const marker = hasXfaMarker(bytes)
    const release = workerTakesInput()
    try {
      await loadPdfForView(bytes).promise
      expect(bytes.byteLength).toBe(0)
      expect(documentFormFeatures({}, marker)).toEqual({ hasXfa: true, encrypted: false })
      expect(
        documentFormFeatures({ IsXFAPresent: true, EncryptFilterName: 'Standard' }, false),
      ).toEqual({ hasXfa: true, encrypted: true })
      expect(documentFormFeatures({}, false)).toEqual({ hasXfa: false, encrypted: false })
    } finally {
      release()
    }
  })

  it('forwards the loading task, password and rejection unchanged', async () => {
    const error = new Error('test password failure')
    const task = { promise: Promise.reject(error), destroy: vi.fn() }
    getDocument.mockReturnValueOnce(task)
    const opened = loadPdfForView(new Uint8Array([1, 2, 3]), 'incorrect')
    expect(opened).toBe(task)
    await expect(opened.promise).rejects.toBe(error)
    expect(getDocument.mock.calls[0][0].password).toBe('incorrect')
    getDocument.mockReset()
  })
})
