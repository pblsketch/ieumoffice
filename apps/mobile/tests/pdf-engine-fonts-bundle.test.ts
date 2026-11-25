// @vitest-environment node
/**
 * The bundled Korean fonts in a real production bundle: engine/fonts.ts built
 * by Vite with the stand-in rule (Rollup's module graph, the browser build of
 * the `brotli` decoder), run in Node. Every placed sfnt must equal what
 * font-metrics' WOFF2 reader gets from Node's own brotli.
 *
 * This caught the stand-ins being bundled twice on Windows: the PC modules'
 * `node:zlib` resolved to a backslash id, the engine's own import to Vite's
 * forward-slash id, so the decoder engine/fonts.ts registered was not the one
 * font-metrics called and every text insert or edit failed to save.
 *
 * Node environment: Vite's bundler (esbuild) does not run under jsdom.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, normalizePath, type Plugin } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import {
  pdfEngineNodeShims,
  shimFileFor,
} from '../src/renderer/editors/pdf/engine/build/nodeShimPlugin'
import { BUNDLED_FONTS } from '../src/renderer/editors/pdf/engine/fontTable'
import { bundledFontFile, nodeZlibSfnts, placedPaths, sameBytes } from './pdf-engine/bundled-fonts'

const MOBILE_ROOT = resolve(__dirname, '..')
const SHIM_DIR = resolve(MOBILE_ROOT, 'src/renderer/editors/pdf/engine/node-shims')

const runDir = join(
  process.env.PDF_ENGINE_FONTS_DIR ?? tmpdir(),
  `pdf-engine-fonts-${process.pid}-${Date.now()}`,
)

afterAll(() => rmSync(runDir, { recursive: true, force: true }))

/** The asset URL table needs the bundler's ?url assets; the test reads the files instead */
const noAssetUrls: Plugin = {
  name: 'test-no-asset-urls',
  enforce: 'pre',
  resolveId: (source) => (/\/assetUrls$/.test(source) ? '\0test-asset-urls' : null),
  load: (id) => (id === '\0test-asset-urls' ? 'export const ENGINE_ASSET_URLS = {}' : null),
}

describe('bundled fonts in a production bundle', () => {
  it("resolves a PC module's node:* import to the stand-in's Vite id", () => {
    const resolveId = pdfEngineNodeShims().resolveId as (
      source: string,
      importer?: string,
    ) => string | null
    const importer = resolve(MOBILE_ROOT, '../../packages/font-metrics/src/woff2.ts')
    for (const name of ['zlib', 'fs', 'crypto', 'module']) {
      const id = resolveId(`node:${name}`, importer)
      expect(id).toBe(shimFileFor(name))
      // The id a relative import of the same file gets, so the bundle holds one copy
      expect(id).toBe(normalizePath(resolve(SHIM_DIR, `${name}.ts`)))
      expect(id).not.toContain('\\')
    }
  })

  it('places every bundled font exactly as Node zlib decodes it', async () => {
    mkdirSync(runDir, { recursive: true })
    await build({
      configFile: false,
      root: MOBILE_ROOT,
      logLevel: 'silent',
      plugins: [pdfEngineNodeShims(), noAssetUrls],
      build: {
        outDir: runDir,
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: resolve(__dirname, 'pdf-engine/fonts-bundle-entry.ts'),
          formats: ['es'],
          fileName: () => 'fonts-bundle.mjs',
        },
      },
    })
    const bundle = (await import(
      /* @vite-ignore */ pathToFileURL(join(runDir, 'fonts-bundle.mjs')).href
    )) as typeof import('./pdf-engine/fonts-bundle-entry')
    bundle.setEngineAssetLoader(async (asset) => bundledFontFile(asset))
    await bundle.ensureBundledFonts()

    const expected = nodeZlibSfnts()
    for (const font of BUNDLED_FONTS) {
      for (const path of placedPaths(font)) {
        expect(
          sameBytes(bundle.vfsGet(path), expected.get(font.asset)),
          `${font.woff2} at ${path}`,
        ).toBe(true)
      }
    }
  }, 180_000)
})
