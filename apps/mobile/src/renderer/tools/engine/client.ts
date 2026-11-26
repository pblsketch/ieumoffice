/**
 * The screen-side handle on the PDF tools engine (spec 6). Every call is a
 * job for one module worker (worker.ts); jobs run one at a time in the order
 * they were asked for. Inputs are read here one at a time, when the worker
 * asks for them, and handed over without a copy. [Stop] ends the worker at
 * once (`terminate`); the next call starts a fresh one. A worker that dies
 * (the web view ran out of memory) or a tool that ran out of memory answers
 * "too large", and its worker is replaced too, so a full heap is not reused.
 *
 * This module and the ones it imports carry no pdf-lib, PDFium or qpdf code:
 * those load only inside the worker.
 */
import { canvasPictures, elementSurface, answerPicture, type PictureOps } from './picture'
import {
  isOutOfMemory,
  transferable,
  type FromWorker,
  type JobResult,
  type ToWorker,
} from './protocol'
import type { RgbaThumb } from './core'
import type {
  BlankCandidateView,
  BlankPagesOutcome,
  InspectResult,
  PdfToolId,
  PdfToolOptions,
  PdfToolsEngine,
  ToolFile,
  ToolResultFile,
  ToolRunOutcome,
} from './types'

export type {
  BlankCandidateView,
  BlankPagesOutcome,
  PdfToolsEngine,
  ToolFile,
  ToolResultFile,
  ToolResultMime,
  ToolRunFailure,
  ToolRunOutcome,
} from './types'

/** Why a call ended without its answer: [Stop], too little memory, or a failure */
export type EngineEnding = 'stopped' | 'too-large' | 'failed'

/**
 * How `inspect` (on [Stop] only) and `zip` (on every failure) reject; every
 * other answer is a value.
 */
export class PdfToolsEngineError extends Error {
  constructor(readonly reason: EngineEnding) {
    super(`pdf tools engine: ${reason}`)
  }
}

/** The parts of a Worker the engine uses */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: { data: FromWorker }) => void): void
  addEventListener(type: 'error' | 'messageerror', listener: (event: unknown) => void): void
  terminate(): void
}

export interface PdfToolsEngineOptions {
  /** the worker to start (tests); by default the bundled module worker */
  createWorker?: () => WorkerLike
  /** picture work done on the screen thread for a worker without a 2d OffscreenCanvas */
  pictures?: PictureOps
}

function startWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike
}

/** What a job may do while it is the one running */
interface JobContext {
  readonly id: number
  /** whether this job's worker is still the engine's and the job has not ended */
  alive(): boolean
  post(message: ToWorker, transfer?: Transferable[]): void
  /** the job is over: the next one starts */
  finish(): void
  /** replace the worker once this job is over (it ran out of memory) */
  recycle(): void
}

interface Job {
  begin(ctx: JobContext): void
  message(message: FromWorker, ctx: JobContext): void
  /** settle without an answer */
  end(ending: EngineEnding): void
}

/** An RGBA thumbnail as ImageData (a plain object of that shape where ImageData does not exist) */
function toImageData(thumb: RgbaThumb): ImageData {
  if (typeof ImageData === 'function') return new ImageData(thumb.rgba, thumb.width, thumb.height)
  return {
    data: thumb.rgba,
    width: thumb.width,
    height: thumb.height,
    colorSpace: 'srgb',
  } as unknown as ImageData
}

/** Read `file`, or why not */
async function readFile(
  file: ToolFile,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; outOfMemory: boolean }> {
  try {
    return { ok: true, bytes: await file.readBytes() }
  } catch (err) {
    return { ok: false, outOfMemory: isOutOfMemory(err) }
  }
}

const doneResult = (message: FromWorker): JobResult | null =>
  message.type === 'done' ? message.result : null

export function createPdfToolsEngine(options: PdfToolsEngineOptions = {}): PdfToolsEngine {
  const createWorker = options.createWorker ?? startWorker
  let screenPictures = options.pictures ?? null
  let worker: WorkerLike | null = null
  let running: { id: number; job: Job; worker: WorkerLike; recycle: boolean } | null = null
  const queue: { id: number; job: Job }[] = []
  let nextId = 1
  let disposed = false

  const dropWorker = () => {
    worker?.terminate()
    worker = null
  }

  const onMessage = (from: WorkerLike, message: FromWorker) => {
    if (from !== worker) return
    if (message.type === 'picture') {
      screenPictures ??= canvasPictures(elementSurface)
      void answerPicture(screenPictures, message.request).then(({ result, transfer }) => {
        if (from === worker) {
          from.postMessage({ type: 'picture-done', call: message.call, result }, transfer)
        }
      })
      return
    }
    if (!running || running.worker !== from || message.job !== running.id) return
    running.job.message(message, contextOf(running))
  }

  const ensureWorker = (): WorkerLike => {
    if (worker) return worker
    const made = createWorker()
    made.addEventListener('message', (event) => onMessage(made, event.data))
    // a worker that dies (out of memory) ends its job as too large
    made.addEventListener('error', () => {
      if (made !== worker) return
      dropWorker()
      endRunning('too-large')
    })
    made.addEventListener('messageerror', () => {
      if (made === worker) endRunning('failed')
    })
    worker = made
    return made
  }

  function contextOf(entry: NonNullable<typeof running>): JobContext {
    return {
      id: entry.id,
      alive: () => running === entry && worker === entry.worker,
      post: (message, transfer = []) => {
        if (running === entry && worker === entry.worker)
          entry.worker.postMessage(message, transfer)
      },
      finish: () => {
        if (running !== entry) return
        running = null
        if (entry.recycle && worker === entry.worker) dropWorker()
        pump()
      },
      recycle: () => {
        entry.recycle = true
      },
    }
  }

  function endRunning(ending: EngineEnding) {
    const entry = running
    if (!entry) return
    running = null
    entry.job.end(ending)
    pump()
  }

  function pump() {
    if (running || queue.length === 0) return
    const next = queue.shift()!
    let started: WorkerLike
    try {
      started = ensureWorker()
    } catch {
      // this web view cannot start the worker
      next.job.end('failed')
      pump()
      return
    }
    const entry = { ...next, worker: started, recycle: false }
    running = entry
    entry.job.begin(contextOf(entry))
  }

  function enqueue(job: Job) {
    if (disposed) {
      job.end('stopped')
      return
    }
    queue.push({ id: nextId++, job })
    pump()
  }

  /** a job that reads one file and sends it in `first(bytes)` */
  function oneFileJob(
    file: ToolFile,
    first: (bytes: Uint8Array, job: number) => ToWorker,
    settle: { done(result: JobResult, ctx: JobContext): void; end(ending: EngineEnding): void },
  ): Job {
    return {
      begin(ctx) {
        void readFile(file).then((read) => {
          if (!ctx.alive()) return
          if (!read.ok) {
            settle.end(read.outOfMemory ? 'too-large' : 'failed')
            ctx.finish()
            return
          }
          const sent = transferable(read.bytes)
          ctx.post(first(sent.bytes, ctx.id), sent.transfer)
        })
      },
      message(message, ctx) {
        const result = doneResult(message)
        if (result) settle.done(result, ctx)
      },
      end: (ending) => settle.end(ending),
    }
  }

  const engine: PdfToolsEngine = {
    inspect(file, tool) {
      return new Promise<InspectResult & { sizeBytes: number }>((resolve, reject) => {
        let sizeBytes = 0
        enqueue(
          oneFileJob(
            file,
            (bytes, job) => {
              sizeBytes = bytes.length
              return { type: 'inspect', job, tool, mime: file.mime, bytes }
            },
            {
              done(result, ctx) {
                if (result.kind !== 'inspect') return
                if (!result.result.ok && result.result.problem === 'too-large') ctx.recycle()
                resolve({ ...result.result, sizeBytes })
                ctx.finish()
              },
              end(ending) {
                if (ending === 'stopped') reject(new PdfToolsEngineError('stopped'))
                else
                  resolve({
                    ok: false,
                    problem: ending === 'too-large' ? 'too-large' : 'unreadable',
                    sizeBytes,
                  })
              },
            },
          ),
        )
      })
    },

    run(tool: PdfToolId, files: readonly ToolFile[], toolOptions: PdfToolOptions, onProgress) {
      return new Promise<ToolRunOutcome>((resolve) => {
        enqueue({
          begin(ctx) {
            ctx.post({
              type: 'run',
              job: ctx.id,
              tool,
              files: files.map((file) => ({ name: file.name, mime: file.mime })),
              options: toolOptions,
            })
          },
          message(message, ctx) {
            if (message.type === 'need-input') {
              const file = files[message.index]
              const { index } = message
              if (!file) {
                ctx.post({ type: 'input-failed', job: ctx.id, index, outOfMemory: false })
                return
              }
              // one input at a time: the worker asks for the next once it used this one
              void readFile(file).then((read) => {
                if (!ctx.alive()) return
                if (!read.ok) {
                  ctx.post({
                    type: 'input-failed',
                    job: ctx.id,
                    index,
                    outOfMemory: read.outOfMemory,
                  })
                  return
                }
                const sent = transferable(read.bytes)
                ctx.post({ type: 'input', job: ctx.id, index, bytes: sent.bytes }, sent.transfer)
              })
            } else if (message.type === 'progress') {
              onProgress?.(message.done, message.total)
            } else if (message.type === 'done' && message.result.kind === 'run') {
              const outcome = message.result.result
              if (!outcome.ok && outcome.reason === 'too-large') ctx.recycle()
              resolve(outcome)
              ctx.finish()
            }
          },
          end: (reason) => resolve({ ok: false, reason }),
        })
      })
    },

    findBlankPages(file, onProgress) {
      return new Promise<BlankPagesOutcome>((resolve) => {
        const job = oneFileJob(file, (bytes, id) => ({ type: 'blank', job: id, bytes }), {
          done(result, ctx) {
            if (result.kind !== 'blank') return
            const found = result.result
            if (!found.ok) {
              if (found.reason === 'too-large') ctx.recycle()
              resolve(found)
            } else {
              const candidates: BlankCandidateView[] = found.candidates.map((c) => ({
                page: c.page,
                reason: c.reason,
                thumb: c.thumb ? toImageData(c.thumb) : null,
              }))
              resolve({ ok: true, pageCount: found.pageCount, candidates })
            }
            ctx.finish()
          },
          end: (reason) => resolve({ ok: false, reason }),
        })
        enqueue({
          begin: job.begin,
          message(message, ctx) {
            if (message.type === 'progress') onProgress?.(message.done, message.total)
            else job.message(message, ctx)
          },
          end: job.end,
        })
      })
    },

    zip(files: readonly ToolResultFile[], zipName: string) {
      return new Promise<ToolResultFile>((resolve, reject) => {
        enqueue({
          begin(ctx) {
            // copied, not transferred: the screen keeps every part for its own buttons
            ctx.post({ type: 'zip', job: ctx.id, files: [...files], zipName })
          },
          message(message, ctx) {
            const result = doneResult(message)
            if (!result || result.kind !== 'zip') return
            if (result.result.ok) resolve(result.result.file)
            else {
              if (result.result.outOfMemory) ctx.recycle()
              reject(new PdfToolsEngineError(result.result.outOfMemory ? 'too-large' : 'failed'))
            }
            ctx.finish()
          },
          end: (reason) => reject(new PdfToolsEngineError(reason)),
        })
      })
    },

    stop() {
      dropWorker()
      const ended = [...(running ? [running] : []), ...queue.splice(0)]
      running = null
      for (const entry of ended) entry.job.end('stopped')
    },

    dispose() {
      disposed = true
      engine.stop()
    },
  }
  return engine
}
