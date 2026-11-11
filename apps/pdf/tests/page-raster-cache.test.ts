import { describe, expect, it } from 'vitest'
import { PageRasterCache } from '../src/renderer/page-raster-cache'

const canvas = () => Object.assign(document.createElement('canvas'), { width: 10, height: 10 })

describe('bounded immutable PDF raster reuse', () => {
  it('shares one byte budget across documents and evicts the least recently retained pixels', () => {
    const cache = new PageRasterCache(800)
    const first = {},
      second = {}
    const a = canvas(),
      b = canvas(),
      c = canvas()
    cache.put(first, 'a', a)
    cache.put(second, 'b', b)
    cache.put(first, 'c', c)
    expect(a.width).toBe(0)
    expect(cache.take(first, 'a')).toBeUndefined()
    expect(cache.take(second, 'b')).toBe(b)
    expect(b.width).toBe(10)
    expect(cache.take(first, 'c')).toBe(c)
  })

  it('separates documents and releases all their retained pixels on replacement or close', () => {
    const cache = new PageRasterCache()
    const old = {},
      next = {}
    const a = canvas(),
      b = canvas()
    cache.put(old, 'same-settings', a)
    cache.put(next, 'same-settings', b)
    cache.close(old)
    expect(a.width).toBe(0)
    expect(cache.take(next, 'same-settings')).toBe(b)
    cache.put(old, 'late-completion', canvas())
    expect(cache.take(old, 'late-completion')).toBeUndefined()
  })
})
