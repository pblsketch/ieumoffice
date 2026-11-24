// Main-process / worker side: baseline JPEG encoder (Rust WASM `jpeg-encoder`
// primary with a pure-TS baseline JFIF fallback for `GENOFFICE_PRINT_LAYOUT_RUST=0`).
import { wasmEncodeJpeg } from './wasm'

// Standard JPEG Annex K quantization tables (zigzag order not yet applied).
const STD_LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

const STD_CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
]

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

// Standard Huffman specifications (Annex K).
const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const DC_CHROMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125]
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]

const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119]
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]

interface HuffTable {
  code: Uint16Array
  len: Uint8Array
}

function buildHuff(bits: readonly number[], vals: readonly number[]): HuffTable {
  const code = new Uint16Array(256)
  const len = new Uint8Array(256)
  let k = 0
  let c = 0
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]!; i++) {
      const v = vals[k++]!
      code[v] = c
      len[v] = l
      c++
    }
    c <<= 1
  }
  return { code, len }
}

const HUFF_DC_Y = buildHuff(DC_LUMA_BITS, DC_LUMA_VALS)
const HUFF_AC_Y = buildHuff(AC_LUMA_BITS, AC_LUMA_VALS)
const HUFF_DC_C = buildHuff(DC_CHROMA_BITS, DC_CHROMA_VALS)
const HUFF_AC_C = buildHuff(AC_CHROMA_BITS, AC_CHROMA_VALS)

const COS_TABLE = (() => {
  const t = new Float64Array(64)
  for (let u = 0; u < 8; u++) {
    const cu = u === 0 ? Math.SQRT1_2 : 1
    for (let x = 0; x < 8; x++) {
      t[u * 8 + x] = 0.5 * cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
    }
  }
  return t
})()

function scaleQuant(base: readonly number[], quality: number): Uint8Array {
  const sf = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2
  const out = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    const v = Math.floor((base[ZIGZAG[i]!]! * sf + 50) / 100)
    out[i] = Math.min(255, Math.max(1, v))
  }
  return out
}

function fdctBlock(input: Float64Array, tmp: Float64Array, out: Float64Array): void {
  for (let y = 0; y < 8; y++) {
    const row = y * 8
    for (let u = 0; u < 8; u++) {
      const cu = u * 8
      let sum = 0
      for (let x = 0; x < 8; x++) sum += input[row + x]! * COS_TABLE[cu + x]!
      tmp[row + u] = sum
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      const cv = v * 8
      let sum = 0
      for (let y = 0; y < 8; y++) sum += tmp[y * 8 + u]! * COS_TABLE[cv + y]!
      out[v * 8 + u] = sum
    }
  }
}

class BitWriter {
  private buf: number[] = []
  private bitBuf = 0
  private bitCount = 0

  writeByte(b: number): void {
    this.buf.push(b & 0xff)
  }

  writeBytes(bytes: readonly number[] | Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]! & 0xff)
  }

  writeUint16(v: number): void {
    this.buf.push((v >>> 8) & 0xff, v & 0xff)
  }

  writeBits(code: number, length: number): void {
    this.bitBuf = (this.bitBuf << length) | (code & ((1 << length) - 1))
    this.bitCount += length
    while (this.bitCount >= 8) {
      this.bitCount -= 8
      const b = (this.bitBuf >>> this.bitCount) & 0xff
      this.buf.push(b)
      if (b === 0xff) this.buf.push(0x00)
    }
  }

  flushBits(): void {
    if (this.bitCount > 0) {
      const pad = 8 - this.bitCount
      this.writeBits((1 << pad) - 1, pad)
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf)
  }
}

function bitSize(v: number): number {
  let a = Math.abs(v)
  let s = 0
  while (a > 0) {
    a >>>= 1
    s++
  }
  return s
}

function encodeBlock(
  w: BitWriter,
  coeffs: Float64Array,
  quant: Uint8Array,
  dcHuff: HuffTable,
  acHuff: HuffTable,
  prevDc: number,
): number {
  const dc = Math.round(coeffs[0]! / quant[0]!)
  const diff = dc - prevDc
  const dSize = bitSize(diff)
  w.writeBits(dcHuff.code[dSize]!, dcHuff.len[dSize]!)
  if (dSize > 0) w.writeBits(diff < 0 ? diff + ((1 << dSize) - 1) : diff, dSize)

  let zeroRun = 0
  for (let i = 1; i < 64; i++) {
    const q = Math.round(coeffs[ZIGZAG[i]!]! / quant[i]!)
    if (q === 0) {
      zeroRun++
    } else {
      while (zeroRun >= 16) {
        w.writeBits(acHuff.code[0xf0]!, acHuff.len[0xf0]!)
        zeroRun -= 16
      }
      const s = bitSize(q)
      const sym = (zeroRun << 4) | s
      w.writeBits(acHuff.code[sym]!, acHuff.len[sym]!)
      w.writeBits(q < 0 ? q + ((1 << s) - 1) : q, s)
      zeroRun = 0
    }
  }
  if (zeroRun > 0) w.writeBits(acHuff.code[0x00]!, acHuff.len[0x00]!)
  return dc
}

function encodeJpegJs(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3,
  quality: number,
): Uint8Array {
  const w = new BitWriter()
  const qY = scaleQuant(STD_LUMA_QUANT, quality)
  const qC = scaleQuant(STD_CHROMA_QUANT, quality)

  // SOI + JFIF APP0
  w.writeBytes([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
  ])
  // DQT (Y, and CbCr for RGB)
  w.writeBytes([0xff, 0xdb, 0x00, 67, 0])
  w.writeBytes(qY)
  if (channels === 3) {
    w.writeBytes([0xff, 0xdb, 0x00, 67, 1])
    w.writeBytes(qC)
  }
  // SOF0
  w.writeBytes([0xff, 0xc0])
  w.writeUint16(8 + channels * 3)
  w.writeByte(8)
  w.writeUint16(height)
  w.writeUint16(width)
  w.writeByte(channels)
  if (channels === 1) {
    w.writeBytes([1, 0x11, 0])
  } else {
    w.writeBytes([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
  }
  // DHT
  const writeDht = (tcTh: number, bits: readonly number[], vals: readonly number[]) => {
    w.writeBytes([0xff, 0xc4])
    w.writeUint16(2 + 1 + 16 + vals.length)
    w.writeByte(tcTh)
    w.writeBytes(bits)
    w.writeBytes(vals)
  }
  writeDht(0x00, DC_LUMA_BITS, DC_LUMA_VALS)
  writeDht(0x10, AC_LUMA_BITS, AC_LUMA_VALS)
  if (channels === 3) {
    writeDht(0x01, DC_CHROMA_BITS, DC_CHROMA_VALS)
    writeDht(0x11, AC_CHROMA_BITS, AC_CHROMA_VALS)
  }
  // SOS
  w.writeBytes([0xff, 0xda])
  w.writeUint16(6 + channels * 2)
  w.writeByte(channels)
  if (channels === 1) {
    w.writeBytes([1, 0x00])
  } else {
    w.writeBytes([1, 0x00, 2, 0x11, 3, 0x11])
  }
  w.writeBytes([0x00, 0x3f, 0x00])

  const bY = new Float64Array(64)
  const bCb = new Float64Array(64)
  const bCr = new Float64Array(64)
  const tmp = new Float64Array(64)
  const dct = new Float64Array(64)
  let dcY = 0
  let dcCb = 0
  let dcCr = 0

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let dy = 0; dy < 8; dy++) {
        const sy = Math.min(by + dy, height - 1)
        for (let dx = 0; dx < 8; dx++) {
          const sx = Math.min(bx + dx, width - 1)
          const idx = dy * 8 + dx
          if (channels === 1) {
            bY[idx] = pixels[sy * width + sx]! - 128
          } else {
            const p = (sy * width + sx) * 3
            const r = pixels[p]!
            const g = pixels[p + 1]!
            const b = pixels[p + 2]!
            bY[idx] = 0.299 * r + 0.587 * g + 0.114 * b - 128
            bCb[idx] = -0.168736 * r - 0.331264 * g + 0.5 * b
            bCr[idx] = 0.5 * r - 0.418688 * g - 0.081312 * b
          }
        }
      }
      fdctBlock(bY, tmp, dct)
      dcY = encodeBlock(w, dct, qY, HUFF_DC_Y, HUFF_AC_Y, dcY)
      if (channels === 3) {
        fdctBlock(bCb, tmp, dct)
        dcCb = encodeBlock(w, dct, qC, HUFF_DC_C, HUFF_AC_C, dcCb)
        fdctBlock(bCr, tmp, dct)
        dcCr = encodeBlock(w, dct, qC, HUFF_DC_C, HUFF_AC_C, dcCr)
      }
    }
  }
  w.flushBits()
  w.writeBytes([0xff, 0xd9])
  return w.toUint8Array()
}

/**
 * Encodes tightly packed 8-bit gray (`channels = 1`) or RGB (`channels = 3`)
 * pixels as a baseline JPEG (Rust WASM `jpeg-encoder` with pure-TS fallback).
 */
export function encodeJpeg(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3,
  quality = 90,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 65535 ||
    height > 65535
  ) {
    throw new Error(`invalid JPEG size ${width}x${height}`)
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error(`invalid JPEG quality ${quality}`)
  }
  const expected = width * height * channels
  if (pixels.length < expected) {
    throw new Error('JPEG pixel buffer is too short')
  }
  const wasm = wasmEncodeJpeg(pixels, width, height, channels, quality)
  if (wasm.ok) return wasm.value
  return encodeJpegJs(pixels, width, height, channels, quality)
}
