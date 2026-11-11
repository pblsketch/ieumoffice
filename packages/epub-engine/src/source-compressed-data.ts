/** JSZip's compressed-entry protocol, backed by bounded immutable-source reads. */
import JSZip from 'jszip'
import {
  streamZipSourceCompressed,
  type ZipByteSource,
  type ZipSourcePart,
} from '@genoffice/zip-gate'

interface Worker {
  isPaused: boolean
  isFinished: boolean
  streamInfo: Record<string, unknown>
  resume(): boolean
  cleanUp(): void
  end(): boolean
  error(error: Error): boolean
  push(chunk: { data: Uint8Array; meta: { percent: number } }): void
  pipe(next: Worker): Worker
  withStreamInfo(key: string, value: unknown): Worker
  on(event: string, listener: (this: Worker, chunk: { data: Uint8Array }) => void): Worker
}

interface CompressedData {
  compressedSize: number
  uncompressedSize: number
  crc32: number
  compression: { magic: string; uncompressWorker(): Worker }
  getCompressedWorker(): Worker
  getContentWorker(): Worker
}

let templates: Promise<{ stored: CompressedData; deflated: CompressedData }> | undefined

function dataTemplates() {
  // Derive prototypes from the same JSZip runtime. Importing private CJS classes
  // breaks instanceof checks in browser builds that use JSZip's bundled runtime.
  return (templates ??= (async () => {
    const zip = new JSZip()
    zip.file('stored', new Uint8Array([1]), { compression: 'STORE' })
    zip.file('deflated', new Uint8Array([1]), { compression: 'DEFLATE' })
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    const data = (name: string) =>
      (loaded.files[name] as unknown as { _data: CompressedData })._data
    return { stored: data('stored'), deflated: data('deflated') }
  })())
}

export async function sourceCompressedData(source: ZipByteSource, part: ZipSourcePart) {
  const { stored, deflated } = await dataTemplates()
  const template = part.method === 0 ? stored : deflated
  // JSZip's inherits helper deliberately omits .constructor. Clone a fresh
  // paused worker's state, retaining its real prototype rather than reading
  // .constructor (which is Object). Its pending promise belongs to the sample,
  // so this copy stays unready and is driven exclusively by our range pump.
  const initialize = function (this: Worker) {
    Object.assign(this, stored.getCompressedWorker())
  }
  initialize.prototype = Object.getPrototypeOf(stored.getCompressedWorker())
  const Base = initialize as unknown as new () => Worker

  class SourceWorker extends Base {
    private reader?: ReadableStreamDefaultReader<Uint8Array>
    private pending?: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>
    private pumping = false
    private count = 0

    constructor() {
      // The inherited worker remains unready; only our pump supplies chunks.
      super()
    }

    override resume(): boolean {
      const resumed = super.resume()
      if (resumed && !this.pumping && !this.isFinished) {
        this.pumping = true
        void this.pump().catch((error: unknown) => {
          this.error(error instanceof Error ? error : new Error(String(error)))
        })
      }
      return resumed
    }

    private async pump(): Promise<void> {
      try {
        // JSZip constructs all entry workers up front, but resumes only one.
        this.reader ??= streamZipSourceCompressed(source, part).getReader()
        while (!this.isPaused && !this.isFinished) {
          const next = this.pending ?? (await this.reader.read())
          this.pending = undefined
          if (this.isFinished) return
          if (this.isPaused) {
            this.pending = next
            return
          }
          if (next.done) {
            this.end()
            return
          }
          this.count += next.value.length
          this.push({
            data: next.value,
            meta: { percent: part.csize ? (this.count / part.csize) * 100 : 100 },
          })
        }
      } finally {
        this.pumping = false
      }
    }

    override cleanUp(): void {
      const reader = this.reader
      this.reader = undefined
      this.pending = undefined
      if (reader)
        void reader
          .cancel()
          .catch(() => {})
          .finally(() => reader.releaseLock())
      super.cleanUp()
    }
  }

  const data = Object.create(Object.getPrototypeOf(template)) as CompressedData
  Object.assign(data, {
    compressedSize: part.csize,
    uncompressedSize: part.usize,
    crc32: new DataView(part.centralHeader.buffer, part.centralHeader.byteOffset).getInt32(
      16,
      true,
    ),
    compression: template.compression,
    getCompressedWorker() {
      return new SourceWorker()
        .withStreamInfo('compressedSize', part.csize)
        .withStreamInfo('uncompressedSize', part.usize)
        .withStreamInfo('crc32', data.crc32)
        .withStreamInfo('compression', data.compression)
    },
    getContentWorker() {
      let length = 0
      return new SourceWorker()
        .pipe(data.compression.uncompressWorker())
        .on('data', function (chunk) {
          length += chunk.data.length
        })
        .on('end', function () {
          if (length !== part.usize)
            throw new Error(`zip: uncompressed size mismatch for ${part.name}`)
        })
    },
  })
  return data
}
