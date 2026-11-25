/**
 * PC reference run of the PDF engine parity test. Started by
 * tests/pdf-engine-parity.test.ts as `node --import tsx pc-reference.mts <runDir>`:
 * a plain Node process with NO mobile stand-ins, so the PC modules use the
 * real node:fs, node:crypto, node:zlib and Buffer.
 *
 * Only the outside inputs are fixed, the same way the mobile run fixes them:
 * the clock, node:crypto's randomBytes (a seeded stream restarted per case),
 * and the fonts. For the fonts, the real OS fonts are hidden: the paths and
 * font folder the PC code reads hold the app's bundled fonts (fontTable.ts),
 * decoded here with font-metrics and the real zlib.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_FONTS, type BundledFont } from '../../src/renderer/editors/pdf/engine/fontTable'
import { MANIFEST_FILE, PC_RESULTS_FILE, seedOf } from './cases'
import type { ParityCase, ParityManifest, ParityOutcome } from './cases'
import { deterministicRandom, installFixedClock } from './deterministic'

const runDir = resolve(process.argv[2] ?? '')
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const fontAssets = resolve(repo, 'apps/mobile/src/renderer/assets/fonts')

installFixedClock()

// ── Deterministic randomBytes (the only random source the PC save code uses) ──
let random = deterministicRandom(seedOf(0))
const realRandomBytes = crypto.randomBytes
;(crypto as { randomBytes: unknown }).randomBytes = (size: number, cb?: unknown) => {
  const out = Buffer.from(random(size))
  if (typeof cb === 'function') {
    queueMicrotask(() => (cb as (e: null, b: Buffer) => void)(null, out))
    return undefined
  }
  return out
}
void realRandomBytes

// ── Fonts: the bundled set only ──
const { woff2ToSfnt } = await import('../../../../packages/font-metrics/src/woff2')
const { fontDirs } = await import('../../../../packages/font-metrics/src/sfnt')

const key = (p: unknown): string =>
  String(p instanceof URL ? fileURLToPath(p) : p)
    .replace(/\\/g, '/')
    .toLowerCase()

const fontBytes = new Map<string, Buffer>()
const fontFiles = new Map<string, string>()
const fontDirKeys = fontDirs().map(key)
const firstFontDir = fontDirs()[0]!
fs.mkdirSync(join(runDir, 'pc-fonts'), { recursive: true })
for (const font of BUNDLED_FONTS as readonly BundledFont[]) {
  const sfnt = woff2ToSfnt(fs.readFileSync(join(fontAssets, font.woff2)))
  if (!sfnt) throw new Error(`could not decode ${font.woff2}`)
  const real = join(runDir, 'pc-fonts', font.sfntName)
  fs.writeFileSync(real, sfnt)
  for (const p of [...font.paths, join(firstFontDir, font.sfntName)]) {
    fontBytes.set(key(p), sfnt)
    fontFiles.set(key(p), real)
  }
}
const isFontFile = (p: unknown) => /\.(ttf|otf|ttc|otc)$/i.test(String(p))
const enoent = (p: unknown) =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${String(p)}'`), {
    code: 'ENOENT',
  })

const real = {
  readFileSync: fs.readFileSync,
  openSync: fs.openSync,
  readdirSync: fs.readdirSync,
}
;(fs as { readFileSync: unknown }).readFileSync = (p: unknown, ...rest: unknown[]) => {
  const bytes = fontBytes.get(key(p))
  if (bytes) return Buffer.from(bytes)
  if (isFontFile(p)) throw enoent(p)
  return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest)
}
;(fs as { openSync: unknown }).openSync = (p: unknown, ...rest: unknown[]) => {
  const file = fontFiles.get(key(p))
  if (file) return real.openSync(file, 'r')
  if (isFontFile(p)) throw enoent(p)
  return (real.openSync as (...a: unknown[]) => unknown)(p, ...rest)
}
;(fs as { readdirSync: unknown }).readdirSync = (p: unknown, ...rest: unknown[]) => {
  const at = fontDirKeys.indexOf(key(p))
  if (at < 0) return (real.readdirSync as (...a: unknown[]) => unknown)(p, ...rest)
  const names = at === 0 ? BUNDLED_FONTS.map((f) => f.sfntName).sort() : []
  const withTypes = (rest[0] as { withFileTypes?: boolean } | undefined)?.withFileTypes
  return withTypes
    ? names.map((name) => ({
        name,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      }))
    : names
}
syncBuiltinESMExports()

// ── The PC modules, loaded only now so they see the fixed inputs ──
const savePdf = await import('../../../pdf/src/main/save-pdf')
const textEdit = await import('../../../pdf/src/main/text-edit')
const { blankPdfBuffer } = await import('../../../pdf/src/main/blank-pdf')
const { flattenAnnotsBytes } = await import('../../../pdf/src/main/annot-flatten')
const { stripCommentAnnotsBytes } = await import('../../../pdf/src/main/annot-strip')

const manifest = JSON.parse(
  fs.readFileSync(join(runDir, MANIFEST_FILE), 'utf8') as string,
) as ParityManifest
const read = (name: string) => new Uint8Array(fs.readFileSync(join(runDir, name)) as Buffer)

async function run(c: ParityCase, index: number): Promise<{ bytes?: Uint8Array; value?: unknown }> {
  switch (c.kind) {
    case 'save': {
      const target = join(runDir, `${index}.pc-target.pdf`)
      const skips = await savePdf.savePdfBytesToPath(read(c.source), target, c.request)
      const bytes = read(basename(target))
      fs.rmSync(target)
      return { bytes, value: skips }
    }
    case 'apply':
      return { bytes: await savePdf.pdfBytesWithEditsOf(read(c.source), c.request) }
    case 'hasEdits':
      return { value: savePdf.saveRequestHasEdits(c.request) }
    case 'insertPdf': {
      const { merged, count } = await savePdf.insertPdfBytes(
        read(c.source),
        read(c.other),
        c.afterPageIndex,
      )
      return { bytes: merged, value: count }
    }
    case 'insertBlankPage':
      return { bytes: await savePdf.insertBlankPageBytes(read(c.source), c.afterPageIndex) }
    case 'blankPdf':
      return { bytes: await blankPdfBuffer() }
    case 'flatten':
      return { bytes: await flattenAnnotsBytes(read(c.source)) }
    case 'strip': {
      const out = await stripCommentAnnotsBytes(read(c.source))
      return { bytes: out.bytes, value: out.removed }
    }
    case 'canDraw':
      return { value: textEdit.canDrawText(c.text, c.font, c.bold, c.italic) }
    case 'listEditFonts':
      return { value: textEdit.listEditFonts() }
  }
}

const results: Record<string, ParityOutcome> = {}
for (const [index, c] of manifest.cases.entries()) {
  random = deterministicRandom(seedOf(index))
  try {
    const { bytes, value } = await run(c, index)
    let bytesFile: string | undefined
    if (bytes) {
      bytesFile = `${index}.pc.pdf`
      fs.writeFileSync(join(runDir, bytesFile), bytes)
    }
    results[c.name] = { ok: true, ...(bytesFile ? { bytesFile } : {}), value }
  } catch (error) {
    results[c.name] = { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
fs.writeFileSync(join(runDir, PC_RESULTS_FILE), JSON.stringify(results, null, 2))
