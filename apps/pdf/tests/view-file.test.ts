// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { readSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { snapshotPdfViewFile, type PdfViewFile } from '../src/main/view-file'
import { PDF_VIEW_RANGE_CHUNK_BYTES as CHUNK } from '../src/shared/view-source'

const roots: string[] = []
const files: PdfViewFile[] = []
async function fixture(bytes: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-view-file-test-'))
  roots.push(root)
  const path = join(root, 'source.pdf')
  await writeFile(path, bytes)
  const file = await snapshotPdfViewFile(path, join(root, 'cache'))
  files.push(file)
  return { root, path, file }
}
afterEach(async () => {
  await Promise.all(files.splice(0).map((file) => file.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('immutable PDF view input', () => {
  it('keeps old bytes and a readable descriptor after the original changes or disappears', async () => {
    const original = new TextEncoder().encode('%PDF old body /XFA 5 0 R')
    const { path, file, root } = await fixture(original)
    await writeFile(path, 'external replacement')
    await unlink(path)
    expect(await file.read(0, original.length)).toEqual(original)
    const direct = new Uint8Array(original.length)
    expect(readSync(file.fd, direct, 0, direct.length, 0)).toBe(original.length)
    expect(direct).toEqual(original)
    expect(file.diskState?.hash).toBe(createHash('sha256').update(original).digest('hex'))
    expect(file.hasXfa).toBe(true)
    const [dir] = await readdir(join(root, 'cache'))
    expect(await readdir(join(root, 'cache', dir!))).toEqual([])
  })

  it.each([-4, -3, -2, -1, 0, 1, 2])(
    'scans a token across chunk offset %i and hashes each byte once',
    async (offset) => {
      const bytes = new Uint8Array(CHUNK + 80).fill(97)
      bytes.set(new TextEncoder().encode('/XFA 5 0 R'), CHUNK + offset)
      const { file } = await fixture(bytes)
      expect(file.hasXfa).toBe(true)
      expect(file.diskState?.hash).toBe(createHash('sha256').update(bytes).digest('hex'))
    },
  )

  it('does not treat the end of an intermediate scan window as the end of the file', async () => {
    const bytes = new Uint8Array(CHUNK + 80).fill(97)
    bytes.set(new TextEncoder().encode('/XFAfoo'), CHUNK)
    const { file } = await fixture(bytes)
    expect(file.hasXfa).toBe(false)
  })

  it('accepts a token at the true end of a large file', async () => {
    const bytes = new Uint8Array(CHUNK + 40).fill(97)
    bytes.set(new TextEncoder().encode('/XFA'), bytes.length - 4)
    const { file } = await fixture(bytes)
    expect(file.hasXfa).toBe(true)
  })

  it('pins recovery bytes even if the original path no longer exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pdf-view-recovery-test-'))
    roots.push(root)
    const bytes = new TextEncoder().encode('recovered document')
    const file = await snapshotPdfViewFile(join(root, 'missing.pdf'), join(root, 'cache'), bytes)
    files.push(file)
    expect(await file.read(0, bytes.length)).toEqual(bytes)
    expect(file.diskState).toBeNull()
  })

  it('rejects oversized/out-of-bounds reads and closes only after active reads finish', async () => {
    const bytes = new Uint8Array(CHUNK).fill(23)
    const { file } = await fixture(bytes)
    for (const [offset, length] of [
      [-1, 1],
      [0.5, 1],
      [0, CHUNK + 1],
      [CHUNK, 1],
    ])
      await expect(file.read(offset!, length!)).rejects.toThrow()
    const pending = file.read(0, CHUNK)
    const closed = file.close()
    expect(await pending).toEqual(bytes)
    await closed
    await expect(file.read(0, 1)).rejects.toThrow('closed')
  })
})
