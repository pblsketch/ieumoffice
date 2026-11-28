import { describe, expect, it, vi } from 'vitest'
import type {
  VersionEntry,
  VersionTimelineBridge,
} from '@genoffice/electron-utils/version-timeline-channels'
import { applyPatches } from '../src/renderer/document/patch'
import { HtmlTimelineAdapter } from '../src/renderer/timeline/html-timeline-adapter'

function makeMemoryBridge(): VersionTimelineBridge {
  const entries = new Map<string, VersionEntry[]>()
  const blobs = new Map<string, Uint8Array>()
  return {
    async list(docKey) {
      return [...(entries.get(docKey) ?? [])].reverse()
    },
    async record(input) {
      const id = `v-${blobs.size + 1}`
      const bytes =
        typeof input.content === 'string'
          ? new TextEncoder().encode(input.content)
          : new Uint8Array(input.content)
      const entry: VersionEntry = {
        id,
        docKey: input.docKey,
        source: input.source,
        createdAt: new Date().toISOString(),
        contentHash: `${bytes.byteLength}`,
        byteSize: bytes.byteLength,
        promptSummary: input.promptSummary,
        changeSummary: input.changeSummary,
      }
      entries.set(input.docKey, [...(entries.get(input.docKey) ?? []), entry])
      blobs.set(id, bytes)
      return { ok: true, entry }
    },
    async readSnapshot(_docKey, id) {
      return blobs.get(id) ?? null
    },
    async deleteEntry(docKey, id) {
      blobs.delete(id)
      entries.set(
        docKey,
        (entries.get(docKey) ?? []).filter((e) => e.id !== id),
      )
      return true
    },
    async clearAll() {
      entries.clear()
      blobs.clear()
      return true
    },
    async getStats() {
      return { totalBytes: 0, docCount: entries.size, entryCount: blobs.size }
    },
  }
}

describe('HtmlTimelineAdapter', () => {
  it('records snapshots, previews HTML, and restores via single Patch after safety checkpoint', async () => {
    let html = '<html><body><h1>v1</h1></body></html>'
    const applyPatchSpy = vi.fn((patch) => {
      html = applyPatches(html, [patch])
    })
    const bridge = makeMemoryBridge()
    const adapter = new HtmlTimelineAdapter(bridge, {
      docKey: 'doc-html-1',
      getHtml: () => html,
      applyRestorePatch: applyPatchSpy,
    })

    const e1 = await adapter.record('ai', { promptSummary: 'Create v1' })
    expect(e1).not.toBeNull()
    html = '<html><body><h1>v2</h1></body></html>'
    await adapter.record('save')

    expect(await adapter.preview(e1!.id)).toContain('<h1>v1</h1>')
    const ok = await adapter.restore(e1!.id)
    expect(ok).toBe(true)
    expect(applyPatchSpy).toHaveBeenCalledTimes(1)
    expect(html).toContain('<h1>v1</h1>')

    const list = await adapter.list()
    expect(list.some((e) => e.source === 'restore')).toBe(true)
  })
})
