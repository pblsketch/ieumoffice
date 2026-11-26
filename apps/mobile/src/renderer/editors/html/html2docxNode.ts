// Stand-ins for the two Node built-ins html2docx's Word generator uses, for the phone's web view
// (config/tracks/web.ts hands these to packages/html2docx/src/generate/page-settings.ts only).
// That file paints a plain page color as a 1×1 PNG with `Buffer` and `node:zlib`; this module
// gives it exactly the calls it makes: Buffer.alloc/from/concat, writeUInt32BE, copy, and
// zlib.crc32/deflateSync. The PNG it makes holds the same pixel.

/** Bytes with the two Buffer methods the page-color PNG calls on them. */
class NodeBytes extends Uint8Array {
  writeUInt32BE(value: number, offset = 0): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, value >>> 0)
    return offset + 4
  }

  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const part = this.subarray(sourceStart, Math.min(sourceEnd, this.length))
    const copied = part.subarray(0, Math.max(0, target.length - targetStart))
    target.set(copied, targetStart)
    return copied.length
  }
}

/** The slice of Node's Buffer that the page-color PNG uses. */
export const Buffer = {
  alloc(size: number): NodeBytes {
    return new NodeBytes(size)
  },

  /** A string is read as Latin-1 (the generator passes ASCII); anything else as bytes. */
  from(value: string | ArrayLike<number>, _encoding?: string): NodeBytes {
    const out = new NodeBytes(value.length)
    if (typeof value === 'string') {
      for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
    } else {
      out.set(value)
    }
    return out
  },

  concat(list: readonly Uint8Array[]): NodeBytes {
    const out = new NodeBytes(list.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of list) {
      out.set(part, at)
      at += part.length
    }
    return out
  },
}

let crcTable: Uint32Array | null = null

function table(): Uint32Array {
  if (crcTable) return crcTable
  const next = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    next[n] = c >>> 0
  }
  crcTable = next
  return next
}

/** CRC-32 (the PNG and zlib polynomial), unsigned, as Node's `zlib.crc32`. */
export function crc32(data: Uint8Array): number {
  const t = table()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Largest stored (uncompressed) deflate block. */
const STORED_MAX = 0xffff

/**
 * A zlib stream of `data` in stored (uncompressed) deflate blocks: what any inflater reads back
 * as `data`. The generator only deflates a few bytes, so compressing them would gain nothing.
 */
export function deflateSync(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_MAX))
  const out = new NodeBytes(2 + blocks * 5 + data.length + 4)
  // zlib header: deflate, 32 KiB window, no dictionary, fastest level (0x78 0x01 checks out)
  out[0] = 0x78
  out[1] = 0x01
  let at = 2
  for (let block = 0; block < blocks; block++) {
    const start = block * STORED_MAX
    const part = data.subarray(start, Math.min(data.length, start + STORED_MAX))
    out[at++] = block === blocks - 1 ? 1 : 0
    out[at++] = part.length & 0xff
    out[at++] = part.length >>> 8
    out[at++] = ~part.length & 0xff
    out[at++] = (~part.length >>> 8) & 0xff
    out.set(part, at)
    at += part.length
  }
  out.writeUInt32BE(adler32(data), at)
  return out
}

/** The default export page-settings.ts imports as `zlib`. */
const zlib = { crc32, deflateSync }
export default zlib
