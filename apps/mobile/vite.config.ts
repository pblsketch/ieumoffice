import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { rhwpPatches } from '../hwp/scripts/rhwp-patches.mjs'
import { trackAlias, trackDefine, trackPlugins, trackWorkerPlugins } from './config/tracks'

/**
 * Minimal same-origin iframe entry for the HWP flow-view WASM engine so its
 * linear memory can be reclaimed by navigating and removing the iframe on close.
 */
const FLOW_HOST_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import init, { HwpDocument } from './rhwp.js';
window.__ieumInitRhwp = async (wasmUrl) => {
  await init({ module_or_path: wasmUrl });
  return { HwpDocument, Uint8Array };
};
window.dispatchEvent(new Event('ieum-rhwp-host-ready'));
</script>
</body></html>
`

/**
 * Copies the prebuilt rhwp-studio bundle from apps/hwp/public/studio into
 * dist/studio so mobile WebView loads the HWP editor locally without network.
 */
function copyHwpStudioPlugin(): Plugin {
  const studioSrc = resolve(__dirname, '../hwp/public/studio')
  const studioDest = resolve(__dirname, 'dist/studio')
  return {
    name: 'copy-hwp-studio',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/studio/flow-host.html') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(FLOW_HOST_HTML)
          return
        }
        next()
      })
    },
    closeBundle() {
      if (!existsSync(studioSrc)) {
        throw new Error(
          `rhwp-studio bundle missing at ${studioSrc}; run "npm run studio -w @genoffice/hwp" first.`,
        )
      }
      mkdirSync(studioDest, { recursive: true })
      cpSync(studioSrc, studioDest, { recursive: true })
      writeFileSync(resolve(studioDest, 'flow-host.html'), FLOW_HOST_HTML, 'utf8')
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
    // each v1 track's own plugins (config/tracks/<track>.ts)
    ...trackPlugins,
  ],
  resolve: {
    alias: trackAlias,
  },
  define: {
    __IEUM_RHWP_WASM__: JSON.stringify(studioRhwpWasmPath()),
    ...trackDefine,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: {
    format: 'es',
    plugins: trackWorkerPlugins,
  },
  server: {
    port: 5185,
    strictPort: true,
  },
})
