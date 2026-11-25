/**
 * The bundled Korean fonts reach the PC save code through the real mobile
 * path: font-metrics' WOFF2 reader calls `brotliDecompressSync` of the
 * `node:zlib` stand-in, which runs the pure-JS `brotli` decoder engine/fonts.ts
 * registers. The sfnt it places must equal what the same reader gets from
 * Node's own brotli. (pdf-engine-fonts-bundle.test.ts checks the same in a
 * real production bundle.)
 *
 * Runs in jsdom like the parity test: there Vitest resolves the PC modules'
 * `node:*` imports through the stand-in rule (in its node environment those
 * stay Node's own built-ins).
 */
import { woff2ToSfnt } from '@genoffice/font-metrics'
import { afterAll, describe, expect, it } from 'vitest'
import { setEngineAssetLoader } from '../src/renderer/editors/pdf/engine/assets'
import { ensureBundledFonts } from '../src/renderer/editors/pdf/engine/fonts'
import { BUNDLED_FONTS } from '../src/renderer/editors/pdf/engine/fontTable'
import { vfsGet } from '../src/renderer/editors/pdf/engine/node-shims/vfs'
import {
  asWoff2Buffer,
  bundledFontFile,
  nodeZlibSfnts,
  placedPaths,
  sameBytes,
} from './pdf-engine/bundled-fonts'

afterAll(() => setEngineAssetLoader(null))

describe('bundled fonts on the node:zlib stand-in', () => {
  it('reads WOFF2 through the stand-in in this process, not through Node zlib', () => {
    // No decoder registered yet: the stand-in throws, so the reader answers null
    expect(woff2ToSfnt(asWoff2Buffer(bundledFontFile('font:sans')))).toBeNull()
  })

  it('places every bundled font exactly as Node zlib decodes it', async () => {
    setEngineAssetLoader(async (asset) => bundledFontFile(asset))
    await ensureBundledFonts()
    // Read before nodeZlibSfnts() swaps Node's brotli into the stand-in
    const placed = BUNDLED_FONTS.map((font) => ({
      font,
      sfnts: placedPaths(font).map((path) => ({ path, bytes: vfsGet(path) })),
    }))
    const expected = nodeZlibSfnts()
    for (const { font, sfnts } of placed) {
      for (const { path, bytes } of sfnts) {
        expect(sameBytes(bytes, expected.get(font.asset)), `${font.woff2} at ${path}`).toBe(true)
      }
    }
  })
})
