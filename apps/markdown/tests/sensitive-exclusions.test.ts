/**
 * Where "exclude" in the sensitive-info list is remembered: per document path
 * in the app's data folder, as the candidate's kind and a keyed hash — never
 * the value — with the key in a file of its own.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exclusionHash } from '@genoffice/agent-core/sensitive-exclusion'
import { createSensitiveExclusionStore } from '../src/main/sensitive-exclusions'
import {
  createSensitiveExclusionMemory,
  type SensitiveExclusionBridge,
} from '../src/renderer/ai/sensitive-find'

describe('remembering exclusions', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the kind and a keyed hash per document path, never the value, and the key apart', async () => {
    dir = mkdtempSync(join(tmpdir(), 'markdown-sens-'))
    const store = createSensitiveExclusionStore(dir, 'markdown', 'linux')
    const bridge: SensitiveExclusionBridge = {
      get: (p) => store.get(p) as ReturnType<SensitiveExclusionBridge['get']>,
      add: (p, e) => store.add(p, e),
    }
    let path = '/docs/a.md'
    const memory = createSensitiveExclusionMemory(bridge, () => path)
    expect(await memory.isExcluded('phone', '010-1234-5678')).toBe(false)
    await memory.exclude('phone', '010-1234-5678')

    // a new tab on the same document remembers it, written with or without hyphens
    const later = createSensitiveExclusionMemory(bridge, () => '/docs/a.md')
    expect(await later.isExcluded('phone', '01012345678')).toBe(true)
    expect(await later.isExcluded('email', 'a@b.co')).toBe(false)
    // another document does not
    const other = createSensitiveExclusionMemory(bridge, () => '/docs/b.md')
    expect(await other.isExcluded('phone', '010-1234-5678')).toBe(false)

    expect(readdirSync(dir).sort()).toEqual(['markdown-exclusion-key', 'markdown-exclusions.json'])
    const records = readFileSync(join(dir, 'markdown-exclusions.json'), 'utf8')
    expect(records).not.toContain('1234')
    expect(records).not.toContain('5678')
    const key = readFileSync(join(dir, 'markdown-exclusion-key'), 'utf8')
    expect(records).not.toContain(key)
    const keyBytes = Uint8Array.from(key.match(/../g)!.map((h) => Number.parseInt(h, 16)))
    expect(records).toContain(await exclusionHash(keyBytes, 'phone', '010-1234-5678'))

    // an untitled document is remembered for the tab only
    path = ''
    const untitled = createSensitiveExclusionMemory(bridge, () => null)
    await untitled.exclude('email', 'a@b.co')
    expect(await untitled.isExcluded('email', 'a@b.co')).toBe(true)
    const documents = JSON.parse(readFileSync(join(dir, 'markdown-exclusions.json'), 'utf8'))
      .documents as Record<string, unknown>
    expect(Object.values(documents)).toEqual([[expect.objectContaining({ kind: 'phone' })]])
  })

  it('refuses an entry that is not a kind and a hash', async () => {
    dir = mkdtempSync(join(tmpdir(), 'markdown-sens-'))
    const store = createSensitiveExclusionStore(dir, 'markdown', 'linux')
    expect(await store.add('/d.md', { kind: 'phone', hash: '010-1234-5678' } as never)).toBe(false)
    expect(await store.add('/d.md', { kind: 'Not A Kind!', hash: 'a'.repeat(64) } as never)).toBe(
      false,
    )
    expect((await store.get('/d.md')).entries).toEqual([])
  })
})
