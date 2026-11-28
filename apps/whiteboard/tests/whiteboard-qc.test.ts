import { describe, expect, it } from 'vitest'
import type { BoardDocument } from '@genoffice/whiteboard-engine'
import { runWhiteboardStaticQualityAudit } from '../src/renderer/ai/whiteboard-qc'

describe('Whiteboard static quality audit', () => {
  it('flags out-of-bounds shapes, placeholder text, and stops P0 reminder after round 2', () => {
    const doc = {
      id: 'b1',
      title: 'Test',
      pages: [
        {
          id: 'p1',
          title: 'Page 1',
          orderKey: 'a0',
          format: 'a4-landscape',
          width: 1000,
          height: 700,
        },
      ],
      objects: [
        {
          id: 'o1',
          pageId: 'p1',
          x: 950,
          y: 10,
          width: 200,
          height: 100,
          text: 'Lorem ipsum',
          fill: '#6366f1',
        },
      ],
      resources: {},
    } as unknown as BoardDocument

    const res = runWhiteboardStaticQualityAudit(doc, { pageId: 'p1', round: 0 })
    expect(res.findings.some((f) => f.code === 'canvas_bounds_overflow')).toBe(true)
    expect(res.findings.some((f) => f.code === 'placeholder_text')).toBe(true)
    expect(res.p0Reminder).toContain('<quality-audit>')

    const capped = runWhiteboardStaticQualityAudit(doc, { pageId: 'p1', round: 2 })
    expect(capped.p0Reminder).toBeNull()
  })
})
