/**
 * The phone's PDF tools, run on bytes (spec 5.3, 5.4, 6). Pure: PDFium, qpdf,
 * the picture code and the random source come from the caller, so this runs
 * in the engine worker (bundled wasm, OffscreenCanvas) and in Node tests
 * (wasm read from node_modules, a fake recoder) alike.
 *
 * Every tool is @genoffice/pdf-ops, the same code the PC tools window runs:
 * runPdfTool / runSplitPdfTool with the mirror page engine, mergePdfInOrder
 * and imagesToPdfFrom so inputs are read one at a time, qpdf for passwords,
 * PDFium for repair and blank pages. No network, no AI; inputs are only read.
 */
import {
  PdfToolRefusal,
  WrongPasswordError,
  checkOptions,
  checkToolResult,
  findBlankPages as findBlankPagesIn,
  imagesToPdfFrom,
  inspectToolInput,
  mergePdfInOrder,
  mirrorPageEngine,
  outputNames,
  pdfiumOpens,
  qpdfDecrypt,
  qpdfEncrypt,
  readImageInfo,
  repairPdfBytes,
  runPdfTool,
  runSplitPdfTool,
  salvagePdfBytes,
  toolAccepts,
  toolInputKind,
  toolMinInputs,
  toolTakesMany,
  withPdfiumDocument,
  type BlankPagesPdfium,
  type CreateQpdf,
  type InspectResult,
  type PdfTextPdfium,
  type PdfToolId,
  type PdfToolOptions,
  type PdfToolPaper,
  type RepairPdfium,
} from '@genoffice/pdf-ops'
import type { PictureOps } from './picture'
import { isOutOfMemory } from './protocol'
import type { ToolFile, ToolResultFile, ToolRunOutcome } from './types'

/** The PDFium calls the tools use: text, blank pages, repair and the password check */
export type EnginePdfium = BlankPagesPdfium & RepairPdfium & PdfTextPdfium

/** qpdf's module factory and where its wasm is (a bundled asset URL, or a path in Node) */
export interface QpdfKit {
  create: CreateQpdf
  wasmLocation: string
}

export interface CoreDeps {
  /** PDFium, initialised; called only when a tool first needs it */
  loadPdfium(): Promise<EnginePdfium>
  /** qpdf; called only when a password is added or removed */
  loadQpdf(): Promise<QpdfKit>
  pictures: PictureOps
  /** `length` random bytes (crypto.getRandomValues) for the owner password nobody knows */
  randomBytes(length: number): Uint8Array
}

/** A thumbnail as RGBA pixels, ready for ImageData */
export interface RgbaThumb {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
}

export type CoreBlankOutcome =
  | {
      ok: true
      pageCount: number
      candidates: { page: number; reason: 'empty' | 'nearly-white'; thumb: RgbaThumb | null }[]
    }
  | { ok: false; reason: 'failed' | 'too-large' }

export interface EngineCore {
  inspect(bytes: Uint8Array, mime: string, tool: PdfToolId): Promise<InspectResult>
  run(
    tool: PdfToolId,
    files: readonly ToolFile[],
    options: PdfToolOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ToolRunOutcome>
  findBlankPages(
    bytes: Uint8Array,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CoreBlankOutcome>
  zip(files: readonly ToolResultFile[], zipName: string): Promise<ToolResultFile>
}

/**
 * Paper sizes and margins of "images to PDF", the values runPdfTool uses
 * (pdf-ops tools.ts keeps them private). The engine test holds this run to
 * runPdfTool's bytes for every paper and margin, so a change there fails it.
 */
const PAPER_POINTS: Record<PdfToolPaper, { w: number; h: number }> = {
  A3: { w: 842, h: 1191 },
  A4: { w: 595, h: 842 },
  A5: { w: 420, h: 595 },
  Letter: { w: 612, h: 792 },
  Legal: { w: 612, h: 1008 },
}
const MARGIN_POINTS = { none: 0, small: 18, large: 36 } as const

/** Bytes of the owner password made when no restriction is asked for (as hex, twice as long) */
export const OWNER_PASSWORD_BYTES = 32

/** The outcome for an error thrown by a tool */
function failureOf(err: unknown): ToolRunOutcome {
  if (err instanceof PdfToolRefusal) return { ok: false, reason: err.reason }
  if (err instanceof WrongPasswordError) return { ok: false, reason: 'wrong-password' }
  return { ok: false, reason: isOutOfMemory(err) ? 'too-large' : 'failed' }
}

const FAILED: ToolRunOutcome = { ok: false, reason: 'failed' }

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** The bytes `held` has, which it then lets go */
function take(held: { bytes: Uint8Array | null }): Uint8Array {
  const bytes = held.bytes
  held.bytes = null
  if (!bytes) throw new Error('no input')
  return bytes
}

/** One promise for a loader, made again if it failed */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | null = null
  return () => {
    made ??= load().catch((err: unknown) => {
      made = null
      throw err
    })
    return made
  }
}

/** A file name used once in a ZIP: "a.pdf", then "a (2).pdf" */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const dot = name.lastIndexOf('.')
    candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

export function createEngineCore(deps: CoreDeps): EngineCore {
  const loadPdfium = once(() => deps.loadPdfium())
  const loadQpdf = once(() => deps.loadQpdf())
  const engine = mirrorPageEngine(loadPdfium)
  // names are filled in by run() once the tool has made its files
  const pdf = (bytes: Uint8Array): ToolResultFile => ({ name: '', mime: 'application/pdf', bytes })

  /**
   * The inputs in order, each read only when the one before is used: the
   * first is already read; `convert` may turn each one (photos to JPEG).
   */
  async function* oneAtATime(
    held: { bytes: Uint8Array | null },
    rest: readonly ToolFile[],
    convert: (bytes: Uint8Array, file: number) => Promise<Uint8Array>,
    onProgress?: (done: number, total: number) => void,
  ): AsyncGenerator<Uint8Array> {
    const total = rest.length + 1
    // no local keeps the first input once it is handed on
    yield await convert(take(held), 0)
    for (let i = 0; i < rest.length; i++) {
      onProgress?.(i + 1, total)
      yield await convert(await rest[i]!.readBytes(), i + 1)
    }
    onProgress?.(total, total)
  }

  async function encrypt(bytes: Uint8Array, options: PdfToolOptions): Promise<ToolRunOutcome> {
    const qpdf = await loadQpdf()
    const restrict = options.restrict === true && !!options.permissionPassword
    // with no restriction nobody needs the owner password: random, never kept
    const ownerPassword = restrict
      ? options.permissionPassword!
      : hex(deps.randomBytes(OWNER_PASSWORD_BYTES))
    const locked = await qpdfEncrypt(qpdf.create, qpdf.wasmLocation, bytes, {
      userPassword: options.password ?? '',
      ownerPassword,
      restrict,
    })
    return (await checkToolResult('encrypt', locked)) ? { ok: true, files: [pdf(locked)] } : FAILED
  }

  async function decrypt(bytes: Uint8Array, password: string): Promise<ToolRunOutcome> {
    const m = await loadPdfium()
    const opens = pdfiumOpens(m, bytes, password)
    if (opens === 'wrong-password') return { ok: false, reason: 'wrong-password' }
    const qpdf = await loadQpdf()
    // PDFium has already answered for this password
    const open = await qpdfDecrypt(qpdf.create, qpdf.wasmLocation, bytes, password, () => opens)
    return (await checkToolResult('decrypt', open)) ? { ok: true, files: [pdf(open)] } : FAILED
  }

  async function repair(bytes: Uint8Array): Promise<ToolRunOutcome> {
    const m = await loadPdfium()
    let made: Uint8Array | null = null
    try {
      const rewritten = repairPdfBytes(m, bytes).bytes
      if (await checkToolResult('repair', rewritten)) made = rewritten
    } catch (err) {
      if (isOutOfMemory(err)) throw err
    }
    if (!made) {
      // PDFium gave up: keep the whole pages pdf-lib can still read
      const salvaged = await salvagePdfBytes(bytes)
      if (salvaged && (await checkToolResult('repair', salvaged.bytes))) made = salvaged.bytes
    }
    return made ? { ok: true, files: [pdf(made)] } : { ok: false, reason: 'repair-failed' }
  }

  async function runChecked(
    tool: PdfToolId,
    files: readonly ToolFile[],
    held: { bytes: Uint8Array | null },
    options: PdfToolOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ToolRunOutcome> {
    // merge and images to PDF take the first input from `held` and drop it once it is used
    const first = () => held.bytes!
    switch (tool) {
      case 'merge': {
        const { merged } = await mergePdfInOrder(
          oneAtATime(held, files.slice(1), async (bytes) => bytes, onProgress),
        )
        return { ok: true, files: [pdf(merged)] }
      }
      case 'imagesToPdf': {
        const paper = options.imagePaper ?? 'A4'
        const made = await imagesToPdfFrom(
          oneAtATime(
            held,
            files.slice(1),
            async (bytes, index) => {
              if (readImageInfo(bytes)) return bytes
              // a photo of another kind this web view decodes: stored again as a JPEG
              const jpeg = await deps.pictures.toJpeg(bytes, files[index]!.mime)
              if (!jpeg) throw new Error('not a picture')
              return jpeg
            },
            onProgress,
          ),
          {
            paper: paper === 'image' ? null : PAPER_POINTS[paper],
            marginPt: MARGIN_POINTS[options.margin ?? 'small'],
          },
        )
        return { ok: true, files: [pdf(made)] }
      }
      case 'split': {
        const split = await runSplitPdfTool(first(), files[0]!.name, options, {
          ...(onProgress ? { onProgress } : {}),
        })
        return {
          ok: true,
          files: split.parts.map((bytes, i) => ({
            name: split.names[i]!,
            mime: 'application/pdf',
            bytes,
          })),
          ...(split.oversizedPages.length > 0 ? { oversizedPages: split.oversizedPages } : {}),
        }
      }
      case 'encrypt':
        return encrypt(first(), options)
      case 'decrypt':
        return decrypt(first(), options.password ?? '')
      case 'repair':
        return repair(first())
      default: {
        const bytes = first()
        const made = await runPdfTool(tool, [bytes], options, {
          engine,
          recode: deps.pictures.recode,
          ...(onProgress ? { onProgress } : {}),
        })
        return {
          ok: true,
          files: made.map((out) =>
            tool === 'toText' ? { name: '', mime: 'text/plain', bytes: out } : pdf(out),
          ),
          ...(tool === 'compress' ? { sizeBefore: bytes.length } : {}),
        }
      }
    }
  }

  return {
    async inspect(bytes, mime, tool) {
      const kind = toolInputKind(tool)
      try {
        const info = await inspectToolInput(bytes, kind, toolAccepts(tool))
        if (info.ok || kind !== 'image') return info
        // not a JPEG or PNG: a photo this web view decodes goes in as a JPEG
        return (await deps.pictures.decodable(bytes, mime))
          ? { ok: true, pages: 1 }
          : { ok: false, problem: 'not-image' }
      } catch (err) {
        if (isOutOfMemory(err)) return { ok: false, problem: 'too-large' }
        return { ok: false, problem: kind === 'image' ? 'not-image' : 'unreadable' }
      }
    },

    async run(tool, files, raw, onProgress) {
      try {
        const used = toolTakesMany(tool) ? files : files.slice(0, 1)
        if (used.length === 0 || used.length < toolMinInputs(tool)) return FAILED
        const held: { bytes: Uint8Array | null } = { bytes: await used[0]!.readBytes() }
        // the options are checked again against the file as it is now (the PC does the same)
        const kind = toolInputKind(tool)
        let pages = 1
        if (kind === 'pdf') {
          const info = await inspectToolInput(held.bytes!, kind, toolAccepts(tool))
          if (!info.ok) return FAILED
          pages = info.pages
        }
        const checked = checkOptions(tool, raw, pages)
        if (!checked.ok) return FAILED
        const outcome = await runChecked(tool, used, held, checked.options, onProgress)
        if (!outcome.ok || tool === 'split') return outcome
        const names = outputNames(tool, used[0]!.name, outcome.files.length, checked.options)
        return { ...outcome, files: outcome.files.map((f, i) => ({ ...f, name: names[i]! })) }
      } catch (err) {
        return failureOf(err)
      }
    },

    async findBlankPages(bytes, onProgress) {
      try {
        const m = await loadPdfium()
        const found = await withPdfiumDocument(m, bytes, null, (doc) =>
          findBlankPagesIn(m, doc, onProgress),
        )
        return {
          ok: true,
          pageCount: found.pageCount,
          candidates: found.candidates.map((c) => ({
            page: c.page,
            reason: c.reason,
            thumb: c.thumb ? bgraToRgba(c.thumb) : null,
          })),
        }
      } catch (err) {
        return { ok: false, reason: isOutOfMemory(err) ? 'too-large' : 'failed' }
      }
    },

    async zip(files, zipName) {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const taken = new Set<string>()
      for (const file of files) zip.file(uniqueName(file.name, taken), file.bytes, { binary: true })
      const bytes = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })
      return { name: zipName, mime: 'application/zip', bytes }
    },
  }
}

/** PDFium's BGRA thumbnail as RGBA */
export function bgraToRgba(thumb: { width: number; height: number; bgra: Uint8Array }): RgbaThumb {
  const { bgra } = thumb
  const rgba = new Uint8ClampedArray(bgra.length)
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]!
    rgba[i + 1] = bgra[i + 1]!
    rgba[i + 2] = bgra[i]!
    rgba[i + 3] = bgra[i + 3]!
  }
  return { width: thumb.width, height: thumb.height, rgba }
}

/**
 * Initialise @embedpdf/pdfium's module the way the PC does (apps/pdf
 * text-edit.ts loadPdfium): a fixed ASCII program name, then the library.
 * `overrides` says where the wasm is (locateFile in the worker, wasmBinary in
 * Node tests).
 */
export async function initPdfium(
  init: (overrides: object) => Promise<unknown>,
  overrides: object,
): Promise<EnginePdfium> {
  const wrapped = (await init({ thisProgram: 'ieum-pdf-tools', ...overrides })) as object
  const m = ('pdfium' in wrapped ? wrapped.pdfium : wrapped) as EnginePdfium & {
    _PDFiumExt_Init(): void
  }
  m._PDFiumExt_Init()
  return m
}
