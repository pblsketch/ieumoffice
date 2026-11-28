import { describe, expect, it } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
import { runSlidesStaticQualityAudit } from '../src/renderer/ai/slides-static-qc'

describe('Slides extended static quality audit', () => {
  it('detects footer rail overflow, CJK fake italic, and Anti-AI-Slop P0 items', () => {
    const slide = {
      index: 0,
      widthPx: 960,
      heightPx: 540,
      nodes: [
        {
          type: 'shape',
          kind: 'shape',
          sourceId: 'sp1',
          box: { x: 40, y: 440, w: 600, h: 90 },
          x: 40,
          y: 440,
          w: 600,
          h: 90,
          fill: '#6366f1',
          paragraphs: [
            {
              runs: [
                { text: '한국어 기울임 문장입니다 Lorem ipsum', italic: true, fontSizePt: 24 },
              ],
            },
          ],
        },
      ],
    } as unknown as RenderSlide

    const res = runSlidesStaticQualityAudit([slide], { round: 0 })
    expect(res.findings.some((f) => f.code === 'footer_rail_overflow')).toBe(true)
    expect(res.findings.some((f) => f.code === 'cjk_fake_italic')).toBe(true)
    expect(res.findings.some((f) => f.code === 'placeholder_text')).toBe(true)
    expect(res.p0Reminder).toContain('<quality-audit>')
  })
})
