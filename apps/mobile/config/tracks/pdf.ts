// Build settings of track T2 pdf. Owned by that track.
import { pdfEngineNodeShims } from '../../src/renderer/editors/pdf/engine/build/nodeShimPlugin'
import { pdfjsAssetsPlugin } from '../../src/renderer/editors/pdf/engine/build/pdfjsAssetsPlugin'
import type { TrackBuild } from './types'

export const pdfBuild: TrackBuild = {
  plugins: [
    // Node built-ins of the PC save code -> mobile stand-ins, only for apps/pdf/src/main,
    // font-metrics and electron-utils (engine/build/nodeShimPlugin.ts)
    pdfEngineNodeShims(),
    // PDF.js CMaps, standard fonts and wasm at pdfjs/ (engine/build/pdfjsAssetsPlugin.ts)
    pdfjsAssetsPlugin(),
  ],
  // The PDF engine worker (editors/pdf/engine/worker.ts) runs the PC save code and splits into
  // lazy chunks (PDFium, fonts), so it gets the same Node stand-in plugin merged with other tracks.
  workerPlugins: () => [pdfEngineNodeShims()],
}
