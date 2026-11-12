/**
 * 민감정보 찾기's dismissals, remembered per document in the app's data folder: by kind and
 * a keyed hash only, the key in a file of its own, nothing of the value on disk.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExclusionStore } from '../src/main/sensitive-exclusions'

const dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hwp-sensitive-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the exclusion store', () => {
  it('remembers a dismissal for the document it was made in only', async () => {
    const dir = scratch()
    const store = createExclusionStore(dir)
    await store.exclude('C:\\docs\\a.hwp', { kind: 'phone', value: '010-1234-5678' })

    expect(
      await store.excluded('C:\\docs\\a.hwp', [
        { kind: 'phone', value: '010-1234-5678' },
        // the same number written another way is the same number
        { kind: 'phone', value: '01012345678' },
        { kind: 'phone', value: '010-9999-0000' },
        { kind: 'email', value: '010-1234-5678' },
      ]),
    ).toEqual([true, true, false, false])
    expect(
      await store.excluded('C:\\docs\\b.hwp', [{ kind: 'phone', value: '010-1234-5678' }]),
    ).toEqual([false])
    // a later run of the app reads the same record with the same key
    const again = createExclusionStore(dir)
    expect(
      await again.excluded('C:\\docs\\a.hwp', [{ kind: 'phone', value: '010-1234-5678' }]),
    ).toEqual([true])
  })

  it('keeps no value on disk, and the key apart from the records', async () => {
    const dir = scratch()
    const store = createExclusionStore(dir)
    await store.exclude('/home/u/a.hwpx', { kind: 'name', value: '홍길동' })
    expect(readdirSync(dir).sort()).toEqual(['key.bin', 'records'])
    const [record] = readdirSync(join(dir, 'records'))
    const text = readFileSync(join(dir, 'records', record!), 'utf8')
    expect(text).not.toContain('홍길동')
    expect(text).not.toContain('a.hwpx')
    const parsed = JSON.parse(text) as { entries: { kind: string; hash: string }[] }
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]!.kind).toBe('name')
    expect(parsed.entries[0]!.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(parsed.entries[0]!).sort()).toEqual(['hash', 'kind'])
  })

  it('takes no unknown kind', async () => {
    const dir = scratch()
    const store = createExclusionStore(dir)
    await store.exclude('/a.hwp', { kind: 'secret', value: 'x' })
    expect(await store.excluded('/a.hwp', [{ kind: 'secret', value: 'x' }])).toEqual([false])
  })
})
