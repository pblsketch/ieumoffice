import { createHash } from 'node:crypto'

const HASH_CHUNK_BYTES = 8 * 1024 * 1024

/**
 * The session's document key is still SHA-256 of all file bytes. WebCrypto
 * copies its whole input before dispatching: hashing a 900 MiB book temporarily
 * doubles its memory. Node's incremental hash reads views of the owned buffer;
 * yield between chunks so other tabs can keep handling input during a large open.
 */
export async function hashBookBytes(bytes: Uint8Array): Promise<string> {
  const hash = createHash('sha256')
  for (let start = 0; start < bytes.byteLength; start += HASH_CHUNK_BYTES) {
    hash.update(bytes.subarray(start, start + HASH_CHUNK_BYTES))
    if (start + HASH_CHUNK_BYTES < bytes.byteLength) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  return hash.digest('hex')
}
