/**
 * The worker side of the engine: takes the screen's messages, runs each job
 * on the core and posts the answer back (protocol.ts). Inputs are asked for
 * one at a time; picture work goes to the screen thread when this worker has
 * no 2d OffscreenCanvas. Kept apart from worker.ts so tests can serve the
 * engine over a fake worker.
 */
import type { EngineCore } from './core'
import type { PictureOps } from './picture'
import {
  isOutOfMemory,
  resultTransfer,
  transferable,
  type FromWorker,
  type JobResult,
  type PictureCall,
  type PictureResult,
  type ToWorker,
} from './protocol'
import type { ToolFile, ToolResultFile } from './types'

/** The parts of a worker's global scope this uses */
export interface HostScope {
  postMessage(message: FromWorker, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: { data: ToWorker }) => void): void
}

interface Waiter<T> {
  resolve(value: T): void
  reject(err: unknown): void
}

/** Thrown in the worker for an input the screen could not read */
class InputFailed extends Error {}

/** The answer for a job that threw instead of answering */
function failureFor(message: ToWorker, outOfMemory: boolean): JobResult | null {
  const reason = outOfMemory ? 'too-large' : 'failed'
  switch (message.type) {
    case 'inspect':
      return {
        kind: 'inspect',
        result: { ok: false, problem: outOfMemory ? 'too-large' : 'unreadable' },
      }
    case 'run':
      return { kind: 'run', result: { ok: false, reason } }
    case 'blank':
      return { kind: 'blank', result: { ok: false, reason } }
    case 'zip':
      return { kind: 'zip', result: { ok: false, outOfMemory } }
    default:
      return null
  }
}

export function serveEngine(
  scope: HostScope,
  makeCore: (pictures: PictureOps) => EngineCore,
  localPictures: PictureOps | null,
): void {
  const inputs = new Map<string, Waiter<Uint8Array>>()
  const pictureCalls = new Map<number, Waiter<PictureResult>>()
  let nextCall = 1

  const post = (message: FromWorker, transfer: Transferable[] = []) =>
    scope.postMessage(message, transfer)

  /** picture work done by the screen thread */
  const askScreen = (request: PictureCall, transfer: ArrayBuffer[]): Promise<PictureResult> =>
    new Promise((resolve, reject) => {
      const call = nextCall++
      pictureCalls.set(call, { resolve, reject })
      post({ type: 'picture', call, request }, transfer)
    })

  const valueOf = <T>(result: PictureResult): T => {
    if (result.ok) return result.value as T
    throw result.outOfMemory ? new RangeError('out of memory') : new Error('picture failed')
  }

  const remotePictures: PictureOps = {
    async decodable(bytes, mime) {
      const sent = transferable(bytes)
      return valueOf<boolean>(
        await askScreen({ op: 'decodable', bytes: sent.bytes, mime }, sent.transfer),
      )
    },
    async toJpeg(bytes, mime) {
      const sent = transferable(bytes)
      return valueOf<Uint8Array | null>(
        await askScreen({ op: 'toJpeg', bytes: sent.bytes, mime }, sent.transfer),
      )
    },
    async recode(source, target) {
      // the source is a view into the PDF: send a copy of just its pixels
      const data = source.kind === 'jpeg' ? source.bytes.slice() : source.samples.slice()
      const copy =
        source.kind === 'jpeg' ? { ...source, bytes: data } : { ...source, samples: data }
      return valueOf<{ jpeg: Uint8Array; width: number; height: number } | null>(
        await askScreen({ op: 'recode', source: copy, target }, [data.buffer]),
      )
    },
  }

  const core = makeCore(localPictures ?? remotePictures)

  const inputKey = (job: number, index: number) => `${job}:${index}`

  /** The files of run `job`, each read from the screen when the core asks for it */
  const filesOf = (job: number, files: { name: string; mime: string }[]): ToolFile[] =>
    files.map((file, index) => ({
      name: file.name,
      mime: file.mime,
      readBytes: () =>
        new Promise<Uint8Array>((resolve, reject) => {
          inputs.set(inputKey(job, index), { resolve, reject })
          post({ type: 'need-input', job, index })
        }),
    }))

  const progressOf = (job: number) => (done: number, total: number) =>
    post({ type: 'progress', job, done, total })

  /** a result file whose bytes can be transferred on their own */
  const own = (file: ToolResultFile): ToolResultFile => ({
    ...file,
    bytes: transferable(file.bytes).bytes,
  })

  async function work(message: ToWorker): Promise<JobResult | null> {
    switch (message.type) {
      case 'inspect':
        return {
          kind: 'inspect',
          result: await core.inspect(message.bytes, message.mime, message.tool),
        }
      case 'run': {
        const result = await core.run(
          message.tool,
          filesOf(message.job, message.files),
          message.options,
          progressOf(message.job),
        )
        return {
          kind: 'run',
          result: result.ok ? { ...result, files: result.files.map(own) } : result,
        }
      }
      case 'blank':
        return {
          kind: 'blank',
          result: await core.findBlankPages(message.bytes, progressOf(message.job)),
        }
      case 'zip':
        return {
          kind: 'zip',
          result: { ok: true, file: own(await core.zip(message.files, message.zipName)) },
        }
      default:
        return null
    }
  }

  scope.addEventListener('message', (event) => {
    const message = event.data
    switch (message.type) {
      case 'input': {
        const key = inputKey(message.job, message.index)
        inputs.get(key)?.resolve(message.bytes)
        inputs.delete(key)
        return
      }
      case 'input-failed': {
        const key = inputKey(message.job, message.index)
        inputs
          .get(key)
          ?.reject(
            message.outOfMemory ? new RangeError('out of memory') : new InputFailed('unreadable'),
          )
        inputs.delete(key)
        return
      }
      case 'picture-done': {
        pictureCalls.get(message.call)?.resolve(message.result)
        pictureCalls.delete(message.call)
        return
      }
      default: {
        const job = message.job
        void work(message)
          .then((result) => {
            if (result) post({ type: 'done', job, result }, resultTransfer(result))
          })
          .catch((err: unknown) => {
            // the screen waits for every job's answer: one that threw still gets one
            const failed = failureFor(message, isOutOfMemory(err))
            if (failed) post({ type: 'done', job, result: failed })
          })
      }
    }
  })
  post({ type: 'ready' })
}
