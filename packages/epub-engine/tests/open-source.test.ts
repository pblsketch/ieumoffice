import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { ZipByteSource } from '@genoffice/zip-gate'
import { openEpub, openEpubSource, saveEpub } from '../src/core'
import { buildEpub, epub3Files } from './helpers'

function source(bytes: Uint8Array) {
  const reads: Array<[number, number]> = []
  const reader: ZipByteSource = {
    size: bytes.length,
    async read(at, length) {
      reads.push([at, length])
      return new Uint8Array(bytes.subarray(at, at + length))
    },
  }
  return { reader, reads }
}

describe('immutable random-access EPUBs', () => {
  it('rejects overstated package metadata just as the memory-backed reader does', async () => {
    const bytes = await buildEpub(epub3Files())
    const needle = new TextEncoder().encode('OEBPS/content.opf')
    let at = bytes.length - 22
    while (at >= 0 && !needle.every((value, i) => bytes[at + i] === value)) at--
    const view = new DataView(bytes.buffer)
    view.setUint32(at - 46 + 24, view.getUint32(at - 46 + 24, true) + 1, true)
    expect(await openEpub(bytes)).toMatchObject({ ok: false, reason: 'damaged' })
    expect(await openEpubSource(source(bytes).reader)).toMatchObject({
      ok: false,
      reason: 'damaged',
    })
  })
  it('opens the same book and preserves every saved byte as the in-memory path', async () => {
    const bytes = await buildEpub(epub3Files())
    const a = await openEpub(bytes)
    const b = await openEpubSource(source(bytes).reader)
    if (!a.ok || !b.ok) throw new Error('fixture failed to open')
    expect(b.book.metadata).toEqual(a.book.metadata)
    expect(b.book.toc).toEqual(a.book.toc)
    expect(b.book.entryNames).toEqual(a.book.entryNames)
    for (const path of a.book.entryNames)
      expect(await b.book.read(path)).toEqual(await a.book.read(path))
    const path = a.book.spine.items[0]!.path
    const chapter = (await a.book.readText(path))!.text
    const at = chapter.indexOf('<h1>') + 4
    const edit = { [path]: [{ start: at, end: chapter.indexOf('</h1>', at), text: 'Changed' }] }
    const options = { now: () => new Date('2026-11-10T00:00:00Z') }
    expect(await saveEpub(b.book, edit, options)).toEqual(await saveEpub(a.book, edit, options))
  })

  it('does not materialize stored media or a no-op save', async () => {
    const zip = await JSZip.loadAsync(await buildEpub(epub3Files()))
    zip.file('OEBPS/images/large.png', new Uint8Array(4 * 1024 * 1024), { compression: 'STORE' })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const { reader, reads } = source(bytes)
    const opened = await openEpubSource(reader)
    if (!opened.ok) throw new Error(opened.detail)
    const before = reads.length
    expect(await saveEpub(opened.book, {})).toEqual({ ok: true, changed: false })
    expect(reads.length).toBe(before)
    expect(reads.reduce((n, [, length]) => n + length, 0)).toBeLessThan(256 * 1024)
    const media = await opened.book.read('OEBPS/images/large.png')
    expect(media?.length).toBe(4 * 1024 * 1024)
    expect(media?.every((byte) => byte === 0)).toBe(true)
  })

  it('keeps JSZip Unicode names and normalized names', async () => {
    const zip = await JSZip.loadAsync(await buildEpub(epub3Files()))
    zip.file('OEBPS/그림.png', new Uint8Array([1, 2, 3]), { comment: '그림 설명' })
    zip.file('OEBPS/folder/../normalized.png', new Uint8Array([4, 5, 6]))
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      encodeFileName: (name: string) =>
        Array.from(name, (c) => String.fromCharCode(c.charCodeAt(0) & 0xff)).join(''),
    })
    const a = await openEpub(bytes)
    const b = await openEpubSource(source(bytes).reader)
    if (!a.ok || !b.ok) throw new Error('fixture failed to open')
    expect(b.book.entryNames).toEqual(a.book.entryNames)
    expect(await b.book.read('OEBPS/그림.png')).toEqual(new Uint8Array([1, 2, 3]))
    expect(await b.book.read('OEBPS/normalized.png')).toEqual(new Uint8Array([4, 5, 6]))
  })

  it('rejects DRM, invalid packages and forged sizes through the source path too', async () => {
    const drm = await buildEpub({ ...epub3Files(), 'META-INF/rights.xml': '<rights/>' })
    expect(await openEpubSource(source(drm).reader)).toMatchObject({ ok: false, reason: 'drm' })
    const notEpub = await new JSZip().generateAsync({ type: 'uint8array' })
    expect(await openEpubSource(source(notEpub).reader)).toMatchObject({
      ok: false,
      reason: 'not-epub',
    })
    const zip = await JSZip.loadAsync(await buildEpub(epub3Files()))
    zip.file('bomb', new Uint8Array(1024 * 1024), { compression: 'DEFLATE' })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const needle = new TextEncoder().encode('bomb')
    let at = bytes.length - 22
    while (at >= 0 && !needle.every((value, i) => bytes[at + i] === value)) at--
    new DataView(bytes.buffer).setUint32(at - 46 + 24, 10, true)
    expect(await openEpubSource(source(bytes).reader)).toMatchObject({
      ok: false,
      reason: 'too-large',
    })
  })
})
