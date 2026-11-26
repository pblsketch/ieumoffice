/**
 * Messages between the screen (client.ts) and the engine worker (host.ts).
 * One job runs at a time. Input bytes cross one file at a time, when the
 * worker asks for them, and are transferred, not copied; result bytes come
 * back the same way. Passwords travel only inside a run's options and are
 * never put in any other message.
 */
import type { SourceImage } from '@genoffice/pdf-ops'
import type { CoreBlankOutcome } from './core'
import type {
  InspectResult,
  PdfToolId,
  PdfToolOptions,
  ToolResultFile,
  ToolRunOutcome,
} from './types'

export type ToWorker =
  | { type: 'inspect'; job: number; tool: PdfToolId; mime: string; bytes: Uint8Array }
  | {
      type: 'run'
      job: number
      tool: PdfToolId
      files: { name: string; mime: string }[]
      options: PdfToolOptions
    }
  | { type: 'blank'; job: number; bytes: Uint8Array }
  | { type: 'zip'; job: number; files: ToolResultFile[]; zipName: string }
  /** the input the worker asked for */
  | { type: 'input'; job: number; index: number; bytes: Uint8Array }
  /** the input could not be read; `outOfMemory` when reading it ran out of memory */
  | { type: 'input-failed'; job: number; index: number; outOfMemory: boolean }
  /** the screen thread's answer to a picture call */
  | { type: 'picture-done'; call: number; result: PictureResult }

export type PictureCall =
  | { op: 'decodable'; bytes: Uint8Array; mime: string }
  | { op: 'toJpeg'; bytes: Uint8Array; mime: string }
  | { op: 'recode'; source: SourceImage; target: { longSide: number; quality: number } }

export type PictureResult =
  | {
      ok: true
      value: boolean | Uint8Array | { jpeg: Uint8Array; width: number; height: number } | null
    }
  | { ok: false; outOfMemory: boolean }

export type JobResult =
  | { kind: 'inspect'; result: InspectResult }
  | { kind: 'run'; result: ToolRunOutcome }
  | { kind: 'blank'; result: CoreBlankOutcome }
  | {
      kind: 'zip'
      result: { ok: true; file: ToolResultFile } | { ok: false; outOfMemory: boolean }
    }

export type FromWorker =
  /** the worker script loaded and is listening (sent once, first) */
  | { type: 'ready' }
  | { type: 'need-input'; job: number; index: number }
  | { type: 'progress'; job: number; done: number; total: number }
  | { type: 'done'; job: number; result: JobResult }
  /** picture work for the screen thread (the worker has no 2d OffscreenCanvas) */
  | { type: 'picture'; call: number; request: PictureCall }

/**
 * The buffer to transfer for `bytes`, and the array to send: the array itself
 * when it spans its whole buffer, else a copy of just its range (sending a
 * view would carry its whole buffer along, and detaching that buffer would
 * take the rest of it from the sender).
 */
export function transferable(bytes: Uint8Array): { bytes: Uint8Array; transfer: ArrayBuffer[] } {
  const whole =
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  const own = whole ? bytes : bytes.slice()
  return { bytes: own, transfer: [own.buffer as ArrayBuffer] }
}

/** Every buffer of a result to transfer back */
export function resultTransfer(result: JobResult): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = []
  if (result.kind === 'run' && result.result.ok) {
    for (const file of result.result.files) buffers.push(file.bytes.buffer as ArrayBuffer)
  } else if (result.kind === 'blank' && result.result.ok) {
    for (const c of result.result.candidates) if (c.thumb) buffers.push(c.thumb.rgba.buffer)
  } else if (result.kind === 'zip' && result.result.ok) {
    buffers.push(result.result.file.bytes.buffer as ArrayBuffer)
  }
  // a buffer listed twice cannot be transferred
  return [...new Set(buffers)]
}

/**
 * Whether `err` means the device ran out of memory: a RangeError (an array
 * that could not be made), or an emscripten abort because the wasm heap could
 * not grow.
 */
export function isOutOfMemory(err: unknown): boolean {
  if (err instanceof RangeError) return true
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /out of memory|\bOOM\b|cannot enlarge memory|allocation failed/i.test(message)
}
