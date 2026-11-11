import { describe, expect, it } from 'vitest'
import { visiblePageTiles } from '../src/renderer/view-tiles'
import { ViewRenderQueue } from '../src/renderer/view-render-queue'

describe('viewport tile working set', () => {
  it('covers the visible region without allocating the full large page', () => {
    const tiles = visiblePageTiles(6000, 8000, 2100, 3100, 2900, 3900)
    expect(tiles.reduce((n, tile) => n + tile.width * tile.height, 0)).toBeLessThan(5_000_000)
    for (const [x, y] of [
      [2100, 3100],
      [2899, 3899],
      [2500, 3500],
    ])
      expect(
        tiles.some((t) => x! >= t.x && x! < t.x + t.width && y! >= t.y && y! < t.y + t.height),
      ).toBe(true)
    for (const tile of tiles) {
      expect(tile.x + tile.width).toBeLessThanOrEqual(6000)
      expect(tile.y + tile.height).toBeLessThanOrEqual(8000)
    }
  })

  it('clips the final tile and skips pages outside the viewport', () => {
    expect(visiblePageTiles(100, 100, 0, 0, 100, 100)).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
    ])
    expect(visiblePageTiles(100, 100, 0, 101, 100, 200)).toEqual([])
  })

  it('drops obsolete work before admission and lets visible work pass thumbnails', async () => {
    const queue = new ViewRenderQueue(1)
    let finish!: () => void
    const executed: string[] = []
    const first = queue.schedule(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const stale = queue.schedule(async () => {
      executed.push('stale')
    })
    const staleError = stale.promise.catch((error: Error) => error.message)
    const thumb = queue.schedule(async () => {
      executed.push('thumb')
    }, true)
    const visible = queue.schedule(async () => {
      executed.push('visible')
    })
    stale.cancel()
    await Promise.resolve()
    finish()
    await Promise.all([first.promise, thumb.promise, visible.promise])
    expect(await staleError).toContain('cancelled')
    expect(executed).toEqual(['visible', 'thumb'])
  })
})
