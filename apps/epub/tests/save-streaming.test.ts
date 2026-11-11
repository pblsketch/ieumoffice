// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openEpub } from '@genoffice/epub-engine'
import { createBookFile, publishBookFile, snapshotBookFile } from '../src/main/book-file'
import { EpubBookSession } from '../src/main/book-session'
import { saveBook, type SaveDeps } from '../src/main/save-pipeline'
import { buildBook } from './helpers/book'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
const now = () => new Date('2026-11-10T00:00:00Z')

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ieum-epub-stream-test-'))
  dirs.push(dir)
  const path = join(dir, 'input.epub')
  const cache = join(dir, 'cache')
  const bytes = await buildBook({ extras: true })
  await writeFile(path, bytes)
  const opened = await EpubBookSession.openFile(path, cache, 0)
  if (!opened.ok) throw new Error(opened.reason)
  const deps: SaveDeps = {
    now,
    write: vi.fn(async () => {
      throw new Error('buffer writer used')
    }),
    streaming: { create: (produce) => createBookFile(cache, produce), publish: publishBookFile },
    store: () => ({
      migrateDocument: vi.fn(async () => ({ aiReadPages: 0, translationBlocks: 0, languages: [] })),
      listJobs: vi.fn(async () => []),
      readJob: vi.fn(),
      writeJob: vi.fn(),
    }),
  }
  return { s: opened.session, dir, path, cache, bytes, deps }
}

async function edit(s: EpubBookSession, text: string) {
  const chapter = await s.readChapter(0)
  if (!chapter.ok || chapter.broken) throw new Error('chapter refused')
  const result = await s.applyEdits(0, [{ op: 'replace', blockId: chapter.blocks[0]!.id, text }])
  if (!result.ok) throw new Error('edit refused')
  return { chapter, result }
}

describe('streamed file-backed save lifecycle', () => {
  it('keeps the same bytes, hash, chapter IDs and file-backed reads after repeated saves', async () => {
    const { s, path, deps, cache } = await fixture()
    try {
      const { chapter } = await edit(s, 'First save')
      const expected = await s.prepareSave({ now })
      if (!expected.result.ok || !expected.result.changed) throw new Error('save refused')
      const materialize = vi.spyOn(s, 'readBytes')
      const outcome = await saveBook(s, path, true, deps)
      expect(outcome).toMatchObject({ ok: true, written: true })
      const saved = await readFile(path)
      expect(new Uint8Array(saved)).toEqual(expected.result.bytes)
      expect(s.docHash).toBe(createHash('sha256').update(saved).digest('hex'))
      expect(() => s.bytes).toThrow(/file-backed/)
      expect(s.isDirty()).toBe(false)
      const after = await s.readChapter(0)
      if (!after.ok || after.broken) throw new Error('saved chapter refused')
      expect(after.blocks[0]!.id).toBe(chapter.blocks[0]!.id)
      await edit(s, 'Second save')
      expect(await saveBook(s, path, true, deps)).toMatchObject({ ok: true, written: true })
      expect(() => s.bytes).toThrow(/file-backed/)
      expect(materialize).not.toHaveBeenCalled()
      expect(deps.write).not.toHaveBeenCalled()
    } finally {
      await s.dispose()
    }
    expect(await readdir(cache)).toEqual([])
  })

  it('copies an unchanged Save As in chunks without creating a new archive', async () => {
    const { s, dir, path, bytes, deps } = await fixture()
    const create = vi.spyOn(deps.streaming!, 'create')
    const materialize = vi.spyOn(s, 'readBytes')
    try {
      expect(await saveBook(s, path, true, deps)).toMatchObject({ ok: true, written: false })
      const target = join(dir, 'copy.epub')
      expect(await saveBook(s, target, false, deps)).toMatchObject({ ok: true, written: true })
      expect(new Uint8Array(await readFile(target))).toEqual(bytes)
      expect(create).not.toHaveBeenCalled()
      expect(materialize).not.toHaveBeenCalled()
    } finally {
      await s.dispose()
    }
  })

  it('keeps edits that arrive during publication unsaved and preserves undo ranges', async () => {
    const { s, path, deps } = await fixture()
    try {
      await edit(s, 'Saved text')
      const publish = deps.streaming!.publish
      let latest: Awaited<ReturnType<typeof edit>> | undefined
      deps.streaming!.publish = async (...args) => {
        latest = await edit(s, 'Typed while saving')
        await publish(...args)
      }
      expect(await saveBook(s, path, true, deps)).toMatchObject({ ok: true, written: true })
      expect(s.isDirty()).toBe(true)
      const disk = await openEpub(new Uint8Array(await readFile(path)))
      if (!disk.ok || !latest) throw new Error('saved book refused')
      expect((await disk.book.readText(latest.chapter.path))!.text).toContain('Saved text')
      expect(await s.replaceRanges(0, latest.result.version, latest.result.inverse)).toMatchObject({
        ok: true,
      })
      expect(s.isDirty()).toBe(false)
    } finally {
      await s.dispose()
    }
  })

  it('leaves the old session and disk intact on failed publication and closes private output', async () => {
    const { s, path, bytes, cache, deps } = await fixture()
    try {
      const oldHash = s.docHash
      await edit(s, 'Unsaved text')
      deps.streaming!.publish = async () => {
        throw new Error('target locked')
      }
      await expect(saveBook(s, path, true, deps)).rejects.toThrow('target locked')
      expect(new Uint8Array(await readFile(path))).toEqual(bytes)
      expect(s.docHash).toBe(oldHash)
      expect(s.isDirty()).toBe(true)
      expect((await readdir(cache)).length).toBe(1)
      expect(await s.readChapter(1)).toMatchObject({ ok: true })
    } finally {
      await s.dispose()
    }
    expect(await readdir(cache)).toEqual([])
  })

  it('waits for a running save on close and does not resurrect its descriptor', async () => {
    const { s, path, deps, cache } = await fixture()
    await edit(s, 'Closing save')
    let started!: () => void
    const entered = new Promise<void>((done) => {
      started = done
    })
    let resume!: () => void
    const paused = new Promise<void>((done) => {
      resume = done
    })
    const publish = deps.streaming!.publish
    deps.streaming!.publish = async (...args) => {
      started()
      await paused
      await publish(...args)
    }
    const saving = saveBook(s, path, true, deps)
    await Promise.race([
      entered,
      saving.then(() => {
        throw new Error('save finished before publication')
      }),
    ])
    const closing = s.dispose()
    resume()
    expect(await saving).toMatchObject({ ok: true, written: true })
    await closing
    expect(await readdir(cache)).toEqual([])
    await expect(saveBook(s, path, true, deps)).rejects.toThrow(/closed/)
  })

  it('keeps a multi-read consumer alive across close and releases it exactly once', async () => {
    const { s, path, cache } = await fixture()
    await s.dispose()
    const source = await snapshotBookFile(path, cache)
    const lease = source.lease!()
    const closing = source.close()
    await expect(source.read(0, 1)).rejects.toThrow(/closed/)
    expect((await lease.read(0, 2)).length).toBe(2)
    expect((await lease.read(2, 2)).length).toBe(2)
    await Promise.all([lease.release(), lease.release()])
    await closing
    expect(await readdir(cache)).toEqual([])
  })
})
