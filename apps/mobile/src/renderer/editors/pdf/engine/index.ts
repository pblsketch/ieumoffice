/**
 * Mobile PDF engine (T2, spec 2.1-2.3): the PC save code run unchanged in a
 * web worker. Import from here on the page thread; this module loads nothing
 * heavy until an operation is called. Tests that need the engine without a
 * Worker import `createInThreadPdfEngine` from './inThread' and hand it to
 * `setSharedPdfEngine`.
 */
export {
  createPdfEngineClient,
  disposePdfEngine,
  getPdfEngine,
  setSharedPdfEngine,
  DEFAULT_ENGINE_IDLE_MS,
  type EngineWorkerLike,
  type PdfEngine,
  type PdfEngineClientOptions,
} from './client'
export type { PdfSaveResult, PdfEngineOp } from './core'
export { PDF_ENGINE_OPS } from './protocol'
export { NOT_ON_MOBILE } from './node-shims/unsupported'
