/** View-scoped capabilities for immutable bytes and off-thread page bitmaps. */
import { randomUUID } from 'node:crypto'
import type { PdfViewBitmap, PdfViewRenderRequest, PdfViewSource } from '../shared/view-source'
import { snapshotPdfViewFile, type PdfViewFile } from './view-file'
import { validViewBitmapSize, validViewTile } from './view-render-core'
import { PdfViewRenderWorker } from './view-render-worker'

interface Source {
  owner: number
  file: PdfViewFile
  closing?: Promise<void>
}

export class PdfViewSources {
  private readonly sources = new Map<string, Source>()
  private readonly generations = new Map<number, number>()
  private readonly opening = new Map<number, number>()
  constructor(
    private readonly cacheDir: string,
    private readonly renderer: Pick<PdfViewRenderWorker, 'render' | 'cancel' | 'close'> &
      Partial<Pick<PdfViewRenderWorker, 'prepare'>> = new PdfViewRenderWorker(),
  ) {}

  async open(
    owner: number,
    path: string,
    replacement?: Uint8Array,
  ): Promise<{ source: PdfViewSource; file: PdfViewFile }> {
    const count = [...this.sources.values()].filter((source) => source.owner === owner).length
    if (count + (this.opening.get(owner) ?? 0) >= 4)
      throw new Error('pdf: too many opening view sources')
    const generation = this.generations.get(owner) ?? 0
    this.opening.set(owner, (this.opening.get(owner) ?? 0) + 1)
    let file: PdfViewFile | undefined
    try {
      file = await snapshotPdfViewFile(path, this.cacheDir, replacement)
      const initialData = await file.read(0, Math.min(file.size, 64 * 1024))
      if (generation !== (this.generations.get(owner) ?? 0))
        throw new Error('pdf: view closed while opening')
      const id = randomUUID()
      this.sources.set(id, { owner, file })
      // Compile the existing WASM renderer while PDF.js builds its interaction
      // model, rather than adding that work after the first canvas is requested.
      if (!file.hasXfa && file.size <= 0xffffffff) void this.renderer.prepare?.(id).catch(() => {})
      return {
        source: {
          id,
          length: file.size,
          hasXfa: file.hasXfa,
          initialData: initialData.buffer as ArrayBuffer,
        },
        file,
      }
    } catch (error) {
      await file?.close()
      throw error
    } finally {
      const pending = (this.opening.get(owner) ?? 1) - 1
      if (pending) this.opening.set(owner, pending)
      else this.opening.delete(owner)
    }
  }

  private owned(owner: number, id: unknown): Source {
    const source = typeof id === 'string' ? this.sources.get(id) : undefined
    if (!source || source.owner !== owner || source.closing)
      throw new Error('pdf: view source not granted')
    return source
  }

  read(owner: number, id: unknown, offset: number, length: number): Promise<ArrayBuffer> {
    return this.owned(owner, id)
      .file.read(offset, length)
      .then((bytes) => bytes.buffer as ArrayBuffer)
  }

  render(owner: number, request: PdfViewRenderRequest): Promise<PdfViewBitmap> {
    if (
      !request ||
      typeof request.requestId !== 'string' ||
      !request.requestId ||
      request.requestId.length > 128 ||
      !Number.isSafeInteger(request.page) ||
      request.page < 1 ||
      !validViewBitmapSize(request.width, request.height) ||
      !validViewTile(request.width, request.height, request.tile) ||
      ![0, 1, 2, 3].includes(request.rotation) ||
      (request.password !== undefined && typeof request.password !== 'string')
    )
      return Promise.reject(new Error('pdf: invalid view render request'))
    const { file } = this.owned(owner, request.sourceId)
    return this.renderer.render(file.fd, file.size, request).then((bitmap) => ({
      ...bitmap,
      rgba: (bitmap.rgba.byteOffset === 0 &&
      bitmap.rgba.byteLength === bitmap.rgba.buffer.byteLength
        ? bitmap.rgba.buffer
        : bitmap.rgba.slice().buffer) as ArrayBuffer,
    }))
  }

  cancel(owner: number, id: unknown, requestId: unknown): void {
    this.owned(owner, id)
    if (typeof requestId === 'string') this.renderer.cancel(id as string, requestId)
  }

  close(owner: number, id: unknown): Promise<void> {
    const source = typeof id === 'string' ? this.sources.get(id) : undefined
    if (!source) return Promise.resolve()
    if (source.owner !== owner) return Promise.reject(new Error('pdf: view source not granted'))
    return (source.closing ??= (async () => {
      try {
        await this.renderer.close(id as string)
      } finally {
        await source.file.close()
        this.sources.delete(id as string)
      }
    })())
  }

  async closeOwner(owner: number): Promise<void> {
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1)
    await Promise.all(
      [...this.sources]
        .filter(([, source]) => source.owner === owner)
        .map(([id]) => this.close(owner, id)),
    )
  }
}
