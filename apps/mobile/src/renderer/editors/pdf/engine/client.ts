/**
 * Calling side of the mobile PDF engine. `createPdfEngineClient` runs the
 * engine in one reused web worker, started on the first call and stopped
 * after it has been idle a while (or on `dispose()`), so PDFium's memory is
 * given back. It rejects with an `Error` whose message is the engine's own,
 * e.g. `save-verify-failed pages=2: …` or `not available on mobile: …`.
 * (./inThread runs the same operations in the calling thread, for tests.)
 *
 * Nothing here imports the engine itself: only the worker bundle holds it.
 */
import type { PdfEngineCore, PdfEngineOp } from './core'
import type { PdfEngineRequest, PdfEngineResponse } from './protocol'
import { PDF_ENGINE_OPS, errorFrom } from './protocol'

type EngineMethods = {
  [Op in PdfEngineOp]: (...args: Parameters<PdfEngineCore[Op]>) => ReturnType<PdfEngineCore[Op]>
}

export interface PdfEngine extends EngineMethods {
  /** Stop the worker and reject what is still pending; a later call starts a new one */
  dispose(): void
}

/** The part of `Worker` the client uses (tests pass a fake) */
export interface EngineWorkerLike {
  postMessage(message: PdfEngineRequest): void
  terminate(): void
  onmessage: ((event: { data: PdfEngineResponse }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

export interface PdfEngineClientOptions {
  createWorker?: () => EngineWorkerLike
  /** Stop the worker after this long without a pending request (default one minute) */
  idleMs?: number
}

export const DEFAULT_ENGINE_IDLE_MS = 60_000

function startEngineWorker(): EngineWorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'ieum-pdf-engine',
  }) as unknown as EngineWorkerLike
}

export function engineFrom(
  call: (op: PdfEngineOp, args: unknown[]) => Promise<unknown>,
  dispose: () => void,
) {
  const engine = { dispose } as Record<string, unknown>
  for (const op of PDF_ENGINE_OPS) engine[op] = (...args: unknown[]) => call(op, args)
  return engine as unknown as PdfEngine
}

export function createPdfEngineClient(options: PdfEngineClientOptions = {}): PdfEngine {
  const createWorker = options.createWorker ?? startEngineWorker
  const idleMs = options.idleMs ?? DEFAULT_ENGINE_IDLE_MS
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  let worker: EngineWorkerLike | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const clearIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
  }

  const stop = (reason: string) => {
    clearIdle()
    const current = worker
    worker = null
    current?.terminate()
    const waiting = [...pending.values()]
    pending.clear()
    for (const p of waiting) p.reject(new Error(reason))
  }

  const armIdle = () => {
    clearIdle()
    if (pending.size === 0 && worker) {
      idleTimer = setTimeout(() => stop('pdf engine stopped while idle'), idleMs)
    }
  }

  const ensureWorker = (): EngineWorkerLike => {
    if (worker) return worker
    const started = createWorker()
    started.onmessage = (event) => {
      const response = event.data
      const waiter = pending.get(response.id)
      if (!waiter) return
      pending.delete(response.id)
      if (response.ok) waiter.resolve(response.result)
      else waiter.reject(errorFrom(response.error))
      armIdle()
    }
    started.onerror = (event) => {
      if (worker === started) stop(`pdf engine worker failed: ${event.message ?? 'unknown error'}`)
    }
    worker = started
    return started
  }

  const call = (op: PdfEngineOp, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      clearIdle()
      const id = nextId++
      pending.set(id, { resolve, reject })
      try {
        ensureWorker().postMessage({ id, op, args } as PdfEngineRequest)
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
        armIdle()
      }
    })

  return engineFrom(call, () => stop('pdf engine disposed'))
}

let shared: PdfEngine | null = null

/** The app's engine: one worker shared by every caller */
export function getPdfEngine(): PdfEngine {
  shared ??= createPdfEngineClient()
  return shared
}

/**
 * Use `engine` as the shared engine (tests in jsdom, which has no Worker, pass
 * `createInThreadPdfEngine()` from ./inThread); null goes back to the worker.
 */
export function setSharedPdfEngine(engine: PdfEngine | null): void {
  if (shared !== engine) shared?.dispose()
  shared = engine
}

/** Stop the shared engine (its worker, if any); the next `getPdfEngine()` starts afresh */
export function disposePdfEngine(): void {
  shared?.dispose()
  shared = null
}
