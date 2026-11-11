// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openEpub } from '@genoffice/epub-engine'
import { isModifiedSince } from '../../../packages/electron-utils/src/save-conflict'
import { snapshotBookFile } from '../src/main/book-file'
import { EpubBookSession } from '../src/main/book-session'
import { buildBook } from './helpers/book'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ieum-epub-file-test-'))
  dirs.push(dir)
  const path = join(dir, 'input.epub')
  const cache = join(dir, 'cache')
  const bytes = await buildBook({ extras: true })
  await writeFile(path, bytes)
  return { dir, path, cache, bytes }
}

describe('file-backed book session', () => {
  it('lets an in-flight multi-chunk read finish before closing its descriptor', async () => {
    const { path, cache } = await fixture()
    const bytes = new Uint8Array(2 * 1024 * 1024 + 19).fill(0x5a)
    await writeFile(path, bytes)
    const source = await snapshotBookFile(path, cache)
    const hashing = source.docHash()
    const closing = source.close()
    expect(await hashing).toBe(createHash('sha256').update(bytes).digest('hex'))
    await closing
    expect(await readdir(cache)).toEqual([])
  })
  it('pins original bytes across external changes, preserves SHA-256, and reclaims its snapshot', async () => {
    const { path, cache, bytes } = await fixture()
    const source = await snapshotBookFile(path, cache)
    try {
      await writeFile(path, 'external change')
      expect(await source.docHash()).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(await source.read(0, bytes.length)).toEqual(bytes)
      await expect(source.read(-1, 1)).rejects.toThrow(/outside/)
    } finally {
      await source.close()
    }
    expect(await readdir(cache)).toEqual([])
    await expect(source.read(0, 1)).rejects.toThrow(/closed/)
  })

  it('reads, edits, saves and rebases through the same original-preserving writer', async () => {
    const { path, cache, bytes } = await fixture()
    const opened = await EpubBookSession.openFile(path, cache, 0)
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error(opened.reason)
    const session = opened.session
    try {
      const disk = await stat(path)
      expect(session.initialDiskState).toEqual({
        mtimeMs: disk.mtimeMs,
        size: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      })
      await writeFile(path, 'external edit after open')
      expect(await isModifiedSince(session.initialDiskState!, path)).toBe(true)
      const initial = await session.prepareSave()
      expect(initial.result).toEqual({ ok: true, changed: false })
      expect(await session.readBytes()).toEqual(bytes)
      const chapter = await session.readChapter(0)
      if (!chapter.ok || chapter.broken) throw new Error('fixture chapter did not open')
      const result = await session.applyEdits(0, [
        { op: 'replace', blockId: chapter.blocks[0]!.id, text: 'Changed title' },
      ])
      expect(result.ok).toBe(true)
      const saved = await session.prepareSave({ now: () => new Date('2026-11-10T00:00:00Z') })
      if (!saved.result.ok || !saved.result.changed) throw new Error('save did not change the book')
      const read = await openEpub(saved.result.bytes)
      if (!read.ok) throw new Error(read.detail)
      expect((await read.book.readText(chapter.path))?.text).toContain('Changed title')
      expect(await read.book.read('OEBPS/images/pic.png')).toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
      )
      await session.rebase(saved.result.bytes, saved.snapshot)
      expect(session.isDirty()).toBe(false)
      expect(await readdir(cache)).toEqual([])
    } finally {
      await session.dispose()
    }
  })

  it('cleans refused books without leaving snapshot files', async () => {
    const { path, cache } = await fixture()
    await writeFile(path, 'not a zip')
    expect(await EpubBookSession.openFile(path, cache, 0)).toEqual({ ok: false, reason: 'damaged' })
    expect(await readdir(cache)).toEqual([])
  })
})
