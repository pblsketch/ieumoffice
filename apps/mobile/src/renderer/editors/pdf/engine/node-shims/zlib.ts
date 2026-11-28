/**
 * Stand-in for `node:zlib` inside the PC PDF save code on the phone. Only
 * brotliDecompressSync is used (font-metrics' WOFF2 reader). The pure-JS
 * decoder is registered by engine/fonts.ts right before the first WOFF2
 * decode, so it is downloaded only when text is first inserted or edited.
 */
import { Buffer } from 'buffer'
import { notOnMobile } from './unsupported'

type BrotliDecoder = (input: Uint8Array) => Uint8Array

let decoder: BrotliDecoder | null = null

export function registerBrotliDecoder(next: BrotliDecoder): void {
  decoder = next
}

export function brotliDecompressSync(input: Uint8Array): Buffer {
  if (!decoder) throw new Error('brotli decoder not loaded yet (engine/fonts.ts loads it)')
  const out = decoder(input)
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}

export const inflateSync = (): never => notOnMobile('zlib.inflateSync')
export const deflateSync = (): never => notOnMobile('zlib.deflateSync')
export const gzipSync = (): never => notOnMobile('zlib.gzipSync')
export const gunzipSync = (): never => notOnMobile('zlib.gunzipSync')
export const brotliCompressSync = (): never => notOnMobile('zlib.brotliCompressSync')

export default {
  brotliDecompressSync,
  inflateSync,
  deflateSync,
  gzipSync,
  gunzipSync,
  brotliCompressSync,
}
