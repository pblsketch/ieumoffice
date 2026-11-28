import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VersionTimelineStore, docKeyFromPath } from '../src/version-timeline-store'

describe('VersionTimelineStore', () => {
  let tempDir: string
  let store: VersionTimelineStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ieum-vt-test-'))
    store = new VersionTimelineStore({
      baseDir: tempDir,
      maxVersionsPerDoc: 3,
      maxTotalBytes: 2048,
      maxSingleSnapshotBytes: 1024,
    })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('records ai/save/checkpoint/restore, deduplicates unchanged saves, and refuses encrypted documents', () => {
    const key = docKeyFromPath('/docs/report.html')

    // Encrypted PPTX must never touch disk
    const enc = store.record({
      docKey: key,
      editorKind: 'slides',
      source: 'ai',
      content: 'secret deck',
      ext: 'pptx',
      encrypted: true,
    })
    expect(enc).toEqual({ ok: false, skipped: true, reason: 'encrypted' })
    expect(store.list(key)).toEqual([])

    const r1 = store.record({
      docKey: key,
      editorKind: 'html',
      source: 'ai',
      content: '<h1>v1</h1>',
      ext: 'html',
      promptSummary: 'a'.repeat(400),
    })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.entry.promptSummary?.length).toBe(300)
      expect(store.readSnapshot(key, r1.entry.id, true)).toBe('<h1>v1</h1>')
    }

    // Identical Ctrl+S save is deduplicated
    const dup = store.record({
      docKey: key,
      editorKind: 'html',
      source: 'save',
      content: '<h1>v1</h1>',
      ext: 'html',
    })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.reason).toBe('unchanged')

    // Changed Ctrl+S save records a new entry
    const r2 = store.record({
      docKey: key,
      editorKind: 'html',
      source: 'save',
      content: '<h1>v2</h1>',
      ext: 'html',
    })
    expect(r2.ok).toBe(true)
    expect(store.list(key)).toHaveLength(2)
  })

  it('enforces per-doc max count, single snapshot size limit, delete, move, and clearAll', () => {
    const key = docKeyFromPath('/docs/deck.pptx')
    for (let i = 1; i <= 4; i++) {
      store.record({
        docKey: key,
        editorKind: 'slides',
        source: 'checkpoint',
        content: `v${i}`,
        ext: 'json',
        label: `cp-${i}`,
      })
    }
    const list = store.list(key)
    expect(list).toHaveLength(3)
    expect(list[0]?.label).toBe('cp-4')

    const tooBig = store.record({
      docKey: key,
      editorKind: 'slides',
      source: 'checkpoint',
      content: 'x'.repeat(2000),
      ext: 'json',
    })
    expect(tooBig).toEqual({ ok: false, skipped: true, reason: 'too-large' })

    expect(store.getStats().entryCount).toBe(3)
    const movedKey = docKeyFromPath('/docs/deck-renamed.pptx')
    expect(store.moveDocKey(key, movedKey)).toBe(true)
    expect(store.list(movedKey)).toHaveLength(3)

    expect(store.deleteEntry(movedKey, list[0]!.id)).toBe(true)
    expect(store.list(movedKey)).toHaveLength(2)

    store.clearAll()
    expect(store.getStats()).toEqual({ totalBytes: 0, docCount: 0, entryCount: 0 })
  })
})
