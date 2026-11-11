import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { documentHashOfFile } from '../src/store'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, open: vi.fn(original.open) }
})

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ieum-shared-file-hash-'))
  vi.mocked(open).mockClear()
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it('reads a large file once for concurrent callers and rechecks after completion', async () => {
  const path = join(directory, 'document.pdf')
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 13, 0x5a)
  bytes[bytes.length - 1] = 7
  writeFileSync(path, bytes)
  const expected = createHash('sha256').update(bytes).digest('hex')
  const hashes = await Promise.all(Array.from({ length: 12 }, () => documentHashOfFile(path)))
  expect(hashes).toEqual(Array(12).fill(expected))
  expect(open).toHaveBeenCalledTimes(1)
  writeFileSync(path, 'new content')
  expect(await documentHashOfFile(path)).toBe(
    createHash('sha256').update('new content').digest('hex'),
  )
  expect(open).toHaveBeenCalledTimes(2)
})

it('keeps empty files valid and does not keep failed reads', async () => {
  const path = join(directory, 'empty.pdf')
  await expect(documentHashOfFile(path)).rejects.toThrow()
  writeFileSync(path, '')
  vi.mocked(open).mockRejectedValueOnce(new Error('temporary read failure'))
  await expect(documentHashOfFile(path)).rejects.toThrow('temporary read failure')
  expect(await documentHashOfFile(path)).toBe(createHash('sha256').digest('hex'))
})
