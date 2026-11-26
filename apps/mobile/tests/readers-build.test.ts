// Build rule of track T5 readers: the PPTX engine's Node-only imports get mobile stand-ins,
// scoped to the engine's own src folder, and opening a deck gives the same result as Node.
import { createHash as nodeCreateHash } from 'node:crypto'
import { realpathSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import JSZip from 'jszip'
import type { Plugin } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { readersBuild } from '../config/tracks/readers'
import { createHash, randomUUID } from '../src/renderer/editors/readers/build/node-shims/crypto'
import { Buffer as ShimBuffer } from '../src/renderer/editors/readers/build/node-shims/buffer'
import * as fsShim from '../src/renderer/editors/readers/build/node-shims/fs'
import * as streamShim from '../src/renderer/editors/readers/build/node-shims/stream-promises'
import * as zlibShim from '../src/renderer/editors/readers/build/node-shims/zlib'
import {
  PPTX_ENGINE_SRC,
  inPptxShimScope,
  pptxNodeShims,
} from '../src/renderer/editors/readers/build/pptxNodeShims'

// Counts the stand-in hash calls, so the deck test proves the engine really reached the stand-in.
const hashCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('../src/renderer/editors/readers/build/node-shims/crypto', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../src/renderer/editors/readers/build/node-shims/crypto')>()
  return {
    ...real,
    createHash: (algorithm: string) => {
      hashCalls.count++
      return real.createHash(algorithm)
    },
  }
})

const fwd = (p: string): string => p.replace(/\\/g, '/')
const require = createRequire(import.meta.url)

function engineSrcFromNode(): string {
  return fwd(realpathSync(dirname(require.resolve('@genoffice/pptx-engine'))))
}

function nodeHex(input: Uint8Array | string): string {
  return nodeCreateHash('sha256').update(input).digest('hex')
}

function pseudoRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  let seed = 0x2545f491
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    out[i] = seed & 0xff
  }
  return out
}

describe('crypto stand-in', () => {
  const inputs: [string, Uint8Array | string][] = [
    ['empty bytes', new Uint8Array(0)],
    ['empty string', ''],
    ['ascii', 'hello, slides'],
    ['multi-byte', '한글 슬라이드 ☃ 🎉 日本語'],
    ['large', pseudoRandomBytes(3 * 1024 * 1024 + 7)],
  ]

  it.each(inputs)('hashes %s exactly like Node', (_name, input) => {
    expect(createHash('sha256').update(input).digest('hex')).toBe(nodeHex(input))
  })

  it('chains several updates like Node', () => {
    const parts = ['ab', new Uint8Array([0xc3, 0xa9, 0, 255]), '끝']
    const ours = createHash('sha256')
    const node = nodeCreateHash('sha256')
    for (const part of parts) {
      expect(ours.update(part)).toBe(ours)
      node.update(part)
    }
    expect(ours.digest('hex')).toBe(node.digest('hex'))
  })

  it('refuses what it does not implement', () => {
    expect(() => createHash('md5')).toThrow(/sha256/)
    expect(() =>
      createHash('sha256')
        .update('x')
        .digest('base64' as 'hex'),
    ).toThrow(/hex/)
  })

  it('makes v4 UUIDs', () => {
    const a = randomUUID()
    const b = randomUUID()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})

describe('write-only stand-ins', () => {
  it('say the mobile reader cannot write', () => {
    expect(() => zlibShim.deflateSync(new Uint8Array(1))).toThrow(
      /not available in the mobile reader/,
    )
    expect(() => fsShim.createWriteStream('x.pptx')).toThrow(/not available in the mobile reader/)
    expect(() => streamShim.pipeline()).toThrow(/not available in the mobile reader/)
  })

  it('give the buffer package Buffer, which decodes like Node', () => {
    const text = '한글 ☃ 🎉'
    expect(ShimBuffer.from(new Uint8Array(Buffer.from(text, 'utf8'))).toString('utf8')).toBe(text)
    expect([...ShimBuffer.from(text, 'utf8')]).toEqual([...Buffer.from(text, 'utf8')])
  })
})

describe('stand-in scope', () => {
  it('is the real (symlink-resolved) src folder of the installed engine', () => {
    expect(PPTX_ENGINE_SRC).toBe(engineSrcFromNode())
    expect(PPTX_ENGINE_SRC.endsWith('/packages/pptx-engine/src')).toBe(true)
  })

  it('covers modules under the engine src, and nothing else', () => {
    expect(inPptxShimScope(`${PPTX_ENGINE_SRC}/zip.ts`)).toBe(true)
    expect(inPptxShimScope(`${PPTX_ENGINE_SRC}/vendor/mtx/index.ts?v=1`)).toBe(true)
    const root = PPTX_ENGINE_SRC.slice(0, -'/packages/pptx-engine/src'.length)
    expect(inPptxShimScope(`${root}/apps/mobile/src/renderer/App.tsx`)).toBe(false)
    expect(inPptxShimScope(`${root}/packages/pptx-render/src/index.ts`)).toBe(false)
    expect(inPptxShimScope(`${root}/packages/pptx-engine/tests/x.test.ts`)).toBe(false)
    expect(inPptxShimScope(`${root}/packages/pptx-engine/src-other/x.ts`)).toBe(false)
    expect(inPptxShimScope(resolve(__dirname, '../src/renderer/App.tsx'))).toBe(false)
    expect(inPptxShimScope(undefined)).toBe(false)
  })

  it.runIf(process.platform === 'win32')(
    'matches Windows paths whatever the slashes and case',
    () => {
      const native = PPTX_ENGINE_SRC.replace(/\//g, '\\')
      const flipped =
        native[0] === native[0]!.toUpperCase() ? native[0]!.toLowerCase() : native[0]!.toUpperCase()
      expect(inPptxShimScope(`${flipped}${native.slice(1)}\\zip.ts`)).toBe(true)
    },
  )
})

describe('pptx stand-in plugin', () => {
  const plugin = pptxNodeShims()
  type ResolveFn = (source: string, importer?: string) => string | null
  type TransformFn = (code: string, id: string) => { code: string } | null
  const resolveId = plugin.resolveId as unknown as ResolveFn
  const transform = plugin.transform as unknown as TransformFn
  const engineFile = `${PPTX_ENGINE_SRC}/zip.ts`

  it('is the readers track build plugin, running before the others', () => {
    expect(readersBuild.plugins?.map((p: Plugin) => p.name)).toEqual([plugin.name])
    expect(plugin.enforce).toBe('pre')
  })

  it.each([
    ['node:crypto', 'crypto.ts'],
    ['crypto', 'crypto.ts'],
    ['node:zlib', 'zlib.ts'],
    ['zlib', 'zlib.ts'],
    ['node:fs', 'fs.ts'],
    ['fs', 'fs.ts'],
    ['node:stream/promises', 'stream-promises.ts'],
    ['stream/promises', 'stream-promises.ts'],
  ])('redirects %s from an engine module to its stand-in', (specifier, file) => {
    const id = resolveId.call({}, specifier, engineFile)
    expect(id).toBeTypeOf('string')
    expect(id).not.toContain('\\')
    expect(id!.endsWith(`/editors/readers/build/node-shims/${file}`)).toBe(true)
  })

  it('leaves other importers and other specifiers alone', () => {
    const other = fwd(resolve(__dirname, '../src/renderer/App.tsx'))
    expect(resolveId.call({}, 'node:crypto', other)).toBeNull()
    expect(resolveId.call({}, 'node:crypto', undefined)).toBeNull()
    expect(resolveId.call({}, 'jszip', engineFile)).toBeNull()
    expect(resolveId.call({}, './types', engineFile)).toBeNull()
  })

  it('injects the Buffer stand-in into engine modules that use Buffer, keeping line numbers', () => {
    const code =
      "import JSZip from 'jszip'\nexport const t = (b) => Buffer.from(b).toString('utf8')\n"
    const out = transform.call({}, code, engineFile)
    expect(out).not.toBeNull()
    expect(out!.code.split('\n')).toHaveLength(code.split('\n').length)
    expect(out!.code).toMatch(/^import \{ Buffer \} from "[^"\\]*\/node-shims\/buffer\.ts";/)
    expect(out!.code.endsWith(code)).toBe(true)
  })

  it('injects nothing elsewhere, nor where Buffer is unused or bound locally', () => {
    const code = 'export const t = Buffer.alloc(1)\n'
    expect(transform.call({}, code, fwd(resolve(__dirname, '../src/renderer/App.tsx')))).toBeNull()
    expect(transform.call({}, 'export const x = 1\n', engineFile)).toBeNull()
    expect(transform.call({}, "import { Buffer } from 'buffer'\n" + code, engineFile)).toBeNull()
    expect(transform.call({}, code, `${PPTX_ENGINE_SRC}/data.json`)).toBeNull()
  })
})

describe('opening a deck through the stand-ins (jsdom)', () => {
  const fixtures = join(PPTX_ENGINE_SRC, '../tests/fixtures')
  const decks = readdirSync(fixtures).filter((name) => name.endsWith('.pptx'))

  it('has fixture decks to open', () => {
    expect(decks.length).toBeGreaterThan(0)
  })

  it.each(decks)('opens %s with the slide count and hash Node computes', async (name) => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, name)))
    const zip = await JSZip.loadAsync(bytes)
    const expectedSlides = Object.keys(zip.files).filter((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    ).length
    const before = hashCalls.count
    const { openPptx } = await import('@genoffice/pptx-engine')
    const opened = await openPptx(bytes)
    expect(hashCalls.count).toBeGreaterThan(before)
    expect(opened.deck.slides).toHaveLength(expectedSlides)
    expect(opened.deck.originalHash).toBe(nodeHex(bytes))
  })
})
