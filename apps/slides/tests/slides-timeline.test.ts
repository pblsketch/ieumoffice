import { describe, expect, it, vi } from 'vitest'
import type { VersionTimelineBridge } from '@genoffice/electron-utils/version-timeline-channels'
import { SlidesTimelineAdapter } from '../src/renderer/timeline/slides-timeline-adapter'

describe('SlidesTimelineAdapter', () => {
  it('isolates encrypted .pptx strictly in memory and never calls disk IPC', async () => {
    const bridge: VersionTimelineBridge = {
      list: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue({ ok: true }),
      readSnapshot: vi.fn().mockResolvedValue(null),
      deleteEntry: vi.fn().mockResolvedValue(true),
      clearAll: vi.fn().mockResolvedValue(true),
      getStats: vi.fn().mockResolvedValue({ totalBytes: 0, docCount: 0, entryCount: 0 }),
    }
    let current: Uint8Array = new Uint8Array([1, 2, 3])
    const applySnapshot = vi.fn((bytes: Uint8Array) => {
      current = bytes
      return true
    })

    const adapter = new SlidesTimelineAdapter(bridge, {
      docKey: 'enc-deck',
      isEncrypted: () => true,
      captureSnapshot: () => ({ bytes: current, slideCount: 3 }),
      applySnapshot,
    })

    expect(adapter.isMemoryOnly).toBe(true)
    const e1 = await adapter.record('ai', { promptSummary: 'Build confidential deck' })
    expect(e1).not.toBeNull()
    // Save with identical bytes deduplicates
    expect(await adapter.record('save')).toBeNull()

    current = new Uint8Array([4, 5, 6])
    const e2 = await adapter.record('save')
    expect(e2).not.toBeNull()

    const restored = await adapter.restore(e1!.id)
    expect(restored).toBe(true)
    expect(Array.from(current)).toEqual([1, 2, 3])
    expect(bridge.record).not.toHaveBeenCalled()
    expect(bridge.list).not.toHaveBeenCalled()
  })
})
