/**
 * The PDF tools engine worker (an ES module worker, started by client.ts).
 * It hosts the core with PDFium and qpdf from the app bundle, picture work on
 * an OffscreenCanvas when this worker has a 2d one (else on the screen
 * thread), and owner passwords from crypto.getRandomValues.
 */
import { loadBundledPdfium, loadBundledQpdf } from './assets'
import { createEngineCore } from './core'
import { serveEngine, type HostScope } from './host'
import { canvasPictures, hasOffscreen2d, offscreenSurface } from './picture'

serveEngine(
  self as unknown as HostScope,
  (pictures) =>
    createEngineCore({
      loadPdfium: loadBundledPdfium,
      loadQpdf: loadBundledQpdf,
      pictures,
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    }),
  typeof createImageBitmap === 'function' && hasOffscreen2d()
    ? canvasPictures(offscreenSurface)
    : null,
)
