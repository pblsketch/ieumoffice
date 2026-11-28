import { describe, expect, it, vi } from 'vitest'
import type {
  VersionEntry,
  VersionTimelineBridge,
} from '@genoffice/electron-utils/version-timeline-channels'
import type { BoardDocument } from '@genoffice/whiteboard-engine'
import type { WhiteboardSession } from '../src/renderer/document/session'
import { WhiteboardTimelineAdapter } from '../src/renderer/timeline/whiteboard-timeline-adapter'

describe('WhiteboardTimelineAdapter', () => {
  it('records JSON snapshot and restores via single commitDocument undo step', async () => {
    const blobs = new Map<string, Uint8Array>()
    const entries: VersionEntry[] = []
    const bridge: VersionTimelineBridge = {
      list: async () => [...entries].reverse(),
      record: async (input) => {
        const id = `wb-${entries.length + 1}`
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
          changeSummary: input.changeSummary,
        }
        entries.push(entry)
        blobs.set(id, bytes)
        return { ok: true, entry }
      },
      readSnapshot: async (_docKey, id) => blobs.get(id) ?? null,
      deleteEntry: async () => true,
      clearAll: async () => true,
      getStats: async () => ({ totalBytes: 0, docCount: 1, entryCount: entries.length }),
    }

    let doc = {
      id: 'b1',
      title: 'v1',
      pages: [{ id: 'p1', title: 'P1', orderKey: 'a0', format: 'infinite' }],
      objects: [],
      resources: {},
    } as unknown as BoardDocument

    const commitDocument = vi.fn((next: BoardDocument) => {
      doc = next
    })
    const fakeSession = {
      getDocument: () => doc,
      commitDocument,
      getAllResourceDataUrls: () => new Map(),
    } as unknown as WhiteboardSession

    const adapter = new WhiteboardTimelineAdapter(bridge, 'wb-1', () => fakeSession)
    const e1 = await adapter.record('ai', { promptSummary: 'Draw flow' })
    expect(e1).not.toBeNull()

    doc = { ...doc, title: 'v2' }
    await adapter.record('checkpoint', { label: 'Before edit' })

    const ok = await adapter.restore(e1!.id)
    expect(ok).toBe(true)
    expect(commitDocument).toHaveBeenCalledTimes(1)
    expect(doc.title).toBe('v1')
    expect(entries.some((e) => e.source === 'restore')).toBe(true)
  })
})
