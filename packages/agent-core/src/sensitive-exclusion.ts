/**
 * The keyed hash a dismissed candidate is remembered by.
 *
 * When the reader dismisses a candidate, the app remembers it per document in
 * its data folder so it is not offered again. The record holds the kind and
 * this hash, never the value: a value kept there would be the very thing the
 * reader chose not to hide, sitting in a second place.
 *
 * The hash is HMAC-SHA-256 under a key the app makes once
 * (`createExclusionKey`) and keeps apart from the records. Many kinds have
 * few possible values (a phone number has about 10^8), so an unkeyed hash
 * could be reversed by trying them all; without the key it cannot be.
 * Values are compared as `normalizeSensitiveValue` does, so the same phone
 * number written another way stays dismissed.
 *
 * Web Crypto only (`crypto.subtle`), present in an Electron renderer and in
 * Node 18 and later. Renderer-safe, exported as
 * `@genoffice/agent-core/sensitive-exclusion`.
 */

import { normalizeSensitiveValue, type SensitiveKind } from './sensitive-kinds'

const KEY_BYTES = 32
const MIN_KEY_BYTES = 16
/** Kept apart from any other use of the same key, and versioned should the input ever change. */
const DOMAIN = 'ieum-exclusion-v1'

/** A new random key for the exclusion hashes. */
export function createExclusionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES))
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The hash a dismissed candidate is remembered by: lower-case hex, 64 characters. */
export async function exclusionHash(
  key: Uint8Array,
  kind: SensitiveKind,
  value: string,
): Promise<string> {
  if (key.length < MIN_KEY_BYTES) throw new Error('exclusion key too short')
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = new TextEncoder().encode(
    `${DOMAIN}\u0000${kind}\u0000${normalizeSensitiveValue(kind, value)}`,
  )
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, message))
}
