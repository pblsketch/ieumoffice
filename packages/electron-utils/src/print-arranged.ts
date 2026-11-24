// The worker path module's type, for every editor build that compiles this file.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./print-layout-worker-path.d.ts" />
/// Advanced print layout for the editors' main processes: the print job PDF is
/// arranged (and turned gray when asked), rendered to face images in a worker
/// thread, and printed from a hidden window through the system dialog or the
/// editor's in-app printer. macOS in-app printer jobs go to the queue as a PDF
/// instead. Also the result preview, saving the arranged PDF, the IPC helpers
/// every editor registers, and the app-wide label grid store.
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  isDefaultOptions,
  PrintLayoutError,
  pdfiumWasmPath,
  RASTER_WORKER_DATA,
  runRasterJob,
  validateImageExportOptions,
  validateLabelSpec,
  validateOptions,
  type ImageExportOptions,
  type LabelSpec,
  type PageSize,
  type PdfOverlayBundle,
  type PrintImageFace,
  type PrintLayoutOptions,
  type RasterJobRequest,
  type RasterJobResult,
  type RasterWorkerMessage,
} from '@genoffice/print-layout'
import printLayoutWorkerPath from './print-layout-worker?modulePath'
import { atomicWriteFile, writeJsonAtomic } from './atomic-write'
import { printPdfViaCups, type CupsPrintJob } from './print-cups'
import { printJobOptions, printOutcome, type PrintDuplex } from './print-job'
import {
  PRINT_LAYOUT_SHARED_CHANNELS,
  printLayoutChannels,
  type LabelSpecSetResult,
  type PrintLayoutFailure,
  type PrintLayoutOverlayData,
  type PrintLayoutPreviewFacesResult,
  type PrintLayoutPreviewResult,
  type PrintLayoutPrintResult,
  type PrintLayoutProgress,
  type PrintLayoutSaveImagesResult,
  type PrintLayoutSaveResult,
} from './print-layout-channels'
import { PRINT_READY_SCRIPT } from './print-window'

export * from './print-layout-channels'

// ── Runners: where a job's rendering happens ───────────────────────────────

export interface PrintLayoutRunContext {
  signal?: AbortSignal | undefined
  onProgress?: ((progress: PrintLayoutProgress) => void) | undefined
}

/** Runs one raster job: in a worker thread in the app, directly in tests. */
export interface PrintLayoutRunner {
  run(request: RasterJobRequest, context: PrintLayoutRunContext): Promise<RasterJobResult>
}

/** Runs jobs on the calling thread (tests, or a build without the worker chunk). */
export const inProcessRunner: PrintLayoutRunner = {
  run: (request, context) => runRasterJob(request, context),
}

/** The part of node:worker_threads' Worker used here. */
export interface RasterWorkerLike {
  on(event: 'message', listener: (message: RasterWorkerMessage) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(request: RasterJobRequest, transfer: ArrayBuffer[]): void
  terminate(): Promise<number>
}

function abortError(): Error {
  return new DOMException('The print job was canceled', 'AbortError')
}

/**
 * One worker per job, terminated on every path: answered, failed, crashed or
 * canceled. A cancel settles only after the worker has stopped, so the caller
 * can remove the job's files right away.
 */
export function workerRunner(spawn: () => RasterWorkerLike): PrintLayoutRunner {
  return {
    run(request, { signal, onProgress }) {
      if (signal?.aborted) return Promise.reject(abortError())
      const worker = spawn()
      return new Promise<RasterJobResult>((resolve, reject) => {
        let settled = false
        const finish = (settle: () => void) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          void worker
            .terminate()
            .catch(() => 0)
            .then(settle)
        }
        const onAbort = () => finish(() => reject(abortError()))
        signal?.addEventListener('abort', onAbort, { once: true })
        worker.on('message', (message) => {
          if (settled) return
          if (message.type === 'progress') {
            onProgress?.({ done: message.done, total: message.total })
          } else if (message.type === 'done') {
            finish(() => resolve(message.result))
          } else {
            const err = message.issue
              ? new PrintLayoutError(message.issue)
              : new Error(message.message)
            finish(() => reject(err))
          }
        })
        worker.on('error', (err) => finish(() => reject(err)))
        worker.on('exit', (code) =>
          finish(() => reject(new Error(`the print job stopped (exit code ${code})`))),
        )
        // a Buffer can view Node's shared pool: hand over a copy this side owns
        if (request.kind === 'preview-arranged') {
          const arrangedPdf = new Uint8Array(request.arrangedPdf)
          worker.postMessage({ ...request, arrangedPdf }, [arrangedPdf.buffer])
        } else {
          const jobPdf = new Uint8Array(request.jobPdf)
          const transfer: ArrayBuffer[] = [jobPdf.buffer]
          let overlays = request.overlays
          if (overlays) {
            const stamps = overlays.stamps.map((s) => {
              const copy = new Uint8Array(s)
              transfer.push(copy.buffer)
              return copy
            })
            overlays = { stamps, perFace: overlays.perFace }
          }
          worker.postMessage({ ...request, jobPdf, ...(overlays ? { overlays } : {}) }, transfer)
        }
      })
    },
  }
}

/** Worker runner for the bundled worker chunk at `path`. */
export function workerRunnerAt(path: string): PrintLayoutRunner {
  return workerRunner(
    () => new Worker(path, { workerData: RASTER_WORKER_DATA }) as unknown as RasterWorkerLike,
  )
}

/**
 * The worker chunk when the build bundled one (every editor main build does:
 * electron-vite resolves `?modulePath`); otherwise, as under the test runner,
 * the calling thread.
 */
export function defaultPrintLayoutRunner(): PrintLayoutRunner {
  const path: unknown = printLayoutWorkerPath
  return typeof path === 'string' && path !== '' && existsSync(path)
    ? workerRunnerAt(path)
    : inProcessRunner
}

// ── Results ────────────────────────────────────────────────────────────────

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
  )
}

/** A thrown error as the answer the screen gets. */
export function printLayoutFailure(err: unknown, signal?: AbortSignal): PrintLayoutFailure {
  if (isAbort(err, signal)) return { ok: false, aborted: true }
  if (err instanceof PrintLayoutError) {
    const issue = err.toIssue()
    return { ok: false, error: issue.message, code: issue.code }
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

// ── Preview, save and print ────────────────────────────────────────────────

export interface ArrangedJob {
  /** the editor's print job PDF (range, selection and its own layout applied) */
  jobPdf: Uint8Array
  /** checked options (`validateOptions`) */
  options: PrintLayoutOptions
  /** pre-rendered transparent PNG overlays (watermark, header/footer) */
  overlays?: PdfOverlayBundle | undefined
  signal?: AbortSignal | undefined
  onProgress?: ((progress: PrintLayoutProgress) => void) | undefined
  /** default `defaultPrintLayoutRunner()` */
  runner?: PrintLayoutRunner | undefined
  /** default `pdfiumWasmPath()` */
  wasmPath?: string | undefined
}

const runnerOf = (job: ArrangedJob) => job.runner ?? defaultPrintLayoutRunner()
const wasmOf = (job: ArrangedJob) => job.wasmPath ?? pdfiumWasmPath()

/** Each arranged face (grayscale applied) as a small PNG, not turned. */
export async function previewArranged(
  job: ArrangedJob & {
    longSidePx?: number | undefined
    faceIndices?: number[] | undefined
  },
): Promise<PrintLayoutPreviewResult> {
  try {
    const result = await runnerOf(job).run(
      {
        kind: 'preview',
        jobPdf: job.jobPdf,
        options: job.options,
        ...(job.overlays ? { overlays: job.overlays } : {}),
        longSidePx: job.longSidePx ?? 0,
        ...(job.faceIndices ? { faceIndices: job.faceIndices } : {}),
        wasmPath: wasmOf(job),
      },
      { signal: job.signal, onProgress: job.onProgress },
    )
    if (result.kind !== 'preview') throw new Error('the print job answered the wrong request')
    job.signal?.throwIfAborted()
    return {
      ok: true,
      faces: result.faces,
      ...(result.totalFaces !== undefined ? { totalFaces: result.totalFaces } : {}),
      ...(result.faceSizes !== undefined ? { faceSizes: result.faceSizes } : {}),
    }
  } catch (err) {
    return printLayoutFailure(err, job.signal)
  }
}

/** The arranged PDF (the gray one when grayscale is on, faces never turned) at `path`. */
export async function saveArrangedPdf(
  job: ArrangedJob & { path: string },
): Promise<PrintLayoutSaveResult> {
  try {
    const result = await runnerOf(job).run(
      {
        kind: 'pdf',
        jobPdf: job.jobPdf,
        options: job.options,
        ...(job.overlays ? { overlays: job.overlays } : {}),
        rotateLandscape: false,
        wasmPath: wasmOf(job),
      },
      { signal: job.signal, onProgress: job.onProgress },
    )
    if (result.kind !== 'pdf') throw new Error('the print job answered the wrong request')
    job.signal?.throwIfAborted()
    await atomicWriteFile(job.path, Buffer.from(result.pdf))
    return { ok: true, path: job.path }
  } catch (err) {
    return printLayoutFailure(err, job.signal)
  }
}

/** Saves the arranged faces as PNG/JPG files (single, numbered, or UTF-8 STORE ZIP). */
export async function saveArrangedImages(
  job: ArrangedJob & { image: ImageExportOptions; path: string },
): Promise<PrintLayoutSaveImagesResult> {
  try {
    const result = await runnerOf(job).run(
      {
        kind: 'save-images',
        jobPdf: job.jobPdf,
        options: job.options,
        ...(job.overlays ? { overlays: job.overlays } : {}),
        format: job.image.format,
        quality: job.image.quality,
        bundle: job.image.bundle,
        outPath: job.path,
        wasmPath: wasmOf(job),
      },
      { signal: job.signal, onProgress: job.onProgress },
    )
    if (result.kind !== 'save-images') throw new Error('the print job answered the wrong request')
    job.signal?.throwIfAborted()
    return { ok: true, paths: result.paths }
  } catch (err) {
    return printLayoutFailure(err, job.signal)
  }
}

/** Electron's `webContents.print` options this module passes. */
export interface PrintLayoutPrintOptions {
  silent: boolean
  printBackground: boolean
  margins: { marginType: 'none' }
  /** copies are always whole sets: the arranged faces are one set */
  collate: boolean
  deviceName?: string
  copies?: number
  duplexMode?: PrintDuplex
  /** microns; the printed faces' paper for an in-app printer job */
  pageSize?: { width: number; height: number }
}

/** The hidden window the face images print from; the caller owns its webPreferences. */
export interface PrintLayoutWindow {
  loadFile(path: string): Promise<void>
  webContents: {
    executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>
    print(
      options: PrintLayoutPrintOptions,
      callback: (success: boolean, failureReason: string) => void,
    ): void
  }
  show(): void
  focus(): void
  isDestroyed(): boolean
  destroy(): void
}

export type CupsSender = (
  pdf: Uint8Array,
  job: CupsPrintJob,
) => Promise<{ ok: boolean; error?: string }>

export interface PrintArrangedRequest extends ArrangedJob {
  /** `PrintJobOptions` from the in-app printer choice; absent = the system dialog */
  job?: unknown | undefined
  /** made only once the images are ready, so a canceled job opens no window */
  createWindow: () => PrintLayoutWindow
  platform?: NodeJS.Platform | undefined
  /** default `printPdfViaCups` */
  sendCups?: CupsSender | undefined
  /** temp folder prefix inside the OS temp folder */
  dirPrefix?: string | undefined
}

const PT_TO_MICRONS = 25_400 / 72
/** Images get this much less height than their page, so rounding never spills a blank page. */
const FIT_SLACK_PT = 0.75
// a wedged readiness probe must not hold the job forever
const PRINT_READY_TIMEOUT_MS = 10_000

const css = (n: number) => `${Number(n.toFixed(3))}pt`

/**
 * The print page: one image per face, each face on its own named page of its
 * size with no margin. Images are already turned upright.
 */
export function printFacesHtml(faces: readonly PrintImageFace[]): string {
  const sizes = new Map<string, number>()
  const pageOf = (f: PrintImageFace) => {
    const key = `${css(f.widthPt)} ${css(f.heightPt)}`
    let n = sizes.get(key)
    if (n === undefined) {
      n = sizes.size
      sizes.set(key, n)
    }
    return n
  }
  const body = faces
    .map((f) => {
      const n = pageOf(f)
      const style = `width:${css(f.widthPt)};height:${css(Math.max(1, f.heightPt - FIT_SLACK_PT))}`
      return `<img class="f${n}" src="${f.file}" alt="" style="${style}">`
    })
    .join('\n')
  const pages = [...sizes]
    .map(([size, n]) => `@page f${n}{size:${size};margin:0}\n.f${n}{page:f${n}}`)
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>print</title><style>
@page{margin:0}
html,body{margin:0;padding:0;background:#fff}
img{display:block;object-fit:contain;break-inside:avoid}
img+img{break-before:page}
${pages}
</style></head><body>
${body}
</body></html>
`
}

/**
 * Prints the arranged job. Faces are rendered to images (gray ones when
 * grayscale is on, rendered once) in a per-job temp folder, landscape faces
 * turned upright, and printed from `createWindow()`. A macOS in-app printer
 * job sends the arranged (or gray) PDF to the queue with landscape faces
 * marked turned instead, without images. On cancel or failure nothing is
 * sent; the temp folder is always removed.
 */
export async function printArranged(req: PrintArrangedRequest): Promise<PrintLayoutPrintResult> {
  const platform = req.platform ?? process.platform
  const jobOpts = printJobOptions(req.job)
  // Arranged jobs (n-up, booklet, odd/even, reverse, etc.) always stay collated
  // as whole sets; plain single-page silent jobs honor the caller's collate choice.
  const collate = isDefaultOptions(req.options) ? (jobOpts.collate ?? true) : true
  const signal = req.signal
  let tempDir: string | null = null
  try {
    signal?.throwIfAborted()
    if (platform === 'darwin' && jobOpts.silent) {
      const result = await runnerOf(req).run(
        {
          kind: 'pdf',
          jobPdf: req.jobPdf,
          options: req.options,
          ...(req.overlays ? { overlays: req.overlays } : {}),
          rotateLandscape: true,
          wasmPath: wasmOf(req),
        },
        { signal, onProgress: req.onProgress },
      )
      if (result.kind !== 'pdf') throw new Error('the print job answered the wrong request')
      signal?.throwIfAborted()
      const send = req.sendCups ?? ((pdf, job) => printPdfViaCups(pdf, job))
      const sent = await send(result.pdf, {
        ...(jobOpts.deviceName !== undefined ? { deviceName: jobOpts.deviceName } : {}),
        ...(jobOpts.copies !== undefined ? { copies: jobOpts.copies } : {}),
        collate,
        ...(jobOpts.duplexMode !== undefined ? { duplexMode: jobOpts.duplexMode } : {}),
      })
      return sent.ok ? { ok: true } : { ok: false, error: sent.error ?? 'the print job failed' }
    }

    tempDir = await mkdtemp(join(tmpdir(), req.dirPrefix ?? 'genoffice-print-layout-'))
    const result = await runnerOf(req).run(
      {
        kind: 'print-images',
        jobPdf: req.jobPdf,
        options: req.options,
        ...(req.overlays ? { overlays: req.overlays } : {}),
        outDir: tempDir,
        wasmPath: wasmOf(req),
      },
      { signal, onProgress: req.onProgress },
    )
    if (result.kind !== 'print-images') throw new Error('the print job answered the wrong request')
    if (result.faces.length === 0) throw new Error('the print job has no faces')
    signal?.throwIfAborted()
    const htmlPath = join(tempDir, 'print.html')
    await writeFile(htmlPath, printFacesHtml(result.faces), 'utf8')

    const win = req.createWindow()
    try {
      await win.loadFile(htmlPath)
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        win.webContents.executeJavaScript(PRINT_READY_SCRIPT, true),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PRINT_READY_TIMEOUT_MS)
        }),
      ]).catch((err: unknown) => {
        console.error('[print-layout] readiness probe failed:', err)
      })
      clearTimeout(timer)
      signal?.throwIfAborted()
      // Windows attaches the native dialog to the printed window, which must be visible
      if (platform === 'win32' && !jobOpts.silent) {
        win.show()
        win.focus()
      }
      const first = result.faces[0]!
      const options: PrintLayoutPrintOptions = {
        silent: jobOpts.silent,
        printBackground: true,
        margins: { marginType: 'none' },
        collate,
        ...(jobOpts.silent
          ? {
              ...(jobOpts.deviceName !== undefined ? { deviceName: jobOpts.deviceName } : {}),
              ...(jobOpts.copies !== undefined ? { copies: jobOpts.copies } : {}),
              ...(jobOpts.duplexMode !== undefined ? { duplexMode: jobOpts.duplexMode } : {}),
              pageSize: {
                width: Math.round(first.widthPt * PT_TO_MICRONS),
                height: Math.round(first.heightPt * PT_TO_MICRONS),
              },
            }
          : {}),
      }
      const printed = await new Promise<{ success: boolean; reason: string }>((resolve) => {
        win.webContents.print(options, (success, reason) => resolve({ success, reason }))
      })
      const outcome = printOutcome(printed.success, printed.reason, options.silent)
      if (outcome.ok) return { ok: true }
      // printOutcome leaves out the error only for a cancel in the system dialog
      if (!options.silent && printed.reason && !outcome.error) return { ok: true, canceled: true }
      return { ok: false, error: outcome.error ?? 'the print job failed' }
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  } catch (err) {
    return printLayoutFailure(err, signal)
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ── IPC: one editor's channels ─────────────────────────────────────────────

/** The part of Electron's `ipcMain` these helpers use. */
export interface PrintLayoutIpcMain {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
  removeHandler?(channel: string): void
}

/** The part of the invoking `webContents` used: who asked, where progress goes, and OS printers. */
export interface PrintLayoutSender {
  id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  getPrintersAsync?(): Promise<Array<{ name: string; displayName?: string }>>
  once?(event: string, listener: () => void): unknown
}

export interface PrintLayoutInvokeEvent {
  sender: PrintLayoutSender
}

export interface PrintLayoutIpcHandlers<E = unknown> {
  ipcMain: PrintLayoutIpcMain
  /** the editor's print job PDF for this request: its range, selection and own layout applied */
  buildJobPdf(event: PrintLayoutInvokeEvent, editor: E | undefined): Promise<Uint8Array>
  /** a hidden window with the editor's webPreferences (scripting on, for the readiness check) */
  createPrintWindow(event: PrintLayoutInvokeEvent): PrintLayoutWindow
  /** asks where to save the arranged PDF; null = the user canceled */
  pickSavePath(event: PrintLayoutInvokeEvent, editor: E | undefined): Promise<string | null>
  /** asks where to save PNG/JPG/ZIP output; null = the user canceled */
  pickImageSavePath?(
    event: PrintLayoutInvokeEvent,
    editor: E | undefined,
    image: ImageExportOptions,
  ): Promise<string | null>
  /**
   * Optional main-process guard for permission-restricted documents (e.g. PDF
   * with copy/extract restrictions). Returning false rejects both `save` and
   * `saveImages`.
   */
  canSave?(event: PrintLayoutInvokeEvent, editor: E | undefined): Promise<boolean> | boolean
  runner?: PrintLayoutRunner | undefined
  platform?: NodeJS.Platform | undefined
  sendCups?: CupsSender | undefined
}

interface ParsedRequest {
  options: unknown
  editor: unknown
  job: unknown
  longSidePx: unknown
  faceIndices: unknown
  editorKey: unknown
  optionsKey: unknown
  overlays: unknown
  image: unknown
}

function parseRequest(raw: unknown): ParsedRequest {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    options: r.options,
    editor: r.editor,
    job: r.job,
    longSidePx: r.longSidePx,
    faceIndices: r.faceIndices,
    editorKey: r.editorKey,
    optionsKey: r.optionsKey,
    overlays: r.overlays,
    image: r.image,
  }
}

function parseOverlays(raw: unknown): PdfOverlayBundle | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Partial<PrintLayoutOverlayData>
  if (!Array.isArray(r.stamps) || !Array.isArray(r.perFace)) return undefined
  const stamps: Uint8Array[] = []
  for (const s of r.stamps) {
    if (!(s instanceof Uint8Array)) return undefined
    stamps.push(s)
  }
  const perFace = r.perFace.map((list) =>
    Array.isArray(list)
      ? list
          .filter(
            (p): p is NonNullable<typeof p> =>
              typeof p === 'object' && p !== null && typeof p.stampIndex === 'number',
          )
          .map((p) => ({
            stampIndex: p.stampIndex,
            ...(typeof p.x === 'number' ? { x: p.x } : {}),
            ...(typeof p.y === 'number' ? { y: p.y } : {}),
            ...(typeof p.width === 'number' ? { width: p.width } : {}),
            ...(typeof p.height === 'number' ? { height: p.height } : {}),
            ...(typeof p.opacity === 'number' ? { opacity: p.opacity } : {}),
          }))
      : [],
  )
  return stamps.length > 0 ? { stamps, perFace } : undefined
}

function parseFaceIndices(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0)
}

interface PreviewSessionCache {
  editorKey: string | null
  jobPdf: Uint8Array | null
  optionsKey: string | null
  arrangedPdf: Uint8Array | null
  faceSizes: PageSize[] | null
}

/** Standard Electron file dialog filters for image export (`png` / `jpg` / `zip`). */
export function imageSaveDialogSpec(
  baseName: string,
  image: ImageExportOptions,
): { defaultFileName: string; filters: Array<{ name: string; extensions: string[] }> } {
  const safeBase = baseName.replace(/\.[^./\\]+$/, '') || 'document'
  if (image.bundle === 'zip') {
    return {
      defaultFileName: `${safeBase}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    }
  }
  if (image.format === 'jpg') {
    return {
      defaultFileName: `${safeBase}.jpg`,
      filters: [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }],
    }
  }
  return {
    defaultFileName: `${safeBase}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  }
}

const registered = new WeakMap<PrintLayoutIpcMain, Map<string, () => void>>()

/**
 * Registers `<prefix>:print-layout-preview|preview-faces|close-preview|print|save|save-images|cancel`
 * for one editor. Options are checked before anything is built. Progress goes as
 * `<prefix>:print-layout-progress` to the asking window only. A window runs one
 * job at a time: a new request cancels its previous one. Registering the same
 * prefix again on the same `ipcMain` returns the first registration's remover.
 */
export function registerPrintLayoutIpc<E = unknown>(
  prefix: string,
  handlers: PrintLayoutIpcHandlers<E>,
): () => void {
  const channels = printLayoutChannels(prefix)
  const ipc = handlers.ipcMain
  let byPrefix = registered.get(ipc)
  if (!byPrefix) {
    byPrefix = new Map()
    registered.set(ipc, byPrefix)
  }
  const existing = byPrefix.get(prefix)
  if (existing) return existing

  const running = new Map<number, AbortController>()
  const previewRunning = new Map<number, AbortController>()
  const sessions = new Map<number, PreviewSessionCache>()

  const dropSession = (senderId: number) => {
    previewRunning.get(senderId)?.abort()
    previewRunning.delete(senderId)
    sessions.delete(senderId)
  }

  const ensureSessionCleanup = (sender: PrintLayoutSender) => {
    if (sessions.has(sender.id)) return
    sessions.set(sender.id, {
      editorKey: null,
      jobPdf: null,
      optionsKey: null,
      arrangedPdf: null,
      faceSizes: null,
    })
    sender.once?.('destroyed', () => dropSession(sender.id))
  }

  const beginIn = (
    map: Map<number, AbortController>,
    sender: PrintLayoutSender,
  ): AbortController => {
    map.get(sender.id)?.abort()
    const controller = new AbortController()
    map.set(sender.id, controller)
    return controller
  }
  const endIn = (
    map: Map<number, AbortController>,
    sender: PrintLayoutSender,
    controller: AbortController,
  ) => {
    if (map.get(sender.id) === controller) map.delete(sender.id)
  }
  const progressTo = (sender: PrintLayoutSender) => (p: PrintLayoutProgress) => {
    if (!sender.isDestroyed()) sender.send(channels.progress, { done: p.done, total: p.total })
  }
  const checked = (raw: unknown) => validateOptions(raw, Number.MAX_SAFE_INTEGER)
  const common = { runner: handlers.runner }

  async function withJob<T>(
    event: PrintLayoutInvokeEvent,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | PrintLayoutFailure> {
    const controller = beginIn(running, event.sender)
    try {
      return await work(controller.signal)
    } catch (err) {
      return printLayoutFailure(err, controller.signal)
    } finally {
      endIn(running, event.sender, controller)
    }
  }

  async function withPreviewJob<T>(
    event: PrintLayoutInvokeEvent,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | PrintLayoutFailure> {
    const controller = beginIn(previewRunning, event.sender)
    try {
      return await work(controller.signal)
    } catch (err) {
      return printLayoutFailure(err, controller.signal)
    } finally {
      endIn(previewRunning, event.sender, controller)
    }
  }

  ipc.handle(channels.preview, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    const overlays = parseOverlays(req.overlays)
    const faceIndices = parseFaceIndices(req.faceIndices)
    return withJob(event, async (signal) => {
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return previewArranged({
        ...common,
        jobPdf,
        options: options.options,
        ...(overlays ? { overlays } : {}),
        longSidePx: typeof req.longSidePx === 'number' ? req.longSidePx : undefined,
        ...(faceIndices ? { faceIndices } : {}),
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(
    channels.previewFaces,
    async (event: PrintLayoutInvokeEvent, raw: unknown): Promise<PrintLayoutPreviewFacesResult> => {
      const req = parseRequest(raw)
      const options = checked(req.options)
      if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
      const overlays = parseOverlays(req.overlays)
      const faceIndices = parseFaceIndices(req.faceIndices) ?? [0]
      const editorKey = typeof req.editorKey === 'string' ? req.editorKey : null
      const optionsKey =
        typeof req.optionsKey === 'string'
          ? req.optionsKey
          : JSON.stringify(options.options) + (overlays ? `:${overlays.stamps.length}` : '')
      const longSidePx = typeof req.longSidePx === 'number' ? req.longSidePx : 0

      return withPreviewJob(event, async (signal) => {
        ensureSessionCleanup(event.sender)
        const session = sessions.get(event.sender.id)!
        if (!session.jobPdf || editorKey === null || session.editorKey !== editorKey) {
          const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
          signal.throwIfAborted()
          session.editorKey = editorKey
          session.jobPdf = jobPdf
          session.optionsKey = null
          session.arrangedPdf = null
          session.faceSizes = null
        }

        const runner = handlers.runner ?? defaultPrintLayoutRunner()
        const wasmPath = pdfiumWasmPath()
        if (!session.arrangedPdf || !session.faceSizes || session.optionsKey !== optionsKey) {
          const arranged = await runner.run(
            {
              kind: 'arrange',
              jobPdf: session.jobPdf,
              options: options.options,
              ...(overlays ? { overlays } : {}),
              wasmPath,
            },
            { signal },
          )
          if (arranged.kind !== 'arrange') {
            throw new Error('the print job answered the wrong request')
          }
          signal.throwIfAborted()
          session.optionsKey = optionsKey
          session.arrangedPdf = arranged.pdf
          session.faceSizes = arranged.faceSizes
        }

        const rendered = await runner.run(
          {
            kind: 'preview-arranged',
            arrangedPdf: session.arrangedPdf,
            dpi: options.options.dpi,
            grayscale: options.options.grayscale,
            longSidePx,
            faceIndices,
            wasmPath,
          },
          { signal },
        )
        if (rendered.kind !== 'preview-arranged') {
          throw new Error('the print job answered the wrong request')
        }
        signal.throwIfAborted()
        return {
          ok: true,
          totalFaces: rendered.totalFaces,
          faceSizes: session.faceSizes,
          faces: rendered.faces.map((f, i) => ({
            index: f.index ?? faceIndices[i] ?? i,
            png: f.png,
            widthPt: f.widthPt,
            heightPt: f.heightPt,
          })),
        }
      })
    },
  )

  ipc.handle(channels.closePreview, (event: PrintLayoutInvokeEvent) => {
    dropSession(event.sender.id)
    return { ok: true }
  })

  ipc.handle(channels.print, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    const overlays = parseOverlays(req.overlays)
    return withJob(event, async (signal) => {
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return printArranged({
        ...common,
        jobPdf,
        options: options.options,
        ...(overlays ? { overlays } : {}),
        job: req.job,
        createWindow: () => handlers.createPrintWindow(event),
        platform: handlers.platform,
        sendCups: handlers.sendCups,
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(channels.save, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    const overlays = parseOverlays(req.overlays)
    return withJob(event, async (signal) => {
      if (handlers.canSave && !(await handlers.canSave(event, req.editor as E | undefined))) {
        return { ok: false as const, error: 'saving this document is restricted' }
      }
      const path = await handlers.pickSavePath(event, req.editor as E | undefined)
      if (!path) return { ok: true as const, canceled: true as const }
      signal.throwIfAborted()
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return saveArrangedPdf({
        ...common,
        jobPdf,
        options: options.options,
        ...(overlays ? { overlays } : {}),
        path,
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(channels.saveImages, async (event: PrintLayoutInvokeEvent, raw: unknown) => {
    const req = parseRequest(raw)
    const options = checked(req.options)
    if (!options.ok) return { ok: false, error: options.error.message, code: options.error.code }
    const image = validateImageExportOptions(req.image)
    if (!image.ok) return { ok: false, error: image.error.message, code: image.error.code }
    const overlays = parseOverlays(req.overlays)
    return withJob(event, async (signal) => {
      if (handlers.canSave && !(await handlers.canSave(event, req.editor as E | undefined))) {
        return { ok: false as const, error: 'saving this document is restricted' }
      }
      const pick = handlers.pickImageSavePath
      if (!pick) {
        return { ok: false as const, error: 'image export is not configured for this editor' }
      }
      const path = await pick(event, req.editor as E | undefined, image.options)
      if (!path) return { ok: true as const, canceled: true as const }
      signal.throwIfAborted()
      const jobPdf = await handlers.buildJobPdf(event, req.editor as E | undefined)
      signal.throwIfAborted()
      return saveArrangedImages({
        ...common,
        jobPdf,
        options: options.options,
        ...(overlays ? { overlays } : {}),
        image: image.options,
        path,
        signal,
        onProgress: progressTo(event.sender),
      })
    })
  })

  ipc.handle(channels.cancel, (event: PrintLayoutInvokeEvent) => {
    running.get(event.sender.id)?.abort()
    previewRunning.get(event.sender.id)?.abort()
    return { ok: true }
  })

  const unregister = () => {
    for (const c of [
      channels.preview,
      channels.previewFaces,
      channels.closePreview,
      channels.print,
      channels.save,
      channels.saveImages,
      channels.cancel,
    ]) {
      ipc.removeHandler?.(c)
    }
    for (const controller of running.values()) controller.abort()
    for (const controller of previewRunning.values()) controller.abort()
    running.clear()
    previewRunning.clear()
    sessions.clear()
    byPrefix.delete(prefix)
  }
  byPrefix.set(prefix, unregister)
  return unregister
}

// ── App-wide: the typed-in label grid ──────────────────────────────────────

/** File name of the label grid store in the app's user data folder. */
export const LABEL_SPEC_FILE_NAME = 'print-label-spec.json'

const LABEL_SPEC_VERSION = 1

export interface LabelSpecStore {
  /** the stored grid, or null when there is none or it no longer checks out */
  get(): LabelSpec | null
  /** checks and stores a grid; an invalid one is refused and nothing is written */
  set(input: unknown): LabelSpecSetResult
}

/** The last typed-in label grid, one JSON file (not the AI settings file). */
export function createLabelSpecStore(filePath: string | (() => string)): LabelSpecStore {
  const path = () => (typeof filePath === 'function' ? filePath() : filePath)
  return {
    get() {
      try {
        const raw = JSON.parse(readFileSync(path(), 'utf8')) as { spec?: unknown }
        const checked = validateLabelSpec(raw?.spec)
        return checked.ok ? checked.spec : null
      } catch {
        return null
      }
    },
    set(input) {
      const checked = validateLabelSpec(input)
      if (!checked.ok) {
        return { ok: false, error: checked.error.message, code: checked.error.code }
      }
      try {
        writeJsonAtomic(path(), { version: LABEL_SPEC_VERSION, spec: checked.spec })
        return { ok: true, spec: checked.spec }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

/** File name of the app-wide quick-print click preference in userData. */
export const QUICK_PRINT_PREF_FILE_NAME = 'print-quick-pref.json'

const QUICK_PRINT_PREF_VERSION = 1

export interface QuickPrintPrefStore {
  get(): boolean
  set(enabled: boolean): boolean
}

/** App-wide preference: whether clicking the top-bar print icon runs Quick Print directly. */
export function createQuickPrintPrefStore(filePath: string | (() => string)): QuickPrintPrefStore {
  const path = () => (typeof filePath === 'function' ? filePath() : filePath)
  return {
    get() {
      try {
        const raw = JSON.parse(readFileSync(path(), 'utf8')) as { clickToQuickPrint?: unknown }
        return raw?.clickToQuickPrint === true
      } catch {
        return false
      }
    },
    set(enabled: boolean) {
      const value = enabled === true
      try {
        writeJsonAtomic(path(), { version: QUICK_PRINT_PREF_VERSION, clickToQuickPrint: value })
      } catch {
        // Ignore write failures; the returned boolean still reflects the requested state.
      }
      return value
    },
  }
}

function broadcastQuickPrintPref(enabled: boolean): void {
  // Load Electron lazily so unit tests running in plain Node never require Electron.
  void import('electron')
    .then((electron) => {
      const all = electron?.webContents?.getAllWebContents?.()
      if (!Array.isArray(all)) return
      for (const wc of all) {
        if (!wc.isDestroyed()) {
          wc.send(PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefChanged, enabled)
        }
      }
    })
    .catch(() => {
      // Non-Electron runtime (tests).
    })
}

export interface PrintLayoutSharedSetup {
  ipcMain: PrintLayoutIpcMain
  /** full path of the store, e.g. join(app.getPath('userData'), LABEL_SPEC_FILE_NAME) */
  labelSpecPath: string | (() => string)
}

// Kept on globalThis, like the other process-wide state here: every editor bundle
// carries its own copy of this module, and the channels may be registered only once.
const SHARED_STORE = Symbol.for('genoffice.print-layout.shared-store')
type SharedStoreHost = { [SHARED_STORE]?: LabelSpecStore }

/**
 * Registers the app-wide `print-layout:` channels once per process, whoever
 * asks first. Several editors' main modules run in one process in the packaged
 * app and registering a channel twice throws, so every editor calls this.
 */
export function ensurePrintLayoutIpc(setup: PrintLayoutSharedSetup): LabelSpecStore {
  const host = globalThis as SharedStoreHost
  const existing = host[SHARED_STORE]
  if (existing) return existing
  const store = createLabelSpecStore(setup.labelSpecPath)
  const quickPrefPath = () => {
    const labelPath =
      typeof setup.labelSpecPath === 'function' ? setup.labelSpecPath() : setup.labelSpecPath
    return join(dirname(labelPath), QUICK_PRINT_PREF_FILE_NAME)
  }
  const quickPref = createQuickPrintPrefStore(quickPrefPath)
  setup.ipcMain.handle(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecGet, () => store.get())
  setup.ipcMain.handle(PRINT_LAYOUT_SHARED_CHANNELS.labelSpecSet, (_event, spec: unknown) =>
    store.set(spec),
  )
  setup.ipcMain.handle(
    PRINT_LAYOUT_SHARED_CHANNELS.listPrinters,
    async (event: PrintLayoutInvokeEvent) => {
      const printers = (await event?.sender?.getPrintersAsync?.()) ?? []
      return printers.map((p) => {
        const isDefault = Boolean((p as { isDefault?: unknown }).isDefault)
        return {
          name: p.name,
          displayName: p.displayName || p.name,
          ...(isDefault ? { isDefault: true } : {}),
        }
      })
    },
  )
  setup.ipcMain.handle(PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefGet, () => quickPref.get())
  setup.ipcMain.handle(
    PRINT_LAYOUT_SHARED_CHANNELS.quickPrintPrefSet,
    (_event, enabled: unknown) => {
      const next = quickPref.set(enabled === true)
      broadcastQuickPrintPref(next)
      return next
    },
  )
  host[SHARED_STORE] = store
  return store
}
