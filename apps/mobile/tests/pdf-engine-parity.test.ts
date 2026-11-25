/**
 * Mobile PDF engine = PC save code (spec 2.1): for the same source bytes, the
 * same request and the same outside inputs (clock, random bytes, font files),
 * the mobile path (PC modules on the mobile stand-ins, this Vitest process)
 * writes the same bytes as the PC path (PC modules on real Node, a separate
 * `tsx` process with no stand-in rules: tests/pdf-engine/pc-reference.mts).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setEngineAssetLoader, type EngineAsset } from '../src/renderer/editors/pdf/engine/assets'
import type { PdfEngine } from '../src/renderer/editors/pdf/engine/client'
import { createInThreadPdfEngine } from '../src/renderer/editors/pdf/engine/inThread'
import { BUNDLED_FONTS } from '../src/renderer/editors/pdf/engine/fontTable'
import { setRandomSource } from '../src/renderer/editors/pdf/engine/node-shims/crypto'
import { NOT_ON_MOBILE } from '../src/renderer/editors/pdf/engine/node-shims/unsupported'
import {
  MANIFEST_FILE,
  PC_RESULTS_FILE,
  seedOf,
  type ParityCase,
  type ParityOutcome,
} from './pdf-engine/cases'
import { deterministicRandom, installFixedClock } from './pdf-engine/deterministic'
import { EXPECTED_VALUES, buildSamples } from './pdf-engine/samples'

const MOBILE_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(MOBILE_ROOT, '../..')
const FONT_DIR = resolve(MOBILE_ROOT, 'src/renderer/assets/fonts')
const mobileRequire = createRequire(join(MOBILE_ROOT, 'package.json'))
const pcRequire = createRequire(resolve(REPO_ROOT, 'apps/pdf/src/main/wasm-path.ts'))

/** Asset files exactly as the mobile bundle takes them (its own dependency resolution) */
function mobileAssetPath(asset: EngineAsset): string {
  if (asset === 'pdfium.wasm') return mobileRequire.resolve('@embedpdf/pdfium/pdfium.wasm')
  if (asset === 'hb-subset.wasm') return mobileRequire.resolve('harfbuzzjs/hb-subset.wasm')
  return join(FONT_DIR, BUNDLED_FONTS.find((f) => f.asset === asset)!.woff2)
}

const runDir = join(
  process.env.PDF_ENGINE_PARITY_DIR ?? tmpdir(),
  `pdf-engine-parity-${process.pid}-${Date.now()}`,
)

let cases: ParityCase[] = []
let pcResults: Record<string, ParityOutcome> = {}
const mobileResults = new Map<
  string,
  { ok: true; bytes?: Uint8Array; value?: unknown } | { ok: false; message: string }
>()
let restoreClock: () => void = () => {}
let engine: PdfEngine

async function runMobile(c: ParityCase): Promise<{ bytes?: Uint8Array; value?: unknown }> {
  const read = (name: string) => new Uint8Array(readFileSync(join(runDir, name)))
  switch (c.kind) {
    case 'save': {
      const { bytes, ...skips } = await engine.saveBytes(read(c.source), c.request)
      return { bytes, value: skips }
    }
    case 'apply':
      return { bytes: await engine.applyEdits(read(c.source), c.request) }
    case 'hasEdits':
      return { value: await engine.hasEdits(c.request) }
    case 'insertPdf': {
      const { merged, count } = await engine.insertPdf(
        read(c.source),
        read(c.other),
        c.afterPageIndex,
      )
      return { bytes: merged, value: count }
    }
    case 'insertBlankPage':
      return { bytes: await engine.insertBlankPage(read(c.source), c.afterPageIndex) }
    case 'blankPdf':
      return { bytes: await engine.blankPdf() }
    case 'flatten':
      return { bytes: await engine.flattenAnnots(read(c.source)) }
    case 'strip': {
      const out = await engine.stripCommentAnnots(read(c.source))
      return { bytes: out.bytes, value: out.removed }
    }
    case 'canDraw':
      return { value: await engine.canDrawText(c.text, c.font, c.bold, c.italic) }
    case 'listEditFonts':
      return { value: await engine.listEditFonts() }
  }
}

beforeAll(async () => {
  restoreClock = installFixedClock()
  mkdirSync(runDir, { recursive: true })
  const samples = await buildSamples()
  cases = samples.cases
  for (const [name, bytes] of Object.entries(samples.files))
    writeFileSync(join(runDir, name), bytes)
  writeFileSync(join(runDir, MANIFEST_FILE), JSON.stringify({ cases }))

  // PC reference: real Node, no stand-ins
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(__dirname, 'pdf-engine/pc-reference.mts'), runDir],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 240_000 },
  )
  if (child.status !== 0) {
    throw new Error(`PC reference run failed (${child.status}):\n${child.stderr}\n${child.stdout}`)
  }
  pcResults = JSON.parse(readFileSync(join(runDir, PC_RESULTS_FILE), 'utf8')) as typeof pcResults

  // Mobile: the same cases, in the same order, on the stand-ins
  setEngineAssetLoader(async (asset) => new Uint8Array(readFileSync(mobileAssetPath(asset))))
  engine = createInThreadPdfEngine()
  for (const [index, c] of cases.entries()) {
    setRandomSource(deterministicRandom(seedOf(index)))
    try {
      mobileResults.set(c.name, { ok: true, ...(await runMobile(c)) })
    } catch (error) {
      mobileResults.set(c.name, { ok: false, message: (error as Error).message })
    }
  }
}, 600_000)

afterAll(() => {
  restoreClock()
  setRandomSource(null)
  setEngineAssetLoader(null)
  if (!process.env.PDF_ENGINE_PARITY_KEEP) rmSync(runDir, { recursive: true, force: true })
})

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('mobile engine writes the PC bytes', () => {
  it('runs on the same wasm files as the PC code', () => {
    const same = (pcId: string, mobileId: string) =>
      sha(readFileSync(pcRequire.resolve(pcId))) ===
      sha(readFileSync(mobileRequire.resolve(mobileId)))
    expect(same('@embedpdf/pdfium/pdfium.wasm', '@embedpdf/pdfium/pdfium.wasm')).toBe(true)
    expect(same('harfbuzzjs/hb-subset.wasm', 'harfbuzzjs/hb-subset.wasm')).toBe(true)
  })

  it('places the fonts at paths the PC code really reads', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'apps/pdf/src/main/text-edit.ts'), 'utf8')
    for (const font of BUNDLED_FONTS) {
      // The first regular-weight path of the font's edit id, and the first fallback path
      const block = new RegExp(`${font.editFontId}: \\{\\s*regular: \\[\\s*'([^']+)'`).exec(source)
      expect(block?.[1]).toBe(font.paths[0])
    }
    expect(/FALLBACK_FONT_PATHS = \[\s*'([^']+)'/.exec(source)?.[1]).toBe(
      BUNDLED_FONTS[0]!.paths[1],
    )
  })

  it('knows every lazily loaded PC save stage (PDFium and fonts are loaded per request)', () => {
    // engine/core.ts requestNeedsPdfium/requestNeedsFonts mirror these stages; a new
    // stage in the PC save must be added there before this list is updated
    const source = readFileSync(resolve(REPO_ROOT, 'apps/pdf/src/main/save-pdf.ts'), 'utf8')
    const stages = [...source.matchAll(/await import\('\.\/([\w-]+)'\)/g)].map((m) => m[1])
    expect([...new Set(stages)].sort()).toEqual([
      'annot-delete',
      'annot-flatten',
      'annot-strip',
      'image-edit',
      'text-edit',
    ])
  })

  it('covers every sample the spec names', () => {
    expect(cases.length).toBeGreaterThan(25)
    expect(Object.keys(pcResults).sort()).toEqual(cases.map((c) => c.name).sort())
  })

  it.each([
    'markups',
    'ink drawing',
    'shapes',
    'note and reply',
    'image signature',
    'form values',
    'static check and cross marks',
    'page operations',
    'links',
    'text insert in bundled fonts',
    'text edit',
    'fresh password protection',
    'encrypted enc256.pdf keeps its protection',
    'encrypted enc128.pdf keeps its protection',
    'encrypted encrc4.pdf keeps its protection',
    'save as with flatten',
    'save as with strip',
    'unchanged save keeps the source bytes',
    'a refused request fails the same way',
    'apply edits (recovery copy shape)',
    'has edits: empty request',
    'has edits: one markup',
    'insert pages of another PDF',
    'insert a blank page',
    'blank PDF',
    'flatten saved annotations',
    'strip saved comments',
    'edit fonts',
    'can draw: common Hangul in Sans',
    'can draw: common Hangul in Serif bold',
    'can draw: common Hangul without a font',
    'can draw: rare Hangul',
    'can draw: Hanja',
    'can draw: circled digit',
  ])('%s', (name) => {
    const pc = pcResults[name]
    const mobile = mobileResults.get(name)
    expect(pc, 'PC run answered').toBeDefined()
    expect(mobile, 'mobile run answered').toBeDefined()
    if (!pc!.ok || !mobile!.ok) {
      // Only the deliberately refused request may fail, and then the same way on both
      expect(name).toBe('a refused request fails the same way')
      expect(mobile).toEqual(pc)
      return
    }
    expect(mobile!.value).toEqual(pc!.value)
    if (name in EXPECTED_VALUES) expect(mobile!.value).toEqual(EXPECTED_VALUES[name])
    if (pc!.bytesFile) {
      const pcBytes = readFileSync(join(runDir, pc!.bytesFile))
      expect(mobile!.bytes, 'mobile run produced bytes').toBeInstanceOf(Uint8Array)
      expect(mobile!.bytes!.byteLength).toBe(pcBytes.byteLength)
      expect(sha(mobile!.bytes!)).toBe(sha(pcBytes))
    } else {
      expect(mobile!.bytes).toBeUndefined()
    }
  })

  it('leaves an unchanged save byte-identical to the source', () => {
    const mobile = mobileResults.get('unchanged save keeps the source bytes')
    expect(mobile?.ok && sha(mobile.bytes!)).toBe(sha(readFileSync(join(runDir, 'base.pdf'))))
  })
})

describe('what the phone does not do', () => {
  it('refuses file writes outside the in-memory save sink', async () => {
    const { writePdfAtomically } = await import('../../pdf/src/main/atomic-write')
    await expect(writePdfAtomically('/storage/doc.pdf', new Uint8Array([1]))).rejects.toThrow(
      NOT_ON_MOBILE,
    )
    const fs = await import('../src/renderer/editors/pdf/engine/node-shims/fs')
    expect(() => fs.writeFileSync()).toThrow(NOT_ON_MOBILE)
  })

  it('refuses Electron', async () => {
    const { nativeImage } = await import('../src/renderer/editors/pdf/engine/node-shims/electron')
    expect(() => nativeImage.createFromBuffer()).toThrow(`${NOT_ON_MOBILE}: electron.nativeImage`)
  })
})
