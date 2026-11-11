/** Bounded, cancellable scheduling; only the active job crosses into the worker. */
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { PdfViewRenderRequest } from '../shared/view-source'
import type { PdfViewPixelBitmap } from './view-worker-protocol'
import type { PdfViewWorkerRequest, PdfViewWorkerResponse } from './view-worker-protocol'
import { pdfiumWasmPath } from './wasm-path'
import { releaseOwnedBuffer } from './owned-buffer'

export interface ViewWorker {
  postMessage(message: PdfViewWorkerRequest): void
  on(event: 'message', callback: (response: PdfViewWorkerResponse) => void): unknown
  on(event: 'error', callback: (error: Error) => void): unknown
  on(event: 'exit', callback: (code: number) => void): unknown
  unref(): void
  terminate(): Promise<number>
}

interface Job {
  message: PdfViewWorkerRequest
  sourceId: string
  requestId?: string
  thumbnail: boolean
  cancelled: boolean
  resolve: (bitmap?: PdfViewPixelBitmap) => void
  reject: (error: Error) => void
}

export class PdfViewRenderWorker {
  private worker?: ViewWorker
  private active?: Job
  private queue: Job[] = []
  private serial = 0
  private terminating: Promise<unknown> = Promise.resolve()
  private readonly opened = new Set<string>()
  constructor(
    private readonly createWorker: () => ViewWorker = () =>
      new Worker(join(__dirname, 'pdf-view-worker.js'), {
        workerData: { wasmPath: pdfiumWasmPath() },
      }),
  ) {}

  prepare(sourceId: string): Promise<void> {
    if (this.queue.length >= 64) return Promise.reject(new Error('pdf: view render queue is full'))
    return new Promise<void>((resolve, reject) => {
      this.queue.push({
        message: { id: ++this.serial, type: 'prepare', sourceId },
        sourceId,
        thumbnail: false,
        cancelled: false,
        resolve: () => resolve(),
        reject,
      })
      this.pump()
    })
  }

  render(fd: number, length: number, request: PdfViewRenderRequest): Promise<PdfViewPixelBitmap> {
    if (this.queue.length >= 64) return Promise.reject(new Error('pdf: view render queue is full'))
    if (
      [this.active, ...this.queue].some(
        (job) => job?.sourceId === request.sourceId && job.requestId === request.requestId,
      )
    )
      return Promise.reject(new Error('pdf: duplicate view render request'))
    return new Promise<PdfViewPixelBitmap>((resolve, reject) => {
      this.queue.push({
        message: { id: ++this.serial, type: 'render', fd, length, request },
        sourceId: request.sourceId,
        requestId: request.requestId,
        thumbnail: request.thumbnail === true,
        cancelled: false,
        resolve: (bitmap) =>
          bitmap ? resolve(bitmap) : reject(new Error('pdf: missing view bitmap')),
        reject,
      })
      this.pump()
    })
  }

  cancel(sourceId: string, requestId: string): void {
    for (const job of [this.active, ...this.queue]) {
      if (!job || job.sourceId !== sourceId || job.requestId !== requestId || job.cancelled)
        continue
      job.cancelled = true
      job.reject(new Error('pdf: view render cancelled'))
    }
    this.queue = this.queue.filter((job) => !job.cancelled)
  }

  async close(sourceId: string): Promise<void> {
    for (const job of [this.active, ...this.queue]) {
      if (job?.sourceId === sourceId && job.requestId !== undefined)
        this.cancel(sourceId, job.requestId)
    }
    await this.terminating
    if (!this.worker && !this.active && !this.queue.length) return
    return new Promise<void>((resolve, reject) => {
      this.queue.unshift({
        message: { id: ++this.serial, type: 'close', sourceId },
        sourceId,
        thumbnail: false,
        cancelled: false,
        resolve: () => resolve(),
        reject,
      })
      this.pump()
    })
  }

  private pump(): void {
    if (this.active || !this.queue.length) return
    try {
      if (!this.worker) {
        const worker = this.createWorker()
        this.worker = worker
        worker.on('message', (response) => {
          if (this.worker !== worker || response.id !== this.active?.message.id) return
          if (!response.ok && this.active.message.type === 'close') {
            this.failWorker(worker, new Error(response.error))
            return
          }
          const done = this.active
          this.active = undefined
          if (done.message.type === 'close') this.opened.delete(done.sourceId)
          if (!done.cancelled) {
            if (response.ok) done.resolve(response.bitmap)
            else done.reject(new Error(response.error))
          } else if (response.ok && response.bitmap) {
            releaseOwnedBuffer(response.bitmap.rgba.buffer as ArrayBuffer)
          }
          this.pump()
          if (this.worker === worker && !this.opened.size && !this.active && !this.queue.length) {
            this.worker = undefined
            this.terminating = worker.terminate()
          }
        })
        worker.on('error', (error) => this.failWorker(worker, error))
        worker.on('exit', (code) =>
          this.failWorker(worker, new Error(`pdf: view worker exited (${code})`)),
        )
        worker.unref()
      }
      const index = this.queue.findIndex((job) => !job.thumbnail)
      this.active = this.queue.splice(index < 0 ? 0 : index, 1)[0]!
      if (this.active.message.type !== 'close') this.opened.add(this.active.sourceId)
      this.worker.postMessage(this.active.message)
    } catch (error) {
      const reason = error instanceof Error ? error : new Error('pdf: cannot start view worker')
      if (this.worker) this.failWorker(this.worker, reason)
      else {
        this.active?.reject(reason)
        this.active = undefined
        for (const job of this.queue) job.reject(reason)
        this.queue = []
      }
    }
  }

  private failWorker(worker: ViewWorker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = undefined
    const abandoned = [this.active, ...this.queue]
    this.active = undefined
    this.queue = []
    this.opened.clear()
    this.terminating = worker.terminate().then(() => {
      for (const job of abandoned) job?.reject(error)
    })
  }
}
