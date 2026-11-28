// Main-process / worker side: one print layout job from the job PDF to what the
// sender needs (face image files, preview images, arranged PDF, or saved images).
// The same function runs in a worker thread in the app and directly in tests.
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { arrangePrintJob, readJobPageSizes } from './arrange'
import { PrintLayoutError, type PrintLayoutIssue } from './errors'
import type { PageSize } from './geometry'
import { grayscalePdf, rotateLandscapeFaces } from './grayscale'
import type {
  DpiChoice,
  ImageBundleMode,
  ImageExportFormat,
  JpgQuality,
  PrintLayoutOptions,
} from './options'
import { applyPdfOverlays, type PdfOverlayBundle } from './overlay'
import { encodeBgrxToJpeg, encodeBgrxToPng, rasterizePdfBgrx, type RasterProgress } from './raster'
import { buildStoreZip, type ZipStoreEntry } from './zip-store'

/** Long side of a preview image when the caller names none. */
export const PREVIEW_LONG_SIDE_PX = 800
/** Bounds on a requested preview size. */
export const PREVIEW_LONG_SIDE_MIN_PX = 64
export const PREVIEW_LONG_SIDE_MAX_PX = 2400

export type RasterJobRequest =
  | {
      /** face images for printing: landscape faces turned upright, written to `outDir` */
      kind: 'print-images'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      overlays?: PdfOverlayBundle | undefined
      outDir: string
      wasmPath?: string | undefined
    }
  | {
      /** small face images for the result preview, not turned */
      kind: 'preview'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      overlays?: PdfOverlayBundle | undefined
      longSidePx: number
      /** optional 0-based face indices to render (defaults to all faces) */
      faceIndices?: number[] | undefined
      wasmPath?: string | undefined
    }
  | {
      /** arranges the PDF and stamps overlays once for a cached live-preview session */
      kind: 'arrange'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      overlays?: PdfOverlayBundle | undefined
      wasmPath?: string | undefined
    }
  | {
      /** renders selected faces from an already-arranged PDF (live-preview page flip) */
      kind: 'preview-arranged'
      arrangedPdf: Uint8Array
      dpi: DpiChoice
      grayscale: boolean
      longSidePx: number
      faceIndices?: number[] | undefined
      wasmPath?: string | undefined
    }
  | {
      /** the arranged PDF (grayscale when asked); `rotateLandscape` for a printer queue */
      kind: 'pdf'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      overlays?: PdfOverlayBundle | undefined
      rotateLandscape: boolean
      wasmPath?: string | undefined
    }
  | {
      /** saves arranged faces as PNG/JPG files (single, numbered, or UTF-8 STORE ZIP) */
      kind: 'save-images'
      jobPdf: Uint8Array
      options: PrintLayoutOptions
      overlays?: PdfOverlayBundle | undefined
      format: ImageExportFormat
      quality: JpgQuality
      bundle: ImageBundleMode
      /** target file path picked by the user (single/numbered base path, or .zip path) */
      outPath: string
      wasmPath?: string | undefined
    }

export interface PrintImageFace {
  /** file name inside `outDir` */
  file: string
  /** the printed face in points, after any turn (a turned face is the face's height wide) */
  widthPt: number
  heightPt: number
  rotated: boolean
}

export interface PreviewImageFace {
  /** 0-based face index in the arranged output */
  index?: number | undefined
  png: Uint8Array
  /** the face in points as the arranged PDF shows it */
  widthPt: number
  heightPt: number
}

export type RasterJobResult =
  | { kind: 'print-images'; faces: PrintImageFace[] }
  | {
      kind: 'preview'
      faces: PreviewImageFace[]
      totalFaces?: number | undefined
      faceSizes?: PageSize[] | undefined
    }
  | { kind: 'arrange'; pdf: Uint8Array; faceSizes: PageSize[] }
  | { kind: 'preview-arranged'; faces: PreviewImageFace[]; totalFaces: number }
  | { kind: 'pdf'; pdf: Uint8Array }
  | { kind: 'save-images'; paths: string[] }

export interface RasterJobContext {
  signal?: AbortSignal | undefined
  onProgress?: ((progress: RasterProgress) => void) | undefined
}

function faceFileName(index: number): string {
  return `face-${String(index + 1).padStart(5, '0')}.png`
}

/** Matches `numberedExportPaths`: 1 face keeps `target`; >=2 faces get `stem-01.ext`, ... */
export function numberedImagePaths(target: string, count: number): string[] {
  const pages = Math.max(0, Math.floor(count))
  if (pages <= 1) return pages === 1 ? [target] : []
  const slash = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))
  const dot = target.lastIndexOf('.')
  const hasExt = dot > slash + 1
  const stem = hasExt ? target.slice(0, dot) : target
  const ext = hasExt ? target.slice(dot) : ''
  const width = Math.max(2, String(pages).length)
  return Array.from(
    { length: pages },
    (_, i) => `${stem}-${String(i + 1).padStart(width, '0')}${ext}`,
  )
}

function clampPreviewLongSide(requested: number): number {
  return Math.round(
    Math.min(
      PREVIEW_LONG_SIDE_MAX_PX,
      Math.max(PREVIEW_LONG_SIDE_MIN_PX, requested || PREVIEW_LONG_SIDE_PX),
    ),
  )
}

async function prepareArrangedPdf(
  jobPdf: Uint8Array,
  options: PrintLayoutOptions,
  overlays: PdfOverlayBundle | undefined,
  wasmPath: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const arranged = await arrangePrintJob(jobPdf, options)
  signal?.throwIfAborted()
  const stamped = await applyPdfOverlays(arranged, overlays, wasmPath)
  signal?.throwIfAborted()
  return stamped
}

/** Runs one job. Throws `PrintLayoutError` for options the job cannot take. */
export async function runRasterJob(
  request: RasterJobRequest,
  context: RasterJobContext = {},
): Promise<RasterJobResult> {
  const { signal, onProgress } = context
  signal?.throwIfAborted()

  if (request.kind === 'preview-arranged') {
    const longSidePx = clampPreviewLongSide(request.longSidePx)
    const faces: PreviewImageFace[] = []
    const totalFaces = await rasterizePdfBgrx(
      request.arrangedPdf,
      {
        dpi: request.dpi,
        longSidePx,
        grayscale: request.grayscale,
        rotateLandscape: false,
        faceIndices: request.faceIndices,
        signal,
        onProgress,
        wasmPath: request.wasmPath,
      },
      (face) => {
        faces.push({
          index: face.index,
          png: encodeBgrxToPng(
            face.bgrx,
            face.stride,
            face.widthPx,
            face.heightPx,
            request.grayscale,
            request.wasmPath,
          ),
          widthPt: face.widthPt,
          heightPt: face.heightPt,
        })
      },
    )
    return { kind: 'preview-arranged', faces, totalFaces }
  }

  const { options, wasmPath } = request
  const arranged = await prepareArrangedPdf(
    request.jobPdf,
    options,
    request.overlays,
    wasmPath,
    signal,
  )

  if (request.kind === 'arrange') {
    const faceSizes = await readJobPageSizes(arranged)
    signal?.throwIfAborted()
    return { kind: 'arrange', pdf: arranged, faceSizes }
  }

  if (request.kind === 'pdf') {
    let pdf = options.grayscale
      ? await grayscalePdf(arranged, { dpi: options.dpi, signal, onProgress, wasmPath })
      : arranged
    if (request.rotateLandscape) pdf = (await rotateLandscapeFaces(pdf)).pdf
    signal?.throwIfAborted()
    return { kind: 'pdf', pdf }
  }

  if (request.kind === 'preview') {
    const longSidePx = clampPreviewLongSide(request.longSidePx)
    const faces: PreviewImageFace[] = []
    const faceSizes = await readJobPageSizes(arranged)
    signal?.throwIfAborted()
    const totalFaces = await rasterizePdfBgrx(
      arranged,
      {
        dpi: options.dpi,
        longSidePx,
        grayscale: options.grayscale,
        rotateLandscape: false,
        faceIndices: request.faceIndices,
        signal,
        onProgress,
        wasmPath,
      },
      (face) => {
        faces.push({
          index: face.index,
          png: encodeBgrxToPng(
            face.bgrx,
            face.stride,
            face.widthPx,
            face.heightPx,
            options.grayscale,
            wasmPath,
          ),
          widthPt: face.widthPt,
          heightPt: face.heightPt,
        })
      },
    )
    return { kind: 'preview', faces, totalFaces, faceSizes }
  }

  if (request.kind === 'save-images') {
    const ext = request.format === 'jpg' ? 'jpg' : 'png'
    const faceSizes = await readJobPageSizes(arranged)
    signal?.throwIfAborted()
    const total = faceSizes.length
    if (total === 0) throw new Error('the print job has no faces')
    const useZip = request.bundle === 'zip' || /\.zip$/i.test(request.outPath)

    const encodeFace = (bgrx: Uint8Array, stride: number, w: number, h: number): Uint8Array =>
      request.format === 'jpg'
        ? encodeBgrxToJpeg(bgrx, stride, w, h, options.grayscale, request.quality, wasmPath)
        : encodeBgrxToPng(bgrx, stride, w, h, options.grayscale, wasmPath)

    if (useZip) {
      const baseName = basename(request.outPath).replace(/\.zip$/i, '') || 'pages'
      const width = Math.max(2, String(total).length)
      const entries: ZipStoreEntry[] = []
      await rasterizePdfBgrx(
        arranged,
        {
          dpi: options.dpi,
          grayscale: options.grayscale,
          rotateLandscape: false,
          signal,
          onProgress,
          wasmPath,
        },
        (face) => {
          const data = encodeFace(face.bgrx, face.stride, face.widthPx, face.heightPx)
          entries.push({
            name: `${baseName}-${String(face.index + 1).padStart(width, '0')}.${ext}`,
            data,
          })
        },
      )
      signal?.throwIfAborted()
      const zip = buildStoreZip(entries)
      await writeFile(request.outPath, zip)
      return { kind: 'save-images', paths: [request.outPath] }
    }

    const targets = numberedImagePaths(request.outPath, total)
    const written: string[] = []
    await rasterizePdfBgrx(
      arranged,
      {
        dpi: options.dpi,
        grayscale: options.grayscale,
        rotateLandscape: false,
        signal,
        onProgress,
        wasmPath,
      },
      async (face) => {
        const bytes = encodeFace(face.bgrx, face.stride, face.widthPx, face.heightPx)
        const target = targets[face.index]!
        await writeFile(target, bytes)
        written.push(target)
      },
    )
    return { kind: 'save-images', paths: written }
  }

  // Grayscale faces are rendered gray here, once; the gray PDF is not built
  // and rendered again for printing.
  const faces: PrintImageFace[] = []
  const outDir = request.outDir
  await rasterizePdfBgrx(
    arranged,
    {
      dpi: options.dpi,
      grayscale: options.grayscale,
      rotateLandscape: true,
      signal,
      onProgress,
      wasmPath,
    },
    async (face) => {
      const file = faceFileName(face.index)
      // Consume `face.bgrx` synchronously before awaiting the file write.
      const png = encodeBgrxToPng(
        face.bgrx,
        face.stride,
        face.widthPx,
        face.heightPx,
        options.grayscale,
        wasmPath,
      )
      await writeFile(join(outDir, file), png)
      faces.push({
        file,
        widthPt: face.rotated ? face.heightPt : face.widthPt,
        heightPt: face.rotated ? face.widthPt : face.heightPt,
        rotated: face.rotated,
      })
    },
  )
  return { kind: 'print-images', faces }
}

/** Messages a raster worker sends back. */
export type RasterWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: RasterJobResult }
  | { type: 'error'; message: string; issue?: PrintLayoutIssue }

/** Marks a worker started for raster jobs (its `workerData`). */
export const RASTER_WORKER_DATA = { genofficePrintLayoutRaster: true } as const

/** True for the `workerData` a raster worker is started with. */
export function isRasterWorkerData(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).genofficePrintLayoutRaster === true
  )
}

/** The part of a worker's `parentPort` the job server uses. */
export interface RasterWorkerPort {
  once(event: 'message', listener: (request: RasterJobRequest) => void): unknown
  postMessage(message: RasterWorkerMessage, transfer?: ArrayBuffer[]): void
}

function transferablesOf(result: RasterJobResult): ArrayBuffer[] {
  if (result.kind === 'pdf' || result.kind === 'arrange') return [result.pdf.buffer as ArrayBuffer]
  if (result.kind === 'preview' || result.kind === 'preview-arranged') {
    return result.faces.map((f) => f.png.buffer as ArrayBuffer)
  }
  return []
}

/** Error to message, keeping a layout issue's code. */
export function rasterErrorMessage(err: unknown): RasterWorkerMessage {
  if (err instanceof PrintLayoutError) {
    return { type: 'error', message: err.message, issue: err.toIssue() }
  }
  return { type: 'error', message: err instanceof Error ? err.message : String(err) }
}

/**
 * Worker side: answers one job on `port`. The parent ends the worker when the
 * answer arrives, and terminates it to cancel.
 */
export function serveRasterJob(port: RasterWorkerPort): void {
  port.once('message', (request) => {
    void runRasterJob(request, {
      onProgress: ({ done, total }) => port.postMessage({ type: 'progress', done, total }),
    }).then(
      (result) => {
        // a result buffer may be a view into a larger one; send only copies this side owns
        const owned = ownedCopy(result)
        port.postMessage({ type: 'done', result: owned }, transferablesOf(owned))
      },
      (err: unknown) => port.postMessage(rasterErrorMessage(err)),
    )
  })
}

function ownedCopy(result: RasterJobResult): RasterJobResult {
  if (result.kind === 'pdf') return { kind: 'pdf', pdf: result.pdf.slice() }
  if (result.kind === 'arrange') return { ...result, pdf: result.pdf.slice() }
  if (result.kind === 'preview' || result.kind === 'preview-arranged') {
    return { ...result, faces: result.faces.map((f) => ({ ...f, png: f.png.slice() })) }
  }
  return result
}
