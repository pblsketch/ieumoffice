// Main-process / worker entry for rendering: face images, the grayscale PDF,
// overlays, JPEG/ZIP export and the job runner. Not part of `./plan` (Node only).
export { encodePng } from './png'
export { encodeJpeg } from './jpeg'
export { buildStoreZip, type ZipStoreEntry } from './zip-store'
export { applyPdfOverlays, type PdfOverlayBundle, type PdfOverlayPlacement } from './overlay'
export { loadRasterPdfium, pdfiumWasmPath, type RasterPdfium } from './pdfium'
export {
  AUTO_FLOOR_DPI,
  AUTO_PIXEL_BUDGET,
  AUTO_TARGET_DPI,
  encodeBgrxToJpeg,
  encodeBgrxToPng,
  rasterDpiFor,
  rasterizePdf,
  type RasterFace,
  type RasterizeOptions,
  type RasterProgress,
} from './raster'
export { grayscalePdf, rotateLandscapeFaces, type GrayPdfOptions } from './grayscale'
export {
  isRasterWorkerData,
  numberedImagePaths,
  PREVIEW_LONG_SIDE_MAX_PX,
  PREVIEW_LONG_SIDE_MIN_PX,
  PREVIEW_LONG_SIDE_PX,
  RASTER_WORKER_DATA,
  rasterErrorMessage,
  runRasterJob,
  serveRasterJob,
  type PreviewImageFace,
  type PrintImageFace,
  type RasterJobContext,
  type RasterJobRequest,
  type RasterJobResult,
  type RasterWorkerMessage,
  type RasterWorkerPort,
} from './raster-job'
