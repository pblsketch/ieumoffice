// @vitest-environment node
/**
 * `imagesToPdfFrom` reads pictures one at a time and must write the same
 * bytes `imagesToPdfBytes` writes for the same pictures in the same order.
 * Only Date is frozen: pdf-lib stamps its dates from the clock and waits on
 * timer ticks while saving, so faking every timer would hang it.
 */
import { crc32, deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  imagesToPdfBytes,
  imagesToPdfFrom,
  readImageInfo,
  type ImagesToPdfOptions,
} from '../src/images'

const FIXED_NOW = new Date('2026-01-02T03:04:05Z')

/**
 * A JPEG pdf-lib can embed: it only reads the header, so the scan data can be
 * a stub. `orientation` adds an APP1 Exif segment (big- or little-endian TIFF).
 */
function jpeg(width: number, height: number, orientation?: number, little = false): Uint8Array {
  const parts: number[] = [0xff, 0xd8]
  if (orientation !== undefined) {
    const w16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
    const w32 = (v: number) =>
      little
        ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
        : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
    const tiff = [
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...w16(42),
      ...w32(8),
      ...w16(1),
      // one IFD entry: tag 0x0112 (Orientation), SHORT, count 1, value
      ...w16(0x0112),
      ...w16(3),
      ...w32(1),
      ...w16(orientation),
      0,
      0,
      ...w32(0),
    ]
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    const length = body.length + 2
    parts.push(0xff, 0xe1, length >> 8, length & 0xff, ...body)
  }
  // SOF0: precision 8, height, width, 3 components
  parts.push(0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3)
  parts.push(1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0)
  parts.push(0xff, 0xd9)
  return Uint8Array.from(parts)
}

/** A real RGB PNG of one colour */
function png(width: number, height: number, shade = 0x80): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([len, typed, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, shade)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

async function* oneByOne(images: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const image of images) {
    await Promise.resolve()
    yield image
  }
}

const A4 = { w: 595.28, h: 841.89 }
const LETTER = { w: 612, h: 792 }

const PICTURES: Uint8Array[] = [
  jpeg(400, 300),
  jpeg(400, 300, 6),
  jpeg(300, 500, 3, true),
  jpeg(640, 480, 8, true),
  jpeg(200, 100, 5),
  png(64, 48),
  png(30, 90, 0x20),
  jpeg(30_000, 20_000, 2),
]

const OPTIONS: [string, ImagesToPdfOptions][] = [
  ['each page the size of its picture', { paper: null, marginPt: 0 }],
  ['A4 without a margin', { paper: A4, marginPt: 0 }],
  ['A4 with a margin', { paper: A4, marginPt: 36 }],
  ['Letter with a margin larger than a quarter page', { paper: LETTER, marginPt: 400 }],
  ['A4 with a negative margin', { paper: A4, marginPt: -10 }],
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('imagesToPdfFrom', () => {
  it('reads the fixture pictures as the kinds and orientations they are meant to be', () => {
    expect(PICTURES.map((p) => readImageInfo(p))).toEqual([
      { kind: 'jpg', width: 400, height: 300, orientation: 1 },
      { kind: 'jpg', width: 400, height: 300, orientation: 6 },
      { kind: 'jpg', width: 300, height: 500, orientation: 3 },
      { kind: 'jpg', width: 640, height: 480, orientation: 8 },
      { kind: 'jpg', width: 200, height: 100, orientation: 5 },
      { kind: 'png', width: 64, height: 48, orientation: 1 },
      { kind: 'png', width: 30, height: 90, orientation: 1 },
      { kind: 'jpg', width: 30_000, height: 20_000, orientation: 2 },
    ])
  })

  it.each(OPTIONS)('writes the same bytes as imagesToPdfBytes: %s', async (_label, options) => {
    const all = await imagesToPdfBytes(PICTURES, options)
    const streamed = await imagesToPdfFrom(oneByOne(PICTURES), options)
    expect(Buffer.from(streamed).equals(Buffer.from(all))).toBe(true)
    expect((await PDFDocument.load(streamed)).getPageCount()).toBe(PICTURES.length)
  })

  it('writes the same bytes for one picture and for the pictures in another order', async () => {
    const options = { paper: A4, marginPt: 18 }
    for (const pictures of [[png(10, 10)], [...PICTURES].reverse(), [jpeg(50, 80, 7)]]) {
      const all = await imagesToPdfBytes(pictures, options)
      const streamed = await imagesToPdfFrom(oneByOne(pictures), options)
      expect(Buffer.from(streamed).equals(Buffer.from(all))).toBe(true)
    }
  })

  it('writes the same empty document for no pictures', async () => {
    const options = { paper: null, marginPt: 0 }
    const all = await imagesToPdfBytes([], options)
    const streamed = await imagesToPdfFrom(oneByOne([]), options)
    expect(Buffer.from(streamed).equals(Buffer.from(all))).toBe(true)
  })

  it('asks for the next picture only after the one before is in, and stops at one it cannot read', async () => {
    const pulled: number[] = []
    const pictures = [jpeg(100, 100), Uint8Array.from([1, 2, 3, 4]), png(5, 5)]
    async function* source(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < pictures.length; i++) {
        pulled.push(i)
        yield pictures[i]!
      }
    }
    await expect(imagesToPdfFrom(source(), { paper: null, marginPt: 0 })).rejects.toThrow(
      'not a JPEG or PNG image',
    )
    expect(pulled).toEqual([0, 1])
    await expect(imagesToPdfBytes(pictures, { paper: null, marginPt: 0 })).rejects.toThrow(
      'not a JPEG or PNG image',
    )
  })
})
