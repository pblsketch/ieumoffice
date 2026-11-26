/**
 * Supplies the app's bundled Korean fonts to the PC save code (spec 2.1, 2.3):
 * each WOFF2 is decoded to sfnt with font-metrics' own reader and placed at
 * the paths listed in fontTable.ts. Loaded once, before the first request that
 * draws text; the PC code caches what it reads, so the fonts must be in place
 * before it looks the first time.
 */
import { woff2ToSfnt } from '@genoffice/font-metrics'
import { loadEngineAsset, once } from './assets'
import { BUNDLED_FONT_DIR, BUNDLED_FONTS } from './fontTable'
import { Buffer } from './node-shims/buffer'
import { vfsPut } from './node-shims/vfs'
import { registerBrotliDecoder } from './node-shims/zlib'

export const ensureBundledFonts = once(async () => {
  const { decompress } = await import('brotli/decompress.js')
  registerBrotliDecoder((input) => decompress(input))
  const decoded = await Promise.all(
    BUNDLED_FONTS.map(async (font) => {
      const woff2 = await loadEngineAsset(font.asset)
      const sfnt = woff2ToSfnt(Buffer.from(woff2.buffer, woff2.byteOffset, woff2.byteLength))
      if (!sfnt) throw new Error(`bundled font ${font.woff2} could not be decoded`)
      return { font, sfnt: new Uint8Array(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength) }
    }),
  )
  for (const { font, sfnt } of decoded) {
    for (const path of font.paths) vfsPut(path, sfnt)
    vfsPut(`${BUNDLED_FONT_DIR}/${font.sfntName}`, sfnt)
  }
})
