import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
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

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), rhwpPatches('sdk-scheme') as Plugin, copyHwpStudioPlugin()],
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
