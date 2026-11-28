import JSZip from 'jszip'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertDeclaredSizesWithinLimits,
  assertZipInflatesWithinLimits,
  DEFAULT_ZIP_LIMITS,
  inflateRawWithinCap,
  type DeclaredPart,
} from '../src/index'

const KB = 1024
const MB = 1024 * KB

/** Small budgets so the tests stay fast; the shape of the check is the point. */
const LIMITS = { maxParts: 100, maxPartBytes: 2 * MB, maxTotalBytes: 8 * MB } as const

const NAME = 'word/document.xml'

/** A valid one-part archive whose real payload is `realBytes`, with the
 *  central directory's declared uncompressed size rewritten to `declares`. */
async function onePart(
  realBytes: number,
  declares: number,
  opts?: { method?: 'store'; name?: string },
): Promise<Buffer> {
  const zip = new JSZip()
  const name = opts?.name ?? NAME
  const content =
    opts?.method === 'store'
      ? zip.file(name, Buffer.alloc(realBytes), { compression: 'STORE' })
      : zip.file(name, Buffer.alloc(realBytes))
  void content
  const bytes = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
  // rewrite the *file* entry's declared size (JSZip also emits an auto-created
  // directory entry whose central record comes first)
  const centralName = bytes.lastIndexOf(Buffer.from(name))
  bytes.writeUInt32LE(declares, centralName - 46 + 24)
  return bytes
}

describe('assertZipInflatesWithinLimits', () => {
  it('refuses a part that declares less than it inflates to', async () => {
    // The #759 case: megabytes behind a 300-byte declaration. Every declared
    // number is inside the limits, so only inflating can find out.
    const archive = await onePart(1024 * KB, 300)
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).rejects.toThrow(
      new RegExp(
        `part ${NAME.replace(/\//g, '\\/')} declares 300 uncompressed bytes but inflates past that`,
      ),
    )
  })

  it('catches the lie at the declared size, not at the payload', async () => {
    const archive = await onePart(1024 * KB, 300)
    const before = process.memoryUsage().rss
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).rejects.toThrow(/inflates past/)
    // The budget is one byte past the claim, so nothing near the payload size
    // is ever allocated.
    expect(process.memoryUsage().rss - before).toBeLessThan(16 * MB)
  })

  it('accepts an honest part, and a stored part that tells the truth', async () => {
    await expect(
      assertZipInflatesWithinLimits(await onePart(300, 300), LIMITS),
    ).resolves.toBeUndefined()
    await expect(
      assertZipInflatesWithinLimits(
        await onePart(64 * KB, 64 * KB, { method: 'store', name: 'word/media/image1.png' }),
        LIMITS,
      ),
    ).resolves.toBeUndefined()
  })

  it('refuses a stored part that holds more bytes than it declares', async () => {
    await expect(
      assertZipInflatesWithinLimits(await onePart(64 * KB, 300, { method: 'store' }), LIMITS),
    ).rejects.toThrow(/inflates past that/)
  })

  it('rejects oversized declarations before inflating anything', async () => {
    const big = await onePart(300, LIMITS.maxPartBytes + 1)
    await expect(assertZipInflatesWithinLimits(big, LIMITS)).rejects.toThrow(/limit 2097152/)
  })

  it('rejects excess totals from verified lengths, not claims', async () => {
    // Two stored 3 MB parts honestly declaring 3 MB each: the verified total
    // busts the 4 MB budget even though no single part is over maxPartBytes.
    const zip = new JSZip()
    zip.file('a.bin', Buffer.alloc(3 * MB), { compression: 'STORE' })
    zip.file('b.bin', Buffer.alloc(3 * MB), { compression: 'STORE' })
    const bytes = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    await expect(
      assertZipInflatesWithinLimits(new Uint8Array(bytes), {
        ...LIMITS,
        maxPartBytes: 4 * MB,
        maxTotalBytes: 5 * MB,
      }),
    ).rejects.toThrow(/total uncompressed size/)
  })

  it('bounds every entry against the archive and refuses unsupported forms', async () => {
    // A declared csize past the end of the file must never reach a reader
    // that allocates from declarations.
    const good = await onePart(300, 300)
    const centralOfPart = good.lastIndexOf(Buffer.from(NAME)) - 46
    const oversized = Buffer.from(good)
    oversized.writeUInt32LE(0xffffff00, centralOfPart + 20)
    await expect(assertZipInflatesWithinLimits(oversized, LIMITS)).rejects.toThrow(
      /outside the .*-byte archive/,
    )

    // Encrypted flag in the central directory.
    const encrypted = Buffer.from(good)
    encrypted.writeUInt16LE(0x1, centralOfPart + 8)
    await expect(assertZipInflatesWithinLimits(encrypted, LIMITS)).rejects.toThrow(/encrypted/)

    // Garbage that is not a zip at all.
    await expect(assertZipInflatesWithinLimits(Buffer.from('not a zip'), LIMITS)).rejects.toThrow(
      /end of central directory/,
    )
  })

  it('keeps the default policy shared with the engines', () => {
    expect(DEFAULT_ZIP_LIMITS.maxParts).toBe(10000)
    expect(DEFAULT_ZIP_LIMITS.maxPartBytes).toBe(512 * 1024 * 1024)
    expect(DEFAULT_ZIP_LIMITS.maxTotalBytes).toBe(1.5 * 1024 * 1024 * 1024)
  })
})

/** A one-part archive whose entry holds exactly `data` (method 8), declaring `usize`. */
function deflatedPart(name: string, data: Uint8Array, usize: number, crc: number): Buffer {
  const nameBytes = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(usize, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(usize, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  const cdOffset = local.length + nameBytes.length + data.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length + nameBytes.length, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, nameBytes, data, central, nameBytes, eocd])
}

function gzipTrailer(crc: number, size: number): Buffer {
  const trailer = Buffer.alloc(8)
  trailer.writeUInt32LE(crc, 0)
  trailer.writeUInt32LE(size, 4)
  return trailer
}

// Node 22 ignores bytes after a raw deflate stream. Exercise the recovery path
// under a decompressor that enforces the stream boundary on every CI runtime.
class StrictRawDeflateStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    const chunks: Uint8Array[] = []
    super({
      transform(chunk) {
        chunks.push(chunk)
      },
      flush(controller) {
        const input = Buffer.concat(chunks)
        const { buffer, engine } = inflateRawSync(input, { info: true }) as unknown as {
          buffer: Buffer
          engine: { bytesWritten: number }
        }
        if (engine.bytesWritten !== input.length) {
          throw new TypeError('Trailing bytes after raw deflate')
        }
        controller.enqueue(buffer)
      },
    })
  }
}

describe('a deflated part followed by a gzip trailer (#693)', () => {
  beforeEach(() => vi.stubGlobal('DecompressionStream', StrictRawDeflateStream))
  afterEach(() => vi.unstubAllGlobals())
  // what an HWP 5 BinData stream from some writers looks like, copied into an HWPX
  const IMAGE = 'BinData/image1.jpg'
  const hwpx = { allowHwpxBinDataTrailer: true }
  const content = Buffer.from(Array.from({ length: 40 * KB }, (_, i) => (i * 31 + (i >> 7)) & 0xff))
  const deflated = deflateRawSync(content)
  const crc = crc32(content)

  it('reads a plain deflated part as before', async () => {
    const archive = deflatedPart(IMAGE, deflated, content.length, crc)
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).resolves.toBeUndefined()
  })

  it('accepts a matching trailer for HWPX BinData when enabled', async () => {
    const data = Buffer.concat([deflated, gzipTrailer(crc, content.length)])
    const archive = deflatedPart(IMAGE, data, content.length, crc)
    await expect(assertZipInflatesWithinLimits(archive, LIMITS, hwpx)).resolves.toBeUndefined()
    await expect(assertZipInflatesWithinLimits(archive, LIMITS)).rejects.toThrow(
      /cannot be inflated/,
    )
    const xml = deflatedPart('Contents/section0.xml', data, content.length, crc)
    await expect(assertZipInflatesWithinLimits(xml, LIMITS, hwpx)).rejects.toThrow(
      /cannot be inflated/,
    )
  })

  it('rejects a trailer whose CRC-32 disagrees with the ZIP or the inflated bytes', async () => {
    const otherCrc = (crc ^ 1) >>> 0
    const valid = Buffer.concat([deflated, gzipTrailer(crc, content.length)])
    const bad = Buffer.concat([deflated, gzipTrailer(otherCrc, content.length)])
    for (const data of [valid, bad]) {
      const archive = deflatedPart(IMAGE, data, content.length, otherCrc)
      await expect(assertZipInflatesWithinLimits(archive, LIMITS, hwpx)).rejects.toThrow(
        /cannot be inflated/,
      )
    }
  })

  it('still rejects eight bytes that are not that trailer', async () => {
    const cases = [
      gzipTrailer((crc ^ 1) >>> 0, content.length),
      gzipTrailer(crc, content.length + 1),
      Buffer.from('junkjunk'),
    ]
    for (const tail of cases) {
      const data = Buffer.concat([deflated, tail])
      const archive = deflatedPart(IMAGE, data, content.length, crc)
      await expect(assertZipInflatesWithinLimits(archive, LIMITS, hwpx)).rejects.toThrow(
        /zip rejected: part BinData\/image1\.jpg cannot be inflated/,
      )
    }
  })

  it('still rejects other junk after the deflate stream', async () => {
    const data = Buffer.concat([deflated, gzipTrailer(crc, content.length), Buffer.from([0])])
    const archive = deflatedPart(IMAGE, data, content.length, crc)
    await expect(assertZipInflatesWithinLimits(archive, LIMITS, hwpx)).rejects.toThrow(
      /cannot be inflated/,
    )
  })

  it('does not let a trailer hide a part that inflates past its declaration', async () => {
    const bomb = Buffer.alloc(1024 * KB)
    const lie = 300
    const data = Buffer.concat([deflateRawSync(bomb), gzipTrailer(crc32(bomb), lie)])
    const archive = deflatedPart(IMAGE, data, lie, crc32(bomb))
    await expect(assertZipInflatesWithinLimits(archive, LIMITS, hwpx)).rejects.toThrow(
      /zip rejected:/,
    )
  })
})

describe('assertDeclaredSizesWithinLimits', () => {
  it('rejects too many parts by declared count alone', () => {
    const parts: DeclaredPart[] = Array.from({ length: LIMITS.maxParts + 1 }, (_, i) => ({
      name: `p/${i}`,
      usize: 1,
    }))
    expect(() => assertDeclaredSizesWithinLimits(parts, LIMITS)).toThrow(/parts exceeds/)
    expect(() =>
      assertDeclaredSizesWithinLimits([{ name: 'a.xml', usize: 10 }], LIMITS),
    ).not.toThrow()
  })
})

describe('inflateRawWithinCap', () => {
  it('returns the inflated bytes for an honest stream', async () => {
    const raw = deflateRawSync(Buffer.alloc(64 * KB))
    const out = await inflateRawWithinCap(raw, 128 * KB)
    expect(out).not.toBeNull()
    expect(out!.byteLength).toBe(64 * KB)
    expect(out![0]).toBe(0)
    expect(out![63 * KB]).toBe(0)
  })

  it('accepts output exactly at the cap and refuses one byte past it', async () => {
    const raw = deflateRawSync(Buffer.alloc(100))
    await expect(inflateRawWithinCap(raw, 100)).resolves.not.toBeNull()
    await expect(inflateRawWithinCap(raw, 99)).resolves.toBeNull()
  })

  it('cancels a lying stream at the cap instead of materialising the payload', async () => {
    // 1 MB of output behind a small compressed block — the serving-side twin
    // of the #759 bomb, where the caller never gate-checked the declaration.
    const raw = deflateRawSync(Buffer.alloc(1024 * KB))
    const before = process.memoryUsage().rss
    await expect(inflateRawWithinCap(raw, 128 * KB)).resolves.toBeNull()
    expect(process.memoryUsage().rss - before).toBeLessThan(32 * MB)
  })

  it('returns null for corrupt input instead of throwing', async () => {
    await expect(inflateRawWithinCap(Buffer.from('not a deflate stream'), 1024)).resolves.toBeNull()
  })
})
