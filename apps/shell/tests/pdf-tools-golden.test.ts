/**
 * Baseline of the PC PDF tools' results, recorded from the code as it was
 * before the shared package (`@genoffice/pdf-ops`) existed. Moving that code
 * must not change one PC result, so every later step runs this test against
 * the table recorded once in pdf-tools-golden.json. The table is never edited
 * to make this pass: a difference means the code changed behaviour.
 *
 * What runs, through the entry points the PC keeps by name and signature:
 * - `runPdfTool` / `runSplitPdfTool` for every tool they run in-process,
 *   `outputNames` for every tool, `checkOptions` on valid input and on each
 *   error, and the small helpers the tools window reads (tools.ts);
 * - the PDF job process's work, called directly: `findBlankPages`
 *   (blank-pages.ts), `encryptPdfBytes` / `decryptPdfBytes` (qpdf.ts),
 *   `repairPdfBytes` / `salvagePdfBytes` / `pdfiumOpens` (repair.ts) and
 *   `readPdfText` (read-text.ts).
 *
 * Every case is produced twice and the two must agree before it is compared
 * with the table. How each kind of result is compared:
 * - byte-compared (SHA-256 of every output file): every runPdfTool and
 *   runSplitPdfTool output, the blank-page finder's thumbnails, qpdf's
 *   decrypted output of the fixed encrypted fixtures, PDFium's repaired
 *   output and the pdf-lib salvage output. These come out the same on every
 *   run once Date is frozen: pdf-lib seeds its own name suffixes per document
 *   and stamps its dates from the clock; PDFium writes the same /ID for the
 *   same input (checked: not from the clock or the heap); qpdf keeps the
 *   first /ID element and takes the second from the clock (Date.now through
 *   emscripten), which the frozen Date fixes. Decrypted and repaired files
 *   also carry their structure (page count, each page's text, the object
 *   digest without /ID), so a failure shows whether the content moved or
 *   only the bytes did; either fails the test.
 * - structural: encryption, always, because qpdf draws a fresh random key
 *   and salt on every run (and the PC adds a random owner password when no
 *   restriction is asked for). Recorded instead: which passwords open it
 *   (PDFium), the encryption dictionary without its random strings (so /P
 *   with and without "restrict"), and after removing the password again the
 *   page count, each page's text and a digest of every object with the
 *   trailer's /ID left out. Decrypting a file this test encrypted is
 *   structural for the same reason: its input differs on every run.
 * - plain values: option checks, names, page counts, text, candidate lists.
 *
 * Only Date is frozen (`vi.useFakeTimers({ toFake: ['Date'] })`): pdf-lib
 * waits on timer ticks while saving, so faking every timer hangs it. "Make
 * smaller" gets a fake picture recoder that answers the same bytes for the
 * same request; its requests are recorded too.
 *
 * To record the table again (only before the first commit of this file):
 * PDF_TOOLS_GOLDEN_WRITE=1 npx vitest run tests/pdf-tools-golden.test.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from 'pdf-lib'
import { loadPdfium } from '../../../packages/pdf2docx/tests/helpers/wasm'
import { withPdfDocument } from '../../../packages/pdf2docx/src/extract/pdfium'
import { findBlankPages } from '../../pdf/src/main/blank-pages'
import { decryptPdfBytes, encryptPdfBytes } from '../../pdf/src/main/qpdf'
import {
  pdfiumOpens,
  repairPdfBytes,
  salvagePdfBytes,
  type RepairPdfium,
} from '../../pdf/src/main/repair'
import { readPdfText, type ReadPdfTextOptions } from '../../pdf/src/main/read-text'
import { qpdfWasmPath } from '../../pdf/src/main/wasm-path'
import type { ImageRecoder } from '../../pdf/src/main/compress'
import {
  DEFAULT_ANNOT_KINDS,
  MAX_PASSWORD_BYTES,
  MAX_TOOL_INPUT_BYTES,
  PdfToolRefusal,
  checkOptions,
  encryptedPageCount,
  foundBlankPagesOf,
  inspectImage,
  inspectPdf,
  isPdfToolId,
  jobBytesOf,
  jobFor,
  outputNames,
  pagesToText,
  readBookmarksBytes,
  runPdfTool,
  runSplitPdfTool,
  splitPlanFromOptions,
  toolAccepts,
  toolInputKind,
  toolMinInputs,
  toolOutputExtension,
  toolRunsAsJob,
  toolTakesMany,
  type RunDeps,
} from '../src/main/pdf-tools/tools'
import {
  PDF_TOOL_ANNOT_KINDS,
  PDF_TOOL_IDS,
  PDF_TOOL_MARGINS,
  PDF_TOOL_PAPERS,
  PDF_TOOL_SHEET_PAGES,
  type PdfToolId,
  type PdfToolOptions,
} from '../src/shared/pdf-tools-api'
import {
  backgroundPdf,
  blankCandidatesPdf,
  compressSample,
  jpeg,
  manyEmptyPages,
  plainPages,
  png,
  richPdf,
  shiftedXref,
  textPdf,
  wrongStartxref,
} from './helpers/pdf-tools-fixtures'

const GOLDEN_PATH = fileURLToPath(new URL('./pdf-tools-golden.json', import.meta.url))
const WRITE = process.env.PDF_TOOLS_GOLDEN_WRITE === '1'
const FIXED_NOW = new Date('2026-01-02T03:04:05Z')

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const shaText = (text: string): string => sha(new TextEncoder().encode(text))
/** a value as the JSON table holds it (undefined fields dropped) */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown

const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))))

interface Samples {
  rich: Uint8Array
  text3: Uint8Array
  noText: Uint8Array
  plain6: Uint8Array
  plainSample: Uint8Array
  background: Uint8Array
  blank: Uint8Array
  manyEmpty: Uint8Array
  compress: Uint8Array
  tight: Uint8Array
  pngRgb: Uint8Array
  pngWide: Uint8Array
  pngRgba: Uint8Array
  jpegPlain: Uint8Array
  jpegTurned: Uint8Array
  jpegMirrored: Uint8Array
  shifted: Uint8Array
  badStartxref: Uint8Array
  truncated: Uint8Array
  truncatedRich: Uint8Array
  junk: Uint8Array
  corrupt: Uint8Array
  enc256: Uint8Array
  enc128: Uint8Array
  encRc4: Uint8Array
  encR3: Uint8Array
  encR4: Uint8Array
  encR5: Uint8Array
  encOwnerOnly: Uint8Array
  encSpaces: Uint8Array
}

let s: Samples

const goldenTable: { entries: Record<string, unknown> } =
  !WRITE || existsSync(GOLDEN_PATH)
    ? (JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as { entries: Record<string, unknown> })
    : { entries: {} }
const recorded: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// How results are described

interface FileRecord {
  sha256: string
  size: number
}

const fileRecord = (bytes: Uint8Array): FileRecord => ({ sha256: sha(bytes), size: bytes.length })

/** What a thrown error says; a tool's refusal by its reason */
function errorRecord(err: unknown): unknown {
  if (err instanceof PdfToolRefusal) return { refused: err.reason }
  if (err instanceof Error || (err && typeof err === 'object' && 'message' in err)) {
    const e = err as Error & { code?: unknown; reason?: unknown }
    return {
      error: e.name,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
      ...(e.reason !== undefined ? { reason: e.reason } : {}),
    }
  }
  return { error: String(err) }
}

/** Run a tool and describe what it made; the inputs must come out untouched */
async function outcome(
  inputs: Uint8Array[],
  make: () => Promise<unknown>,
  describeMade: (made: never) => unknown,
): Promise<unknown> {
  const before = inputs.map(sha)
  let result: unknown
  try {
    result = await describeMade((await make()) as never)
  } catch (err) {
    result = errorRecord(err)
  }
  expect(inputs.map(sha), 'a tool changed its source bytes').toEqual(before)
  return result
}

/** The window's own check of the options, which must pass */
function checked(tool: PdfToolId, raw: unknown, pageCount: number, bg = 1): PdfToolOptions {
  const result = checkOptions(tool, raw, pageCount, bg)
  if (!result.ok) throw new Error(`options refused: ${result.error}`)
  return result.options
}

async function runTool(
  tool: PdfToolId,
  inputs: Uint8Array[],
  options: PdfToolOptions,
  deps: RunDeps = {},
): Promise<unknown> {
  return outcome(
    inputs,
    () => runPdfTool(tool, inputs, options, deps),
    (files: Uint8Array[]) => ({
      files: files.map((bytes) =>
        tool === 'toText'
          ? { ...fileRecord(bytes), text: new TextDecoder().decode(bytes) }
          : fileRecord(bytes),
      ),
    }),
  )
}

async function runSplit(
  input: Uint8Array,
  sourceName: string,
  options: PdfToolOptions,
): Promise<unknown> {
  const progress: [number, number][] = []
  const result = await outcome(
    [input],
    () =>
      runSplitPdfTool(input, sourceName, options, { onProgress: (d, t) => progress.push([d, t]) }),
    (made: { parts: Uint8Array[]; names: string[]; oversizedPages: number[] }) => ({
      names: made.names,
      parts: made.parts.map(fileRecord),
      oversizedPages: made.oversizedPages,
    }),
  )
  return { result, progress }
}

/** A PDF object as JSON, leaving out the keys listed (random strings) */
function objectJson(value: PDFObject | undefined, omit: ReadonlySet<string> = new Set()): unknown {
  if (value === undefined) return null
  if (value instanceof PDFNumber) return value.asNumber()
  if (value instanceof PDFName) return `/${value.decodeText()}`
  if (value instanceof PDFBool) return value.asBoolean()
  if (value === PDFNull) return null
  if (value instanceof PDFRef) return `ref ${value.toString()}`
  if (value instanceof PDFString || value instanceof PDFHexString) return `(${value.decodeText()})`
  if (value instanceof PDFArray) return value.asArray().map((item) => objectJson(item, omit))
  if (value instanceof PDFDict) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of value.entries()) {
      const name = key.decodeText()
      if (!omit.has(name)) out[name] = objectJson(item, omit)
    }
    return out
  }
  return value.toString()
}

/**
 * A digest of every indirect object in `bytes`, by number, with streams by
 * their dictionary and data; the trailer by its /Root and /Info only, so the
 * file's /ID (which may change between runs) does not count.
 */
async function objectDigest(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const lines: string[] = []
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFStream) {
      const dict = object.dict
      if (dict.lookup(PDFName.of('Type')) === PDFName.of('XRef')) continue
      lines.push(`${ref.toString()} ${dict.toString()} stream ${sha(object.getContents())}`)
    } else {
      lines.push(`${ref.toString()} ${object.toString()}`)
    }
  }
  const trailer = doc.context.trailerInfo
  lines.push(`trailer root ${String(trailer.Root)} info ${String(trailer.Info)}`)
  return shaText(lines.join('\n'))
}

/** Page count, each page's text and the object digest of an open (not encrypted) PDF */
async function openedShape(bytes: Uint8Array): Promise<unknown> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const text = await readPdfText(bytes)
  return {
    pages: doc.getPageCount(),
    text: text.pages.map((page) => page.text),
    objects: await objectDigest(bytes),
  }
}

/** The encryption dictionary without its random strings */
async function encryptionDict(bytes: Uint8Array): Promise<unknown> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const raw = doc.context.trailerInfo.Encrypt
  const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw
  return objectJson(dict as PDFObject | undefined, new Set(['O', 'U', 'OE', 'UE', 'Perms']))
}

// ---------------------------------------------------------------------------
// The engines the PDF job process uses

const pdfium = async () => (await loadPdfium()) as unknown as RepairPdfium
const opener =
  (m: RepairPdfium) =>
  (bytes: Uint8Array, password: string): 'ok' | 'wrong-password' | 'unreadable' =>
    pdfiumOpens(m, bytes, password)

async function blankPages(bytes: Uint8Array, digestOnly = false): Promise<unknown> {
  const m = await loadPdfium()
  const progress: [number, number][] = []
  // the job process opens the file the same way (jobs.ts, 'blankPages')
  const found = withPdfDocument(m, bytes, (doc) =>
    findBlankPages(m, doc, (done, total) => progress.push([done, total])),
  )
  const candidates = found.candidates.map((c) => ({
    page: c.page,
    reason: c.reason,
    thumb: c.thumb
      ? { width: c.thumb.width, height: c.thumb.height, sha256: sha(c.thumb.bgra) }
      : null,
  }))
  // the window reads the job's answer through this check: it must take it whole
  // (compared by count: a deep compare of every thumbnail's pixels is very slow)
  expect(foundBlankPagesOf(found)?.candidates.length).toBe(found.candidates.length)
  if (!digestOnly) return { pageCount: found.pageCount, candidates, progress }
  return {
    pageCount: found.pageCount,
    candidateCount: candidates.length,
    withThumb: candidates.filter((c) => c.thumb).length,
    candidates: shaText(JSON.stringify(candidates)),
    progress: shaText(JSON.stringify(progress)),
  }
}

async function decrypt(bytes: Uint8Array, password: string): Promise<unknown> {
  const m = await pdfium()
  return outcome(
    [bytes],
    () => decryptPdfBytes(qpdfWasmPath(), bytes, password, opener(m)),
    async (open: Uint8Array) => ({
      file: fileRecord(open),
      inspect: await inspectPdf(open),
      opened: await openedShape(open),
    }),
  )
}

/** Lock `bytes` and describe the result by structure (it differs on every run) */
async function encrypt(bytes: Uint8Array, user: string, owner?: string): Promise<unknown> {
  const m = await pdfium()
  const before = sha(bytes)
  const locked = await encryptPdfBytes(qpdfWasmPath(), bytes, {
    userPassword: user,
    ...(owner !== undefined ? { ownerPassword: owner } : {}),
  })
  expect(sha(bytes)).toBe(before)
  const unlocked = await decryptPdfBytes(qpdfWasmPath(), locked, user, opener(m))
  let wrong: unknown = null
  try {
    await decryptPdfBytes(qpdfWasmPath(), locked, `${user}x`, opener(m))
  } catch (err) {
    wrong = errorRecord(err)
  }
  return {
    inspect: await inspectPdf(locked),
    encryptedPageCount: await encryptedPageCount(locked),
    opens: {
      none: pdfiumOpens(m, locked, ''),
      wrong: pdfiumOpens(m, locked, `${user}x`),
      user: pdfiumOpens(m, locked, user),
      owner: owner !== undefined ? pdfiumOpens(m, locked, owner) : null,
    },
    encryption: await encryptionDict(locked),
    decryptWithWrongPassword: wrong,
    unlocked: await openedShape(unlocked),
    unlockedWithOwner:
      owner !== undefined
        ? await openedShape(await decryptPdfBytes(qpdfWasmPath(), locked, owner, opener(m)))
        : null,
  }
}

async function repair(bytes: Uint8Array): Promise<unknown> {
  const m = await pdfium()
  const before = sha(bytes)
  let repaired: unknown
  try {
    const made = repairPdfBytes(m, bytes)
    repaired = {
      file: fileRecord(made.bytes),
      pages: made.pages,
      opened: await openedShape(made.bytes),
    }
  } catch (err) {
    repaired = errorRecord(err)
  }
  let salvaged: unknown
  try {
    const made = await salvagePdfBytes(bytes)
    salvaged = made
      ? { file: fileRecord(made.bytes), pages: made.pages, opened: await openedShape(made.bytes) }
      : null
  } catch (err) {
    salvaged = errorRecord(err)
  }
  expect(sha(bytes)).toBe(before)
  return {
    opens: { none: pdfiumOpens(m, bytes, ''), wrong: pdfiumOpens(m, bytes, 'wrong') },
    inspect: await inspectPdf(bytes),
    repaired,
    salvaged,
  }
}

async function text(bytes: Uint8Array, options?: ReadPdfTextOptions): Promise<unknown> {
  try {
    return await readPdfText(bytes, options)
  } catch (err) {
    return errorRecord(err)
  }
}

/** A recoder that halves each picture into a stub JPEG sized by the quality asked for */
function fakeRecoder(log: unknown[]): ImageRecoder {
  return async (source, target) => {
    log.push({
      kind: source.kind,
      width: source.width,
      height: source.height,
      components: source.kind === 'raw' ? source.components : null,
      data: sha(source.kind === 'jpeg' ? source.bytes : source.samples),
      target,
    })
    // a grey picture it "cannot" do: the original stays
    if (source.kind === 'raw' && source.components === 1) return null
    const scale = Math.min(1, target.longSide / Math.max(source.width, source.height))
    const width = Math.max(1, Math.round((source.width * scale) / 2))
    const height = Math.max(1, Math.round((source.height * scale) / 2))
    return { jpeg: jpeg(width, height, target.quality * 10), width, height }
  }
}

async function compress(
  bytes: Uint8Array,
  options: PdfToolOptions,
  deps: { recoder?: 'fake' | 'null' | 'none'; aborted?: boolean } = {},
): Promise<unknown> {
  const log: unknown[] = []
  const progress: [number, number][] = []
  const recode: ImageRecoder | undefined =
    deps.recoder === 'none'
      ? undefined
      : deps.recoder === 'null'
        ? async () => null
        : fakeRecoder(log)
  const result = await runTool('compress', [bytes], options, {
    ...(recode ? { recode } : {}),
    onProgress: (done, total) => progress.push([done, total]),
    ...(deps.aborted ? { signal: AbortSignal.abort() } : {}),
  })
  return { result, requests: log, progress }
}

// ---------------------------------------------------------------------------
// The cases

const cases: [string, () => Promise<unknown>][] = []
const add = (key: string, run: () => Promise<unknown> | unknown) =>
  cases.push([key, async () => run()])

add('samples', () =>
  Object.fromEntries(Object.entries(s).map(([name, bytes]) => [name, sha(bytes as Uint8Array)])),
)

add('constants', () => ({
  MAX_TOOL_INPUT_BYTES,
  MAX_PASSWORD_BYTES,
  DEFAULT_ANNOT_KINDS,
  PDF_TOOL_IDS,
  PDF_TOOL_PAPERS,
  PDF_TOOL_MARGINS,
  PDF_TOOL_SHEET_PAGES,
  PDF_TOOL_ANNOT_KINDS,
}))

add('tool-table', () =>
  Object.fromEntries(
    PDF_TOOL_IDS.map((tool) => [
      tool,
      {
        isPdfToolId: isPdfToolId(tool),
        takesMany: toolTakesMany(tool),
        minInputs: toolMinInputs(tool),
        accepts: toolAccepts(tool),
        runsAsJob: toolRunsAsJob(tool),
        inputKind: toolInputKind(tool),
        outputExtension: toolOutputExtension(tool),
      },
    ]),
  ),
)

add('is-pdf-tool-id', () =>
  ['merge', 'stamps', 'crop', 'MERGE', '', null, undefined, 3].map((v) => isPdfToolId(v)),
)

add('inspect', async () => ({
  rich: await inspectPdf(s.rich),
  text3: await inspectPdf(s.text3),
  plainSample: await inspectPdf(s.plainSample),
  enc256: await inspectPdf(s.enc256),
  encOwnerOnly: await inspectPdf(s.encOwnerOnly),
  shifted: await inspectPdf(s.shifted),
  truncated: await inspectPdf(s.truncated),
  corrupt: await inspectPdf(s.corrupt),
  junk: await inspectPdf(s.junk),
  empty: await inspectPdf(new Uint8Array(0)),
  imagePng: inspectImage(s.pngRgb),
  imageJpeg: inspectImage(s.jpegTurned),
  imageNot: inspectImage(s.rich),
  encryptedPageCount: {
    enc256: await encryptedPageCount(s.enc256),
    encR5: await encryptedPageCount(s.encR5),
    rich: await encryptedPageCount(s.rich),
    junk: await encryptedPageCount(s.junk),
  },
}))

add('bookmarks', async () => ({
  rich: await readBookmarksBytes(s.rich),
  text3: await readBookmarksBytes(s.text3),
}))

// checkOptions: [tool, raw options, page count, background pages]
const OPTION_CASES: [PdfToolId, unknown, number, number?][] = [
  ['split', {}, 8],
  ['split', null, 8],
  ['split', { chunkSize: 3 }, 8],
  ['split', { chunkSize: 0 }, 8],
  ['split', { chunkSize: 9 }, 8],
  ['split', { chunkSize: 2.5 }, 8],
  ['split', { splitMode: 'ranges', splitRanges: '1-2, 4-6' }, 8],
  ['split', { splitMode: 'ranges', splitRanges: '6-4,1', splitMergeRanges: true }, 8],
  ['split', { splitMode: 'ranges', splitRanges: '1-9' }, 8],
  ['split', { splitMode: 'ranges', splitRanges: '' }, 8],
  ['split', { splitMode: 'ranges', splitRanges: 'a-b' }, 8],
  ['split', { splitMode: 'fixed', splitFixedKind: 'fileCount', splitFixedValue: 3 }, 8],
  ['split', { splitMode: 'fixed', splitFixedValue: 99, splitPattern: 'range' }, 8],
  ['split', { splitMode: 'fixed', chunkSize: 4, splitPrefix: '  Part  ' }, 8],
  ['split', { splitMode: 'odd', splitPattern: 'weird', splitCreateSubfolder: 'yes' }, 8],
  ['split', { splitMode: 'bookmarks' }, 8],
  [
    'split',
    {
      splitMode: 'bookmarks',
      splitBookmarkLevel: 2,
      splitIncludeLeading: false,
      splitPattern: 'bookmark',
      splitCreateSubfolder: true,
    },
    8,
  ],
  ['split', { splitMode: 'bookmarks', splitBookmarkLevel: 3 }, 8],
  ['split', { splitMode: 'maxSize', splitMaxBytes: 100 }, 8],
  ['split', { splitMode: 'maxSize', splitMaxBytes: 10 * 1024 }, 8],
  ['split', { splitMode: 'maxSize', splitMaxBytes: 20480.6 }, 8],
  ['split', { splitMode: 'maxSize', splitMaxBytes: 2 * 1024 * 1024 * 1024 }, 8],
  ['split', { splitMode: 'maxSize' }, 8],
  ['extract', { pages: '3-1, 5' }, 8],
  ['extract', { pages: '8,1,1' }, 8],
  ['extract', { pages: '2-9' }, 8],
  ['extract', { pages: 'abc' }, 8],
  ['extract', {}, 8],
  ['extract', { pages: '1；3、5' }, 8],
  ['reverse', { pages: '1', chunkSize: 2 }, 8],
  ['nup', {}, 8],
  ['nup', { perSheet: 9, direction: 'vertical', separator: true }, 8],
  ['nup', { perSheet: 40, direction: 'diagonal', separator: 'yes' }, 8],
  ['nup', { perSheet: 1 }, 8],
  ['rotate', {}, 8],
  ['rotate', { rotation: 180 }, 8],
  ['rotate', { rotation: 270 }, 8],
  ['rotate', { rotation: 45 }, 8],
  ['pageSize', {}, 8],
  ['pageSize', { paper: 'Legal' }, 8],
  ['pageSize', { paper: 'B5' }, 8],
  ['splitPages', {}, 8],
  ['splitPages', { perPage: 4 }, 8],
  ['splitPages', { perPage: 9 }, 8],
  ['splitPages', { perPage: 3 }, 8],
  ['imagesToPdf', {}, 1],
  ['imagesToPdf', { imagePaper: 'image', margin: 'none' }, 1],
  ['imagesToPdf', { imagePaper: 'Letter', margin: 'large' }, 1],
  ['imagesToPdf', { imagePaper: 'B5', margin: 'huge' }, 1],
  ['toText', { pages: '1' }, 3],
  ['duplex', {}, 3],
  ['duplex', { sheetPages: 4 }, 3],
  ['duplex', { sheetPages: 3 }, 3],
  ['overlay', {}, 8, 2],
  ['overlay', { layer: 'front', backgroundPage: 2, applyPages: '3,1' }, 8, 2],
  ['overlay', { layer: 'side', backgroundPage: 5 }, 8, 2],
  ['overlay', { applyPages: '9' }, 8, 2],
  ['overlay', { applyPages: '   ' }, 8, 2],
  ['stripAnnots', {}, 8],
  ['stripAnnots', { annotKinds: ['links', 'bogus'], applyPages: '3' }, 8],
  ['stripAnnots', { annotKinds: [] }, 8],
  ['stripAnnots', { annotKinds: 'comments' }, 8],
  ['stripAnnots', { applyPages: '0' }, 8],
  ['blankPages', { removePages: '4, 2,2,9' }, 8],
  ['blankPages', { removePages: '' }, 8],
  ['blankPages', {}, 8],
  ['blankPages', { removePages: '1,2' }, 2],
  ['blankPages', { removePages: '1.5, x' }, 8],
  ['compress', {}, 3],
  ['compress', { compressLevel: 'light' }, 3],
  ['compress', { compressLevel: 'strong' }, 3],
  ['compress', { compressLevel: 'max' }, 3],
  ['encrypt', { password: ' a b ', passwordConfirm: 'x' }, 1],
  ['encrypt', { password: '' }, 1],
  ['encrypt', {}, 1],
  ['encrypt', { password: 'a', restrict: true }, 1],
  ['encrypt', { password: 'a', restrict: true, permissionPassword: 'a' }, 1],
  ['encrypt', { password: 'a', restrict: true, permissionPassword: 'b' }, 1],
  ['encrypt', { password: 'a', restrict: false, permissionPassword: 'b' }, 1],
  ['encrypt', { password: '가'.repeat(42) }, 1],
  ['encrypt', { password: '가'.repeat(43) }, 1],
  ['encrypt', { password: 'a', restrict: true, permissionPassword: 'b'.repeat(128) }, 1],
  ['decrypt', {}, 1],
  ['decrypt', { password: 'p', restrict: true }, 1],
  ['repair', { password: 'p' }, 0],
  ['merge', { pages: '1' }, 3],
]

add('check-options', () =>
  OPTION_CASES.map(([tool, raw, pageCount, bg]) => ({
    tool,
    raw,
    pageCount,
    ...(bg !== undefined ? { bg } : {}),
    result:
      bg !== undefined
        ? checkOptions(tool, raw, pageCount, bg)
        : checkOptions(tool, raw, pageCount),
  })),
)

add('output-names', () => {
  const rows: unknown[] = []
  for (const tool of PDF_TOOL_IDS) {
    for (const source of ['Report.pdf', 'Photo 1.JPEG', 'scan.png', 'x.jpg', '.pdf', 'notes']) {
      rows.push({ tool, source, names: outputNames(tool, source, 1, {}) })
    }
  }
  const options: [PdfToolId, string, number, PdfToolOptions][] = [
    ['split', 'a.pdf', 3, {}],
    ['split', 'a.pdf', 12, {}],
    ['split', 'a.pdf', 100, {}],
    ['split', 'Book.pdf', 2, { splitPrefix: 'Chapter' }],
    ['split', 'Book.pdf', 2, { splitPrefix: 'a/b:c*?"<>|' }],
    ['split', 'Book.pdf', 2, { splitPrefix: 'x'.repeat(80) }],
    ['nup', 'a.pdf', 1, { perSheet: 4 }],
    ['nup', 'a.pdf', 1, { perSheet: 16 }],
    ['pageSize', 'a.pdf', 1, { paper: 'Letter' }],
    ['pageSize', 'a.pdf', 1, { paper: 'A3' }],
  ]
  for (const [tool, source, count, opts] of options) {
    rows.push({ tool, source, count, opts, names: outputNames(tool, source, count, opts) })
  }
  return rows
})

add('split-plan', () =>
  [
    {},
    { chunkSize: 3 },
    { splitMode: 'ranges', splitRanges: '1-2, 4-6', splitMergeRanges: true },
    { splitMode: 'ranges', splitRanges: '1-99' },
    { splitMode: 'fixed', splitFixedKind: 'fileCount', splitFixedValue: 3 },
    { splitMode: 'fixed', chunkSize: 2 },
    { splitMode: 'bookmarks', splitBookmarkLevel: 2, splitIncludeLeading: false },
    { splitMode: 'bookmarks' },
    { splitMode: 'maxSize', splitMaxBytes: 20000 },
    { splitMode: 'maxSize' },
  ].map((options) => splitPlanFromOptions(options as PdfToolOptions, 8)),
)

add('job-for', () => ({
  repair: jobFor('repair', 'C:/x/a.pdf', { password: 'ignored' }),
  decrypt: jobFor('decrypt', 'a.pdf', { password: 'p' }),
  decryptEmpty: jobFor('decrypt', 'a.pdf', {}),
  encrypt: jobFor('encrypt', 'a.pdf', { password: 'a', permissionPassword: 'b' }),
  encryptRestrict: jobFor('encrypt', 'a.pdf', {
    password: 'a',
    restrict: true,
    permissionPassword: 'b',
  }),
  encryptRestrictNoPermission: jobFor('encrypt', 'a.pdf', { password: 'a', restrict: true }),
}))

add('job-bytes-of', () => {
  const bytes = new Uint8Array([1, 2])
  return [
    jobBytesOf({ bytes }) === bytes,
    jobBytesOf({ bytes: new Uint8Array(0) }),
    jobBytesOf({ bytes: [1, 2] }),
    jobBytesOf(null),
    jobBytesOf({}),
  ]
})

add('found-blank-pages-of', () => {
  const thumb = { width: 2, height: 1, bgra: new Uint8Array(8) }
  const values: unknown[] = [
    { pageCount: 3, candidates: [{ page: 2, reason: 'empty', thumb }] },
    { pageCount: 3, candidates: [{ page: 3, reason: 'nearly-white', thumb: null }] },
    { pageCount: 3, candidates: [{ page: 4, reason: 'empty' }] },
    { pageCount: 3, candidates: [{ page: 1.5, reason: 'empty' }] },
    { pageCount: 3, candidates: [{ page: 1, reason: 'odd' }] },
    { pageCount: 3, candidates: [{ page: 1, reason: 'empty', thumb: { ...thumb, bgra: [] } }] },
    {
      pageCount: 3,
      candidates: [{ page: 1, reason: 'empty', thumb: { ...thumb, bgra: new Uint8Array(4) } }],
    },
    { pageCount: '3', candidates: [] },
    { pageCount: 3, candidates: [null] },
    null,
    'x',
  ]
  return values.map((value) => {
    const found = foundBlankPagesOf(value)
    return found
      ? {
          pageCount: found.pageCount,
          candidates: found.candidates.map((c) => ({
            ...c,
            thumb: c.thumb ? { ...c.thumb, bgra: sha(c.thumb.bgra) } : null,
          })),
        }
      : null
  })
})

add('pages-to-text', () => [
  pagesToText([{ text: 'a\nb  ' }, { text: '   ' }, { text: 'c' }]),
  pagesToText([]),
  pagesToText([{ text: '\n\nx\n\n' }]),
])

// ---- runPdfTool, every in-process tool

add('run/merge/rich+text3', () => runTool('merge', [s.rich, s.text3], {}))
add('run/merge/plain-sample+rich+background', () =>
  runTool('merge', [s.plainSample, s.rich, s.background], {}),
)
add('run/merge/one-input', () => runTool('merge', [s.text3], {}))
add('run/no-input', () => runTool('merge', [], {}))

add('run/split/default', () => runTool('split', [s.rich], checked('split', {}, 8)))
add('run/split/chunk-3', () => runTool('split', [s.rich], checked('split', { chunkSize: 3 }, 8)))
add('run/split/ranges', () =>
  runTool('split', [s.rich], checked('split', { splitMode: 'ranges', splitRanges: '1-2,5-8' }, 8)),
)
add('run/split/bookmarks', () =>
  runTool('split', [s.rich], checked('split', { splitMode: 'bookmarks' }, 8)),
)
add('run/split/no-bookmarks', () =>
  runTool('split', [s.text3], checked('split', { splitMode: 'bookmarks' }, 3)),
)

add('split/ranges-range-names', () =>
  runSplit(
    s.rich,
    'Report.pdf',
    checked('split', { splitMode: 'ranges', splitRanges: '1-2, 5-6', splitPattern: 'range' }, 8),
  ),
)
add('split/ranges-merged', () =>
  runSplit(
    s.rich,
    'Report.pdf',
    checked('split', { splitMode: 'ranges', splitRanges: '6-8, 1-2', splitMergeRanges: true }, 8),
  ),
)
add('split/ranges-overlap', () =>
  runSplit(
    s.rich,
    'Report.pdf',
    checked('split', { splitMode: 'ranges', splitRanges: '1-4, 3-5, 8' }, 8),
  ),
)
add('split/fixed-pages-per-file-prefix', () =>
  runSplit(
    s.rich,
    'Report.pdf',
    checked(
      'split',
      {
        splitMode: 'fixed',
        splitFixedKind: 'pagesPerFile',
        splitFixedValue: 3,
        splitPrefix: 'Part',
      },
      8,
    ),
  ),
)
add('split/fixed-file-count', () =>
  runSplit(
    s.rich,
    'Report.pdf',
    checked('split', { splitMode: 'fixed', splitFixedKind: 'fileCount', splitFixedValue: 3 }, 8),
  ),
)
add('split/fixed-range-names-subfolder', () =>
  runSplit(
    s.plain6,
    'Six pages.pdf',
    checked(
      'split',
      {
        splitMode: 'fixed',
        splitFixedValue: 4,
        splitPattern: 'range',
        splitCreateSubfolder: true,
      },
      6,
    ),
  ),
)
add('split/fixed-twelve-parts', () =>
  runSplit(
    s.manyEmpty,
    'many.pdf',
    checked('split', { splitMode: 'fixed', splitFixedKind: 'fileCount', splitFixedValue: 12 }, 125),
  ),
)
add('split/bookmarks-level-1-with-leading', () =>
  runSplit(
    s.rich,
    'Book.pdf',
    checked(
      'split',
      { splitMode: 'bookmarks', splitBookmarkLevel: 1, splitPattern: 'bookmark' },
      8,
    ),
  ),
)
add('split/bookmarks-level-2-no-leading', () =>
  runSplit(
    s.rich,
    'Book.pdf',
    checked(
      'split',
      {
        splitMode: 'bookmarks',
        splitBookmarkLevel: 2,
        splitIncludeLeading: false,
        splitPattern: 'bookmark',
      },
      8,
    ),
  ),
)
add('split/bookmarks-numbered-prefix', () =>
  runSplit(
    s.rich,
    'Book.pdf',
    checked('split', { splitMode: 'bookmarks', splitPrefix: '장 ', splitPattern: 'numbered' }, 8),
  ),
)
add('split/bookmarks-none', () =>
  runSplit(s.plain6, 'Plain.pdf', checked('split', { splitMode: 'bookmarks' }, 6)),
)
add('split/max-size-10k-rich', () =>
  runSplit(
    s.rich,
    'Sized.pdf',
    checked('split', { splitMode: 'maxSize', splitMaxBytes: 10240 }, 8),
  ),
)
add('split/max-size-20k-compress-sample', () =>
  runSplit(
    s.compress,
    'Pictures.pdf',
    checked('split', { splitMode: 'maxSize', splitMaxBytes: 20480, splitPattern: 'range' }, 2),
  ),
)
add('split/max-size-generous', () =>
  runSplit(
    s.rich,
    'Sized.pdf',
    checked('split', { splitMode: 'maxSize', splitMaxBytes: 50 * 1024 * 1024 }, 8),
  ),
)
add('split/max-size-unchecked-too-small', () =>
  runSplit(s.rich, 'Sized.pdf', { splitMode: 'maxSize', splitMaxBytes: 100 }),
)
add('split/legacy-chunk', () => runSplit(s.rich, 'Old.pdf', { chunkSize: 5 }))

add('run/extract/some', () =>
  runTool('extract', [s.rich], checked('extract', { pages: '2,4-5,8' }, 8)),
)
add('run/extract/reordered-input', () =>
  runTool('extract', [s.rich], checked('extract', { pages: '8,3-1' }, 8)),
)
add('run/extract/form-page', () =>
  runTool('extract', [s.rich], checked('extract', { pages: '3' }, 8)),
)
add('run/extract/unchecked-order', () => runTool('extract', [s.rich], { pages: '8,1,3' }))

add('run/reverse/rich', () => runTool('reverse', [s.rich], {}))
add('run/reverse/plain-sample', () => runTool('reverse', [s.plainSample], {}))

for (const rotation of [90, 180, 270] as const) {
  add(`run/rotate/${rotation}/rich`, () =>
    runTool('rotate', [s.rich], checked('rotate', { rotation }, 8)),
  )
  add(`run/rotate/${rotation}/plain-sample`, () =>
    runTool('rotate', [s.plainSample], checked('rotate', { rotation }, 1)),
  )
}
add('run/rotate/default', () => runTool('rotate', [s.text3], {}))

for (const [perSheet, direction, separator] of [
  [2, 'horizontal', false],
  [3, 'horizontal', false],
  [4, 'vertical', true],
  [6, 'horizontal', true],
  [9, 'vertical', false],
  [16, 'horizontal', false],
] as const) {
  add(`run/nup/${perSheet}-${direction}-${separator ? 'lines' : 'plain'}`, () =>
    runTool('nup', [s.rich], checked('nup', { perSheet, direction, separator }, 8)),
  )
}
add('run/nup/defaults', () => runTool('nup', [s.text3], {}))

for (const paper of PDF_TOOL_PAPERS) {
  add(`run/page-size/${paper}`, () =>
    runTool('pageSize', [s.rich], checked('pageSize', { paper }, 8)),
  )
}
add('run/page-size/default', () => runTool('pageSize', [s.plainSample], {}))

for (const perPage of [2, 4, 9] as const) {
  add(`run/split-pages/${perPage}`, () =>
    runTool('splitPages', [s.rich], checked('splitPages', { perPage }, 8)),
  )
}
add('run/split-pages/default', () => runTool('splitPages', [s.text3], {}))

const mixedImages = () => [s.pngRgb, s.jpegTurned, s.jpegPlain, s.pngWide]
for (const [paper, margin] of [
  ['A4', 'small'],
  ['A5', 'large'],
  ['Letter', 'none'],
  ['A3', 'small'],
  ['Legal', 'large'],
  ['image', 'small'],
  ['image', 'none'],
] as const) {
  add(`run/images-to-pdf/${paper}-${margin}`, () =>
    runTool('imagesToPdf', mixedImages(), checked('imagesToPdf', { imagePaper: paper, margin }, 1)),
  )
}
add('run/images-to-pdf/rgba-default', () => runTool('imagesToPdf', [s.pngRgba], {}))
add('run/images-to-pdf/exif-image-size', () =>
  runTool('imagesToPdf', [s.jpegMirrored, s.jpegTurned], { imagePaper: 'image', margin: 'none' }),
)
add('run/images-to-pdf/not-an-image', () => runTool('imagesToPdf', [s.rich], {}))

for (const sheetPages of [1, 2, 4, 9] as const) {
  add(`run/duplex/${sheetPages}`, () =>
    runTool('duplex', [s.rich, s.text3, s.plainSample], checked('duplex', { sheetPages }, 8)),
  )
}
add('run/duplex/one-file', () => runTool('duplex', [s.text3], {}))

add('run/overlay/behind-all', () =>
  runTool('overlay', [s.rich, s.background], checked('overlay', {}, 8, 2)),
)
add('run/overlay/front-some', () =>
  runTool(
    'overlay',
    [s.rich, s.background],
    checked('overlay', { layer: 'front', backgroundPage: 2, applyPages: '1,3-4' }, 8, 2),
  ),
)
add('run/overlay/plain-sample-on-text', () =>
  runTool('overlay', [s.text3, s.plainSample], checked('overlay', { layer: 'front' }, 3, 1)),
)
add('run/overlay/no-background', () => runTool('overlay', [s.rich], {}))

add('run/strip-annots/default-kinds', () =>
  runTool('stripAnnots', [s.rich], checked('stripAnnots', {}, 8)),
)
add('run/strip-annots/with-links', () =>
  runTool(
    'stripAnnots',
    [s.rich],
    checked('stripAnnots', { annotKinds: [...PDF_TOOL_ANNOT_KINDS] }, 8),
  ),
)
for (const kind of PDF_TOOL_ANNOT_KINDS) {
  add(`run/strip-annots/only-${kind}`, () =>
    runTool('stripAnnots', [s.rich], checked('stripAnnots', { annotKinds: [kind] }, 8)),
  )
}
add('run/strip-annots/links-on-other-pages', () =>
  runTool(
    'stripAnnots',
    [s.rich],
    checked('stripAnnots', { annotKinds: ['links'], applyPages: '1-2,4-8' }, 8),
  ),
)
add('run/strip-annots/none-in-file', () =>
  runTool('stripAnnots', [s.text3], checked('stripAnnots', {}, 3)),
)
add('run/strip-annots/unchecked-defaults', () => runTool('stripAnnots', [s.rich], {}))

for (const level of ['light', 'medium', 'strong'] as const) {
  add(`compress/${level}/sample`, () =>
    compress(s.compress, checked('compress', { compressLevel: level }, 2)),
  )
}
add('compress/medium/rich', () => compress(s.rich, checked('compress', {}, 8)))
add('compress/default/unchecked', () => compress(s.compress, {}))
add('compress/recoder-gives-up', () =>
  compress(s.compress, checked('compress', {}, 2), { recoder: 'null' }),
)
add('compress/not-smaller', () =>
  compress(s.tight, checked('compress', { compressLevel: 'light' }, 1), { recoder: 'null' }),
)
add('compress/no-picture-code', () =>
  compress(s.compress, checked('compress', {}, 2), { recoder: 'none' }),
)
add('compress/stopped', () => compress(s.compress, checked('compress', {}, 2), { aborted: true }))

add('run/blank-pages/rich-empty-and-specks', () =>
  runTool('blankPages', [s.rich], checked('blankPages', { removePages: '6,7' }, 8)),
)
add('run/blank-pages/rich-first', () =>
  runTool('blankPages', [s.rich], checked('blankPages', { removePages: '1' }, 8)),
)
add('run/blank-pages/rich-form-page', () =>
  runTool('blankPages', [s.rich], checked('blankPages', { removePages: '3,4' }, 8)),
)
add('run/blank-pages/blank-sample', () =>
  runTool('blankPages', [s.blank], checked('blankPages', { removePages: '2,3,5,7,9' }, 10)),
)

add('run/to-text/rich', () => runTool('toText', [s.rich], {}))
add('run/to-text/text3', () => runTool('toText', [s.text3], {}))
add('run/to-text/plain-sample', () => runTool('toText', [s.plainSample], {}))
add('run/to-text/blank-sample', () => runTool('toText', [s.blank], {}))
add('run/to-text/no-text', () => runTool('toText', [s.noText], {}))

for (const tool of ['encrypt', 'decrypt', 'repair'] as const) {
  add(`run/${tool}/is-a-job`, () => runTool(tool, [s.text3], {}))
}

// ---- the PDF job process's work

add('blank/rich', () => blankPages(s.rich))
add('blank/blank-sample', () => blankPages(s.blank))
add('blank/plain-sample', () => blankPages(s.plainSample))
add('blank/compress-sample', () => blankPages(s.compress))
add('blank/many-empty', () => blankPages(s.manyEmpty, true))

add('decrypt/enc256', () => decrypt(s.enc256, 'user123'))
add('decrypt/enc128', () => decrypt(s.enc128, 'user123'))
add('decrypt/encrc4', () => decrypt(s.encRc4, 'user123'))
add('decrypt/enc-r3-rc4', () => decrypt(s.encR3, 's3cret'))
add('decrypt/enc-r4-aes128', () => decrypt(s.encR4, 's3cret'))
add('decrypt/enc-r5-aes256', () => decrypt(s.encR5, 's3cret'))
add('decrypt/enc-r5-owneronly-empty', () => decrypt(s.encOwnerOnly, ''))
add('decrypt/four-spaces', () => decrypt(s.encSpaces, '    '))
add('decrypt/wrong-password', () => decrypt(s.enc256, 'nope'))
add('decrypt/not-encrypted', () => decrypt(s.text3, 'x'))
add('decrypt/junk', () => decrypt(s.junk, 'x'))

add('encrypt/rich-user', () => encrypt(s.rich, '열려라 참깨'))
add('encrypt/rich-restrict', () => encrypt(s.rich, 'open', 'permission'))
add('encrypt/text3-user', () => encrypt(s.text3, ' a b '))
add('encrypt/text3-restrict', () => encrypt(s.text3, 'user', '권한 암호'))
add('encrypt/plain-sample-user', () => encrypt(s.plainSample, 'x'.repeat(127)))
add('encrypt/plain-sample-restrict', () => encrypt(s.plainSample, 'u', 'o'))

add('repair/shifted-xref', () => repair(s.shifted))
add('repair/wrong-startxref', () => repair(s.badStartxref))
add('repair/truncated-text', () => repair(s.truncated))
add('repair/truncated-rich', () => repair(s.truncatedRich))
add('repair/corrupt-example', () => repair(s.corrupt))
add('repair/junk', () => repair(s.junk))
add('repair/encrypted', () => repair(s.enc256))
add('repair/healthy', () => repair(s.rich))

add('text/rich', () => text(s.rich))
add('text/rich-pages', () => text(s.rich, { pages: [7, 3, 3, 99] }))
add('text/rich-span', () => text(s.rich, { fromPage: 2, toPage: 4 }))
add('text/rich-budget', () => text(s.rich, { charBudget: 20 }))
add('text/text3', () => text(s.text3))
add('text/blank-sample', () => text(s.blank))
add('text/plain-sample', () => text(s.plainSample))
add('text/compress-sample', () => text(s.compress))
add('text/enc256-password', () => text(s.enc256, { password: 'user123' }))
add('text/enc256-no-password', () => text(s.enc256))
add('text/junk', () => text(s.junk))

// ---------------------------------------------------------------------------

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
  const rich = await richPdf()
  const text3 = await textPdf(['Page one', '', 'Page three'])
  const shiftedSource = await textPdf(['first page', 'second page'], [200, 200])
  const cutSource = await textPdf(['page 1', 'page 2', 'page 3'], [200, 200])
  s = {
    rich,
    text3,
    noText: await textPdf(['', '']),
    plain6: await plainPages(6),
    plainSample: fixture('../../pdf/tests/fixtures/plain-sample.pdf'),
    background: await backgroundPdf(),
    blank: await blankCandidatesPdf(),
    manyEmpty: await manyEmptyPages(125),
    compress: await compressSample(),
    tight: await (await PDFDocument.load(await plainPages(1))).save({ useObjectStreams: true }),
    pngRgb: png(40, 20),
    pngWide: png(300, 60, 2, 'gradient'),
    pngRgba: png(30, 40, 6, 'gradient'),
    jpegPlain: jpeg(800, 600),
    jpegTurned: jpeg(400, 300, 0, 6),
    jpegMirrored: jpeg(300, 200, 0, 2),
    shifted: shiftedXref(shiftedSource),
    badStartxref: wrongStartxref(shiftedSource),
    truncated: cutSource.slice(0, Math.floor(cutSource.length * 0.7)),
    truncatedRich: rich.slice(0, Math.floor(rich.length * 0.6)),
    junk: new TextEncoder().encode('%PDF-1.7\nnothing here'),
    corrupt: fixture('./fixtures/corruptExample.pdf'),
    enc256: fixture('../../pdf/tests/fixtures/enc256.pdf'),
    enc128: fixture('../../pdf/tests/fixtures/enc128.pdf'),
    encRc4: fixture('../../pdf/tests/fixtures/encrc4.pdf'),
    encR3: fixture('../../pdf/tests/fixtures/enc-r3-rc4.pdf'),
    encR4: fixture('../../pdf/tests/fixtures/enc-r4-aes128.pdf'),
    encR5: fixture('../../pdf/tests/fixtures/enc-r5-aes256.pdf'),
    encOwnerOnly: fixture('../../pdf/tests/fixtures/enc-r5-owneronly.pdf'),
    encSpaces: fixture('./fixtures/testPassword4Spaces.pdf'),
  }
}, 60_000)

afterAll(async () => {
  vi.useRealTimers()
  if (!WRITE) return
  // a run where a case failed or was filtered out must not leave a partial table
  if (Object.keys(recorded).length !== cases.length) {
    throw new Error('not every case passed: the table was not written')
  }
  const prettier = await import('prettier')
  const config = (await prettier.resolveConfig(GOLDEN_PATH)) ?? {}
  const table = {
    about:
      'Recorded once by pdf-tools-golden.test.ts from the PC PDF tools before the shared package; never edit by hand.',
    entries: recorded,
  }
  const formatted = await prettier.format(JSON.stringify(table), {
    ...config,
    parser: 'json',
    filepath: GOLDEN_PATH,
  })
  writeFileSync(GOLDEN_PATH, formatted)
})

describe('PDF tools baseline (pdf-tools-golden.json)', () => {
  for (const [key, run] of cases) {
    it(
      key,
      async () => {
        const first = asJson(await run())
        const second = asJson(await run())
        expect(second, `${key}: two runs disagree`).toEqual(first)
        recorded[key] = first
        if (!WRITE) {
          expect(key in goldenTable.entries, `${key} is not in the table`).toBe(true)
          expect(first, `${key} differs from the recorded baseline`).toEqual(
            goldenTable.entries[key],
          )
        }
      },
      120_000,
    )
  }

  it('produced every entry the table holds', () => {
    expect(new Set(cases.map(([key]) => key)).size, 'two cases share a key').toBe(cases.length)
    if (WRITE) return
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(goldenTable.entries).sort())
  })
})
