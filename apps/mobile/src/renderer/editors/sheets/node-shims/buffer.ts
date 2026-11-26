/**
 * The phone's stand-in for Node's global `Buffer`, injected only into the
 * spreadsheet save modules (see `config/tracks/sheets.ts`). It covers what
 * those modules call: `allocUnsafe`/`alloc`, `from` (bytes, UTF-8 or base64
 * text), `concat`, `isBuffer`, and on instances `write(text, offset, 'utf8')`,
 * `toString('utf8' | 'base64')` and `equals`.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

type Encoding = 'utf8' | 'utf-8' | 'base64' | 'latin1' | 'binary'

/** The bytes a stand-in `Buffer` call returns: a Uint8Array with the Node instance methods the save code uses. */
export class BufferBytes extends Uint8Array {
  /** UTF-8 encodes `text` at `offset`; returns the bytes written (whole characters only). */
  write(text: string, offset = 0, encoding: Encoding = 'utf8'): number {
    if (encoding !== 'utf8' && encoding !== 'utf-8') {
      throw new Error(`Buffer.write: encoding ${encoding} is not supported here`)
    }
    return encoder.encodeInto(text, this.subarray(offset)).written
  }

  override toString(encoding: Encoding = 'utf8', start = 0, end = this.byteLength): string {
    const view = new Uint8Array(this.buffer, this.byteOffset + start, Math.max(0, end - start))
    if (encoding === 'base64') return bytesToBase64(view)
    if (encoding === 'latin1' || encoding === 'binary') {
      let text = ''
      for (let index = 0; index < view.length; index += 0x8000) {
        text += String.fromCharCode(...view.subarray(index, index + 0x8000))
      }
      return text
    }
    return decoder.decode(view)
  }

  equals(other: Uint8Array): boolean {
    if (other.byteLength !== this.byteLength) return false
    for (let index = 0; index < this.byteLength; index += 1) {
      if (this[index] !== other[index]) return false
    }
    return true
  }
}

/** Wraps the bytes without copying them. */
function fromBytes(bytes: Uint8Array): BufferBytes {
  return new BufferBytes(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)
}

export const Buffer = {
  allocUnsafe(size: number): BufferBytes {
    return new BufferBytes(size)
  },

  alloc(size: number, fill = 0): BufferBytes {
    const buffer = new BufferBytes(size)
    if (fill !== 0) buffer.fill(fill)
    return buffer
  },

  isBuffer(value: unknown): value is BufferBytes {
    return value instanceof BufferBytes
  },

  byteLength(text: string): number {
    return encoder.encode(text).byteLength
  },

  from(
    value: string | ArrayBuffer | ArrayLike<number> | Uint8Array,
    encoding: Encoding = 'utf8',
  ): BufferBytes {
    if (typeof value === 'string') {
      if (encoding === 'base64') return fromBytes(base64ToBytes(value))
      if (encoding === 'latin1' || encoding === 'binary') {
        const out = new BufferBytes(value.length)
        for (let index = 0; index < value.length; index += 1) {
          out[index] = value.charCodeAt(index) & 0xff
        }
        return out
      }
      return fromBytes(encoder.encode(value))
    }
    if (value instanceof ArrayBuffer) return fromBytes(new Uint8Array(value))
    return fromBytes(Uint8Array.from(value as ArrayLike<number>))
  },

  concat(list: readonly Uint8Array[], totalLength?: number): BufferBytes {
    const size = totalLength ?? list.reduce((total, item) => total + item.byteLength, 0)
    const out = new BufferBytes(size)
    let offset = 0
    for (const item of list) {
      if (offset >= size) break
      const part = item.subarray(0, size - offset)
      out.set(part, offset)
      offset += part.byteLength
    }
    return out
  },

  fromBytes,
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export default { Buffer }
