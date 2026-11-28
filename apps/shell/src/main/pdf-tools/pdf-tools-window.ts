/**
 * The PDF tools window (decision 0030 & PDF tools v2): a resizable BrowserWindow
 * above the shell window, opened from Home's "PDF tools" card or the PDF
 * editor's ribbon. Every tool runs locally without AI and never overwrites its
 * source.
 *
 * Security boundary (paths stay in main):
 * - Renderer-originated file paths come ONLY from two channels:
 *   1. Main-process open dialog (`showOpenDialogWithMemory`)
 *   2. Preload-only `webUtils.getPathForFile(file)` on real OS drop events (`dropInputs`)
 * - Main-internal trusted sources: editor ribbon handoff (`openPdfToolsWithFile`),
 *   result promotion (`promoteResult`), input promotion (`promoteInput`), and
 *   background mixed-merge temp PDFs (`mix-queue.ts`).
 * - Every input passes `inputsFrom()` validation and returns opaque IDs only.
 * - Passwords live in memory only, are never logged, and are cleared on close.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { productName, type Lang } from '@genoffice/i18n'
import {
  HEADLESS_PDF_EXTENSIONS,
  headlessModuleFor,
  safeExternalUrl,
  saveAsSuggestion,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
} from '@genoffice/electron-utils'
import { fileHasUnsavedChanges } from '@genoffice/electron-utils/unsaved-files'
import { writePdfAtomically } from '../../../../pdf/src/main/atomic-write'
import { auditPdfSpace, compressPdfV2Bytes } from '../../../../pdf/src/main/compress'
import { uniqueGeneratedPdfPath } from '../../../../pdf/src/main/generated-output'
import { imagesToPdfBytes } from '../../../../pdf/src/main/images-to-pdf'
import { mergePdfV2Bytes } from '../../../../pdf/src/main/merge-v2'
import { hasOcrEngineHelper } from '../../../../pdf/src/main/ocr-pdf'
import { readPdfText } from '../../../../pdf/src/main/read-text'
import { uniqueSplitSubfolder } from '../../../../pdf/src/main/split-pdf'
import { parsePageRange } from '../../../../pdf/src/renderer/convert/page-range'
import { splitSubfolderName } from '../../../../pdf/src/shared/split-plan'
import {
  PDF_TOOLS_CHANNELS,
  type PdfBlankPagesResult,
  type PdfBookmarksResult,
  type PdfConvertFormat,
  type PdfOrganizePageSpec,
  type PdfPickResult,
  type PdfPickedFileKind,
  type PdfProgressEvent,
  type PdfRenderThumbsResult,
  type PdfToolAccept,
  type PdfToolError,
  type PdfToolInput,
  type PdfToolInputKind,
  type PdfToolOptions,
  type PdfToolRunResult,
  type PdfToolsStart,
  type PdfToolsTheme,
} from '../../shared/pdf-tools-api'
import { PDF_TOOLS_HOME_CHANNELS } from '../../shared/pdf-tools-home-channels'
import type {
  ImagesJobValue,
  OcrPdfJobValue,
  RenderPagesJobValue,
  RenderThumbsJobValue,
  StructureJob,
} from '../pdf-structure/protocol'
import { pdfToolsText } from '../../renderer/src/i18n/strings-pdf-tools'
import { runBatchItems, type BatchItemStepResult } from './batch-orchestrator'
import { killAllHeadlessChildren, runHeadlessPdfExport } from './headless-runner'
import {
  encodeBgraPage,
  imageThumbDataUrl,
  normalizeImageForPdf,
  recodeWithChromium,
} from './image-recode'
import { createMixQueue, sweepOrphanMixFiles, type MixQueue } from './mix-queue'
import { exportPdfPagesToImages } from './pdf-to-images'
import {
  MAX_TOOL_INPUT_BYTES,
  PdfToolRefusal,
  acceptsFileKind,
  checkOptions,
  encryptedPageCount,
  foundBlankPagesOf,
  inspectDocument,
  inspectImage,
  inspectPdf,
  isBatchTool,
  isChainTarget,
  isPdfToolId,
  jobBytesOf,
  jobFor,
  outputNames,
  readBookmarksBytes,
  runPdfTool,
  runSplitPdfTool,
  toolAccepts,
  toolInputKind,
  toolMinInputs,
  toolOutputExtension,
  toolRunsAsJob,
  toolTakesMany,
  type InspectResult,
} from './tools'

export interface PdfToolsWindowDeps {
  /** the window the tools window sits above */
  parentWindow(): BrowserWindow | null
  lang(): Lang
  theme(): PdfToolsTheme
  /**
   * Open a file this window just wrote. An open PDF tab on that path is
   * reloaded from disk; run() never writes over a file open with unsaved
   * changes, so nothing is lost.
   */
  openResult(path: string): boolean
  /** Open a PDF the user picked for an editor-only tool; an open tab is only focused */
  openForEditing(path: string): boolean
  /** Open a PDF in an editor tab and immediately launch its visual Split dialog */
  openSplitInEditor?(path: string): boolean
  /**
   * A result's "open" while the editor it opens in is off (editor choice spec
   * 7.3): asks, then opens through `open`, shows the file in its folder, or
   * does nothing. Without it the result opens at once.
   */
  askBeforeOpenResult?(path: string, open: (path: string) => boolean): Promise<boolean>
  /**
   * Before an entrance that needs the PDF editor or this window itself while
   * that is off: [Turn on and open] [Cancel]; true = go ahead.
   */
  askEditorOn?(item: 'pdf' | 'pdfTools'): Promise<boolean>
  /**
   * Run a page-rendering job in a process of its own, ended when it answers,
   * is cancelled, or `owner` goes away (pdf-structure-ipc.ts runWindowJob)
   */
  runJob(
    owner: WebContents,
    jobId: string,
    job: StructureJob,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>
  cancelJob(owner: number, jobId: string): boolean
}

interface PickedInput extends PdfToolInput {
  path: string
}

interface UnlockedSecret {
  password: string
  decryptedBytes: Uint8Array
}

interface PendingPartialCompress {
  bytes: Uint8Array
  sourcePath: string
  sourceName: string
  notice?: 'unlocked-unencrypted'
}

let deps: PdfToolsWindowDeps | null = null
let win: BrowserWindow | null = null
let ipcRegistered = false
let running = false
/** this window's inputs and outputs by id; cleared when it closes */
const inputs = new Map<string, PickedInput>()
const results = new Map<string, string>()
/** memory-only unlocked passwords & decrypted bytes; cleared on window close */
const unlockedSecrets = new Map<string, UnlockedSecret>()
/** pending target-missed compress outputs awaiting user confirmation */
const pendingPartials = new Map<string, PendingPartialCompress>()
/** pages the blank-page search found, by input id: the only pages blankPages removes */
const blankFound = new Map<string, Set<number>>()
/** active job ids for cancellation */
let finding: string | null = null
let thumbJob: string | null = null
let runStop: AbortController | null = null
let runningJob: string | null = null
/** a task the PDF editor's ribbon asked for, until the window takes it */
let pendingStart: PdfToolsStart | null = null
/** background converter queue for mixed-merge non-PDF files */
let mixQueue: MixQueue | null = null

const PDF_FILTER = { name: 'PDF', extensions: ['pdf'] }
const IMAGE_FILTER = {
  name: 'JPG, PNG, WebP, BMP, GIF',
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'],
}
const DOCUMENT_FILTER = {
  name: 'Documents',
  extensions: [...HEADLESS_PDF_EXTENSIONS],
}
const MIXED_FILTER = {
  name: 'PDF, Images, Documents',
  extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', ...HEADLESS_PDF_EXTENSIONS],
}
const OUTPUT_FILTERS: Record<
  'pdf' | 'txt' | 'zip' | PdfConvertFormat,
  { name: string; extensions: string[] }
> = {
  pdf: PDF_FILTER,
  txt: { name: 'TXT', extensions: ['txt'] },
  zip: { name: 'ZIP', extensions: ['zip'] },
  docx: { name: 'Word (DOCX)', extensions: ['docx'] },
  xlsx: { name: 'Excel (XLSX)', extensions: ['xlsx'] },
  pptx: { name: 'PowerPoint (PPTX)', extensions: ['pptx'] },
  hwpx: { name: 'HWPX', extensions: ['hwpx'] },
  md: { name: 'Markdown (MD)', extensions: ['md'] },
  epub: { name: 'EPUB', extensions: ['epub'] },
}

export function configurePdfToolsWindow(next: PdfToolsWindowDeps): void {
  deps = next
  registerIpc()
}

/** Called on app quit to ensure no headless child processes or temp files linger. */
export function cleanupPdfToolsOnQuit(): void {
  runStop?.abort()
  killAllHeadlessChildren()
  if (mixQueue) {
    void mixQueue.clearAll()
    mixQueue = null
  }
  unlockedSecrets.clear()
  pendingPartials.clear()
}

function fromWindow(event: IpcMainInvokeEvent): boolean {
  return !!win && !win.isDestroyed() && event.sender === win.webContents
}

/** two paths name the same file (Windows paths ignore case) */
function samePath(a: string, b: string): boolean {
  const x = resolve(a)
  const y = resolve(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

function uniqueSubdir(dir: string, stem: string, taken: Set<string>): string {
  const clean = stem.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? clean : `${clean} (${n})`
    const full = join(dir, candidate)
    const key = process.platform === 'win32' ? full.toLowerCase() : full
    if (!taken.has(key) && !existsSync(full)) {
      taken.add(key)
      return full
    }
  }
}

function sendProgress(contents: WebContents, ev: PdfProgressEvent): void {
  if (!contents.isDestroyed()) contents.send(PDF_TOOLS_CHANNELS.progress, ev)
}

function ensureMixQueue(): MixQueue {
  if (mixQueue) return mixQueue
  mixQueue = createMixQueue({
    convertDocument: async (inputPath, outPath, signal) => {
      const res = await runHeadlessPdfExport(inputPath, outPath, { signal })
      return res.ok ? { ok: true } : { ok: false, error: res.error }
    },
    convertImage: async (inputPath, signal) => {
      if (signal.aborted) throw new Error('cancelled')
      const raw = await readFile(inputPath)
      const normalized = normalizeImageForPdf(
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      )
      if (!normalized) throw new Error('image could not be decoded')
      return imagesToPdfBytes([normalized], { paper: { w: 595, h: 842 }, marginPt: 18 })
    },
    inspectPdfPages: async (pdfPath) => {
      const buf = await readFile(pdfPath)
      const info = await inspectPdf(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
      return info.ok ? info.pages : 0
    },
    renderFirstThumb: async (pdfPath) => {
      const owner = win
      if (!owner || owner.isDestroyed() || !deps) return null
      const outcome = await deps.runJob(
        owner.webContents,
        `mix-thumb-${randomUUID()}`,
        { op: 'renderThumbs', source: { pdfPath }, startPage: 1, endPage: 1, longSide: 120 },
        () => {},
      )
      if (!outcome.ok) return null
      const val = outcome.value as RenderThumbsJobValue | null
      const first = val?.thumbs?.[0]
      return first ? thumbUrl(first) : null
    },
    onStatus: (ev) => {
      const target = inputs.get(ev.inputId)
      if (target) {
        target.mixState = ev.state
        if (ev.pages !== undefined) target.pages = ev.pages
        if (ev.thumb !== undefined) target.thumb = ev.thumb
        if (ev.error !== undefined) target.mixError = ev.error
      }
      if (win && !win.isDestroyed()) {
        win.webContents.send(PDF_TOOLS_CHANNELS.mixStatus, ev)
      }
    },
  })
  return mixQueue
}

function canDecodeWithChromium(bytes: Uint8Array): boolean {
  try {
    const img = nativeImage.createFromBuffer(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    )
    if (img.isEmpty()) return false
    const size = img.getSize()
    return size.width > 0 && size.height > 0
  } catch {
    return false
  }
}

function filterForKind(kind: PdfToolInputKind) {
  if (kind === 'image') return IMAGE_FILTER
  if (kind === 'document') return DOCUMENT_FILTER
  if (kind === 'mixed') return MIXED_FILTER
  return PDF_FILTER
}

async function pickInputs(
  multi: boolean,
  kind: PdfToolInputKind,
  accept: PdfToolAccept,
): Promise<PdfPickResult> {
  const owner = win
  const empty: PdfPickResult = { inputs: [], rejected: [] }
  if (!owner) return empty
  const picked = await showOpenDialogWithMemory(dialog, owner, {
    filters: [filterForKind(kind)],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
  })
  if (picked.canceled) return empty
  return inputsFrom(picked.filePaths, kind, accept)
}

/**
 * How many pages a picked PDF has for `accept`, or why the tool cannot take it.
 * For `accept === 'pdf'`, encrypted PDFs are accepted in locked state (`encrypted: true`)
 * so the user can unlock them inline inside the tool panel (spec 4.1 C).
 */
async function inspectPdfForAccept(
  bytes: Uint8Array,
  accept: PdfToolAccept,
): Promise<InspectResult & { encrypted?: boolean }> {
  const info = await inspectPdf(bytes)
  if (info.ok) return accept === 'encrypted' ? { ok: false, problem: 'not-encrypted' } : info
  if (info.problem === 'encrypted') {
    if (accept === 'encrypted') {
      return { ok: true, pages: await encryptedPageCount(bytes) }
    }
    if (accept === 'pdf') {
      return { ok: true, pages: await encryptedPageCount(bytes), encrypted: true }
    }
  }
  if (info.problem === 'unreadable' && accept === 'damaged') return { ok: true, pages: 0 }
  return info
}

/** Quick non-throwing check whether an unencrypted PDF has extractable text (for scanned banner). */
async function detectHasTextLayer(bytes: Uint8Array): Promise<boolean | undefined> {
  if (bytes.byteLength > 64 * 1024 * 1024) return undefined
  try {
    const doc = await readPdfText(bytes)
    return doc.pages.some((p) => p.text.trim().length > 0)
  } catch {
    return undefined
  }
}

function isPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024)
  const head = Buffer.from(bytes.subarray(0, limit)).toString('latin1')
  return head.includes('%PDF-')
}

/** Files from a trusted source (dialog, preload drop, ribbon handoff, promotion), validated and handed out as opaque IDs. */
async function inputsFrom(
  paths: string[],
  kind: PdfToolInputKind,
  accept: PdfToolAccept = 'pdf',
): Promise<PdfPickResult> {
  const out: PdfPickResult = { inputs: [], rejected: [] }
  for (const path of paths) {
    if (typeof path !== 'string' || path.trim() === '') continue
    const name = basename(path)
    try {
      const st = await stat(path)
      if (!st.isFile()) {
        out.rejected.push({ name, problem: 'unreadable' })
        continue
      }
      const size = st.size
      if (size > MAX_TOOL_INPUT_BYTES) {
        out.rejected.push({ name, problem: 'too-large' })
        continue
      }

      if (kind === 'document') {
        const docInfo = inspectDocument(path, size)
        if (!docInfo.ok) {
          out.rejected.push({ name, problem: docInfo.problem })
          continue
        }
        const unsaved = await fileHasUnsavedChanges(path)
        const input: PickedInput = {
          id: randomUUID(),
          kind: 'document',
          name,
          pages: 0,
          size,
          path,
          ...(unsaved ? { unsavedWarning: true } : {}),
        }
        inputs.set(input.id, input)
        out.inputs.push(toPublicInput(input))
        continue
      }

      const buf = await readFile(path)
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)

      if (kind === 'image') {
        const imgInfo = inspectImage(bytes, canDecodeWithChromium)
        if (!imgInfo.ok) {
          out.rejected.push({ name, problem: imgInfo.problem })
          continue
        }
        const thumb = imageThumbDataUrl(bytes, 120)
        const input: PickedInput = {
          id: randomUUID(),
          kind: 'image',
          name,
          pages: 1,
          size,
          path,
          thumb,
        }
        inputs.set(input.id, input)
        out.inputs.push(toPublicInput(input))
        continue
      }

      if (kind === 'mixed') {
        // Detect PDF -> image -> supported document
        let detectedKind: PdfPickedFileKind | null = null
        let pages = 0
        let encrypted = false
        let thumb: string | null | undefined
        if (isPdfMagic(bytes) || path.toLowerCase().endsWith('.pdf')) {
          const pdfInfo = await inspectPdfForAccept(bytes, 'pdf')
          if (pdfInfo.ok) {
            detectedKind = 'pdf'
            pages = pdfInfo.pages
            encrypted = pdfInfo.encrypted === true
          } else {
            out.rejected.push({ name, problem: pdfInfo.problem })
            continue
          }
        }
        if (!detectedKind) {
          const imgInfo = inspectImage(bytes, canDecodeWithChromium)
          if (imgInfo.ok) {
            detectedKind = 'image'
            pages = 1
            thumb = imageThumbDataUrl(bytes, 120)
          }
        }
        if (!detectedKind && headlessModuleFor(path)) {
          detectedKind = 'document'
          pages = 0
        }
        if (!detectedKind) {
          out.rejected.push({ name, problem: 'unsupported-document' })
          continue
        }
        const unsaved = await fileHasUnsavedChanges(path)
        const input: PickedInput = {
          id: randomUUID(),
          kind: detectedKind,
          name,
          pages,
          size,
          path,
          ...(encrypted ? { encrypted: true, unlocked: false } : {}),
          ...(unsaved ? { unsavedWarning: true } : {}),
          ...(thumb !== undefined ? { thumb } : {}),
          ...(detectedKind !== 'pdf' ? { mixState: 'pending' as const } : {}),
        }
        inputs.set(input.id, input)
        if (detectedKind !== 'pdf') {
          ensureMixQueue().enqueue(input.id, detectedKind, path)
        }
        out.inputs.push(toPublicInput(input))
        continue
      }

      // kind === 'pdf'
      const pdfInfo = await inspectPdfForAccept(bytes, accept)
      if (!pdfInfo.ok) {
        out.rejected.push({ name, problem: pdfInfo.problem })
        continue
      }
      const unsaved = await fileHasUnsavedChanges(path)
      const hasTextLayer =
        accept === 'pdf' && !pdfInfo.encrypted ? await detectHasTextLayer(bytes) : undefined
      const input: PickedInput = {
        id: randomUUID(),
        kind: 'pdf',
        name,
        pages: pdfInfo.pages,
        size,
        path,
        ...(pdfInfo.encrypted ? { encrypted: true, unlocked: false } : {}),
        ...(unsaved ? { unsavedWarning: true } : {}),
        ...(hasTextLayer !== undefined ? { hasTextLayer } : {}),
      }
      inputs.set(input.id, input)
      out.inputs.push(toPublicInput(input))
    } catch {
      out.rejected.push({ name, problem: 'unreadable' })
    }
  }
  return out
}

function toPublicInput(input: PickedInput): PdfToolInput {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    pages: input.pages,
    size: input.size,
    ...(input.encrypted !== undefined ? { encrypted: input.encrypted } : {}),
    ...(input.unlocked !== undefined ? { unlocked: input.unlocked } : {}),
    ...(input.unsavedWarning !== undefined ? { unsavedWarning: input.unsavedWarning } : {}),
    ...(input.hasTextLayer !== undefined ? { hasTextLayer: input.hasTextLayer } : {}),
    ...(input.mixState !== undefined ? { mixState: input.mixState } : {}),
    ...(input.mixError !== undefined ? { mixError: input.mixError } : {}),
    ...(input.thumb !== undefined ? { thumb: input.thumb } : {}),
  }
}

/** Read PDF bytes for an input, transparently returning in-memory decrypted bytes when unlocked. */
async function readPdfInputBytes(source: PickedInput): Promise<Uint8Array> {
  const secret = unlockedSecrets.get(source.id)
  if (secret) return secret.decryptedBytes
  const buf = await readFile(source.path)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

async function unlockInput(
  inputId: unknown,
  password: unknown,
): Promise<
  { ok: true; pages: number } | { ok: false; error: 'wrong-password' | 'missing' | 'failed' }
> {
  const owner = win
  if (!owner || !deps) return { ok: false, error: 'failed' }
  if (typeof inputId !== 'string' || typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'wrong-password' }
  }
  const input = inputs.get(inputId)
  if (!input || input.kind !== 'pdf') return { ok: false, error: 'missing' }
  if (!existsSync(input.path)) return { ok: false, error: 'missing' }
  const outcome = await deps.runJob(
    owner.webContents,
    `unlock-${randomUUID()}`,
    { op: 'decrypt', source: { pdfPath: input.path }, password },
    () => {},
  )
  if (!outcome.ok) {
    return {
      ok: false,
      error: outcome.error === 'password-required' ? 'wrong-password' : 'failed',
    }
  }
  const decryptedBytes = jobBytesOf(outcome.value)
  if (!decryptedBytes) return { ok: false, error: 'failed' }
  const info = await inspectPdf(decryptedBytes)
  if (!info.ok) return { ok: false, error: 'failed' }
  unlockedSecrets.set(input.id, { password, decryptedBytes })
  input.unlocked = true
  input.pages = info.pages
  input.hasTextLayer = await detectHasTextLayer(decryptedBytes)
  return { ok: true, pages: info.pages }
}

async function promotePathToTool(
  path: string | undefined,
  nextTool: unknown,
): Promise<{ ok: true; start: PdfToolsStart } | { ok: false; error: PdfToolError }> {
  if (!path || !existsSync(path)) return { ok: false, error: 'missing' }
  if (!isPdfToolId(nextTool) || !isChainTarget(nextTool)) return { ok: false, error: 'failed' }
  const picked = await inputsFrom([path], toolInputKind(nextTool), toolAccepts(nextTool))
  if (picked.inputs.length === 0) return { ok: false, error: 'failed' }
  return {
    ok: true,
    start: { tool: nextTool, inputs: picked.inputs, rejected: picked.rejected },
  }
}

async function auditSpaceHandler(
  inputId: unknown,
): Promise<
  | { ok: true; audit: ReturnType<typeof auditPdfSpace> extends Promise<infer T> ? T : never }
  | { ok: false; error: PdfToolError }
> {
  if (typeof inputId !== 'string') return { ok: false, error: 'no-input' }
  const input = inputs.get(inputId)
  if (!input || input.kind !== 'pdf') return { ok: false, error: 'no-input' }
  if (!existsSync(input.path)) return { ok: false, error: 'missing' }
  if (input.encrypted && !input.unlocked) return { ok: false, error: 'wrong-password' }
  try {
    const bytes = await readPdfInputBytes(input)
    const audit = await auditPdfSpace(bytes)
    return { ok: true, audit }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

async function renderThumbsHandler(
  inputId: unknown,
  startPage: unknown,
  endPage: unknown,
): Promise<PdfRenderThumbsResult> {
  const owner = win
  if (!owner || !deps) return { ok: false, error: 'failed' }
  if (typeof inputId !== 'string') return { ok: false, error: 'no-input' }
  const input = inputs.get(inputId)
  if (!input || input.kind !== 'pdf') return { ok: false, error: 'no-input' }
  if (!existsSync(input.path)) return { ok: false, error: 'missing' }
  if (input.encrypted && !input.unlocked) return { ok: false, error: 'wrong-password' }
  const start = typeof startPage === 'number' && Number.isInteger(startPage) ? startPage : 1
  const end = typeof endPage === 'number' && Number.isInteger(endPage) ? endPage : start
  const jobId = randomUUID()
  thumbJob = jobId
  try {
    const password = unlockedSecrets.get(input.id)?.password
    const outcome = await deps.runJob(
      owner.webContents,
      jobId,
      {
        op: 'renderThumbs',
        source: { pdfPath: input.path, ...(password !== undefined ? { password } : {}) },
        startPage: start,
        endPage: end,
        longSide: 200,
      },
      () => {},
    )
    if (!outcome.ok) {
      return outcome.error === 'cancelled'
        ? { ok: false, canceled: true }
        : { ok: false, error: 'failed' }
    }
    const val = outcome.value as RenderThumbsJobValue | null
    if (!val || !Array.isArray(val.thumbs)) return { ok: false, error: 'failed' }
    return {
      ok: true,
      pageCount: val.pageCount,
      thumbs: val.thumbs.map((t) => ({
        page: t.page,
        widthPt: t.widthPt,
        heightPt: t.heightPt,
        thumb: thumbUrl(t),
      })),
    }
  } catch {
    return { ok: false, error: 'failed' }
  } finally {
    if (thumbJob === jobId) thumbJob = null
  }
}

async function confirmSavePartial(pendingId: unknown, save: unknown): Promise<PdfToolRunResult> {
  const owner = win
  if (!owner || typeof pendingId !== 'string') return { ok: false, error: 'failed' }
  const pending = pendingPartials.get(pendingId)
  pendingPartials.delete(pendingId)
  if (!pending) return { ok: false, error: 'missing' }
  if (save !== true) return { ok: false, canceled: true }
  const names = outputNames('compress', pending.sourceName, 1, {})
  const targets = await pickTargets(owner, pending.sourcePath, names, 'pdf')
  if (!targets) return { ok: false, canceled: true }
  const target = targets[0]!
  if (samePath(pending.sourcePath, target)) return { ok: false, error: 'same-as-source' }
  if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }
  await writePdfAtomically(target, pending.bytes)
  const id = randomUUID()
  results.set(id, target)
  return {
    ok: true,
    outputs: [{ id, name: basename(target), size: pending.bytes.length }],
    ...(pending.notice ? { notice: pending.notice } : {}),
  }
}

function parseOrganizePlan(raw: unknown): PdfOrganizePageSpec[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: PdfOrganizePageSpec[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const r = item as Record<string, unknown>
    if (typeof r.sourceId !== 'string' || r.sourceId.length === 0) return null
    if (
      typeof r.sourcePageIndex !== 'number' ||
      !Number.isInteger(r.sourcePageIndex) ||
      r.sourcePageIndex < 0
    ) {
      return null
    }
    const rot =
      r.extraRotation === 90 || r.extraRotation === 180 || r.extraRotation === 270
        ? r.extraRotation
        : 0
    out.push({
      sourceId: r.sourceId,
      sourcePageIndex: r.sourcePageIndex,
      extraRotation: rot,
      ...(typeof r.widthPt === 'number' && r.widthPt > 0 ? { widthPt: r.widthPt } : {}),
      ...(typeof r.heightPt === 'number' && r.heightPt > 0 ? { heightPt: r.heightPt } : {}),
    })
  }
  return out
}

/** Run compress v2 on one PDF, optionally running qpdf optimize pass (linearize / lossless). */
async function compressOnePdf(
  owner: BrowserWindow,
  bytes: Uint8Array,
  options: PdfToolOptions,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<
  | { ok: true; bytes: Uint8Array; targetMissed: boolean; targetBytes?: number }
  | { ok: false; canceled: true }
  | { ok: false; error: PdfToolError }
> {
  const mode = options.compressMode ?? options.compressLevel ?? 'medium'
  const targetBytes =
    mode === 'target' && options.targetSizeMb !== undefined
      ? Math.round(options.targetSizeMb * 1024 * 1024)
      : undefined

  let working: Uint8Array
  let targetMissed: boolean
  try {
    const made = await compressPdfV2Bytes(
      bytes,
      {
        mode,
        ...(targetBytes !== undefined ? { targetBytes } : {}),
        grayscaleImages: options.grayscaleImages === true,
        stripMetadata: options.stripMetadata === true,
      },
      recodeWithChromium,
      { onProgress, signal },
    )
    working = made.bytes
    targetMissed = !made.targetMet
  } catch {
    if (signal.aborted) return { ok: false, canceled: true }
    return { ok: false, error: 'failed' }
  }

  // Run qpdf optimizer for lossless mode or explicit linearization
  if ((mode === 'lossless' || options.linearize) && deps) {
    const tempDir = await mkdtemp(join(tmpdir(), 'ieum-pdf-opt-'))
    const tempPdf = join(tempDir, 'in.pdf')
    try {
      await writePdfAtomically(tempPdf, working)
      const jobId = randomUUID()
      runningJob = jobId
      const opt = await deps.runJob(
        owner.webContents,
        jobId,
        {
          op: 'optimize',
          source: { pdfPath: tempPdf },
          linearize: options.linearize === true,
          stripMetadata: false,
        },
        () => {},
      )
      runningJob = null
      if (opt.ok) {
        const optBytes = jobBytesOf(opt.value)
        if (optBytes && (options.linearize || optBytes.length < working.length)) {
          working = optBytes
        }
      } else if (opt.error === 'cancelled') {
        return { ok: false, canceled: true }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  if (targetBytes !== undefined) {
    targetMissed = working.length > targetBytes
  }
  if (working.length >= bytes.length && !options.linearize) {
    return { ok: false, error: 'not-smaller' }
  }
  return {
    ok: true,
    bytes: working,
    targetMissed,
    ...(targetBytes !== undefined ? { targetBytes } : {}),
  }
}

/** Run `pdfToImages` on one PDF (pages chunked via renderPages + nativeImage, or embedded images). */
async function runPdfToImagesOne(
  owner: BrowserWindow,
  source: PickedInput,
  options: PdfToolOptions,
  targetOutPath: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<
  | { ok: true; outputs: { id: string; name: string; size: number }[] }
  | { ok: false; canceled: true }
  | { ok: false; error: PdfToolError }
> {
  if (!deps) return { ok: false, error: 'failed' }
  const password = unlockedSecrets.get(source.id)?.password
  const pageNumbers = options.applyPages
    ? options.applyPages
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1)
    : Array.from({ length: Math.max(1, source.pages) }, (_, i) => i + 1)
  const baseName = source.name.replace(/\.pdf$/i, '') || 'document'

  if (options.pdfToImagesMode === 'embedded') {
    await mkdir(targetOutPath, { recursive: true })
    const jobId = randomUUID()
    runningJob = jobId
    const outcome = await deps.runJob(
      owner.webContents,
      jobId,
      {
        op: 'images',
        source: {
          pdfPath: source.path,
          ...(password !== undefined ? { password } : {}),
          ...(options.applyPages ? { pages: pageNumbers } : {}),
        },
        outDir: targetOutPath,
        baseName,
      },
      onProgress,
    )
    runningJob = null
    if (!outcome.ok) {
      return outcome.error === 'cancelled'
        ? { ok: false, canceled: true }
        : { ok: false, error: 'failed' }
    }
    const val = outcome.value as ImagesJobValue | null
    if (!val || !Array.isArray(val.images) || val.images.length === 0) {
      return { ok: false, error: 'no-embedded-images' }
    }
    const outputs: { id: string; name: string; size: number }[] = []
    for (const img of val.images) {
      const id = randomUUID()
      results.set(id, img.file)
      const st = await stat(img.file).catch(() => ({ size: 0 }))
      outputs.push({ id, name: basename(img.file), size: st.size })
    }
    return { ok: true, outputs }
  }

  try {
    const exported = await exportPdfPagesToImages({
      pageNumbers,
      dpi: options.imageDpi ?? 200,
      format: options.imageFormat ?? 'jpg',
      qualityPreset: options.imageQuality ?? 'medium',
      outMode: options.imageOutMode ?? 'zip',
      outPath: targetOutPath,
      baseName,
      signal,
      onProgress,
      encodePage: encodeBgraPage,
      renderChunk: async (chunkPages, dpi) => {
        const jobId = randomUUID()
        runningJob = jobId
        const res = await deps!.runJob(
          owner.webContents,
          jobId,
          {
            op: 'renderPages',
            source: { pdfPath: source.path, ...(password !== undefined ? { password } : {}) },
            pages: chunkPages,
            dpi,
          },
          () => {},
        )
        runningJob = null
        if (!res.ok) {
          const err = new Error(res.error)
          if (res.error === 'cancelled') err.name = 'AbortError'
          throw err
        }
        return res.value as RenderPagesJobValue
      },
    })
    const outputs: { id: string; name: string; size: number }[] = []
    for (const p of exported.writtenPaths) {
      const id = randomUUID()
      results.set(id, p)
      const st = await stat(p).catch(() => ({ size: 0 }))
      outputs.push({ id, name: basename(p), size: st.size })
    }
    return { ok: true, outputs }
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return { ok: false, canceled: true }
    }
    return { ok: false, error: 'failed' }
  }
}

/** Run `convertFromPdf` on one PDF into `outPath`. */
async function runConvertFromPdfOne(
  owner: BrowserWindow,
  source: PickedInput,
  options: PdfToolOptions,
  outPath: string,
  onProgress: (done: number, total: number) => void,
): Promise<
  | { ok: true; output: { id: string; name: string; size: number } }
  | { ok: false; canceled: true }
  | { ok: false; error: PdfToolError }
> {
  if (!deps) return { ok: false, error: 'failed' }
  const format = options.targetFormat ?? 'docx'
  const password = unlockedSecrets.get(source.id)?.password
  const pages = options.applyPages
    ? options.applyPages
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1)
    : undefined
  const jobSource = {
    pdfPath: source.path,
    ...(password !== undefined ? { password } : {}),
    ...(pages && pages.length > 0 ? { pages } : {}),
  }

  let job: StructureJob
  if (format === 'md') {
    job = { op: 'markdown', source: jobSource, outPath }
  } else if (format === 'epub') {
    const title = options.epubTitle?.trim() || source.name.replace(/\.pdf$/i, '') || 'Book'
    job = {
      op: 'epub',
      source: jobSource,
      outPath,
      epub: {
        title,
        ...(options.epubAuthor?.trim() ? { author: options.epubAuthor.trim() } : {}),
        cover: options.epubCover !== false,
        pageBreaks: options.epubPageBreaks === true,
      },
    }
  } else {
    job = { op: 'convertDoc', source: jobSource, format, outPath }
  }

  const jobId = randomUUID()
  runningJob = jobId
  const outcome = await deps.runJob(owner.webContents, jobId, job, onProgress)
  runningJob = null
  if (!outcome.ok) {
    return outcome.error === 'cancelled'
      ? { ok: false, canceled: true }
      : { ok: false, error: 'failed' }
  }
  const st = await stat(outPath).catch(() => ({ size: 0 }))
  const id = randomUUID()
  results.set(id, outPath)
  return { ok: true, output: { id, name: basename(outPath), size: st.size } }
}

/** Pick one folder once for multi-file batch outputs or folder-mode exports. */
async function pickOutputFolder(owner: BrowserWindow, defaultFrom: string): Promise<string | null> {
  const folder = await showOpenDialogWithMemory(
    dialog,
    owner,
    { defaultPath: dirname(defaultFrom), properties: ['openDirectory', 'createDirectory'] },
    dirname(defaultFrom),
  )
  const dir = folder.filePaths[0]
  return folder.canceled || !dir ? null : dir
}

function uniqueOutputFile(dir: string, suggestedName: string, taken: Set<string>): string {
  const target = uniqueGeneratedPdfPath(dir, suggestedName, (p) => existsSync(p) || taken.has(p))
  taken.add(target)
  return target
}

async function run(raw: unknown): Promise<PdfToolRunResult> {
  const owner = win
  if (!owner) return { ok: false, error: 'failed' }
  const req = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tool = req.tool
  if (!isPdfToolId(tool)) return { ok: false, error: 'failed' }
  const ids = Array.isArray(req.inputIds) ? req.inputIds : []
  const kind = toolInputKind(tool)
  const chosen = ids
    .map((id) => (typeof id === 'string' ? inputs.get(id) : undefined))
    .filter((input): input is PickedInput => !!input && acceptsFileKind(kind, input.kind))

  if (tool !== 'organize' && chosen.length === 0) return { ok: false, error: 'no-input' }
  const sources = toolTakesMany(tool) ? chosen : chosen.slice(0, 1)
  if (tool !== 'organize' && sources.length < toolMinInputs(tool)) {
    return { ok: false, error: 'need-two' }
  }

  let background: PickedInput | undefined
  if (tool === 'overlay') {
    const bg = typeof req.backgroundId === 'string' ? inputs.get(req.backgroundId) : undefined
    if (!bg || bg.kind !== 'pdf') return { ok: false, error: 'need-background' }
    if (bg.encrypted && !bg.unlocked) return { ok: false, error: 'wrong-password' }
    background = bg
  }

  let evenSource: PickedInput | undefined
  if (tool === 'interleave') {
    const ev = typeof req.evenId === 'string' ? inputs.get(req.evenId) : undefined
    if (!ev || ev.kind !== 'pdf') return { ok: false, error: 'need-even' }
    if (ev.encrypted && !ev.unlocked) return { ok: false, error: 'wrong-password' }
    evenSource = ev
  }

  if (tool === 'ocr' && !hasOcrEngineHelper()) return { ok: false, error: 'no-ocr-engine' }
  if (running) return { ok: false, error: 'busy' }
  running = true

  const stop = new AbortController()
  runStop = stop
  const contents = owner.webContents

  try {
    // ── Organize Pages (multi-source assembly) ──
    if (tool === 'organize') {
      const plan = parseOrganizePlan(req.organizePlan)
      if (!plan) return { ok: false, error: 'empty-organize' }
      const sourceMap = new Map<string, Uint8Array>()
      const usedInputs: PickedInput[] = []
      let total = 0
      for (const spec of plan) {
        if (spec.sourceId === 'blank' || sourceMap.has(spec.sourceId)) continue
        const src = inputs.get(spec.sourceId)
        if (!src || src.kind !== 'pdf' || !existsSync(src.path))
          return { ok: false, error: 'missing' }
        if (src.encrypted && !src.unlocked) return { ok: false, error: 'wrong-password' }
        total += (await stat(src.path)).size
        if (total > MAX_TOOL_INPUT_BYTES) return { ok: false, error: 'too-large' }
        sourceMap.set(src.id, await readPdfInputBytes(src))
        usedInputs.push(src)
      }
      const primary = usedInputs[0] ?? chosen[0]
      if (!primary) return { ok: false, error: 'no-input' }
      const [made] = await runPdfTool('organize', [], {}, { sourceMap, organizePlan: plan })
      const names = outputNames('organize', primary.name, 1, {})
      const targets = await pickTargets(owner, primary.path, names, 'pdf')
      if (!targets) return { ok: false, canceled: true }
      const target = targets[0]!
      if (usedInputs.some((s) => samePath(s.path, target)))
        return { ok: false, error: 'same-as-source' }
      if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }
      await writePdfAtomically(target, made!)
      const id = randomUUID()
      results.set(id, target)
      const notice = usedInputs.some((s) => s.encrypted && s.unlocked)
        ? ('unlocked-unencrypted' as const)
        : undefined
      return {
        ok: true,
        outputs: [{ id, name: basename(target), size: made!.length }],
        ...(notice ? { notice } : {}),
      }
    }

    // ── Batch Mode (2+ inputs on any batch-capable tool except docsToPdf merge mode) ──
    const rawOpts = (req.options && typeof req.options === 'object' ? req.options : {}) as Record<
      string,
      unknown
    >
    const isDocsMerge = tool === 'docsToPdf' && rawOpts.docsOutputMode === 'merge'
    if (isBatchTool(tool) && sources.length >= 2 && !isDocsMerge) {
      // Check options once (no page-range check across heterogeneous batch files)
      const batchChecked = checkOptions(
        tool,
        { ...rawOpts, applyPages: '', pages: '' },
        10_000,
        background?.pages ?? 1,
      )
      if (!batchChecked.ok) return { ok: false, error: batchChecked.error }
      const outDir = await pickOutputFolder(owner, sources[0]!.path)
      if (!outDir) return { ok: false, canceled: true }
      const taken = new Set<string>()
      const bgBytes = background ? await readPdfInputBytes(background) : undefined
      const anyUnlocked =
        sources.some((s) => s.encrypted && s.unlocked) ||
        Boolean(background?.encrypted && background.unlocked)

      const batchRes = await runBatchItems(
        sources,
        async (item, _idx, reportPage): Promise<BatchItemStepResult> => {
          const source = inputs.get(item.id)
          if (!source || !existsSync(source.path)) return { status: 'failed', reason: 'missing' }

          if (tool === 'docsToPdf') {
            const suggested = outputNames('docsToPdf', source.name, 1, batchChecked.options)[0]!
            const target = uniqueOutputFile(outDir, suggested, taken)
            if (samePath(source.path, target))
              return { status: 'skipped', reason: 'same-as-source' }
            if (await fileHasUnsavedChanges(target)) {
              return { status: 'skipped', reason: 'unsaved-target' }
            }
            const res = await runHeadlessPdfExport(source.path, target, { signal: stop.signal })
            if (!res.ok) {
              return res.canceled ? { status: 'canceled' } : { status: 'failed', reason: 'failed' }
            }
            const st = await stat(target).catch(() => ({ size: 0 }))
            const id = randomUUID()
            results.set(id, target)
            return { status: 'ok', outputs: [{ id, name: basename(target), size: st.size }] }
          }

          if (tool === 'pdfToImages') {
            const mode = batchChecked.options.pdfToImagesMode ?? 'pages'
            const outMode = batchChecked.options.imageOutMode ?? 'zip'
            const base = source.name.replace(/\.pdf$/i, '') || 'document'
            const targetPath =
              mode === 'pages' && outMode === 'zip'
                ? uniqueOutputFile(outDir, `${base}-images.zip`, taken)
                : uniqueSubdir(outDir, base, taken)
            const res = await runPdfToImagesOne(
              owner,
              source,
              batchChecked.options,
              targetPath,
              stop.signal,
              reportPage,
            )
            if (!res.ok) {
              if ('canceled' in res) return { status: 'canceled' }
              return {
                status: res.error === 'no-embedded-images' ? 'skipped' : 'failed',
                reason: res.error,
              }
            }
            return { status: 'ok', outputs: res.outputs }
          }

          if (tool === 'convertFromPdf') {
            const suggested = outputNames(
              'convertFromPdf',
              source.name,
              1,
              batchChecked.options,
            )[0]!
            const target = uniqueOutputFile(outDir, suggested, taken)
            if (await fileHasUnsavedChanges(target)) {
              return { status: 'skipped', reason: 'unsaved-target' }
            }
            const res = await runConvertFromPdfOne(
              owner,
              source,
              batchChecked.options,
              target,
              reportPage,
            )
            if (!res.ok) {
              if ('canceled' in res) return { status: 'canceled' }
              return { status: 'failed', reason: res.error }
            }
            return { status: 'ok', outputs: [res.output] }
          }

          if (tool === 'compress') {
            const pdfBytes = await readPdfInputBytes(source)
            const comp = await compressOnePdf(
              owner,
              pdfBytes,
              batchChecked.options,
              stop.signal,
              reportPage,
            )
            if (!comp.ok) {
              if ('canceled' in comp) return { status: 'canceled' }
              return {
                status: comp.error === 'not-smaller' ? 'skipped' : 'failed',
                reason: comp.error,
              }
            }
            const suggested = outputNames('compress', source.name, 1, batchChecked.options)[0]!
            const target = uniqueOutputFile(outDir, suggested, taken)
            if (samePath(source.path, target))
              return { status: 'skipped', reason: 'same-as-source' }
            await writePdfAtomically(target, comp.bytes)
            const id = randomUUID()
            results.set(id, target)
            return {
              status: comp.targetMissed ? 'target-not-met' : 'ok',
              outputs: [{ id, name: basename(target), size: comp.bytes.length }],
              achievedBytes: comp.bytes.length,
              ...(comp.targetBytes !== undefined ? { targetBytes: comp.targetBytes } : {}),
            }
          }

          if (tool === 'ocr') {
            const password = unlockedSecrets.get(source.id)?.password
            const jobId = randomUUID()
            runningJob = jobId
            const outcome = await deps!.runJob(
              owner.webContents,
              jobId,
              jobFor('ocr', source.path, batchChecked.options, password),
              reportPage,
            )
            runningJob = null
            if (!outcome.ok) {
              if (outcome.error === 'cancelled') return { status: 'canceled' }
              return { status: 'failed', reason: 'failed' }
            }
            const val = outcome.value as OcrPdfJobValue | null
            if (!val || val.ocredPages === 0) return { status: 'skipped', reason: 'no-ocr-changes' }
            const suggested = outputNames('ocr', source.name, 1, batchChecked.options)[0]!
            const target = uniqueOutputFile(outDir, suggested, taken)
            await writePdfAtomically(target, val.bytes)
            const id = randomUUID()
            results.set(id, target)
            return {
              status: 'ok',
              outputs: [{ id, name: basename(target), size: val.bytes.length }],
            }
          }

          if (tool === 'encrypt' || tool === 'decrypt' || tool === 'repair') {
            const unlockedPw = unlockedSecrets.get(source.id)?.password
            const res = await runToolJob(owner, tool, source.path, batchChecked.options, unlockedPw)
            if (!res.ok) {
              if ('canceled' in res) return { status: 'canceled' }
              return { status: 'failed', reason: res.error }
            }
            const suggested = outputNames(tool, source.name, 1, batchChecked.options)[0]!
            const target = uniqueOutputFile(outDir, suggested, taken)
            await writePdfAtomically(target, res.bytes)
            const id = randomUUID()
            results.set(id, target)
            return {
              status: 'ok',
              outputs: [{ id, name: basename(target), size: res.bytes.length }],
            }
          }

          // Standard pdf-lib tools (reverse, rotate, nup, pageSize, splitPages, overlay, stripAnnots, toText)
          try {
            const pdfBytes = await readPdfInputBytes(source)
            const runInputs = bgBytes ? [pdfBytes, bgBytes] : [pdfBytes]
            const made = await runPdfTool(tool, runInputs, batchChecked.options, {
              recode: recodeWithChromium,
              signal: stop.signal,
              onProgress: reportPage,
            })
            const suggested = outputNames(tool, source.name, made.length, batchChecked.options)[0]!
            const target = uniqueOutputFile(outDir, suggested, taken)
            if (samePath(source.path, target))
              return { status: 'skipped', reason: 'same-as-source' }
            await writePdfAtomically(target, made[0]!)
            const id = randomUUID()
            results.set(id, target)
            return {
              status: 'ok',
              outputs: [{ id, name: basename(target), size: made[0]!.length }],
            }
          } catch (err) {
            if (err instanceof PdfToolRefusal) return { status: 'skipped', reason: err.reason }
            if (stop.signal.aborted) return { status: 'canceled' }
            return { status: 'failed', reason: 'failed' }
          }
        },
        {
          signal: stop.signal,
          onProgress: (ev) => sendProgress(contents, ev),
        },
      )

      if (batchRes.canceled) {
        return { ok: false, canceled: true, savedCount: batchRes.savedCount }
      }
      return {
        ok: true,
        outputs: batchRes.outputs,
        batch: batchRes.outcomes,
        ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
      }
    }

    // ── Single-file / multi-input non-batch tools ──
    const primary = sources[0]!
    if (primary.encrypted && !primary.unlocked && tool !== 'decrypt' && tool !== 'repair') {
      return { ok: false, error: 'wrong-password' }
    }
    const anyUnlocked =
      sources.some((s) => s.encrypted && s.unlocked) ||
      Boolean(background?.encrypted && background.unlocked) ||
      Boolean(evenSource?.encrypted && evenSource.unlocked)

    // ── docsToPdf (single file or merged multiple files) ──
    if (tool === 'docsToPdf') {
      const checked = checkOptions('docsToPdf', req.options, 1)
      if (!checked.ok) return { ok: false, error: checked.error }
      const names = outputNames('docsToPdf', primary.name, sources.length, checked.options)
      const targets = await pickTargets(owner, primary.path, names, 'pdf')
      if (!targets) return { ok: false, canceled: true }
      const target = targets[0]!
      if (sources.some((s) => samePath(s.path, target)))
        return { ok: false, error: 'same-as-source' }
      if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }

      if (sources.length === 1) {
        sendProgress(contents, { done: 0, total: 1, currentName: primary.name })
        const res = await runHeadlessPdfExport(primary.path, target, { signal: stop.signal })
        if (!res.ok) {
          return res.canceled ? { ok: false, canceled: true } : { ok: false, error: 'failed' }
        }
        sendProgress(contents, { done: 1, total: 1 })
        const st = await stat(target).catch(() => ({ size: 0 }))
        const id = randomUUID()
        results.set(id, target)
        return { ok: true, outputs: [{ id, name: basename(target), size: st.size }] }
      }

      // Multiple docs -> merge into single PDF with filename bookmarks
      const workDir = await mkdtemp(join(tmpdir(), 'ieum-docs-merge-'))
      try {
        const mergeInputs: { bytes: Uint8Array; name: string }[] = []
        for (let i = 0; i < sources.length; i++) {
          if (stop.signal.aborted) return { ok: false, canceled: true }
          const src = sources[i]!
          sendProgress(contents, {
            done: i,
            total: sources.length,
            fileDone: i,
            fileTotal: sources.length,
            currentName: src.name,
          })
          const tmpPdf = join(workDir, `${i}.pdf`)
          const res = await runHeadlessPdfExport(src.path, tmpPdf, { signal: stop.signal })
          if (!res.ok) {
            return res.canceled ? { ok: false, canceled: true } : { ok: false, error: 'failed' }
          }
          const buf = await readFile(tmpPdf)
          mergeInputs.push({
            bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            name: src.name,
          })
        }
        const merged = await mergePdfV2Bytes(mergeInputs, {
          addBookmarks: checked.options.addBookmarks !== false,
        })
        await writePdfAtomically(target, merged.bytes)
        const id = randomUUID()
        results.set(id, target)
        return { ok: true, outputs: [{ id, name: basename(target), size: merged.bytes.length }] }
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    }

    // ── pdfToImages (single PDF) ──
    if (tool === 'pdfToImages') {
      const checked = checkOptions('pdfToImages', req.options, primary.pages)
      if (!checked.ok) return { ok: false, error: checked.error }
      const mode = checked.options.pdfToImagesMode ?? 'pages'
      const outMode = checked.options.imageOutMode ?? 'zip'
      let targetOutPath: string | null
      if (mode === 'pages' && outMode === 'zip') {
        const names = outputNames('pdfToImages', primary.name, 1, checked.options)
        const targets = await pickTargets(owner, primary.path, names, 'zip')
        targetOutPath = targets?.[0] ?? null
      } else {
        targetOutPath = await pickOutputFolder(owner, primary.path)
      }
      if (!targetOutPath) return { ok: false, canceled: true }
      const res = await runPdfToImagesOne(
        owner,
        primary,
        checked.options,
        targetOutPath,
        stop.signal,
        (done, total) => sendProgress(contents, { done, total }),
      )
      if (!res.ok) return res
      return {
        ok: true,
        outputs: res.outputs,
        ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
      }
    }

    // ── convertFromPdf (single PDF) ──
    if (tool === 'convertFromPdf') {
      const checked = checkOptions('convertFromPdf', req.options, primary.pages)
      if (!checked.ok) return { ok: false, error: checked.error }
      const ext = toolOutputExtension('convertFromPdf', checked.options)
      const names = outputNames('convertFromPdf', primary.name, 1, checked.options)
      const targets = await pickTargets(owner, primary.path, names, ext)
      if (!targets) return { ok: false, canceled: true }
      const target = targets[0]!
      if (samePath(primary.path, target)) return { ok: false, error: 'same-as-source' }
      if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }
      const res = await runConvertFromPdfOne(
        owner,
        primary,
        checked.options,
        target,
        (done, total) => sendProgress(contents, { done, total }),
      )
      if (!res.ok) return res
      return {
        ok: true,
        outputs: [res.output],
        ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
      }
    }

    // ── ocr (single PDF) ──
    if (tool === 'ocr') {
      const checked = checkOptions('ocr', req.options, primary.pages)
      if (!checked.ok) return { ok: false, error: checked.error }
      const password = unlockedSecrets.get(primary.id)?.password
      const jobId = randomUUID()
      runningJob = jobId
      const outcome = await deps!.runJob(
        owner.webContents,
        jobId,
        jobFor('ocr', primary.path, checked.options, password),
        (done, total) => sendProgress(contents, { done, total }),
      )
      runningJob = null
      if (!outcome.ok) {
        return outcome.error === 'cancelled'
          ? { ok: false, canceled: true }
          : { ok: false, error: 'failed' }
      }
      const val = outcome.value as OcrPdfJobValue | null
      if (!val || val.ocredPages === 0) return { ok: false, error: 'no-ocr-changes' }
      const names = outputNames('ocr', primary.name, 1, checked.options)
      const targets = await pickTargets(owner, primary.path, names, 'pdf')
      if (!targets) return { ok: false, canceled: true }
      const target = targets[0]!
      if (samePath(primary.path, target)) return { ok: false, error: 'same-as-source' }
      if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }
      await writePdfAtomically(target, val.bytes)
      const id = randomUUID()
      results.set(id, target)
      return {
        ok: true,
        outputs: [{ id, name: basename(target), size: val.bytes.length }],
        ocrSummary: { ocredPages: val.ocredPages, skippedPages: val.skippedPages },
        ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
      }
    }

    // ── compress v2 (single PDF) ──
    if (tool === 'compress') {
      const checked = checkOptions('compress', req.options, primary.pages)
      if (!checked.ok) return { ok: false, error: checked.error }
      if (!existsSync(primary.path)) return { ok: false, error: 'missing' }
      const pdfBytes = await readPdfInputBytes(primary)
      const comp = await compressOnePdf(
        owner,
        pdfBytes,
        checked.options,
        stop.signal,
        (done, total) => sendProgress(contents, { done, total }),
      )
      if (!comp.ok) return comp
      if (comp.targetMissed && comp.targetBytes !== undefined) {
        const pendingId = randomUUID()
        pendingPartials.set(pendingId, {
          bytes: comp.bytes,
          sourcePath: primary.path,
          sourceName: primary.name,
          ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
        })
        return {
          ok: false,
          targetMissed: true,
          pendingId,
          achievedBytes: comp.bytes.length,
          targetBytes: comp.targetBytes,
          originalBytes: pdfBytes.length,
        }
      }
      const names = outputNames('compress', primary.name, 1, checked.options)
      const targets = await pickTargets(owner, primary.path, names, 'pdf')
      if (!targets) return { ok: false, canceled: true }
      const target = targets[0]!
      if (samePath(primary.path, target)) return { ok: false, error: 'same-as-source' }
      if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }
      await writePdfAtomically(target, comp.bytes)
      const id = randomUUID()
      results.set(id, target)
      return {
        ok: true,
        outputs: [{ id, name: basename(target), size: comp.bytes.length }],
        ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
      }
    }

    // ── Read inputs for remaining tools (merge, interleave, imagesToPdf, split, extract, etc.) ──
    const allSources = [...sources]
    if (background) allSources.push(background)
    if (evenSource) allSources.push(evenSource)

    if (tool === 'merge') {
      for (const s of allSources) {
        if (s.kind !== 'pdf') {
          const entry = mixQueue?.get(s.id)
          if (!entry || entry.state === 'pending' || entry.state === 'converting') {
            return { ok: false, error: 'mix-converting' }
          }
          if (entry.state === 'error') return { ok: false, error: 'mix-failed' }
        }
      }
    }

    let total = 0
    const bytes: Uint8Array[] = []
    for (const source of allSources) {
      if (tool === 'merge' && source.kind !== 'pdf') {
        const entry = mixQueue?.get(source.id)
        if (!entry || !existsSync(entry.pdfPath)) return { ok: false, error: 'missing' }
        total += (await stat(entry.pdfPath)).size
        if (total > MAX_TOOL_INPUT_BYTES) return { ok: false, error: 'too-large' }
        const buf = await readFile(entry.pdfPath)
        bytes.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        continue
      }
      if (!existsSync(source.path)) return { ok: false, error: 'missing' }
      total += (await stat(source.path)).size
      if (total > MAX_TOOL_INPUT_BYTES) return { ok: false, error: 'too-large' }
      if (source.kind === 'pdf') {
        if (source.encrypted && !source.unlocked && tool !== 'decrypt' && tool !== 'repair') {
          return { ok: false, error: 'wrong-password' }
        }
        bytes.push(await readPdfInputBytes(source))
      } else {
        const buf = await readFile(source.path)
        const rawImg = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        const optChoice =
          rawOpts.imageOptimize === 'balanced' || rawOpts.imageOptimize === 'compact'
            ? rawOpts.imageOptimize
            : 'original'
        const normalized = normalizeImageForPdf(rawImg, optChoice)
        if (!normalized) return { ok: false, error: 'failed' }
        bytes.push(normalized)
      }
    }

    // Re-check first input's page count
    let firstPages = primary.pages
    if (tool !== 'imagesToPdf' && tool !== 'merge') {
      const info = await inspectPdfForAccept(bytes[0]!, toolAccepts(tool))
      if (!info.ok) return { ok: false, error: 'failed' }
      firstPages = info.pages
    }
    const backgroundInfo = background ? await inspectPdf(bytes[1]!) : null
    if (backgroundInfo && !backgroundInfo.ok) return { ok: false, error: 'failed' }
    const checked = checkOptions(
      tool,
      req.options,
      firstPages,
      backgroundInfo?.ok ? backgroundInfo.pages : 1,
    )
    if (!checked.ok) return { ok: false, error: checked.error }

    if (tool === 'merge' && checked.options.mergeRanges) {
      // Validate per-file page ranges against each input's actual page count
      for (let i = 0; i < sources.length; i++) {
        const rangeText = checked.options.mergeRanges[sources[i]!.id]
        if (!rangeText) continue
        const info = await inspectPdf(bytes[i]!)
        if (!info.ok) return { ok: false, error: 'failed' }
        const parsed = parsePageRange(rangeText, info.pages)
        if (!parsed.ok) return { ok: false, error: 'range' }
      }
    }

    if (tool === 'blankPages') {
      const found = blankFound.get(sources[0]!.id)
      const chosenPages = (checked.options.removePages ?? '').split(',').map(Number)
      if (!found || chosenPages.some((page) => !found.has(page))) {
        return { ok: false, error: 'not-found' }
      }
    }

    let made: Uint8Array[]
    let customNames: string[] | null = null
    let oversizedPages: number[] = []
    if (toolRunsAsJob(tool) && (tool === 'encrypt' || tool === 'decrypt' || tool === 'repair')) {
      const unlockedPw = unlockedSecrets.get(sources[0]!.id)?.password
      const job = await runToolJob(owner, tool, sources[0]!.path, checked.options, unlockedPw)
      if (!job.ok) return job
      made = [job.bytes]
    } else {
      try {
        const depsRun = {
          recode: recodeWithChromium,
          signal: stop.signal,
          onProgress: (done: number, totalCount: number) =>
            sendProgress(contents, { done, total: totalCount }),
          inputIds: sources.map((s) => s.id),
          sourceNames: sources.map((s) => s.name),
        }
        if (tool === 'split') {
          const splitResult = await runSplitPdfTool(
            bytes[0]!,
            sources[0]!.name,
            checked.options,
            depsRun,
          )
          made = splitResult.parts
          customNames = splitResult.names
          oversizedPages = splitResult.oversizedPages
        } else {
          made = await runPdfTool(tool, bytes, checked.options, depsRun)
        }
      } catch (err) {
        if (err instanceof PdfToolRefusal) return { ok: false, error: err.reason }
        if (stop.signal.aborted) return { ok: false, canceled: true }
        throw err
      }
    }

    const names = customNames ?? outputNames(tool, sources[0]!.name, made.length, checked.options)
    const subfolder =
      tool === 'split' && made.length >= 2 && checked.options.splitCreateSubfolder
        ? splitSubfolderName(sources[0]!.name, checked.options.splitPrefix)
        : null
    const targets = await pickTargets(
      owner,
      sources[0]!.path,
      names,
      toolOutputExtension(tool, checked.options),
      subfolder,
    )
    if (!targets) return { ok: false, canceled: true }
    for (const target of targets) {
      if (allSources.some((source) => samePath(source.path, target))) {
        return { ok: false, error: 'same-as-source' }
      }
      if (await fileHasUnsavedChanges(target)) return { ok: false, error: 'unsaved-target' }
    }
    if (subfolder && targets[0]) {
      await mkdir(dirname(targets[0]), { recursive: true })
    }
    const outputs: { id: string; name: string; size: number }[] = []
    for (let i = 0; i < made.length; i++) {
      await writePdfAtomically(targets[i]!, made[i]!)
      const id = randomUUID()
      results.set(id, targets[i]!)
      outputs.push({ id, name: basename(targets[i]!), size: made[i]!.length })
    }
    return {
      ok: true,
      outputs,
      ...(anyUnlocked ? { notice: 'unlocked-unencrypted' as const } : {}),
      ...(oversizedPages.length > 0 ? { oversizedPages } : {}),
    }
  } catch {
    return { ok: false, error: 'failed' }
  } finally {
    running = false
    runStop = null
    runningJob = null
  }
}

/**
 * Add a password, remove one or repair a file in the PDF job process (qpdf,
 * PDFium), and check its answer is what the tool promises.
 */
async function runToolJob(
  owner: BrowserWindow,
  tool: 'encrypt' | 'decrypt' | 'repair',
  path: string,
  options: PdfToolOptions,
  password?: string,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: 'failed' | 'wrong-password' }
  | { ok: false; canceled: true }
> {
  if (!deps) return { ok: false, error: 'failed' }
  const jobId = randomUUID()
  runningJob = jobId
  const outcome = await deps.runJob(
    owner.webContents,
    jobId,
    jobFor(tool, path, options, password),
    () => {},
  )
  if (!outcome.ok) {
    if (outcome.error === 'cancelled') return { ok: false, canceled: true }
    return { ok: false, error: outcome.error === 'password-required' ? 'wrong-password' : 'failed' }
  }
  const bytes = jobBytesOf(outcome.value)
  if (!bytes) return { ok: false, error: 'failed' }
  const info = await inspectPdf(bytes)
  const asPromised = tool === 'encrypt' ? !info.ok && info.problem === 'encrypted' : info.ok
  return asPromised ? { ok: true, bytes } : { ok: false, error: 'failed' }
}

/**
 * Where to write: one file asks with a save dialog next to the source; several
 * files (split) ask for a folder and take free names in it. Null: canceled.
 */
async function pickTargets(
  owner: BrowserWindow,
  sourcePath: string,
  names: string[],
  extension: 'pdf' | 'txt' | 'zip' | PdfConvertFormat,
  subfolder: string | null = null,
): Promise<string[] | null> {
  if (names.length === 1) {
    const saved = await showSaveDialogWithMemory(dialog, owner, {
      defaultPath: saveAsSuggestion(sourcePath, names[0]!),
      filters: [OUTPUT_FILTERS[extension]],
    })
    if (saved.canceled || !saved.filePath) return null
    const ending = `.${extension}`
    return [
      saved.filePath.toLowerCase().endsWith(ending) ? saved.filePath : `${saved.filePath}${ending}`,
    ]
  }
  const folder = await showOpenDialogWithMemory(
    dialog,
    owner,
    { defaultPath: dirname(sourcePath), properties: ['openDirectory', 'createDirectory'] },
    dirname(sourcePath),
  )
  const dir = folder.filePaths[0]
  if (folder.canceled || !dir) return null
  const destDir = subfolder ? uniqueSplitSubfolder(dir, subfolder, existsSync) : dir
  const taken = new Set<string>()
  return names.map((name) => uniqueOutputFile(destDir, name, taken))
}

async function readBookmarksForInput(inputId: unknown): Promise<PdfBookmarksResult> {
  const input = typeof inputId === 'string' ? inputs.get(inputId) : undefined
  if (!input || input.kind !== 'pdf') return { ok: false, error: 'no-input' }
  if (!existsSync(input.path)) return { ok: false, error: 'missing' }
  try {
    const bytes = await readPdfInputBytes(input)
    const bookmarks = await readBookmarksBytes(bytes)
    return { ok: true, bookmarks }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

async function openSplitForInput(inputId: unknown): Promise<void> {
  const d = deps
  const input = typeof inputId === 'string' ? inputs.get(inputId) : undefined
  if (!d || !input || input.kind !== 'pdf' || !existsSync(input.path)) return
  if (d.askEditorOn && !(await d.askEditorOn('pdf'))) return
  if (d.openSplitInEditor) d.openSplitInEditor(input.path)
  else d.openForEditing(input.path)
}

/** a thumbnail BGRA bitmap as a PNG data URL */
function thumbUrl(thumb: { width: number; height: number; bgra: Uint8Array }): string {
  const buffer = Buffer.from(thumb.bgra.buffer, thumb.bgra.byteOffset, thumb.bgra.byteLength)
  return nativeImage
    .createFromBitmap(buffer, { width: thumb.width, height: thumb.height })
    .toDataURL()
}

async function findBlankPages(inputId: unknown): Promise<PdfBlankPagesResult> {
  const owner = win
  if (!owner || !deps) return { ok: false, error: 'failed' }
  const input = typeof inputId === 'string' ? inputs.get(inputId) : undefined
  if (!input || input.kind !== 'pdf') return { ok: false, error: 'no-input' }
  if (!existsSync(input.path)) return { ok: false, error: 'missing' }
  if (input.encrypted && !input.unlocked) return { ok: false, error: 'failed' }
  if (finding || running) return { ok: false, error: 'busy' }
  const jobId = randomUUID()
  finding = jobId
  try {
    const contents = owner.webContents
    const password = unlockedSecrets.get(input.id)?.password
    const outcome = await deps.runJob(
      contents,
      jobId,
      {
        op: 'blankPages',
        source: { pdfPath: input.path, ...(password !== undefined ? { password } : {}) },
      },
      (done, total) => sendProgress(contents, { done, total }),
    )
    if (!outcome.ok) {
      return outcome.error === 'cancelled'
        ? { ok: false, canceled: true }
        : { ok: false, error: 'failed' }
    }
    const found = foundBlankPagesOf(outcome.value)
    if (!found) return { ok: false, error: 'failed' }
    blankFound.set(input.id, new Set(found.candidates.map((c) => c.page)))
    return {
      ok: true,
      pageCount: found.pageCount,
      candidates: found.candidates.map((c) => ({
        page: c.page,
        reason: c.reason,
        thumb: c.thumb ? thumbUrl(c.thumb) : null,
      })),
    }
  } catch {
    return { ok: false, error: 'failed' }
  } finally {
    finding = null
  }
}

/**
 * The PDF editor's ribbon: open the window on `tool` with the view's own
 * file picked (the editor checked the file is the view's and saved it).
 * False for a task that does not take one PDF.
 */
export function openPdfToolsWithFile(path: string, tool: unknown): boolean {
  const d = deps
  if (!d || !isPdfToolId(tool) || toolInputKind(tool) !== 'pdf') return false
  void (async () => {
    // the PDF tools turned off: asked before the window opens (spec 7.3)
    if (d.askEditorOn && !(await d.askEditorOn('pdfTools'))) return
    const picked = await inputsFrom([path], 'pdf', toolAccepts(tool))
    pendingStart = { tool, inputs: picked.inputs, rejected: picked.rejected }
    const open = !!win && !win.isDestroyed()
    openPdfToolsWindow()
    // a fresh window takes the task as it loads; an open one is told it waits
    if (open) win?.webContents.send(PDF_TOOLS_CHANNELS.startReady)
  })()
  return true
}

async function openInEditor(): Promise<void> {
  const owner = win
  if (!owner || !deps) return
  if (deps.askEditorOn && !(await deps.askEditorOn('pdf'))) return
  const picked = await showOpenDialogWithMemory(dialog, owner, {
    filters: [PDF_FILTER],
    properties: ['openFile'],
  })
  const path = picked.filePaths[0]
  if (!picked.canceled && path) deps.openForEditing(path)
}

async function openInEditorWithInput(inputId: unknown): Promise<void> {
  const owner = win
  if (!owner || !deps || typeof inputId !== 'string') return
  const input = inputs.get(inputId)
  if (!input || input.kind !== 'pdf' || !existsSync(input.path)) return
  if (deps.askEditorOn && !(await deps.askEditorOn('pdf'))) return
  deps.openForEditing(input.path)
}

function parseInputKind(raw: unknown): PdfToolInputKind {
  if (raw === 'image' || raw === 'document' || raw === 'mixed') return raw
  return 'pdf'
}

function parseAccept(raw: unknown): PdfToolAccept {
  return raw === 'encrypted' || raw === 'damaged' ? raw : 'pdf'
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.handle(PDF_TOOLS_CHANNELS.getInit, (event) => {
    if (!fromWindow(event) || !deps) return null
    return { lang: deps.lang(), theme: deps.theme() }
  })
  ipcMain.handle(
    PDF_TOOLS_CHANNELS.pickInputs,
    (event, multi: unknown, kind: unknown, accept: unknown) => {
      if (!fromWindow(event)) return { inputs: [], rejected: [] }
      return pickInputs(multi === true, parseInputKind(kind), parseAccept(accept))
    },
  )
  ipcMain.handle(
    PDF_TOOLS_CHANNELS.dropInputs,
    (event, rawPaths: unknown, kind: unknown, accept: unknown) => {
      if (!fromWindow(event)) return { inputs: [], rejected: [] }
      const paths = Array.isArray(rawPaths)
        ? rawPaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      return inputsFrom(paths, parseInputKind(kind), parseAccept(accept))
    },
  )
  ipcMain.handle(PDF_TOOLS_CHANNELS.releaseInputs, async (event, rawIds: unknown) => {
    if (!fromWindow(event) || running || !Array.isArray(rawIds)) return
    pendingPartials.clear()
    for (const id of rawIds) {
      if (typeof id !== 'string' || id.length === 0) continue
      unlockedSecrets.delete(id)
      inputs.delete(id)
      blankFound.delete(id)
      if (mixQueue) await mixQueue.remove(id)
    }
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.unlockInput, (event, inputId: unknown, password: unknown) => {
    if (!fromWindow(event)) return { ok: false, error: 'failed' }
    return unlockInput(inputId, password)
  })
  ipcMain.handle(
    PDF_TOOLS_CHANNELS.promoteResult,
    (event, outputId: unknown, nextTool: unknown) => {
      if (!fromWindow(event)) return { ok: false, error: 'failed' }
      const path = typeof outputId === 'string' ? results.get(outputId) : undefined
      return promotePathToTool(path, nextTool)
    },
  )
  ipcMain.handle(PDF_TOOLS_CHANNELS.promoteInput, (event, inputId: unknown, nextTool: unknown) => {
    if (!fromWindow(event)) return { ok: false, error: 'failed' }
    const input = typeof inputId === 'string' ? inputs.get(inputId) : undefined
    return promotePathToTool(input?.path, nextTool)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.auditSpace, (event, inputId: unknown) => {
    if (!fromWindow(event)) return { ok: false, error: 'failed' }
    return auditSpaceHandler(inputId)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.ocrAvailable, (event) => {
    if (!fromWindow(event)) return { available: false, platform: process.platform }
    return { available: hasOcrEngineHelper(), platform: process.platform }
  })
  ipcMain.handle(
    PDF_TOOLS_CHANNELS.renderThumbs,
    (event, inputId: unknown, startPage: unknown, endPage: unknown) => {
      if (!fromWindow(event)) return { ok: false, error: 'failed' }
      return renderThumbsHandler(inputId, startPage, endPage)
    },
  )
  ipcMain.handle(PDF_TOOLS_CHANNELS.cancelThumbs, (event) => {
    if (fromWindow(event) && thumbJob) deps?.cancelJob(event.sender.id, thumbJob)
  })
  ipcMain.handle(
    PDF_TOOLS_CHANNELS.confirmSavePartial,
    (event, pendingId: unknown, save: unknown) => {
      if (!fromWindow(event)) return { ok: false, error: 'failed' }
      return confirmSavePartial(pendingId, save)
    },
  )
  ipcMain.handle(PDF_TOOLS_CHANNELS.run, (event, request: unknown) => {
    if (!fromWindow(event)) return { ok: false, error: 'failed' }
    return run(request)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.openResult, async (event, id: unknown) => {
    const path = fromWindow(event) && typeof id === 'string' ? results.get(id) : undefined
    const d = deps
    if (!path || !d || !existsSync(path)) return
    // while the result's editor is off its "open" asks first (spec 7.3)
    if (d.askBeforeOpenResult) await d.askBeforeOpenResult(path, (p) => d.openResult(p))
    else d.openResult(path)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.revealResult, (event, id: unknown) => {
    const path = fromWindow(event) && typeof id === 'string' ? results.get(id) : undefined
    if (path && existsSync(path)) shell.showItemInFolder(path)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.openInEditor, (event) => {
    if (fromWindow(event)) return openInEditor()
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.openInEditorWithInput, (event, inputId: unknown) => {
    if (fromWindow(event)) return openInEditorWithInput(inputId)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.openSplitInEditor, (event, inputId: unknown) => {
    if (fromWindow(event)) return openSplitForInput(inputId)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.readBookmarks, (event, inputId: unknown) => {
    if (!fromWindow(event)) return { ok: false, error: 'failed' }
    return readBookmarksForInput(inputId)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.findBlankPages, (event, inputId: unknown) => {
    if (!fromWindow(event)) return { ok: false, error: 'failed' }
    return findBlankPages(inputId)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.cancelRun, (event) => {
    if (!fromWindow(event)) return
    runStop?.abort()
    if (runningJob) deps?.cancelJob(event.sender.id, runningJob)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.cancelFind, (event) => {
    if (fromWindow(event) && finding) deps?.cancelJob(event.sender.id, finding)
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.takeStart, (event) => {
    if (!fromWindow(event)) return null
    const start = pendingStart
    pendingStart = null
    return start
  })
  ipcMain.handle(PDF_TOOLS_CHANNELS.close, (event) => {
    if (fromWindow(event)) win?.close()
  })
  ipcMain.handle(PDF_TOOLS_HOME_CHANNELS.open, async (event) => {
    const parent = deps?.parentWindow()
    if (!parent || parent.isDestroyed() || event.sender !== parent.webContents) return
    // Home hides the card while the tools are off; asked anyway if it is reached
    if (deps?.askEditorOn && !(await deps.askEditorOn('pdfTools'))) return
    openPdfToolsWindow()
  })
}

export function openPdfToolsWindow(): void {
  const d = deps
  if (!d) throw new Error('the PDF tools window is not configured')
  void sweepOrphanMixFiles()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  const lang = d.lang()
  const parent = d.parentWindow()
  const next = new BrowserWindow({
    width: 840,
    height: 740,
    minWidth: 560,
    minHeight: 520,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    show: false,
    center: true,
    resizable: true,
    minimizable: false,
    maximizable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: `${pdfToolsText(lang, 'windowTitle')} - ${productName(lang)}`,
    webPreferences: {
      preload: join(__dirname, '../preload/pdf-tools.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win = next
  next.removeMenu()
  next.webContents.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url)
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
  next.once('ready-to-show', () => next.show())
  next.on('closed', () => {
    if (win !== next) return
    win = null
    runStop?.abort()
    killAllHeadlessChildren()
    if (mixQueue) {
      void mixQueue.clearAll()
      mixQueue = null
    }
    inputs.clear()
    results.clear()
    unlockedSecrets.clear()
    pendingPartials.clear()
    blankFound.clear()
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void next.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pdf-tools.html`)
  } else {
    void next.loadFile(join(__dirname, '../renderer/pdf-tools.html'))
  }
}
