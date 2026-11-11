// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { replyViewRender } from '../src/main/view-render-reply'
import { ViewRenderClient } from '../src/preload/view-render-client'
import type { PdfViewRenderReply } from '../src/shared/view-render-reply'
import type { PdfViewBitmapResult } from '../src/shared/view-source'

const request = {
  sourceId: 'owned-source',
  requestId: 'page',
  page: 1,
  width: 2,
  height: 2,
  rotation: 0,
}

describe('bounded lifetime of PDF pixel replies', () => {
  it('copies a preload reply before releasing its pixels without waiting for GC', async () => {
    const send = vi.fn()
    let reply!: (message: PdfViewRenderReply) => void
    const client = new ViewRenderClient(send, (receive) => (reply = receive))
    const pixels = new Uint8Array(16).fill(73).buffer
    let received!: PdfViewBitmapResult
    client.deliver(request, (result) => {
      expect(pixels.byteLength).toBe(16)
      received = structuredClone(result)
    })
    reply({
      ticket: send.mock.calls[0][0],
      ok: true,
      bitmap: { width: 2, height: 2, rgba: pixels },
    })
    await vi.waitFor(() => expect(pixels.byteLength).toBe(0))
    expect(received.ok).toBe(true)
    if (received.ok) expect([...new Uint8Array(received.bitmap.rgba)]).toEqual(Array(16).fill(73))
  })

  it('releases preload pixels when the callback belongs to a destroyed renderer', async () => {
    const send = vi.fn()
    let reply!: (message: PdfViewRenderReply) => void
    const client = new ViewRenderClient(send, (receive) => (reply = receive))
    const pixels = new ArrayBuffer(16)
    client.deliver(request, () => {
      throw new Error('context destroyed')
    })
    reply({
      ticket: send.mock.calls[0][0],
      ok: true,
      bitmap: { width: 2, height: 2, rgba: pixels },
    })
    await vi.waitFor(() => expect(pixels.byteLength).toBe(0))
  })

  it('delivers intact cloned pixels and immediately releases the exclusive sender buffer', async () => {
    const pixels = new Uint8Array(16).map((_, i) => i).buffer
    let received!: PdfViewRenderReply
    await replyViewRender(
      1,
      request,
      async () => ({ width: 2, height: 2, rgba: pixels }),
      (message) => {
        received = structuredClone(message)
      },
    )
    expect(pixels.byteLength).toBe(0)
    expect(received.ok).toBe(true)
    if (received.ok)
      expect([...new Uint8Array(received.bitmap.rgba)]).toEqual(
        Array.from({ length: 16 }, (_, i) => i),
      )
  })

  it('also releases pixels when the destination frame has closed', async () => {
    const pixels = new ArrayBuffer(16)
    await replyViewRender(
      1,
      request,
      async () => ({ width: 2, height: 2, rgba: pixels }),
      () => {
        throw new Error('frame closed')
      },
    )
    expect(pixels.byteLength).toBe(0)
  })

  it('rejects native errors by ticket without accepting malformed tickets', async () => {
    const render = vi.fn(async () => {
      throw new Error('source not granted')
    })
    const reply = vi.fn()
    await replyViewRender(NaN, request, render, reply)
    await replyViewRender(0, request, render, reply)
    expect(render).not.toHaveBeenCalled()
    await replyViewRender(4, request, render, reply)
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      ticket: 4,
      ok: false,
      error: 'source not granted',
    })
  })

  it('matches out-of-order successes/errors and ignores duplicate responses', async () => {
    const send = vi.fn()
    let receive!: (message: PdfViewRenderReply) => void
    const client = new ViewRenderClient(send, (fn) => {
      receive = fn
    })
    const first = client.render(request)
    const second = client.render({ ...request, requestId: 'second' }).catch((e: Error) => e.message)
    receive({ ticket: send.mock.calls[1]![0], ok: false, error: 'cancelled' })
    receive({
      ticket: send.mock.calls[0]![0],
      ok: true,
      bitmap: { width: 2, height: 2, rgba: new ArrayBuffer(16) },
    })
    receive({ ticket: send.mock.calls[0]![0], ok: false, error: 'duplicate' })
    await expect(first).resolves.toMatchObject({ width: 2, height: 2 })
    expect(await second).toBe('cancelled')
  })

  it('bounds outstanding replies and removes failed sends from the queue', async () => {
    const send = vi.fn().mockImplementationOnce(() => {
      throw new Error('closed')
    })
    let receive!: (message: PdfViewRenderReply) => void
    const client = new ViewRenderClient(send, (fn) => {
      receive = fn
    })
    await expect(client.render(request)).rejects.toThrow('closed')
    const pending = Array.from({ length: 128 }, () => client.render(request))
    await expect(client.render(request)).rejects.toThrow('full')
    for (const [ticket] of send.mock.calls.slice(1))
      receive({ ticket, ok: true, bitmap: { width: 0, height: 0, rgba: new ArrayBuffer(0) } })
    await Promise.all(pending)
    const next = client.render(request)
    receive({ ticket: send.mock.calls.at(-1)![0], ok: false, error: 'cancelled' })
    await expect(next).rejects.toThrow('cancelled')
  })
})
