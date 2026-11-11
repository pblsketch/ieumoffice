import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ZipByteSource } from '@genoffice/zip-gate'
import { openEpub, openEpubSource, prepareEpubSave, saveEpub } from '../src/core'
import { buildEpub, epub3Files } from './helpers'

const now = () => new Date('2026-11-10T00:00:00Z')

async function fixture(compression: 'STORE' | 'DEFLATE') {
  const zip = await JSZip.loadAsync(await buildEpub(epub3Files()))
  const media = new Uint8Array(4 * 1024 * 1024 + 71)
  for (let i = 0; i < media.length; i++) media[i] = (i * 137 + (i >> 9)) & 255
  zip.file('OEBPS/그림.bin', media, {
    compression,
    comment: '그림 설명',
    date: now(),
    unixPermissions: 0o100640,
  })
  zip.file('OEBPS/folder/../normalized.bin', new Uint8Array([7, 8, 9]), {
    compression,
    comment: 'comment',
  })
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'UNIX',
    comment: 'original archive comment',
  })
}

function source(bytes: Uint8Array) {
  const reads: number[] = []
  const reader: ZipByteSource = {
    size: bytes.length,
    async read(at, length) {
      reads.push(length)
      if (length > 1024 * 1024) throw new Error('whole-archive read')
      return bytes.slice(at, at + length)
    },
  }
  return { reader, reads }
}

async function edits(book: Awaited<ReturnType<typeof openEpub>> & { ok: true }) {
  const path = book.book.spine.items[0]!.path
  const chapter = (await book.book.readText(path))!.text
  const at = chapter.indexOf('</body>')
  return new Map([[path, [{ start: at, end: at, text: '<p id="added">새 글</p>' }]]])
}

describe('streamed EPUB saves', () => {
  it.each(['STORE', 'DEFLATE'] as const)(
    'preserves every writer byte and metadata with %s media',
    async (compression) => {
      const bytes = await fixture(compression)
      const memory = await openEpub(bytes)
      const input = source(bytes)
      const opened = await openEpubSource(input.reader)
      if (!memory.ok || !opened.ok) throw new Error('fixture refused')
      const changes = await edits(memory)
      const expected = await saveEpub(memory.book, changes, { now })
      const plan = await prepareEpubSave(opened.book, changes, { now })
      if (!expected.ok || !expected.changed || !plan.ok || !plan.changed)
        throw new Error('save refused')
      const chunks: Uint8Array[] = []
      let writing = false
      await plan.write(async (chunk) => {
        expect(writing).toBe(false)
        writing = true
        await Promise.resolve()
        chunks.push(chunk)
        writing = false
      })
      const actual = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0))
      let at = 0
      for (const chunk of chunks) {
        actual.set(chunk, at)
        at += chunk.length
      }
      expect(actual.length).toBe(expected.bytes.length)
      expect(createHash('sha256').update(actual).digest('hex')).toBe(
        createHash('sha256').update(expected.bytes).digest('hex'),
      )
      expect(Math.max(...input.reads)).toBeLessThanOrEqual(1024 * 1024)
      expect(chunks.length).toBeGreaterThan(8)
      const reloaded = await openEpub(actual)
      if (!reloaded.ok) throw new Error(reloaded.detail)
      expect((await reloaded.book.readText(reloaded.book.spine.items[0]!.path))!.text).toContain(
        '새 글',
      )
    },
  )

  it('stops upstream source reads when the sink fails', async () => {
    const bytes = await fixture('STORE')
    const input = source(bytes)
    const opened = await openEpubSource(input.reader)
    if (!opened.ok) throw new Error(opened.detail)
    const plan = await prepareEpubSave(opened.book, await edits(opened), { now })
    if (!plan.ok || !plan.changed) throw new Error('save refused')
    await expect(
      plan.write(async () => {
        throw new Error('disk full')
      }),
    ).rejects.toThrow('disk full')
    // Failure at mimetype must not start reading the later multi-MiB media.
    expect(input.reads.every((length) => length < 1024 * 1024)).toBe(true)
  })
})
