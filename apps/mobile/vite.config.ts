import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { rhwpPatches } from '../hwp/scripts/rhwp-patches.mjs'

/**
 * Copies the prebuilt rhwp-studio bundle from apps/hwp/public/studio into
 * dist/studio so mobile WebView loads the HWP editor locally without network.
 */
function copyHwpStudioPlugin(): Plugin {
  const studioSrc = resolve(__dirname, '../hwp/public/studio')
  const studioDest = resolve(__dirname, 'dist/studio')
  return {
    name: 'copy-hwp-studio',
    closeBundle() {
      if (!existsSync(studioSrc)) {
        throw new Error(
          `rhwp-studio bundle missing at ${studioSrc}; run "npm run studio -w @genoffice/hwp" first.`,
        )
      }
      mkdirSync(studioDest, { recursive: true })
      cpSync(studioSrc, studioDest, { recursive: true })
    },
  }
}

/**
 * The HWP flow view (editors/hwpFlow.ts) runs the same rhwp engine the studio
 * ships. Point it at the studio's WASM file instead of bundling a second 28 MB
 * copy: stop Vite from emitting rhwp_bg.wasm for @rhwp/core, and hand the
 * studio asset's path to the renderer as __IEUM_RHWP_WASM__.
 */
function sharedRhwpWasmPlugin(): Plugin {
  return {
    name: 'ieum-shared-rhwp-wasm',
    enforce: 'pre',
    transform(code, id) {
      // Vite module ids use forward slashes on every platform.
      if (!/\/rhwp-core\/rhwp\.js$/.test(id)) return null
      const next = code.replace("new URL('rhwp_bg.wasm', import.meta.url)", 'undefined')
      return next === code ? null : { code: next, map: null }
    },
  }
}

/**
 * Track T2 (pdf): PDF.js reads CMaps, standard fonts and its wasm decoders from
 * `pdfjs/` next to the page (apps/pdf/src/renderer/view-config.ts), as in the PC
 * PDF editor. Copy them into dist/pdfjs on build and serve them in dev.
 */
function pdfjsAssetsPlugin(): Plugin {
  const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const subdirs = ['cmaps', 'standard_fonts', 'wasm']
  return {
    name: 'ieum-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '')
        const [sub] = rel.split('/')
        const file = resolve(pdfjsRoot, rel)
        if (!sub || !subdirs.includes(sub) || !file.startsWith(pdfjsRoot) || !existsSync(file)) {
          next()
          return
        }
        res.end(readFileSync(file))
      })
    },
    closeBundle() {
      for (const sub of subdirs) {
        cpSync(resolve(pdfjsRoot, sub), resolve(__dirname, 'dist/pdfjs', sub), { recursive: true })
      }
    },
  }
}

function studioRhwpWasmPath(): string {
  const assets = resolve(__dirname, '../hwp/public/studio/assets')
  const file = existsSync(assets)
    ? readdirSync(assets).find((name) => /^rhwp_bg-.*\.wasm$/.test(name))
    : undefined
  return file ? `./studio/assets/${file}` : ''
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    rhwpPatches('sdk-scheme') as Plugin,
    sharedRhwpWasmPlugin(),
    copyHwpStudioPlugin(),
    pdfjsAssetsPlugin(),
  ],
  define: {
    __IEUM_RHWP_WASM__: JSON.stringify(studioRhwpWasmPath()),
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5185,
    strictPort: true,
  },
})
