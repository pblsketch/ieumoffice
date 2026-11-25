// Build settings of track T2 pdf. Owned by that track.
import type { Plugin } from 'vite'
import { pdfEngineNodeShims } from '../../src/renderer/editors/pdf/engine/build/nodeShimPlugin'
import { pdfjsAssetsPlugin } from '../../src/renderer/editors/pdf/engine/build/pdfjsAssetsPlugin'
import type { TrackBuild } from './types'

/**
 * The PDF engine worker (editors/pdf/engine/worker.ts) runs the PC save code, which splits into
 * lazy chunks (PDFium, fonts): its bundle is an ES module worker and gets the same Node stand-in
 * rule as the page. Added through `config` so the shared vite.config.ts stays as it is.
 */
function pdfEngineWorkerConfig(): Plugin {
  return {
    name: 'ieum-pdf-engine-worker',
    config() {
      return { worker: { format: 'es', plugins: () => [pdfEngineNodeShims()] } }
    },
  }
}

export const pdfBuild: TrackBuild = {
  plugins: [
    // Node built-ins of the PC save code -> mobile stand-ins, only for apps/pdf/src/main,
    // font-metrics and electron-utils (engine/build/nodeShimPlugin.ts)
    pdfEngineNodeShims(),
    pdfEngineWorkerConfig(),
    // PDF.js CMaps, standard fonts and wasm at pdfjs/ (engine/build/pdfjsAssetsPlugin.ts)
    pdfjsAssetsPlugin(),
  ],
}
