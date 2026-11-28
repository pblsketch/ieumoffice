// Build settings of track T3 pdf tools. Owned by that track.
import type { Plugin } from 'vite'
import type { TrackBuild } from './types'

/**
 * The PDF tools engine runs in a module worker (tools/engine/worker.ts) that
 * loads PDFium and qpdf as later chunks, so workers are bundled as ES
 * modules. Only `worker.format` is set: `worker.plugins` belongs to another
 * track and is left as it is (Vite merges what config() returns).
 */
function pdfToolsWorkerFormat(): Plugin {
  return {
    name: 'ieum-pdf-tools-worker-format',
    config: () => ({ worker: { format: 'es' } }),
  }
}

export const pdfToolsBuild: TrackBuild = {
  plugins: [pdfToolsWorkerFormat()],
}
