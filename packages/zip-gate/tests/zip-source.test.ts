import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  assertZipSourceInflatesWithinLimits,
  readZipSourcePart,
  type ZipByteSource,
} from '../src/index'

function source(bytes: Uint8Array) {
  const reads: Array<[number, number]> = []
  const reader: ZipByteSource = {
    size: bytes.length,
    async read(at, length) {
      reads.push([at, length])
      return new Uint8Array(bytes.subarray(at, at + length))
    },
  }
  return { reader, reads }
}

describe('random-access ZIP gate', () => {
  it.each(['STORE', 'DEFLATE'] as const)(
    'keeps entry-read size checks for overstated %s data',
    async (compression) => {
      const zip = new JSZip()
      zip.file('one', 'hello', { compression })
      const bytes = await zip.generateAsync({ type: 'uint8array' })
      const view = new DataView(bytes.buffer)
      const central = view.getUint32(bytes.length - 22 + 16, true)
      view.setUint32(central + 24, 6, true)
      const { reader } = source(bytes)
      const parts = await assertZipSourceInflatesWithinLimits(reader)
      await expect(readZipSourcePart(reader, parts[0]!)).rejects.toThrow(/size mismatch/)
    },
  )
  it('validates stored media by its bounds without reading its payload', async () => {
    const zip = new JSZip()
    zip.file('media.png', new Uint8Array(4 * 1024 * 1024), { compression: 'STORE' })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const { reader, reads } = source(bytes)
    const parts = await assertZipSourceInflatesWithinLimits(reader)
    expect(reads.reduce((n, [, length]) => n + length, 0)).toBeLessThan(128 * 1024)
    const media = await readZipSourcePart(reader, parts[0]!)
    expect(media.length).toBe(4 * 1024 * 1024)
    expect(media.every((byte) => byte === 0)).toBe(true)
  })

  it('meters actual deflate output and stops forged sizes before materialization', async () => {
    const zip = new JSZip()
    zip.file('bomb', new Uint8Array(16 * 1024 * 1024), { compression: 'DEFLATE' })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const end = bytes.length - 22
    const central = view.getUint32(end + 16, true)
    view.setUint32(central + 24, 300, true)
    await expect(assertZipSourceInflatesWithinLimits(source(bytes).reader)).rejects.toThrow(
      /inflates past that/,
    )
  })

  it('accepts deflate, enforces part and actual-total limits, and rejects truncated reads', async () => {
    const zip = new JSZip()
    zip.file('one', 'hello', { compression: 'DEFLATE' })
    zip.file('two', 'world', { compression: 'STORE' })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const { reader } = source(bytes)
    const parts = await assertZipSourceInflatesWithinLimits(reader)
    expect(new TextDecoder().decode(await readZipSourcePart(reader, parts[0]!))).toBe('hello')
    await expect(
      assertZipSourceInflatesWithinLimits(reader, {
        maxParts: 1,
        maxPartBytes: 10,
        maxTotalBytes: 20,
      }),
    ).rejects.toThrow(/parts exceeds/)
    await expect(
      assertZipSourceInflatesWithinLimits(reader, {
        maxParts: 2,
        maxPartBytes: 4,
        maxTotalBytes: 20,
      }),
    ).rejects.toThrow(/uncompressed bytes/)
    await expect(
      assertZipSourceInflatesWithinLimits(reader, {
        maxParts: 2,
        maxPartBytes: 10,
        maxTotalBytes: 9,
      }),
    ).rejects.toThrow(/total uncompressed size/)
    await expect(
      assertZipSourceInflatesWithinLimits({
        size: bytes.length,
        read: async () => new Uint8Array(),
      }),
    ).rejects.toThrow(/unexpected end/)
  })

  it('rejects encrypted, unsupported, ZIP64 and out-of-bounds entries', async () => {
    const zip = new JSZip()
    zip.file('one', 'hello')
    const original = await zip.generateAsync({ type: 'uint8array' })
    const central = new DataView(original.buffer).getUint32(original.length - 22 + 16, true)
    for (const [offset, value, width, expected] of [
      [central + 8, 1, 2, /encrypted/],
      [central + 10, 9, 2, /unsupported compression/],
      [central + 20, 0xffffffff, 4, /zip64/],
      [central + 42, original.length + 1, 4, /outside the archive/],
    ] as const) {
      const bytes = original.slice()
      const view = new DataView(bytes.buffer)
      if (width === 2) view.setUint16(offset, value, true)
      else view.setUint32(offset, value, true)
      await expect(assertZipSourceInflatesWithinLimits(source(bytes).reader)).rejects.toThrow(
        expected,
      )
    }
  })
})
