/**
 * Mobile stand-in for the `node:crypto` calls of the PPTX engine: `createHash('sha256')` (the
 * deck's original hash on open) and `randomUUID()` (new section ids). Same results as Node;
 * anything else the engine does not use throws instead of answering differently.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

const encoder = new TextEncoder()

export interface Hash {
  update(data: Uint8Array | string): Hash
  digest(encoding: 'hex'): string
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== 'sha256') {
    throw new Error(`createHash: only sha256 is available in the mobile reader, not ${algorithm}`)
  }
  const state = sha256.create()
  const hash: Hash = {
    update(data) {
      // Node hashes a string as UTF-8 when no encoding is given
      state.update(typeof data === 'string' ? encoder.encode(data) : data)
      return hash
    },
    digest(encoding) {
      if (encoding !== 'hex') {
        throw new Error(
          `digest: only hex is available in the mobile reader, not ${String(encoding)}`,
        )
      }
      return bytesToHex(state.digest())
    },
  }
  return hash
}

/** A random version 4 UUID, like Node's */
export function randomUUID(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID()
  // randomUUID needs a secure context; getRandomValues does not
  const bytes = webCrypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
