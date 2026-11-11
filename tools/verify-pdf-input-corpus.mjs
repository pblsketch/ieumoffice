/** Compare stock and sparse PDF.js on the same read-only files; not an app benchmark. */
import { createHash } from 'node:crypto'
import { open, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSparsePdfWorker } from '../apps/pdf/scripts/pdfjs-sparse-worker.mjs'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const option = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
if (!option('--inputs') || !option('--out'))
  throw new Error('Use --inputs <private JSON path array> --out <private JSON>')
const inputs = JSON.parse(await readFile(option('--inputs'), 'utf8'))
if (!Array.isArray(inputs) || inputs.some((file) => typeof file !== 'string'))
  throw new Error('Expected an array of file paths')
const base = dirname(require.resolve('pdfjs-dist/package.json')).replaceAll('\\', '/')
const workers = {
  stock: require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  sparse: await buildSparsePdfWorker(),
}
const results = []
for (const [number, file] of inputs.entries()) {
  const before = await stat(file)
  const entry = { number, fileBytes: before.size, file: resolve(file), runs: {} }
  for (const [kind, workerPath] of Object.entries(workers)) {
    const previousWorker = globalThis.pdfjsWorker
    const handle = await open(file, 'r')
    let task
    let reads = 0
    let readBytes = 0
    try {
      globalThis.pdfjsWorker = await import(pathToFileURL(workerPath).href)
      const pdfjs = await import(
        pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href +
          `?ieum-corpus-${number}-${kind}`
      )
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
      class Ranges extends pdfjs.PDFDataRangeTransport {
        constructor() {
          super(before.size, new Uint8Array(0), true)
        }
        requestDataRange(begin, end) {
          void (async () => {
            const bytes = new Uint8Array(end - begin)
            for (let at = 0; at < bytes.length;) {
              const { bytesRead } = await handle.read(bytes, at, bytes.length - at, begin + at)
              if (!bytesRead) throw new Error('Truncated source')
              at += bytesRead
            }
            reads++
            readBytes += bytes.length
            this.onDataRange(begin, bytes)
          })().catch((error) => {
            entry.rangeFailure = String(error)
            void task?.destroy()
          })
        }
      }
      task = pdfjs.getDocument({
        range: new Ranges(),
        rangeChunkSize: 256 * 1024,
        disableAutoFetch: true,
        disableStream: true,
        standardFontDataUrl: `${base}/standard_fonts/`,
        cMapUrl: `${base}/cmaps/`,
        cMapPacked: true,
        wasmUrl: `${base}/wasm/`,
      })
      const doc = await task.promise
      const digest = createHash('sha256')
      const hash = (value) =>
        digest.update(
          JSON.stringify(value, (_key, item) =>
            item instanceof Map ? [...item.entries()] : item,
          ) + '\n',
        )
      hash((await doc.getMetadata()).info)
      hash(await doc.getOutline())
      hash(await doc.getFieldObjects())
      const attachments = await doc.getAttachments()
      hash(attachments)
      for (const name of attachments?.keys() ?? []) {
        const bytes = await doc.getAttachmentContent(name)
        hash(bytes ? createHash('sha256').update(bytes).digest('hex') : null)
      }
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber)
        hash({ pageNumber, view: page.view, rotate: page.rotate, userUnit: page.userUnit })
        hash(await page.getTextContent())
        hash(await page.getAnnotations())
        page.cleanup()
      }
      entry.runs[kind] = {
        pages: doc.numPages,
        semanticHash: digest.digest('hex'),
        reads,
        readBytes,
      }
      console.log(JSON.stringify({ number, kind, pages: doc.numPages, reads, readBytes }))
    } catch (error) {
      entry.runs[kind] = { failure: String(error), reads, readBytes }
      process.exitCode = 1
    } finally {
      await task?.destroy()
      await handle.close()
      if (previousWorker === undefined) delete globalThis.pdfjsWorker
      else globalThis.pdfjsWorker = previousWorker
    }
  }
  const after = await stat(file)
  entry.inputUnchanged =
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  entry.equal =
    !entry.runs.stock.failure &&
    !entry.runs.sparse.failure &&
    entry.runs.stock.semanticHash === entry.runs.sparse.semanticHash
  if (!entry.inputUnchanged || !entry.equal) process.exitCode = 1
  results.push(entry)
}
await writeFile(
  option('--out'),
  JSON.stringify(
    {
      kind: 'engine-semantic-comparison',
      completed: results.every((r) => r.equal && r.inputUnchanged),
      results,
    },
    null,
    2,
  ),
)
