// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { PdfViewRenderWorker } from '../src/main/view-render-worker'
import type { PdfViewWorkerRequest, PdfViewWorkerResponse } from '../src/main/view-worker-protocol'

class FakeWorker extends EventEmitter {
  sent: PdfViewWorkerRequest[] = []
  postMessage(message: PdfViewWorkerRequest) {
    this.sent.push(message)
  }
  unref = vi.fn()
  terminate = vi.fn(async () => 0)
  answer(index: number) {
    const request = this.sent[index]!
    const response: PdfViewWorkerResponse =
      request.type !== 'render'
        ? { id: request.id, ok: true }
        : { id: request.id, ok: true, bitmap: { width: 1, height: 1, rgba: new Uint8Array(4) } }
    this.emit('message', response)
  }
}
const request = (id: string, thumbnail = false, sourceId = 'source') => ({
  requestId: id,
  sourceId,
  page: 1,
  width: 1,
  height: 1,
  rotation: 0,
  thumbnail,
})

describe('bounded PDF view render scheduling', () => {
  it('prepares WASM in parallel with the interaction model and retains it until source close', async () => {
    const worker = new FakeWorker()
    const broker = new PdfViewRenderWorker(() => worker)
    const preparing = broker.prepare('source')
    expect(worker.sent[0]).toMatchObject({ type: 'prepare', sourceId: 'source' })
    expect(worker.sent[0]).not.toHaveProperty('fd')
    worker.answer(0)
    await preparing
    expect(worker.terminate).not.toHaveBeenCalled()
    const closing = broker.close('source')
    await Promise.resolve()
    worker.answer(1)
    await closing
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('sends only one job at a time and prioritizes visible pages over pending thumbnails', async () => {
    const worker = new FakeWorker()
    const broker = new PdfViewRenderWorker(() => worker)
    const first = broker.render(4, 100, request('first', true))
    const thumb = broker.render(4, 100, request('thumb', true))
    const page = broker.render(4, 100, request('page'))
    expect(worker.sent).toHaveLength(1)
    worker.answer(0)
    await first
    expect(worker.sent[1]!.type === 'render' && worker.sent[1].request.requestId).toBe('page')
    worker.answer(1)
    await page
    worker.answer(2)
    await thumb
  })

  it('drops cancelled queued work and ignores an active cancelled bitmap before closing its source', async () => {
    const worker = new FakeWorker()
    const broker = new PdfViewRenderWorker(() => worker)
    const active = broker.render(4, 100, request('active')).catch((error: Error) => error.message)
    const queued = broker.render(4, 100, request('queued')).catch((error: Error) => error.message)
    broker.cancel('source', 'queued')
    const closed = broker.close('source')
    let finished = false
    void closed.then(() => {
      finished = true
    })
    expect(await queued).toContain('cancelled')
    expect(await active).toContain('cancelled')
    expect(finished).toBe(false)
    worker.answer(0)
    expect(worker.sent[1]!.type).toBe('close')
    worker.answer(1)
    await closed
    expect(worker.sent).toHaveLength(2)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('does not allow another source to cancel a request with the same caller id', async () => {
    const worker = new FakeWorker()
    const broker = new PdfViewRenderWorker(() => worker)
    const active = broker.render(4, 100, request('same'))
    broker.cancel('other-source', 'same')
    worker.answer(0)
    await expect(active).resolves.toMatchObject({ width: 1 })
  })

  it('bounds queued work and rejects duplicate caller ids', async () => {
    const worker = new FakeWorker()
    const broker = new PdfViewRenderWorker(() => worker)
    void broker.render(4, 100, request('active')).catch(() => {})
    await expect(broker.render(4, 100, request('active'))).rejects.toThrow('duplicate')
    const queued = Array.from({ length: 64 }, (_, i) =>
      broker.render(4, 100, request(String(i))).catch(() => {}),
    )
    await expect(broker.render(4, 100, request('overflow'))).rejects.toThrow('full')
    for (let i = 0; i <= 64; i++) worker.answer(i)
    await Promise.all(queued)
  })

  it('releases an active render result discarded after cancellation', async () => {
    const worker = new FakeWorker()
    const broker = new PdfViewRenderWorker(() => worker)
    const pending = broker.render(4, 100, request('cancelled')).catch(() => {})
    broker.cancel('source', 'cancelled')
    const pixels = new Uint8Array(4)
    worker.emit('message', {
      id: worker.sent[0]!.id,
      ok: true,
      bitmap: { width: 1, height: 1, rgba: pixels },
    })
    await pending
    expect(pixels.byteLength).toBe(0)
    const closing = broker.close('source')
    await Promise.resolve()
    worker.answer(1)
    await closing
  })

  it('keeps the descriptor owner waiting until a failed worker is actually terminated', async () => {
    const worker = new FakeWorker()
    let terminated!: (code: number) => void
    worker.terminate.mockImplementation(
      () =>
        new Promise((resolve) => {
          terminated = resolve
        }),
    )
    const broker = new PdfViewRenderWorker(() => worker)
    const job = broker.render(4, 100, request('active')).catch((error: Error) => error.message)
    worker.emit('error', new Error('worker failure'))
    const closed = broker.close('source')
    let finished = false
    void closed.then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    terminated(1)
    await expect(job).resolves.toBe('worker failure')
    await closed
  })
})
