import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(import.meta.url)

/** Deliberately fail on upstream shape changes rather than silently ship a partial patch. */
export function patchPdfjsWorker(original, storage) {
  const replace = (before, after) => {
    if (original.split(before).length !== 2)
      throw new Error(`PDF.js sparse patch anchor changed: ${before.slice(0, 65)}`)
    original = original.replace(before, after)
  }
  replace(
    'super(new Uint8Array(length), 0, length, null);',
    'super(new Uint8Array(0), 0, length, null);',
  )
  replace(
    'this.manager = manager;\n  }\n  getMissingChunks()',
    'this.manager = manager;\n    this._initSparseStorage(length);\n  }\n  getMissingChunks()',
  )
  const install = storage.replace(
    'export function installSparseChunkStorage',
    'function installSparseChunkStorage',
  )
  replace(
    'class ChunkedStreamManager {',
    `${install}\ninstallSparseChunkStorage(ChunkedStream, MissingDataException);\nclass ChunkedStreamManager {`,
  )
  replace(
    `requestAllChunks(noFetch = false) {
    if (!noFetch) {
      const missingChunks = this.stream.getMissingChunks();
      this._requestChunks(missingChunks);
    }
    return this.#loadedStreamCapability.promise;
  }`,
    `requestAllChunks(noFetch = false) {
    if (noFetch) return this.#loadedStreamCapability.promise;
    this.stream._sparse.pinAll = true;
    return this._requestChunks(this.stream.getMissingChunks()).then(() => this.stream);
  }`,
  )
  replace(
    'if (stream.isDataLoaded) {\n      this.#loadedStreamCapability.resolve(stream);',
    'if (stream._sparse.ever.size === stream.numChunks) {\n      this.#loadedStreamCapability.resolve(stream);',
  )
  replace(
    'if (chunksNeeded.size === 0) {\n      return Promise.resolve();',
    'if (chunksNeeded.size === 0) {\n      this._chunksNeededByRequest.delete(requestId);\n      return Promise.resolve();',
  )
  replace(
    'this._promisesByRequest.delete(requestId);\n      capability.resolve();',
    'this._promisesByRequest.delete(requestId);\n      this._chunksNeededByRequest.delete(requestId);\n      capability.resolve();',
  )
  replace(
    'loaded: MathClamp(stream.numChunksLoaded * chunkSize, stream.progressiveDataLength, length),',
    'loaded: MathClamp(stream._sparse.ever.size * chunkSize, stream.progressiveDataLength, length),',
  )
  replace(
    'length: stream.bytes.byteLength',
    'length: stream._sparse?.length ?? stream.bytes.byteLength',
  )
  replace(
    'new Uint8Array(stream.bytes.buffer, stream.start, stream.end - stream.start)',
    'stream.getByteRange(stream.start, stream.end)',
  )
  return (
    '// IeumOffice modification: bounded sparse range input; PDF.js parser and license retained.\n' +
    original.replace(/\/\/# sourceMappingURL=.*$/m, '')
  )
}

export async function buildSparsePdfWorker() {
  const path = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const [original, storage] = await Promise.all([
    readFile(path, 'utf8'),
    readFile(new URL('./pdfjs-sparse-storage.mjs', import.meta.url), 'utf8'),
  ])
  if (
    createHash('sha256').update(original).digest('hex') !==
    'b4e582882f5e811f4d1b7b511f68d9a0c3209141e6f68856f01408c5cc155131'
  )
    throw new Error(
      'PDF.js worker changed; review sparse input adaptation before updating its source fingerprint',
    )
  const patched = patchPdfjsWorker(
    original.replaceAll('\r\n', '\n'),
    storage.replaceAll('\r\n', '\n'),
  )
  const digest = createHash('sha256').update(patched).digest('hex').slice(0, 20)
  const dir = join(root, 'working_dir', 'pdfjs')
  await mkdir(dir, { recursive: true })
  const output = join(dir, `pdf.worker.sparse-${digest}.mjs`)
  await writeFile(output, patched, { flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error
    if ((await readFile(output, 'utf8')) !== patched) await writeFile(output, patched)
  })
  return output
}

export function sparsePdfWorkerPlugin() {
  let worker
  return {
    name: 'ieum-pdfjs-sparse-input',
    enforce: 'pre',
    async resolveId(source) {
      if (source !== 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url') return null
      worker ??= buildSparsePdfWorker()
      return `${await worker}?url`
    },
  }
}
