/**
 * Shared by the bundled-font tests: the WOFF2 files as the app ships them,
 * every virtual path engine/fonts.ts fills, and the sfnt font-metrics' WOFF2
 * reader makes from each file on Node's own brotli (what the PC code gets).
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { woff2ToSfnt } from '@genoffice/font-metrics'
import type { EngineAsset } from '../../src/renderer/editors/pdf/engine/assets'
import {
  BUNDLED_FONT_DIR,
  BUNDLED_FONTS,
  type BundledFont,
} from '../../src/renderer/editors/pdf/engine/fontTable'
import { Buffer as ShimBuffer } from '../../src/renderer/editors/pdf/engine/node-shims/buffer'
import { registerBrotliDecoder } from '../../src/renderer/editors/pdf/engine/node-shims/zlib'

const FONT_DIR = resolve(__dirname, '../../src/renderer/assets/fonts')

export function bundledFontFile(asset: EngineAsset): Uint8Array {
  const font = BUNDLED_FONTS.find((f) => f.asset === asset)
  if (!font) throw new Error(`not a font asset: ${asset}`)
  return new Uint8Array(readFileSync(join(FONT_DIR, font.woff2)))
}

export const asWoff2Buffer = (bytes: Uint8Array) =>
  ShimBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Every virtual path ensureBundledFonts fills with the font's sfnt */
export const placedPaths = (font: BundledFont): string[] => [
  ...font.paths,
  `${BUNDLED_FONT_DIR}/${font.sfntName}`,
]

let reference: Map<string, Uint8Array> | null = null

/**
 * sfnt per font asset from font-metrics' reader on Node's own brotli. Where the
 * reader runs on the node:zlib stand-in (jsdom tests), Node's brotli is put
 * into the stand-in for this, replacing the pure-JS decoder from then on.
 */
export function nodeZlibSfnts(): Map<string, Uint8Array> {
  if (reference) return reference
  registerBrotliDecoder((input) => brotliDecompressSync(input))
  reference = new Map()
  for (const font of BUNDLED_FONTS) {
    const sfnt = woff2ToSfnt(asWoff2Buffer(bundledFontFile(font.asset)))
    if (!sfnt) throw new Error(`${font.woff2}: no sfnt even with Node's brotli`)
    reference.set(font.asset, new Uint8Array(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength))
  }
  return reference
}

export const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean =>
  !!a && !!b && Buffer.from(a).equals(Buffer.from(b))
