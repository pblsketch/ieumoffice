/**
 * The thin calling side of the mobile PDF engine: one reused worker, answers
 * matched by id, the engine's error message passed through unchanged, and the
 * worker stopped on dispose or after being idle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPdfEngineClient,
  disposePdfEngine,
  getPdfEngine,
  setSharedPdfEngine,
  type EngineWorkerLike,
} from '../src/renderer/editors/pdf/engine/client'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import { handleEngineRequest } from '../src/renderer/editors/pdf/engine/dispatch'
import type {
  PdfEngineRequest,
  PdfEngineResponse,
} from '../src/renderer/editors/pdf/engine/protocol'
import { PDF_ENGINE_OPS } from '../src/renderer/editors/pdf/engine/protocol'
import { pdfEngineCore } from '../src/renderer/editors/pdf/engine/core'

/** A worker stand-in answering through the real dispatch, or by a scripted reply */
class FakeWorker implements EngineWorkerLike {
  onmessage: ((event: { data: PdfEngineResponse }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null
  terminated = false
  readonly received: PdfEngineRequest[] = []
  constructor(private readonly reply?: (request: PdfEngineRequest) => PdfEngineResponse | null) {}
  postMessage(message: PdfEngineRequest): void {
    this.received.push(message)
    const scripted = this.reply?.(message)
    if (scripted === null) return // left pending
    void (scripted ? Promise.resolve(scripted) : handleEngineRequest(message)).then((data) =>
      queueMicrotask(() => this.onmessage?.({ data })),
    )
  }
  terminate(): void {
    this.terminated = true
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pdf engine client', () => {
  it('lists exactly the operations the engine core answers', () => {
    expect([...PDF_ENGINE_OPS].sort()).toEqual(Object.keys(pdfEngineCore).sort())
  })

  it('reuses one worker for every call and matches answers by id', async () => {
    const workers: FakeWorker[] = []
    const engine = createPdfEngineClient({
      createWorker: () => {
        const w = new FakeWorker()
        workers.push(w)
        return w
      },
    })
    const empty = { path: 'x.pdf', markups: [], drawings: [], formValues: [], stamps: [] }
    const [a, b] = await Promise.all([
      engine.hasEdits(empty),
      engine.hasEdits({ ...empty, deletedPages: [0] }),
    ])
    expect([a, b]).toEqual([false, true])
    const blank = await engine.blankPdf()
    expect(new TextDecoder().decode(blank.subarray(0, 5))).toBe('%PDF-')
    expect(workers).toHaveLength(1)
    expect(workers[0]!.received.map((r) => r.op)).toEqual(['hasEdits', 'hasEdits', 'blankPdf'])
    engine.dispose()
    expect(workers[0]!.terminated).toBe(true)
    // The first call imports the engine core; on a slow disk under a full run that can exceed 5 s.
  }, 60_000)

  it('passes the engine error message through unchanged', async () => {
    const message = 'save-verify-failed pages=2: text not found; the file was not written'
    const engine = createPdfEngineClient({
      createWorker: () =>
        new FakeWorker((r) => ({ id: r.id, ok: false, error: { message, name: 'Error' } })),
    })
    await expect(engine.blankPdf()).rejects.toThrow(message)
    engine.dispose()
  })

  it('surfaces a real engine failure the same way in the worker and in-thread paths', async () => {
    const bad = new Uint8Array([1, 2, 3])
    const inThread = createInThreadPdfEngine()
    const viaWorker = createPdfEngineClient({ createWorker: () => new FakeWorker() })
    const a = await inThread.insertBlankPage(bad, 0).catch((e: Error) => e)
    const b = await viaWorker.insertBlankPage(bad, 0).catch((e: Error) => e)
    expect(a).toBeInstanceOf(Error)
    expect(b).toBeInstanceOf(Error)
    expect((b as Error).message).toBe((a as Error).message)
    viaWorker.dispose()
  })

  it('rejects pending calls on dispose and starts a new worker afterwards', async () => {
    const workers: FakeWorker[] = []
    const engine = createPdfEngineClient({
      createWorker: () => {
        const w = new FakeWorker(workers.length === 0 ? () => null : undefined)
        workers.push(w)
        return w
      },
    })
    const pending = engine.blankPdf()
    engine.dispose()
    await expect(pending).rejects.toThrow('pdf engine disposed')
    expect(workers[0]!.terminated).toBe(true)
    await expect(
      engine.hasEdits({ path: 'x', markups: [], drawings: [], formValues: [], stamps: [] }),
    ).resolves.toBe(false)
    expect(workers).toHaveLength(2)
    engine.dispose()
  })

  it('rejects pending calls when the worker itself fails', async () => {
    let worker: FakeWorker | null = null
    const engine = createPdfEngineClient({
      createWorker: () => (worker = new FakeWorker(() => null)),
    })
    const pending = engine.blankPdf()
    worker!.onerror?.({ message: 'out of memory' })
    await expect(pending).rejects.toThrow('pdf engine worker failed: out of memory')
    expect(worker!.terminated).toBe(true)
  })

  it('lets tests put an in-thread engine behind getPdfEngine', async () => {
    const inThread = createInThreadPdfEngine()
    setSharedPdfEngine(inThread)
    expect(getPdfEngine()).toBe(inThread)
    await expect(
      inThread.hasEdits({ path: 'x', markups: [], drawings: [], formValues: [], stamps: [] }),
    ).resolves.toBe(false)
    disposePdfEngine()
  })

  it('stops an idle worker so its memory is released', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const workers: FakeWorker[] = []
    const engine = createPdfEngineClient({
      idleMs: 1000,
      createWorker: () => {
        const w = new FakeWorker()
        workers.push(w)
        return w
      },
    })
    await engine.hasEdits({ path: 'x', markups: [], drawings: [], formValues: [], stamps: [] })
    await vi.advanceTimersByTimeAsync(999)
    expect(workers[0]!.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(workers[0]!.terminated).toBe(true)
    engine.dispose()
  })
})
