// The Node-module stand-ins of the spreadsheet save path and the build
// plugin that scopes them to the save modules.
import { describe, expect, it } from 'vitest'
import { inSheetsSaveScope, sheetsBuild, sheetsNodeShimsPlugin } from '../config/tracks/sheets'
import { Buffer } from '../src/renderer/editors/sheets/node-shims/buffer'
import * as path from '../src/renderer/editors/sheets/node-shims/path'
import {
  FLUSH_CHUNK_BYTES,
  MobileVfs,
  type VfsBackend,
} from '../src/renderer/editors/sheets/node-shims/vfs'

/** Byte equality across realms (jsdom and Node each have their own Uint8Array). */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1)
    if (left[index] !== right[index]) return false
  return true
}

function memoryBackend() {
  const disk = new Map<string, Uint8Array>()
  const writes: { path: string; kind: 'text' | 'bytes'; append: boolean; size: number }[] = []
  const backend: VfsBackend = {
    mkdir: async () => {},
    remove: async (target) => {
      disk.delete(target)
    },
    rename: async (from, to) => {
      disk.set(to, disk.get(from)!)
      disk.delete(from)
    },
    copy: async (from, to) => {
      disk.set(to, disk.get(from)!.slice())
    },
    stat: async (target) => {
      const bytes = disk.get(target)
      return bytes ? { size: bytes.byteLength, isFile: true, isDir: false } : null
    },
    read: async (target, range) => {
      const bytes = disk.get(target)
      if (!bytes) throw new Error(`missing ${target}`)
      return range ? bytes.slice(range.offset, range.offset + range.length) : bytes.slice()
    },
    write: async (target, content, append) => {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
      writes.push({
        path: target,
        kind: typeof content === 'string' ? 'text' : 'bytes',
        append,
        size: bytes.byteLength,
      })
      const before = append ? (disk.get(target) ?? new Uint8Array()) : new Uint8Array()
      const next = new Uint8Array(before.byteLength + bytes.byteLength)
      next.set(before, 0)
      next.set(bytes, before.byteLength)
      disk.set(target, next)
    },
  }
  return { disk, writes, backend }
}

describe('the in-memory file layer', () => {
  it('serves a synchronous read only after the asynchronous prefetch, once', async () => {
    const { disk, backend } = memoryBackend()
    const vfs = new MobileVfs()
    vfs.configure(backend, '/w/')
    expect(vfs.tmpdir()).toBe('/w')
    disk.set('/w/e/entry-0.bin', new TextEncoder().encode('<sheet>한</sheet>'))
    expect(() => vfs.readFileSync('/w/e/entry-0.bin')).toThrow(/ENOENT/)
    await vfs.prefetch('/w/e/entry-0.bin')
    expect(vfs.stats().heldBytes).toBe(disk.get('/w/e/entry-0.bin')!.byteLength)
    expect(new TextDecoder().decode(vfs.readFileSync('/w/e/entry-0.bin'))).toBe('<sheet>한</sheet>')
    expect(vfs.stats().heldBytes).toBe(0)
    expect(() => vfs.readFileSync('/w/e/entry-0.bin')).toThrow(/ENOENT/)
  })

  it('keeps synchronous writes in memory until flushed, then hands them over in pieces', async () => {
    const { disk, writes, backend } = memoryBackend()
    const vfs = new MobileVfs()
    vfs.configure(backend, '/w')
    const descriptor = vfs.openSync('/w/s/replace-0.bin', 'wx')
    expect(() => vfs.openSync('/w/s/replace-0.bin', 'wx')).toThrow(/EEXIST/)
    // The gateway's chunked writer: each writeSync carries one encoded string slice.
    const text = '<row>가</row>'.repeat(400_000)
    const run = new TextEncoder().encode(text)
    for (let start = 0; start < text.length; start += 300_000) {
      const slice = new TextEncoder().encode(text.slice(start, start + 300_000))
      expect(vfs.writeSync(descriptor, slice, 0, slice.byteLength)).toBe(slice.byteLength)
    }
    vfs.fsyncSync(descriptor)
    vfs.closeSync(descriptor)
    expect(disk.has('/w/s/replace-0.bin')).toBe(false)
    expect(vfs.stats().heldBytes).toBe(run.byteLength)
    await vfs.flush('/w/s/replace-0.bin')
    expect(sameBytes(disk.get('/w/s/replace-0.bin')!, run)).toBe(true)
    expect(vfs.has('/w/s/replace-0.bin')).toBe(false)
    expect(vfs.stats().heldBytes).toBe(0)
    expect(vfs.stats().peakBytes).toBeGreaterThanOrEqual(run.byteLength)
    // First piece replaces, the rest append; none is larger than one message.
    expect(writes[0]!.append).toBe(false)
    expect(writes.slice(1).every((write) => write.append)).toBe(true)
    expect(writes.length).toBeGreaterThan(1)
    expect(writes.every((write) => write.size <= FLUSH_CHUNK_BYTES)).toBe(true)
    // Whole UTF-8 runs travel as text.
    expect(writes.every((write) => write.kind === 'text')).toBe(true)
  })

  it('sends bytes that are not UTF-8 as bytes, and an empty file as an empty write', async () => {
    const { disk, writes, backend } = memoryBackend()
    const vfs = new MobileVfs()
    vfs.configure(backend, '/w')
    vfs.writeFileSync('/w/s/add-bin-0.bin', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]), true)
    await vfs.flush('/w/s/add-bin-0.bin')
    expect(writes.at(-1)!.kind).toBe('bytes')
    expect([...disk.get('/w/s/add-bin-0.bin')!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0xff])
    const empty = vfs.openSync('/w/s/add-0.bin', 'wx')
    vfs.closeSync(empty)
    await vfs.flush('/w/s/add-0.bin')
    expect(disk.get('/w/s/add-0.bin')!.byteLength).toBe(0)
  })

  it('opens a file the engine wrote for fsync only, and forgets a folder on rm', async () => {
    const { backend } = memoryBackend()
    const vfs = new MobileVfs()
    vfs.configure(backend, '/w')
    const engineWritten = vfs.openSync('/w/.tmp.xlsx', 'r+')
    vfs.fsyncSync(engineWritten)
    expect(() => vfs.writeSync(engineWritten, new Uint8Array([1]))).toThrow(/EBADF/)
    vfs.closeSync(engineWritten)
    vfs.writeFileSync('/w/save-1/a.bin', new Uint8Array([1, 2]), true)
    vfs.writeFileSync('/w/save-1/b.bin', new Uint8Array([3]), true)
    vfs.writeFileSync('/w/save-10/c.bin', new Uint8Array([4]), true)
    vfs.forget('/w/save-1')
    expect(vfs.has('/w/save-1/a.bin')).toBe(false)
    expect(vfs.has('/w/save-10/c.bin')).toBe(true)
    expect(vfs.stats().heldBytes).toBe(1)
  })

  it('refuses to run before the work folder is set up', () => {
    const vfs = new MobileVfs()
    expect(() => vfs.tmpdir()).toThrow(/not set up/)
  })
})

describe('the Buffer and path stand-ins', () => {
  it('encode the way the gateway chunked writer uses them', () => {
    const buffer = Buffer.allocUnsafe(4 * 4)
    expect(buffer.write('a한b', 0, 'utf8')).toBe(5)
    expect(buffer.toString('utf8', 0, 5)).toBe('a한b')
    expect(Buffer.from('aGk=', 'base64').toString()).toBe('hi')
    expect(Buffer.from('hi').toString('base64')).toBe('aGk=')
    expect(Buffer.concat([Buffer.from('a'), Buffer.from('b')]).toString()).toBe('ab')
    expect(Buffer.from('ab').equals(new Uint8Array([97, 98]))).toBe(true)
  })

  it('join and split POSIX paths like Node', () => {
    expect(path.join('/w', 'ai-excel-save-ab12', 'extract-0')).toBe(
      '/w/ai-excel-save-ab12/extract-0',
    )
    expect(path.join('/w/x/', '../y')).toBe('/w/y')
    expect(path.dirname('/w/f-1.xlsx')).toBe('/w')
    expect(path.dirname('/f')).toBe('/')
    expect(path.basename('/w/book.xlsx', '.xlsx')).toBe('book')
    expect(path.extname('/w/book.tmp.xlsx')).toBe('.xlsx')
    expect(path.extname('/w/.hidden')).toBe('')
  })
})

describe('the stand-in build plugin', () => {
  const plugin = sheetsNodeShimsPlugin()
  const resolve = (source: string, importer: string) =>
    (plugin.resolveId as (s: string, i: string) => string | null)(source, importer)
  const transform = (code: string, id: string) =>
    (plugin.transform as (c: string, i: string) => { code: string } | null)(code, id)

  const gateway = 'E:/repo/packages/xlsx-gateway/src/gateway/xlsx-package-io.ts'
  const legacy = 'E:\\repo\\apps\\sheets\\src\\main\\legacy-import.ts'

  it('is part of the T1 build settings', () => {
    expect(sheetsBuild.plugins).toHaveLength(1)
    expect(sheetsBuild.plugins?.[0]?.name).toBe('ieum-sheets-node-shims')
  })

  it('replaces Node modules for the save importers only', () => {
    expect(resolve('node:fs', gateway)).toMatch(/node-shims\/fs\.ts$/)
    expect(resolve('node:fs/promises', gateway)).toMatch(/node-shims\/fs-promises\.ts$/)
    expect(resolve('node:os', gateway)).toMatch(/node-shims\/os\.ts$/)
    expect(resolve('node:path', gateway)).toMatch(/node-shims\/path\.ts$/)
    expect(resolve('node:crypto', gateway)).toMatch(/node-shims\/crypto\.ts$/)
    expect(resolve('jszip', gateway)).toMatch(/node-shims\/jszip\.ts$/)
    expect(resolve('node:fs/promises', legacy)).toMatch(/node-shims\/fs-promises\.ts$/)
    // The legacy conversion's JSZip is the gateway's business, not its own.
    expect(resolve('jszip', legacy)).toBeNull()
    expect(resolve('zod', gateway)).toBeNull()
  })

  it('leaves every other importer alone, in this track and others', () => {
    for (const importer of [
      'E:/repo/apps/mobile/src/renderer/editors/pdf/pdfKind.tsx',
      'E:/repo/apps/mobile/src/renderer/editors/hwpKind.tsx',
      'E:/repo/packages/docx2hwp/src/index.ts',
      'E:/repo/apps/sheets/src/main/sheets-main.ts',
      'E:/repo/packages/xlsx-gateway/src/domain/workbook-dsl.ts',
      'E:/repo/packages/xlsx-gateway/src/gateway/nested/deeper.ts',
      'E:/repo/apps/mobile/src/renderer/editors/sheets/node-shims/jszip.ts',
      undefined as unknown as string,
    ]) {
      for (const source of ['node:fs', 'node:fs/promises', 'node:path', 'node:crypto', 'jszip']) {
        expect(resolve(source, importer), `${source} from ${importer}`).toBeNull()
      }
      expect(inSheetsSaveScope(importer)).toBe(false)
    }
  })

  it('gives the save modules the stand-in Buffer where they use the Node global', () => {
    const code = 'const buffer = Buffer.allocUnsafe(4)\n'
    expect(transform(code, gateway)?.code).toMatch(
      /^import \{ Buffer \} from ".*node-shims\/buffer\.ts";\n/,
    )
    expect(transform(code, 'E:/repo/apps/mobile/src/renderer/x.ts')).toBeNull()
    expect(transform('const n = 1\n', gateway)).toBeNull()
    expect(
      transform("import { Buffer } from 'node:buffer'\nBuffer.from('a')\n", gateway),
    ).toBeNull()
  })
})
