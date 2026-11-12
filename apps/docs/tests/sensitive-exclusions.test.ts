/**
 * The exclusion memory of the sensitive-info finder (main process, no
 * Electron): per document path, kind and keyed hash only, the key in a file
 * of its own, and the same value written another way still remembered.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSensitiveExclusionStore,
  exclusionDocId,
  isExclusionItem,
} from '../src/main/sensitive-exclusions'

const dirs: string[] = []
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docs-sens-excl-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const DOC = join(tmpdir(), 'class', '명단.docx')

describe('the exclusion memory', () => {
  it('remembers a dismissal for that document only', async () => {
    const store = createSensitiveExclusionStore(freshDir())
    await store.add(DOC, { kind: 'phone', value: '010-1234-5678' })
    expect(
      await store.check(DOC, [
        { kind: 'phone', value: '010-1234-5678' },
        { kind: 'phone', value: '01012345678' },
        { kind: 'phone', value: '010-9999-8888' },
        { kind: 'email', value: '010-1234-5678' },
      ]),
    ).toEqual([true, true, false, false])
    expect(
      await store.check(join(tmpdir(), 'other.docx'), [{ kind: 'phone', value: '010-1234-5678' }]),
    ).toEqual([false])
  })

  it('keeps no value on disk, and the key apart from the records', async () => {
    const dir = freshDir()
    const store = createSensitiveExclusionStore(dir)
    await store.add(DOC, { kind: 'name', value: '홍길동' })
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['docs-sensitive-exclusion.key', 'docs-sensitive-exclusions.json'])
    const records = readFileSync(join(dir, 'docs-sensitive-exclusions.json'), 'utf8')
    expect(records).not.toContain('홍길동')
    expect(records).not.toContain('명단')
    const key = readFileSync(join(dir, 'docs-sensitive-exclusion.key'), 'utf8').trim()
    expect(records).not.toContain(key)
    const parsed = JSON.parse(records) as { docs: Record<string, { kind: string; hash: string }[]> }
    expect(parsed.docs[exclusionDocId(DOC)]).toEqual([
      { kind: 'name', hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ])
  })

  it('survives a restart (a new store over the same folder)', async () => {
    const dir = freshDir()
    await createSensitiveExclusionStore(dir).add(DOC, { kind: 'email', value: 'a@b.co' })
    const again = createSensitiveExclusionStore(dir)
    expect(await again.check(DOC, [{ kind: 'email', value: 'a@b.co' }])).toEqual([true])
  })

  it('does not record the same dismissal twice, even when added at once', async () => {
    const dir = freshDir()
    const store = createSensitiveExclusionStore(dir)
    await Promise.all([
      store.add(DOC, { kind: 'phone', value: '010-1234-5678' }),
      store.add(DOC, { kind: 'phone', value: '01012345678' }),
      store.add(DOC, { kind: 'email', value: 'a@b.co' }),
    ])
    const parsed = JSON.parse(readFileSync(join(dir, 'docs-sensitive-exclusions.json'), 'utf8'))
    expect(parsed.docs[exclusionDocId(DOC)]).toHaveLength(2)
  })

  it('a document path is the same document whatever its case on Windows', () => {
    expect(exclusionDocId('C:\\Docs\\A.docx', 'win32')).toBe(
      exclusionDocId('c:\\docs\\a.docx', 'win32'),
    )
  })

  it('accepts only known kinds and string values from the renderer', () => {
    expect(isExclusionItem({ kind: 'phone', value: '1' })).toBe(true)
    expect(isExclusionItem({ kind: 'nope', value: '1' })).toBe(false)
    expect(isExclusionItem({ kind: 'phone', value: 1 })).toBe(false)
    expect(isExclusionItem(null)).toBe(false)
  })
})
