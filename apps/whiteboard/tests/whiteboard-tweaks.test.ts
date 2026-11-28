import { describe, expect, it, vi } from 'vitest'
import type { BoardDocument } from '@genoffice/whiteboard-engine'
import type { WhiteboardSession } from '../src/renderer/document/session'
import {
  DEFAULT_WHITEBOARD_TWEAKS,
  applyWhiteboardTweaksToDocument,
  commitWhiteboardTweaks,
  resetWhiteboardTweaks,
} from '../src/renderer/tweaks/whiteboard-tweaks'

describe('Whiteboard No-AI Style Tweaks', () => {
  it('updates background, palette, scale, radius, and stroke while preserving PDF image pages', () => {
    const base = {
      id: 'b1',
      title: 'Board',
      pages: [
        {
          id: 'p1',
          title: 'P1',
          orderKey: 'a0',
          format: 'infinite',
          background: { kind: 'solid', color: '#FFFFFF' },
        },
        {
          id: 'p2',
          title: 'PDF',
          orderKey: 'a1',
          format: 'custom',
          background: { kind: 'image', resourceId: 'r1', width: 800, height: 600 },
        },
      ],
      objects: [
        {
          id: 'o1',
          pageId: 'p1',
          fill: '#FFFFFF',
          stroke: '#000000',
          textColor: '#000000',
          strokeWidth: 2,
          cornerRadius: 8,
          fontSize: 16,
        },
      ],
      resources: {},
    } as unknown as BoardDocument

    const tweaked = applyWhiteboardTweaksToDocument(base, {
      ...DEFAULT_WHITEBOARD_TWEAKS,
      background: 'dot-grid',
      palette: 'forest',
      fontScalePct: 125,
      radius: 'rounded',
      strokeWidth: 3,
    })
    expect((tweaked.pages[0] as unknown as { background: { kind: string } }).background.kind).toBe(
      'dots',
    )
    expect((tweaked.pages[1] as unknown as { background: { kind: string } }).background.kind).toBe(
      'image',
    )
    const obj = tweaked.objects[0] as unknown as Record<string, unknown>
    expect(obj.stroke).toBe('#1F6F4A')
    expect(obj.strokeWidth).toBe(3)
    expect(obj.cornerRadius).toBe(16)
    expect(obj.fontSize).toBe(20)

    const commitDocument = vi.fn()
    const fakeSession = { commitDocument } as unknown as WhiteboardSession
    commitWhiteboardTweaks(fakeSession, base, DEFAULT_WHITEBOARD_TWEAKS)
    resetWhiteboardTweaks(fakeSession, base)
    expect(commitDocument).toHaveBeenCalledTimes(2)
  })
})
