// @vitest-environment node
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { EpubBookSession } from '../src/main/book-session'
import { buildBook, xhtml } from './helpers/book'

async function bookWithChapters(count = 24, firstBody = '<p>Another paragraph.</p>') {
  const zip = await JSZip.loadAsync(await buildBook())
  const opf = zip.file('OEBPS/content.opf')!
  let manifest = ''
  let spine = ''
  for (let i = 0; i < count; i++) {
    manifest += `<item id="extra${i}" href="text/extra${i}.xhtml" media-type="application/xhtml+xml"/>`
    spine += `<itemref idref="extra${i}"/>`
    zip.file(
      `OEBPS/text/extra${i}.xhtml`,
      xhtml(`Extra ${i}`, i === 0 ? firstBody : `<p>Chapter ${i}.</p>`),
    )
  }
  zip.file(
    'OEBPS/content.opf',
    (await opf.async('string'))
      .replace('</manifest>', manifest + '</manifest>')
      .replace('</spine>', spine + '</spine>'),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}

async function session(count = 24, firstBody?: string) {
  const opened = await EpubBookSession.open(await bookWithChapters(count, firstBody))
  if (!opened.ok) throw new Error(opened.reason)
  return opened.session
}
async function chapter(s: EpubBookSession, index: number) {
  const result = await s.readChapter(index)
  if (!result.ok || result.broken) throw new Error('chapter unavailable')
  return result
}

describe('bounded reconstructible EPUB chapter models', () => {
  it('reloads old untouched models without changing source, block IDs, version or save state', async () => {
    const s = await session()
    const read = vi.spyOn(s.book, 'readText')
    const first = await chapter(s, 0)
    for (let i = 1; i < s.book.spine.items.length; i++) await chapter(s, i)
    expect(await chapter(s, 0)).toEqual(first)
    expect(read.mock.calls.filter(([path]) => path === first.path)).toHaveLength(2)
    expect(s.isDirty()).toBe(false)
    expect((await s.prepareSave()).result).toEqual({ ok: true, changed: false })
  })

  it('retains a recently read model while walking through the rest of a book', async () => {
    const s = await session()
    const read = vi.spyOn(s.book, 'readText')
    const first = await chapter(s, 0)
    for (let i = 1; i < s.book.spine.items.length; i++) {
      await chapter(s, i)
      await chapter(s, 0)
    }
    expect(read.mock.calls.filter(([path]) => path === first.path)).toHaveLength(1)
  })

  it('keeps an edited then undone chapter and its outside-block redo authorization across cache churn and saving', async () => {
    const s = await session()
    const read = vi.spyOn(s.book, 'readText')
    const first = await chapter(s, 0)
    const paragraph = first.blocks.find((block) => block.kind === 'p')!
    const split = await s.applyEdits(0, [{ op: 'split', blockId: paragraph.id, offset: 5 }])
    if (!split.ok) throw new Error(split.message)
    const undone = await s.replaceRanges(0, split.version, split.inverse)
    if (!undone.ok) throw new Error(undone.message)
    expect(undone.source).toBe(first.source)
    expect(s.isDirty()).toBe(false)
    for (let i = 1; i < s.book.spine.items.length; i++) await chapter(s, i)
    expect((await chapter(s, 0)).version).toBe(undone.version)
    expect(read.mock.calls.filter(([path]) => path === first.path)).toHaveLength(1)
    const redone = await s.replaceRanges(0, undone.version, split.replacements)
    if (!redone.ok) throw new Error(redone.message)
    expect(redone.source).toBe(split.source)
    const prepared = await s.prepareSave()
    if (!prepared.result.ok || !prepared.result.changed) throw new Error('no saved changes')
    await s.rebase(prepared.result.bytes, prepared.snapshot)
    expect((await chapter(s, 0)).source).toBe(redone.source)
    expect(s.isDirty()).toBe(false)
    const restored = await s.replaceRanges(0, redone.version, split.inverse)
    expect(restored.ok && restored.source).toBe(first.source)
  })

  it('coalesces simultaneous reads of one chapter', async () => {
    const s = await session()
    const original = s.book.readText.bind(s.book)
    let release!: () => void
    const gate = new Promise<void>((done) => {
      release = done
    })
    const read = vi.spyOn(s.book, 'readText').mockImplementation(async (path) => {
      await gate
      return original(path)
    })
    const requests = Array.from({ length: 6 }, () => chapter(s, 0))
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    release()
    const results = await Promise.all(requests)
    expect(results.every((result) => result.source === results[0]!.source)).toBe(true)
  })

  it('limits concurrent entry decodes even with many different chapter requests', async () => {
    const s = await session()
    const original = s.book.readText.bind(s.book)
    let release!: () => void
    const gate = new Promise<void>((done) => {
      release = done
    })
    let active = 0
    let maximum = 0
    vi.spyOn(s.book, 'readText').mockImplementation(async (path) => {
      active++
      maximum = Math.max(maximum, active)
      try {
        await gate
        return await original(path)
      } finally {
        active--
      }
    })
    const requests = Array.from({ length: 20 }, (_, index) => chapter(s, index))
    await Promise.resolve()
    expect(maximum).toBe(2)
    release()
    await Promise.all(requests)
    expect(maximum).toBe(2)
    expect(active).toBe(0)
  })

  it('retries an in-flight entry against the new archive after a save replaces its source', async () => {
    const s = await session()
    const oldBook = s.book
    const original = oldBook.readText.bind(oldBook)
    let release!: () => void
    const gate = new Promise<void>((done) => {
      release = done
    })
    vi.spyOn(oldBook, 'readText').mockImplementation(async (path) => {
      await gate
      return original(path)
    })
    const pending = chapter(s, 1)
    const zip = await JSZip.loadAsync(s.bytes)
    const source = xhtml('Two', '<p>Text from the replacement archive.</p>')
    zip.file('OEBPS/text/two.xhtml', source)
    await s.rebase(await zip.generateAsync({ type: 'uint8array' }), new Map())
    release()
    expect((await pending).source).toBe(source)
  })

  it('does not retain one model whose node weight exceeds the clean-cache budget', async () => {
    const s = await session(1, '<p>x</p>'.repeat(40000))
    const read = vi.spyOn(s.book, 'readText')
    expect((await chapter(s, 2)).blocks).toHaveLength(40000)
    expect((await chapter(s, 2)).blocks).toHaveLength(40000)
    expect(read.mock.calls.filter(([path]) => path === 'OEBPS/text/extra0.xhtml')).toHaveLength(2)
  })
})
