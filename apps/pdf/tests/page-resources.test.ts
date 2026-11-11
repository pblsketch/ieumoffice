import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { retainPageResources } from '../src/renderer/page-resources'

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('decoded page resources', () => {
  it('keeps a page while a thumbnail or OCR still uses it and releases it once', async () => {
    const cleanup = vi.fn()
    const doc = { getPage: vi.fn(async () => ({ cleanup })) } as unknown as PDFDocumentProxy
    const viewport = retainPageResources(doc, 1)
    const thumbnail = retainPageResources(doc, 1)
    const ocr = retainPageResources(doc, 1)
    expect(doc.getPage).toHaveBeenCalledTimes(1)
    viewport.release()
    thumbnail.release()
    await settle()
    expect(cleanup).not.toHaveBeenCalled()
    ocr.release()
    ocr.release()
    await settle()
    expect(cleanup).toHaveBeenCalledOnce()
    retainPageResources(doc, 1).release()
    await settle()
    expect(doc.getPage).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('does not clean a page reacquired while getPage is still pending', async () => {
    let resolve!: (page: PDFPageProxy) => void
    const cleanup = vi.fn()
    const doc = {
      getPage: vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      ),
    } as unknown as PDFDocumentProxy
    const first = retainPageResources(doc, 7)
    first.release()
    const next = retainPageResources(doc, 7)
    resolve({ cleanup } as unknown as PDFPageProxy)
    await settle()
    expect(cleanup).not.toHaveBeenCalled()
    next.release()
    await settle()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('bounds decoded pages by live consumers across a long scroll', async () => {
    const live = new Set<number>()
    let peak = 0
    const doc = {
      getPage: vi.fn(async (page: number) => {
        live.add(page)
        peak = Math.max(peak, live.size)
        return { cleanup: () => live.delete(page) }
      }),
    } as unknown as PDFDocumentProxy
    let previous: ReturnType<typeof retainPageResources> | undefined
    for (let page = 1; page <= 474; page++) {
      const next = retainPageResources(doc, page)
      await next.page
      previous?.release()
      await settle()
      previous = next
    }
    expect(peak).toBe(2)
    previous?.release()
    await settle()
    expect(live.size).toBe(0)
  })

  it('forgets failed requests so another visit can retry', async () => {
    const cleanup = vi.fn()
    const getPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('page unavailable'))
      .mockResolvedValue({ cleanup })
    const doc = { getPage } as unknown as PDFDocumentProxy
    const failed = retainPageResources(doc, 3)
    await expect(failed.page).rejects.toThrow('page unavailable')
    failed.release()
    await settle()
    const retry = retainPageResources(doc, 3)
    await expect(retry.page).resolves.toEqual({ cleanup })
    retry.release()
    await settle()
    expect(getPage).toHaveBeenCalledTimes(2)
  })
})
