import { describe, expect, it } from 'vitest'

import { probePageGeometry } from '../src/renderer/page-probe'

/** A document whose pages report A4 geometry, with optional per-page rejections */
function fakeDoc(numPages: number, failing: Record<number, Error> = {}) {
  return {
    numPages,
    getPage: async (n: number) => {
      if (failing[n]) throw failing[n]
      return {
        getViewport: ({ scale }: { scale: number }) => ({
          width: 595 * scale,
          height: 842 * scale,
        }),
        rotate: 90,
        view: [0, 0],
        userUnit: 1,
      }
    },
  }
}

describe('probePageGeometry', () => {
  it('probes every page in order on a healthy document', async () => {
    const r = await probePageGeometry(fakeDoc(3))
    expect(r.pages).toHaveLength(3)
    expect(r.failures).toEqual([])
    expect(r.pages[0]).toEqual({ width: 595, height: 842, rotate: 90, origin: [0, 0], userUnit: 1 })
  })

  it('a broken page degrades to the previous geometry instead of failing the document', async () => {
    const r = await probePageGeometry(fakeDoc(450, { 217: new Error('bad xref stream') }))
    expect(r.pages).toHaveLength(450)
    // the broken page inherits its neighbor's geometry so the row layout keeps
    // its shape; the failure is reported for the banner
    expect(r.pages[216]).toEqual(r.pages[215])
    expect(r.failures).toEqual([{ page: 217, message: 'bad xref stream' }])
    // the pages after the broken one still probe normally
    expect(r.pages[217]).toEqual({
      width: 595,
      height: 842,
      rotate: 90,
      origin: [0, 0],
      userUnit: 1,
    })
  })

  it('a broken first page falls back to A4', async () => {
    const r = await probePageGeometry(fakeDoc(2, { 1: new Error('nope') }))
    expect(r.pages[0]).toEqual({ width: 595, height: 842, rotate: 0, origin: [0, 0], userUnit: 1 })
    expect(r.pages[1]).toEqual({ width: 595, height: 842, rotate: 90, origin: [0, 0], userUnit: 1 })
    expect(r.failures).toEqual([{ page: 1, message: 'nope' }])
  })

  it('every page failing still returns a full-length geometry list', async () => {
    const r = await probePageGeometry(
      fakeDoc(3, { 1: new Error('a'), 2: new Error('b'), 3: new Error('c') }),
    )
    expect(r.pages).toHaveLength(3)
    expect(r.failures).toHaveLength(3)
  })

  it('bounds concurrent probes and keeps fallback order when replies arrive out of order', async () => {
    let active = 0
    let peak = 0
    const result = await probePageGeometry({
      numPages: 40,
      async getPage(n) {
        active++
        peak = Math.max(peak, active)
        await new Promise((done) => setTimeout(done, (17 - (n % 16)) % 4))
        active--
        if (n === 1 || n === 18) throw new Error(`page ${n}`)
        return {
          rotate: 0,
          view: [n, n],
          userUnit: 1,
          getViewport: () => ({ width: n * 10, height: n * 20 }),
        }
      },
    })
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(16)
    expect(active).toBe(0)
    expect(result.failures).toEqual([
      { page: 1, message: 'page 1' },
      { page: 18, message: 'page 18' },
    ])
    expect(result.pages[0]!.width).toBe(595)
    expect(result.pages[17]).toEqual(result.pages[16])
    expect(result.pages[18]!.width).toBe(190)
    expect(result.pages[39]!.origin).toEqual([40, 40])
  })
})
