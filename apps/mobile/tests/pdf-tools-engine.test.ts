// @vitest-environment node
/**
 * The phone's PDF tools engine core (apps/mobile/src/renderer/tools/engine/core.ts)
 * on real PDFium and qpdf wasm read from node_modules, with a fake picture
 * recoder. Every tool whose PC result is the same on every run is held to the
 * bytes @genoffice/pdf-ops makes for the same input with the mirror page
 * engine (what the PC tools window runs, apart from the page functions the
 * mirror tests already hold to the PC's own); Date is frozen so pdf-lib and
 * qpdf stamp the same time. Adding a password is checked by what the file
 * does (qpdf draws a fresh key every run).
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  MIN_SPLIT_MAX_BYTES,
  PdfToolRefusal,
  checkOptions,
  findBlankPages,
  mirrorPageEngine,
  pdfiumOpens,
  qpdfDecrypt,
  repairPdfBytes,
  runPdfTool,
  runSplitPdfTool,
  salvagePdfBytes,
  withPdfiumDocument,
  type CreateQpdf,
  type ImageRecoder,
  type PdfToolId,
  type PdfToolOptions,
} from '@genoffice/pdf-ops'
import {
  OWNER_PASSWORD_BYTES,
  bgraToRgba,
  createEngineCore,
  initPdfium,
  type CoreDeps,
  type EngineCore,
  type EnginePdfium,
} from '../src/renderer/tools/engine/core'
import {
  PHOTO_JPEG_QUALITY,
  canvasPictures,
  type PictureOps,
  type Surface,
} from '../src/renderer/tools/engine/picture'
import type { ToolFile, ToolRunOutcome } from '../src/renderer/tools/engine/types'
import {
  blankCandidatesPdf,
  compressSample,
  jpeg,
  plainPages,
  png,
  richPdf,
  shiftedXref,
  textPdf,
} from '../../shell/tests/helpers/pdf-tools-fixtures'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const ENGINE_DIR = resolve(here, '../src/renderer/tools/engine')
const PDF_FIXTURES = resolve(here, '../../pdf/tests/fixtures')

// ---------------------------------------------------------------------------
// Real wasm from node_modules

let pdfiumPromise: Promise<EnginePdfium> | null = null
function loadNodePdfium(): Promise<EnginePdfium> {
  pdfiumPromise ??= (async () => {
    const { init } = await import('@embedpdf/pdfium')
    const raw = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'))
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    return initPdfium(init as (o: object) => Promise<unknown>, { wasmBinary })
  })()
  return pdfiumPromise
}

const QPDF_WASM = require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')
async function loadNodeQpdf(): Promise<{ create: CreateQpdf; wasmLocation: string }> {
  const glue = (await import('@neslinesli93/qpdf-wasm')) as unknown as { default: CreateQpdf }
  return { create: glue.default, wasmLocation: QPDF_WASM }
}

// ---------------------------------------------------------------------------
// Fakes

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A recoder that halves each picture into a stub JPEG sized by the quality asked for */
const fakeRecoder: ImageRecoder = async (source, target) => {
  if (source.kind === 'raw' && source.components === 1) return null
  const scale = Math.min(1, target.longSide / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round((source.width * scale) / 2))
  const height = Math.max(1, Math.round((source.height * scale) / 2))
  return { jpeg: jpeg(width, height, target.quality * 10), width, height }
}

/** Pictures the tests do not decode: every other kind is refused */
const noPictures = (recode: ImageRecoder = fakeRecoder): PictureOps => ({
  decodable: async () => false,
  toJpeg: async () => null,
  recode,
})

function core(overrides: Partial<CoreDeps> = {}): EngineCore {
  return createEngineCore({
    loadPdfium: loadNodePdfium,
    loadQpdf: loadNodeQpdf,
    pictures: noPictures(),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    ...overrides,
  })
}

interface Reads {
  /** names in the order they were read */
  order: string[]
  /** most reads ever waiting at once */
  most: number
}

/** A picked file; every read is a fresh copy, counted in `reads` */
function file(name: string, bytes: Uint8Array, mime = 'application/pdf', reads?: Reads): ToolFile {
  let waiting = 0
  return {
    name,
    mime,
    async readBytes() {
      if (reads) {
        waiting++
        reads.most = Math.max(reads.most, waiting)
        reads.order.push(name)
      }
      await new Promise((r) => setTimeout(r, 1))
      waiting--
      return bytes.slice()
    },
  }
}

const pcEngine = mirrorPageEngine(loadNodePdfium)

function checked(tool: PdfToolId, raw: PdfToolOptions, pages: number): PdfToolOptions {
  const result = checkOptions(tool, raw, pages)
  if (!result.ok) throw new Error(`options refused: ${result.error}`)
  return result.options
}

/** What the PC runner makes for the same input */
const pc = (tool: PdfToolId, inputs: Uint8Array[], raw: PdfToolOptions, pages: number) =>
  runPdfTool(tool, inputs, checked(tool, raw, pages), { engine: pcEngine, recode: fakeRecoder })

function okFiles(outcome: ToolRunOutcome) {
  if (!outcome.ok) throw new Error(`the tool failed: ${outcome.reason}`)
  return outcome.files
}

const same = (a: Uint8Array, b: Uint8Array) => expect(sha(a)).toBe(sha(b))

const pageCount = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()

// ---------------------------------------------------------------------------

interface Samples {
  rich: Uint8Array
  text3: Uint8Array
  noText: Uint8Array
  plain6: Uint8Array
  blank: Uint8Array
  compress: Uint8Array
  tight: Uint8Array
  truncated: Uint8Array
  shifted: Uint8Array
  junk: Uint8Array
  enc256: Uint8Array
}
let s: Samples

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-26T09:00:00Z'))
  const cut = await textPdf(['page 1', 'page 2', 'page 3'], [200, 200])
  s = {
    rich: await richPdf(),
    text3: await textPdf(['Page one', '', 'Page three']),
    noText: await textPdf(['', '']),
    plain6: await plainPages(6),
    blank: await blankCandidatesPdf(),
    compress: await compressSample(),
    tight: await (await PDFDocument.load(await plainPages(1))).save({ useObjectStreams: true }),
    truncated: cut.slice(0, Math.floor(cut.length * 0.7)),
    shifted: shiftedXref(await textPdf(['first page', 'second page'], [200, 200])),
    junk: new TextEncoder().encode('%PDF-1.7\nnothing here'),
    enc256: new Uint8Array(readFileSync(join(PDF_FIXTURES, 'enc256.pdf'))),
  }
  await loadNodePdfium()
}, 60_000)

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('inspect', () => {
  it('judges a file the way the PC window does, per tool', async () => {
    const c = core()
    expect(await c.inspect(s.rich, 'application/pdf', 'merge')).toEqual({ ok: true, pages: 8 })
    expect(await c.inspect(s.enc256, 'application/pdf', 'merge')).toEqual({
      ok: false,
      problem: 'encrypted',
    })
    expect(await c.inspect(s.enc256, 'application/pdf', 'decrypt')).toMatchObject({ ok: true })
    expect(await c.inspect(s.text3, 'application/pdf', 'decrypt')).toEqual({
      ok: false,
      problem: 'not-encrypted',
    })
    expect(await c.inspect(s.junk, 'application/pdf', 'compress')).toEqual({
      ok: false,
      problem: 'unreadable',
    })
    expect(await c.inspect(s.junk, 'application/pdf', 'repair')).toEqual({ ok: true, pages: 0 })
    expect(await c.inspect(png(10, 10), 'image/png', 'imagesToPdf')).toEqual({
      ok: true,
      pages: 1,
    })
    expect(await c.inspect(s.rich, 'application/pdf', 'imagesToPdf')).toEqual({
      ok: false,
      problem: 'not-image',
    })
  })
})

describe('page tools', () => {
  it('merges in order, reading one input at a time, as the PC runner does', async () => {
    const reads: Reads = { order: [], most: 0 }
    const progress: [number, number][] = []
    const inputs = [s.text3, s.plain6, s.rich, s.blank]
    const files = inputs.map((bytes, i) => file(`f${i}.pdf`, bytes, 'application/pdf', reads))
    const outcome = await core().run('merge', files, {}, (d, t) => progress.push([d, t]))
    const [made] = okFiles(outcome)
    same(made!.bytes, (await pc('merge', inputs, {}, 3))[0]!)
    expect(made!.name).toBe('f0-merged.pdf')
    expect(made!.mime).toBe('application/pdf')
    expect(reads.order).toEqual(['f0.pdf', 'f1.pdf', 'f2.pdf', 'f3.pdf'])
    expect(reads.most).toBe(1)
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })

  it('reads the next input only after the merge has taken the one before', async () => {
    const events: string[] = []
    const files: ToolFile[] = [s.text3, s.plain6, s.rich].map((bytes, i) => ({
      name: `f${i}.pdf`,
      mime: 'application/pdf',
      async readBytes() {
        events.push(`read ${i}`)
        return bytes.slice()
      },
    }))
    await core().run('merge', files, {}, (done) => events.push(`used ${done}`))
    // "used n": the merge has taken input n and asks for the next
    expect(events).toEqual(['read 0', 'used 1', 'read 1', 'used 2', 'read 2', 'used 3'])
  })

  it('refuses a merge of one file and options that name pages that do not exist', async () => {
    expect(await core().run('merge', [file('a.pdf', s.rich)], {})).toEqual({
      ok: false,
      reason: 'failed',
    })
    expect(await core().run('extract', [file('a.pdf', s.rich)], { pages: '99' })).toEqual({
      ok: false,
      reason: 'failed',
    })
  })

  it('extracts, reverses and rotates to the PC runner bytes', async () => {
    const c = core()
    const cases: [PdfToolId, PdfToolOptions, string][] = [
      ['extract', { pages: '2-3, 1' }, 'a-pages.pdf'],
      ['reverse', {}, 'a-reversed.pdf'],
      ['rotate', { rotation: 90 }, 'a-rotated.pdf'],
      ['rotate', { rotation: 180 }, 'a-rotated.pdf'],
      ['rotate', { rotation: 270 }, 'a-rotated.pdf'],
    ]
    for (const [tool, options, name] of cases) {
      const [made] = okFiles(await c.run(tool, [file('a.pdf', s.rich)], options))
      same(made!.bytes, (await pc(tool, [s.rich], options, 8))[0]!)
      expect(made!.name).toBe(name)
    }
  })

  it('splits in every mode to the PC split, names and all', async () => {
    const c = core()
    const modes: PdfToolOptions[] = [
      { splitMode: 'ranges', splitRanges: '1-2, 3-8' },
      { splitMode: 'ranges', splitRanges: '1, 4-5', splitMergeRanges: true },
      { splitMode: 'fixed', splitFixedKind: 'pagesPerFile', splitFixedValue: 3 },
      { splitMode: 'fixed', splitFixedKind: 'fileCount', splitFixedValue: 2, splitPrefix: 'part' },
      { splitMode: 'bookmarks', splitBookmarkLevel: 1, splitPattern: 'bookmark' },
      { splitMode: 'bookmarks', splitBookmarkLevel: 2, splitIncludeLeading: false },
      { splitMode: 'maxSize', splitMaxBytes: MIN_SPLIT_MAX_BYTES, splitPattern: 'range' },
    ]
    for (const options of modes) {
      const progress: [number, number][] = []
      const outcome = await c.run('split', [file('book.pdf', s.rich)], options, (d, t) =>
        progress.push([d, t]),
      )
      const files = okFiles(outcome)
      const expected = await runSplitPdfTool(s.rich, 'book.pdf', checked('split', options, 8))
      expect(files.map((f) => f.name)).toEqual(expected.names)
      expect(files.map((f) => sha(f.bytes))).toEqual(expected.parts.map(sha))
      expect(outcome.ok && outcome.oversizedPages).toEqual(
        expected.oversizedPages.length > 0 ? expected.oversizedPages : undefined,
      )
      expect(progress.length).toBeGreaterThan(0)
    }
  })

  it('refuses to split by bookmarks a file that has none', async () => {
    expect(await core().run('split', [file('a.pdf', s.text3)], { splitMode: 'bookmarks' })).toEqual(
      { ok: false, reason: 'no-bookmarks' },
    )
  })

  it('finds blank pages with RGBA thumbnails, then removes the chosen ones as the PC does', async () => {
    const progress: [number, number][] = []
    const c = core()
    const found = await c.findBlankPages(s.blank.slice(), (d, t) => progress.push([d, t]))
    const m = await loadNodePdfium()
    const direct = await withPdfiumDocument(m, s.blank, null, (doc) => findBlankPages(m, doc))
    if (!found.ok) throw new Error('blank pages failed')
    expect(found.pageCount).toBe(direct.pageCount)
    expect(found.candidates.map((x) => [x.page, x.reason])).toEqual(
      direct.candidates.map((x) => [x.page, x.reason]),
    )
    expect(found.candidates.length).toBeGreaterThan(0)
    for (const [i, candidate] of found.candidates.entries()) {
      const thumb = direct.candidates[i]!.thumb!
      expect(candidate.thumb).toEqual(bgraToRgba(thumb))
      // BGRA turned to RGBA: red and blue swap places
      expect(candidate.thumb!.rgba[0]).toBe(thumb.bgra[2])
      expect(candidate.thumb!.rgba[2]).toBe(thumb.bgra[0])
    }
    expect(progress.at(-1)).toEqual([direct.pageCount, direct.pageCount])

    const chosen = found.candidates
      .filter((x) => x.reason === 'empty')
      .map((x) => x.page)
      .join(',')
    const [made] = okFiles(
      await c.run('blankPages', [file('scan.pdf', s.blank)], { removePages: chosen }),
    )
    same(
      made!.bytes,
      (await pc('blankPages', [s.blank], { removePages: chosen }, direct.pageCount))[0]!,
    )
    expect(made!.name).toBe('scan-no-blank.pdf')
  })

  it('answers failed for blank pages of a file PDFium cannot open', async () => {
    expect(await core().findBlankPages(s.junk.slice())).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('images to PDF', () => {
  const pictures = () => [png(40, 20), jpeg(400, 300, 0, 6), png(300, 60, 2, 'gradient')]

  it('makes the PC runner bytes for every paper and margin, one picture at a time', async () => {
    const c = core()
    const choices: PdfToolOptions[] = [
      {},
      { imagePaper: 'image', margin: 'none' },
      { imagePaper: 'A3', margin: 'small' },
      { imagePaper: 'A5', margin: 'large' },
      { imagePaper: 'Letter', margin: 'large' },
      { imagePaper: 'Legal', margin: 'none' },
    ]
    for (const options of choices) {
      const reads: Reads = { order: [], most: 0 }
      const images = pictures()
      const files = images.map((bytes, i) =>
        file(`IMG_${i}.${i === 1 ? 'jpg' : 'png'}`, bytes, 'image/png', reads),
      )
      const [made] = okFiles(await c.run('imagesToPdf', files, options))
      same(made!.bytes, (await pc('imagesToPdf', images, options, 1))[0]!)
      expect(made!.name).toBe('IMG_0.pdf')
      expect(reads).toEqual({ order: ['IMG_0.png', 'IMG_1.jpg', 'IMG_2.png'], most: 1 })
    }
  })

  it('takes a photo of another kind the web view decodes as a JPEG at 0.92', async () => {
    const qualities: number[] = []
    const decoded: string[] = []
    // a stand-in for the web view's decoder: "HEIC" bytes decode to 64 x 48, anything else fails
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 4))
      decoded.push(`${blob.type} ${head}`)
      if (head !== 'HEIC') throw new Error('cannot decode')
      return { width: 64, height: 48, close() {} }
    })
    const surface = (width: number, height: number): Surface => ({
      context: {
        fillRect() {},
        drawImage() {},
      } as unknown as Surface['context'],
      toJpeg: async (quality) => {
        qualities.push(quality)
        return jpeg(width, height)
      },
      release() {},
    })
    const c = core({ pictures: canvasPictures(surface) })
    const heic = new TextEncoder().encode('HEIC and the rest of a photo')
    const notAPicture = new TextEncoder().encode('JUNK')

    expect(await c.inspect(heic, 'image/heic', 'imagesToPdf')).toEqual({ ok: true, pages: 1 })
    expect(await c.inspect(notAPicture, 'image/heic', 'imagesToPdf')).toEqual({
      ok: false,
      problem: 'not-image',
    })

    const first = png(40, 20)
    const [made] = okFiles(
      await c.run(
        'imagesToPdf',
        [file('photo.heic', heic, 'image/heic'), file('b.png', first, 'image/png')],
        { imagePaper: 'A4', margin: 'small' },
      ),
    )
    same(made!.bytes, (await pc('imagesToPdf', [jpeg(64, 48), first], {}, 1))[0]!)
    expect(made!.name).toBe('photo.pdf')
    expect(qualities).toEqual([PHOTO_JPEG_QUALITY])
    expect(decoded).toEqual(['image/heic HEIC', 'image/heic JUNK', 'image/heic HEIC'])
    vi.unstubAllGlobals()
  })

  it('fails when a picture turns out not to be one at run time', async () => {
    const outcome = await core().run('imagesToPdf', [file('x.heic', s.junk, 'image/heic')], {})
    expect(outcome).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('text, compress, annotations', () => {
  it('saves the text as UTF-8 plain text, and refuses a file with none', async () => {
    const c = core()
    const [made] = okFiles(await c.run('toText', [file('notes.pdf', s.text3)], {}))
    same(made!.bytes, (await pc('toText', [s.text3], {}, 3))[0]!)
    expect(made!.mime).toBe('text/plain')
    expect(made!.name).toBe('notes.txt')
    expect(new TextDecoder().decode(made!.bytes)).toBe('Page one\n\nPage three\n')
    expect(await c.run('toText', [file('scan.pdf', s.noText)], {})).toEqual({
      ok: false,
      reason: 'no-text',
    })
  })

  it('makes a file smaller with the recoder it is given, and says how large it was', async () => {
    const c = core()
    for (const compressLevel of ['light', 'medium', 'strong'] as const) {
      const outcome = await c.run('compress', [file('big.pdf', s.compress)], { compressLevel })
      const [made] = okFiles(outcome)
      same(made!.bytes, (await pc('compress', [s.compress], { compressLevel }, 2))[0]!)
      expect(made!.name).toBe('big-smaller.pdf')
      expect(outcome.ok && outcome.sizeBefore).toBe(s.compress.length)
    }
  })

  it('makes no copy of a file that does not get smaller', async () => {
    const c = core({ pictures: noPictures(async () => null) })
    expect(await c.run('compress', [file('tight.pdf', s.tight)], {})).toEqual({
      ok: false,
      reason: 'not-smaller',
    })
  })

  it('strips annotations as the PC does, and refuses when there are none', async () => {
    const c = core()
    const choices: PdfToolOptions[] = [
      {},
      { annotKinds: ['comments', 'links', 'other'] },
      { annotKinds: ['links'] },
      { applyPages: '1-2' },
    ]
    let made = 0
    for (const options of choices) {
      const outcome = await c.run('stripAnnots', [file('a.pdf', s.rich)], options)
      const expected = await pc('stripAnnots', [s.rich], options, 8).catch((err: unknown) => err)
      if (expected instanceof PdfToolRefusal) {
        expect(outcome).toEqual({ ok: false, reason: expected.reason })
        continue
      }
      const [file0] = okFiles(outcome)
      same(file0!.bytes, (expected as Uint8Array[])[0]!)
      expect(file0!.name).toBe('a-clean.pdf')
      made++
    }
    expect(made).toBeGreaterThan(1)
    expect(await c.run('stripAnnots', [file('a.pdf', s.text3)], {})).toEqual({
      ok: false,
      reason: 'no-annots',
    })
  })
})

describe('passwords', () => {
  /** /P of a file's encryption dictionary */
  async function permissions(bytes: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict)
    return (encrypt.lookup(PDFName.of('P'), PDFNumber) as PDFNumber).asNumber()
  }

  it('adds a password with an owner password nobody knows, from the random source', async () => {
    const asked: number[] = []
    const owner = new Uint8Array(OWNER_PASSWORD_BYTES).map((_, i) => i * 7)
    const c = core({
      randomBytes: (n) => {
        asked.push(n)
        return owner.slice(0, n)
      },
    })
    const [made] = okFiles(await c.run('encrypt', [file('a.pdf', s.text3)], { password: 'pw' }))
    expect(made!.name).toBe('a-locked.pdf')
    expect(asked).toEqual([32])
    const m = await loadNodePdfium()
    expect(pdfiumOpens(m, made!.bytes, 'pw')).toBe('ok')
    expect(pdfiumOpens(m, made!.bytes, 'nope')).toBe('wrong-password')
    const hex = [...owner].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toHaveLength(64)
    expect(pdfiumOpens(m, made!.bytes, hex)).toBe('ok')
    expect(await permissions(made!.bytes)).toBe(-4)

    // and it comes off again with the same password
    const [open] = okFiles(
      await c.run('decrypt', [file('a-locked.pdf', made!.bytes)], { password: 'pw' }),
    )
    expect(open!.name).toBe('a-locked-unlocked.pdf')
    expect(await pageCount(open!.bytes)).toBe(3)
    const [text] = okFiles(await c.run('toText', [file('x.pdf', open!.bytes)], {}))
    expect(new TextDecoder().decode(text!.bytes)).toBe('Page one\n\nPage three\n')
  })

  it('restricts printing, copying and changes with the permission password', async () => {
    const random = vi.fn((n: number) => new Uint8Array(n))
    const c = core({ randomBytes: random })
    const [made] = okFiles(
      await c.run('encrypt', [file('a.pdf', s.text3)], {
        password: 'reader',
        restrict: true,
        permissionPassword: 'owner1',
      }),
    )
    expect(random).not.toHaveBeenCalled()
    const m = await loadNodePdfium()
    expect(pdfiumOpens(m, made!.bytes, 'reader')).toBe('ok')
    expect(pdfiumOpens(m, made!.bytes, 'owner1')).toBe('ok')
    const p = await permissions(made!.bytes)
    expect(p).not.toBe(-4)
    // no printing (bit 3), no changes (bit 4), no copying (bit 5), no annotating (bit 6)
    expect(p & 0b111100).toBe(0)
  })

  it('refuses options the sheet should not have sent', async () => {
    const c = core()
    for (const options of [
      {},
      { password: 'same', restrict: true, permissionPassword: 'same' },
      { password: 'x'.repeat(128) },
    ]) {
      expect(await c.run('encrypt', [file('a.pdf', s.text3)], options)).toEqual({
        ok: false,
        reason: 'failed',
      })
    }
  })

  it('removes a password to the bytes qpdf writes, and tells a wrong one apart', async () => {
    const c = core()
    const [made] = okFiles(
      await c.run('decrypt', [file('enc256.pdf', s.enc256)], { password: 'user123' }),
    )
    const m = await loadNodePdfium()
    const { create, wasmLocation } = await loadNodeQpdf()
    const direct = await qpdfDecrypt(create, wasmLocation, s.enc256, 'user123', (b, p) =>
      pdfiumOpens(m, b, p),
    )
    same(made!.bytes, direct)
    expect(made!.name).toBe('enc256-unlocked.pdf')
    expect(await c.run('decrypt', [file('enc256.pdf', s.enc256)], { password: 'nope' })).toEqual({
      ok: false,
      reason: 'wrong-password',
    })
    // a file without a password is not taken
    expect(await c.run('decrypt', [file('a.pdf', s.text3)], { password: 'x' })).toEqual({
      ok: false,
      reason: 'failed',
    })
  })
})

describe('repair', () => {
  it('writes a damaged file out again with PDFium', async () => {
    const [made] = okFiles(await core().run('repair', [file('moved.pdf', s.shifted)], {}))
    const m = await loadNodePdfium()
    same(made!.bytes, repairPdfBytes(m, s.shifted).bytes)
    expect(made!.name).toBe('moved-repaired.pdf')
    expect(await pageCount(made!.bytes)).toBe(2)
  })

  it('keeps the pages pdf-lib still reads from a file cut short', async () => {
    const [made] = okFiles(await core().run('repair', [file('cut.pdf', s.truncated)], {}))
    same(made!.bytes, (await salvagePdfBytes(s.truncated))!.bytes)
    expect(made!.name).toBe('cut-repaired.pdf')
  })

  it('keeps the pages pdf-lib still reads whenever PDFium gives up', async () => {
    const giveUp = async (): Promise<EnginePdfium> => {
      const real = await loadNodePdfium()
      return new Proxy(real, {
        get: (target, key) =>
          key === '_FPDF_LoadMemDocument' ? () => 0 : Reflect.get(target, key),
      })
    }
    const [made] = okFiles(
      await core({ loadPdfium: giveUp }).run('repair', [file('moved.pdf', s.shifted)], {}),
    )
    same(made!.bytes, (await salvagePdfBytes(s.shifted))!.bytes)
  })

  it('says it could not repair a file nothing reads', async () => {
    expect(await core().run('repair', [file('junk.pdf', s.junk)], {})).toEqual({
      ok: false,
      reason: 'repair-failed',
    })
  })
})

describe('memory and loading', () => {
  it('answers too large for a RangeError, wherever it comes from', async () => {
    const full = async (): Promise<EnginePdfium> => {
      throw new RangeError('Array buffer allocation failed')
    }
    expect(await core({ loadPdfium: full }).run('toText', [file('a.pdf', s.text3)], {})).toEqual({
      ok: false,
      reason: 'too-large',
    })
    expect(await core({ loadPdfium: full }).findBlankPages(s.text3.slice())).toEqual({
      ok: false,
      reason: 'too-large',
    })
    const recode: ImageRecoder = async () => {
      throw new RangeError('Invalid typed array length')
    }
    expect(
      await core({ pictures: noPictures(recode) }).run('compress', [file('a.pdf', s.compress)], {}),
    ).toEqual({ ok: false, reason: 'too-large' })
    const reading: ToolFile = {
      name: 'a.pdf',
      mime: 'application/pdf',
      readBytes: async () => {
        throw new RangeError('out of memory')
      },
    }
    expect(await core().run('reverse', [reading], {})).toEqual({ ok: false, reason: 'too-large' })
    // a wasm heap that cannot grow aborts with a message, not a RangeError
    const aborted = async (): Promise<EnginePdfium> => {
      throw new Error('Aborted(Cannot enlarge memory arrays to size 2147483648 bytes)')
    }
    expect(await core({ loadPdfium: aborted }).run('repair', [file('a.pdf', s.text3)], {})).toEqual(
      {
        ok: false,
        reason: 'too-large',
      },
    )
  })

  it('loads PDFium and qpdf only for the tools that need them, once', async () => {
    const pdfium = vi.fn(loadNodePdfium)
    const qpdf = vi.fn(loadNodeQpdf)
    const c = core({ loadPdfium: pdfium, loadQpdf: qpdf })
    await c.run('merge', [file('a.pdf', s.text3), file('b.pdf', s.plain6)], {})
    await c.run('rotate', [file('a.pdf', s.text3)], {})
    await c.run('compress', [file('a.pdf', s.compress)], {})
    expect(pdfium).not.toHaveBeenCalled()
    expect(qpdf).not.toHaveBeenCalled()
    await c.run('toText', [file('a.pdf', s.text3)], {})
    await c.findBlankPages(s.blank.slice())
    expect(pdfium).toHaveBeenCalledTimes(1)
    expect(qpdf).not.toHaveBeenCalled()
    await c.run('encrypt', [file('a.pdf', s.text3)], { password: 'pw' })
    await c.run('decrypt', [file('enc256.pdf', s.enc256)], { password: 'user123' })
    expect(qpdf).toHaveBeenCalledTimes(1)
    expect(pdfium).toHaveBeenCalledTimes(1)
  })
})

describe('zip', () => {
  it('puts every part in one ZIP, keeping names apart', async () => {
    const a = new TextEncoder().encode('first')
    const b = new TextEncoder().encode('second')
    const made = await core().zip(
      [
        { name: 'part-1.pdf', mime: 'application/pdf', bytes: a },
        { name: 'part-1.pdf', mime: 'application/pdf', bytes: b },
        { name: 'part-2.pdf', mime: 'application/pdf', bytes: b },
      ],
      'book-split.zip',
    )
    expect(made.name).toBe('book-split.zip')
    expect(made.mime).toBe('application/zip')
    const zip = await JSZip.loadAsync(made.bytes)
    expect(Object.keys(zip.files)).toEqual(['part-1.pdf', 'part-1 (2).pdf', 'part-2.pdf'])
    expect(await zip.file('part-1 (2).pdf')!.async('string')).toBe('second')
  })
})

describe('the picture recoder on a canvas', () => {
  it('shrinks to the long side, keeps the PC rule on misread sizes, and asks for the quality', async () => {
    const drawn: number[][] = []
    const qualities: number[] = []
    let decodedSize = { width: 3000, height: 1500 }
    const decode = vi.fn(async () => ({ ...decodedSize, close() {} }) as unknown as ImageBitmap)
    const surface = (width: number, height: number): Surface => ({
      context: {
        fillRect() {},
        drawImage: (_b: unknown, ...box: number[]) => drawn.push(box),
      } as unknown as Surface['context'],
      toJpeg: async (quality) => {
        qualities.push(quality)
        return jpeg(width, height)
      },
      release() {},
    })
    const pictures = canvasPictures(surface, decode)
    const source = { kind: 'jpeg' as const, bytes: jpeg(3000, 1500), width: 3000, height: 1500 }
    const made = await pictures.recode(source, { longSide: 2000, quality: 75 })
    expect(made).toMatchObject({ width: 2000, height: 1000 })
    expect(drawn).toEqual([[0, 0, 2000, 1000]])
    expect(qualities).toEqual([0.75])

    // a decoder that turned the picture: the original stays
    decodedSize = { width: 1500, height: 3000 }
    expect(await pictures.recode(source, { longSide: 2000, quality: 75 })).toBeNull()
  })
})

describe('imports', () => {
  /** every file under tools/engine */
  function engineFiles(dir = ENGINE_DIR): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? engineFiles(path) : [path]
    })
  }

  const ALLOWED = [
    /^@genoffice\/pdf-ops(\/(tool-ids|split-plan|page-range))?$/,
    /^pdf-lib$/,
    /^jszip$/,
    /^@embedpdf\/pdfium(\/pdfium\.wasm\?url)?$/,
    /^@neslinesli93\/qpdf-wasm(\/dist\/qpdf\.wasm\?url)?$/,
  ]

  it('takes only pdf-ops, pdf-lib, PDFium, qpdf, jszip and its own files, never the PC apps', () => {
    const files = engineFiles()
    expect(files.length).toBeGreaterThan(5)
    for (const path of files) {
      const text = readFileSync(path, 'utf8')
      const specifiers = [
        ...text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g),
        ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
        ...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]/g),
        ...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((m) => m[1]!)
      for (const spec of specifiers) {
        expect(spec, `${relative(ENGINE_DIR, path)} imports ${spec}`).not.toMatch(
          /apps[\\/](pdf[\\/]src[\\/]main|shell)|^electron$|^node:/,
        )
        if (spec.startsWith('.')) {
          const target = resolve(dirname(path), spec)
          expect(
            relative(ENGINE_DIR, target).startsWith('..'),
            `${relative(ENGINE_DIR, path)} reaches outside the engine folder: ${spec}`,
          ).toBe(false)
        } else {
          expect(
            ALLOWED.some((rule) => rule.test(spec)),
            `${relative(ENGINE_DIR, path)} imports ${spec}`,
          ).toBe(true)
        }
      }
    }
  })
})
