import { Blob } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { collectionFaceOffset } from '../studio-plugin/font-metadata.mjs'

describe('local collection metadata range reads', () => {
  it('selects the named face without reading or reconstructing glyph data', async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x74746366)
    view.setUint32(4, 0x10000)
    view.setUint32(8, 2)
    view.setUint32(12, 64)
    view.setUint32(16, 128)
    for (const [offset, nameOffset] of [
      [64, 256],
      [128, 288],
    ]) {
      view.setUint32(offset!, 0x10000)
      view.setUint16(offset! + 4, 1)
      view.setUint32(offset! + 12, 0x6e616d65)
      view.setUint32(offset! + 20, nameOffset!)
      view.setUint32(offset! + 24, 4)
    }
    bytes.set(new TextEncoder().encode('bold'), 256)
    bytes.set(new TextEncoder().encode('book'), 288)
    const blob = new Blob([bytes])
    let readBytes = 0
    const source = {
      size: blob.size,
      slice: (start: number, end: number) => {
        readBytes += end - start
        return blob.slice(start, end)
      },
      arrayBuffer: () => {
        throw new Error('full-font read')
      },
    }
    const parse = (data: ArrayBuffer) => ({ postscriptNames: [new TextDecoder().decode(data)] })
    expect(await collectionFaceOffset(source, 'BOOK', parse, (s: string) => s.toLowerCase())).toBe(
      128,
    )
    expect(readBytes).toBeLessThan(256)
    expect(await collectionFaceOffset(source, 'absent', parse, (s: string) => s)).toBeNull()
  })

  it('rejects truncated and oversized collection directories', async () => {
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x74746366)
    view.setUint32(4, 0x10000)
    view.setUint32(8, 5000)
    expect(
      await collectionFaceOffset(
        new Blob([bytes]),
        'face',
        () => ({}),
        (s: string) => s,
      ),
    ).toBeNull()
  })
})
