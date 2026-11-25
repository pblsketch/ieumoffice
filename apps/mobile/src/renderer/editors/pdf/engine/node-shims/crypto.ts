/**
 * Stand-in for `node:crypto` inside the PC PDF save code on the phone: the
 * synchronous shapes pdf-crypt.ts and redaction.ts call (createHash for
 * md5/sha256/384/512, AES-CBC/ECB 128/256 ciphers with setAutoPadding,
 * randomBytes), built on pure-JS @noble/ciphers and @noble/hashes.
 *
 * The cipher collects its input and runs at final(): pdf-crypt always
 * concatenates update() and final(), so the joined output is the same.
 */
import { Buffer } from 'buffer'
import { cbc, ecb } from '@noble/ciphers/aes.js'
import { md5 } from '@noble/hashes/legacy.js'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js'
import { notOnMobile } from './unsupported'

type RandomSource = (length: number) => Uint8Array

const MAX_RANDOM_CHUNK = 65536

function platformRandom(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let at = 0; at < length; at += MAX_RANDOM_CHUNK) {
    globalThis.crypto.getRandomValues(out.subarray(at, Math.min(length, at + MAX_RANDOM_CHUNK)))
  }
  return out
}

let randomSource: RandomSource = platformRandom

/** Replace the random source (tests pass a deterministic one); null restores the platform's */
export function setRandomSource(source: RandomSource | null): void {
  randomSource = source ?? platformRandom
}

export function randomBytes(size: number, callback?: (err: Error | null, buf: Buffer) => void) {
  const bytes = randomSource(size)
  if (bytes.length !== size) throw new Error(`random source returned ${bytes.length} of ${size}`)
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (callback) {
    queueMicrotask(() => callback(null, buf))
    return undefined
  }
  return buf
}

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  const target = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
  target.set(randomSource(target.length))
  return array
}

function toBytes(data: unknown, encoding?: string): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, (encoding ?? 'utf8') as BufferEncoding)
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new TypeError('crypto stand-in: unsupported input')
}

const HASHES = { md5, sha256, sha384, sha512 } as const

interface HashLike {
  update(data: unknown, encoding?: string): HashLike
  digest(encoding?: string): Buffer | string
}

export function createHash(algorithm: string): HashLike {
  const fn = HASHES[algorithm.toLowerCase() as keyof typeof HASHES]
  if (!fn) notOnMobile(`crypto.createHash(${algorithm})`)
  const state = fn.create()
  const hash: HashLike = {
    update(data, encoding) {
      state.update(toBytes(data, encoding))
      return hash
    },
    digest(encoding) {
      const out = Buffer.from(state.digest())
      return encoding ? out.toString(encoding as BufferEncoding) : out
    },
  }
  return hash
}

interface CipherLike {
  setAutoPadding(pad?: boolean): CipherLike
  update(data: unknown, inputEncoding?: string): Buffer
  final(): Buffer
}

function cipherOf(
  direction: 'encrypt' | 'decrypt',
  algorithm: string,
  key: unknown,
  iv: unknown,
): CipherLike {
  const match = /^aes-(128|256)-(cbc|ecb)$/.exec(algorithm.toLowerCase())
  if (!match) notOnMobile(`crypto cipher ${algorithm}`)
  const keyBytes = toBytes(key)
  if (keyBytes.length * 8 !== Number(match[1])) throw new RangeError('Invalid key length')
  const mode = match[2] as 'cbc' | 'ecb'
  const ivBytes = mode === 'cbc' ? toBytes(iv) : null
  if (ivBytes && ivBytes.length !== 16) throw new RangeError('Invalid initialization vector')
  let pad = true
  const chunks: Uint8Array[] = []
  const cipher: CipherLike = {
    setAutoPadding(value = true) {
      pad = value
      return cipher
    },
    update(data, inputEncoding) {
      chunks.push(toBytes(data, inputEncoding).slice())
      return Buffer.alloc(0)
    },
    final() {
      const input = Buffer.concat(chunks)
      const opts = { disablePadding: !pad }
      const engine = ivBytes ? cbc(keyBytes, ivBytes, opts) : ecb(keyBytes, opts)
      const out = direction === 'encrypt' ? engine.encrypt(input) : engine.decrypt(input)
      return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
    },
  }
  return cipher
}

export function createCipheriv(algorithm: string, key: unknown, iv: unknown): CipherLike {
  return cipherOf('encrypt', algorithm, key, iv)
}

export function createDecipheriv(algorithm: string, key: unknown, iv: unknown): CipherLike {
  return cipherOf('decrypt', algorithm, key, iv)
}

export const createHmac = (): never => notOnMobile('crypto.createHmac')
export const createSign = (): never => notOnMobile('crypto.createSign')
export const createVerify = (): never => notOnMobile('crypto.createVerify')

export default {
  randomBytes,
  getRandomValues,
  createHash,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createSign,
  createVerify,
}
