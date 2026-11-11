// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileFunction, constants } from 'node:vm'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSparsePdfWorker, patchPdfjsWorker } from '../scripts/pdfjs-sparse-worker.mjs'
import type * as Pdfjs from 'pdfjs-dist'

interface Input {
  pos: number
  end: number
  bytes: Uint8Array
  progressiveDataLength: number
  _sparse: { bytes: number; materialized: Uint8Array | null; chunks: Map<number, Uint8Array> }
  getByte(): number
  getBytes(length?: number): Uint8Array
  getByteRange(begin: number, end: number): Uint8Array
  getMissingChunks(): number[]
  onReceiveData(begin: number, data: ArrayBuffer | Uint8Array): void
  onReceiveProgressiveData(data: Uint8Array): void
  makeSubStream(start: number, length: number): Input
  clone(): Input
}
interface Manager {
  stream: Input
  _chunksNeededByRequest: Map<number, unknown>
  requestRange(begin: number, end: number): Promise<void>
  requestAllChunks(noFetch?: boolean): Promise<Input>
}
let Stream: new (length: number, chunkSize: number, manager?: unknown) => Input
let StreamManager: new (reader: unknown, options: unknown) => Manager
let scratch: string
let inspectedPath: string
let inputsForTest: () => Input[]
const importNative = compileFunction('return import(url)', ['url'], {
  importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
}) as (url: string) => Promise<Record<string, unknown>>

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'ieum-pdf-sparse-test-'))
  const worker = await readFile(await buildSparsePdfWorker(), 'utf8')
  inspectedPath = join(scratch, 'inspected-worker.mjs')
  await writeFile(
    inspectedPath,
    worker.replace(
      'this._initSparseStorage(length);',
      'this._initSparseStorage(length); (globalThis.__ieumTestInputs ??= []).push(this);',
    ) +
      '\nexport {ChunkedStream as InspectedStream, ChunkedStreamManager as InspectedManager};\nexport function inputsForTest() { return globalThis.__ieumTestInputs ?? []; }\n',
  )
  const imported = await importNative(pathToFileURL(inspectedPath).href)
  Stream = imported.InspectedStream as typeof Stream
  StreamManager = imported.InspectedManager as typeof StreamManager
  inputsForTest = imported.inputsForTest as typeof inputsForTest
})
afterAll(async () => {
  const inside = relative(resolve(tmpdir()), resolve(scratch))
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`))
    throw new Error('Invalid test cleanup')
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
})

describe('actual patched PDF.js range storage', () => {
  it('does not allocate a file-length array and retains only a bounded recently read window', () => {
    const stream = new Stream(0xfffffff0, 1024 * 1024)
    expect(stream._sparse.bytes).toBe(0)
    expect(stream._sparse.materialized).toBeNull()
    for (let n = 0; n < 40; n++) {
      stream.onReceiveData(n * 1024 * 1024, new Uint8Array(1024 * 1024).fill(n))
      expect(stream.getByteRange(n * 1024 * 1024, n * 1024 * 1024 + 3)).toEqual(
        new Uint8Array([n, n, n]),
      )
      expect(stream._sparse.bytes).toBeLessThanOrEqual(16 * 1024 * 1024)
    }
    expect(() => stream.getByteRange(0, 1)).toThrow()
    stream.onReceiveData(0, new Uint8Array(1024 * 1024).fill(77))
    expect(stream.getByteRange(0, 1)[0]).toBe(77)
  })

  it('handles partial progressive prefixes, chunk-crossing reads and clones after eviction', () => {
    const stream = new Stream(18 * 1024 * 1024 + 3, 1024 * 1024)
    stream.onReceiveProgressiveData(new Uint8Array([1, 2, 3]))
    expect(stream.getBytes(3)).toEqual(new Uint8Array([1, 2, 3]))
    expect(() => stream.getBytes(1)).toThrow()
    stream.onReceiveData(0, new Uint8Array(1024 * 1024).fill(5))
    stream.onReceiveData(1024 * 1024, new Uint8Array(1024 * 1024).fill(9))
    expect(stream.getByteRange(1024 * 1024 - 2, 1024 * 1024 + 2)).toEqual(
      new Uint8Array([5, 5, 9, 9]),
    )
    const sub = stream.makeSubStream(1024 * 1024 - 2, 4)
    expect(sub.clone().getBytes()).toEqual(new Uint8Array([5, 5, 9, 9]))
    for (let i = 2; i < 18; i++) {
      stream.onReceiveData(i * 1024 * 1024, new Uint8Array(1024 * 1024).fill(i))
      stream.getByteRange(i * 1024 * 1024, i * 1024 * 1024 + 1)
    }
    sub.pos = 1024 * 1024 - 2
    expect(() => sub.getBytes()).toThrow()
    expect(stream._sparse.materialized).toBeNull()
  })

  it('refetches evicted data even after download completion and materializes exact original bytes only on request', async () => {
    const size = 18 * 1024 * 1024
    const expected = (at: number, length: number) =>
      Uint8Array.from({ length }, (_, i) => ((at + i) >> 10) & 255)
    const manager = new StreamManager(
      {
        getRangeReader(begin: number, end: number) {
          let done = false
          return {
            async read() {
              if (done) return { done: true }
              done = true
              return { done: false, value: expected(begin, end - begin).buffer }
            },
          }
        },
      },
      {
        length: size,
        rangeChunkSize: 1024 * 1024,
        disableAutoFetch: true,
        msgHandler: { send() {} },
      },
    )
    for (let at = 0; at < size; at += 1024 * 1024) {
      await manager.requestRange(at, at + 1024 * 1024)
      manager.stream.getByteRange(at, at + 1)
    }
    expect(manager.stream.getMissingChunks().length).toBeGreaterThan(0)
    expect(manager._chunksNeededByRequest.size).toBe(0)
    const stream = await manager.requestAllChunks()
    const bytes = stream.bytes
    expect(bytes.length).toBe(size)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      createHash('sha256').update(expected(0, size)).digest('hex'),
    )
    expect(stream._sparse.chunks.size).toBe(0)
  })

  it('keeps text, geometry, form fields, attachments, metadata and raw-data behavior through the parser', async () => {
    const require = createRequire(import.meta.url)
    // A fresh display module prevents another test's cached fake worker selecting stock storage.
    const pdfjs = (await importNative(
      pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href +
        '?ieumSparseInputTest',
    )) as unknown as typeof Pdfjs
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(inspectedPath).href
    const pdf = await PDFDocument.create()
    pdf.setTitle('Sparse input document')
    const page = pdf.addPage([300, 420])
    page.setCropBox(12, 24, 250, 370)
    page.setRotation(degrees(90))
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText('Original text survives range eviction.', { x: 28, y: 200, font, size: 12 })
    const field = pdf.getForm().createTextField('sample')
    field.setText('Field value')
    field.addToPage(page, { x: 30, y: 50, width: 150, height: 25 })
    let value = 0x12345678
    const payload = Uint8Array.from({ length: 256 * 1024 }, () => {
      value ^= value << 13
      value ^= value >>> 17
      value ^= value << 5
      return value & 255
    })
    await pdf.attach(payload, 'payload.bin')
    const bytes = await pdf.save()
    class Ranges extends pdfjs.PDFDataRangeTransport {
      constructor() {
        super(bytes.length, bytes.slice(0, 64), true)
      }
      requestDataRange(begin: number, end: number) {
        queueMicrotask(() => this.onDataRange(begin, bytes.slice(begin, end)))
      }
    }
    const task = pdfjs.getDocument({
      range: new Ranges(),
      rangeChunkSize: 4096,
      disableAutoFetch: true,
      disableStream: true,
      standardFontDataUrl:
        join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replaceAll(
          '\\',
          '/',
        ) + '/',
    })
    try {
      const doc = await task.promise
      expect((await doc.getMetadata()).info).toMatchObject({ Title: 'Sparse input document' })
      const loaded = await doc.getPage(1)
      expect(loaded.view).toEqual([12, 24, 262, 394])
      expect(loaded.rotate).toBe(90)
      const text = await loaded.getTextContent()
      expect(
        text.items
          .filter((item) => 'str' in item)
          .map((item) => (item as { str: string }).str)
          .join(' '),
      ).toContain('Original text survives range eviction.')
      expect((await loaded.getAnnotations()).some((item) => item.fieldName === 'sample')).toBe(true)
      expect(await doc.getFieldObjects()).toHaveProperty('sample')
      expect((await doc.getAttachments())?.has('payload.bin')).toBe(true)
      expect(
        createHash('sha256')
          .update(await doc.getAttachmentContent('payload.bin'))
          .digest('hex'),
      ).toBe(createHash('sha256').update(payload).digest('hex'))
      const inputs = inputsForTest()
      expect(inputs.length).toBeGreaterThan(0)
      expect(inputs.at(-1)!._sparse.materialized).toBeNull()
      expect(
        createHash('sha256')
          .update(await doc.getData())
          .digest('hex'),
      ).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect((await doc.getDownloadInfo()).length).toBe(bytes.length)
    } finally {
      await task.destroy()
    }
  })

  it('rejects upstream worker shapes that no longer match the reviewed patch', () => {
    expect(() => patchPdfjsWorker('class ChunkedStream {}', '')).toThrow(/anchor changed/)
  })
})
