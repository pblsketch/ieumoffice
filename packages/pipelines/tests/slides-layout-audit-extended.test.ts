import { describe, expect, it } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
import { auditSlideFindings } from '../src/slides/layout-audit'

describe('auditSlideFindings extended visual quality checks', () => {
  it('flags footer_rail_overflow, cjk_fake_italic, and hero_off_center when extendedQuality is enabled', () => {
    const slide = {
      index: 0,
      widthPx: 960,
      heightPx: 540,
      nodes: [
        {
          type: 'text',
          sourceId: 'el-title',
          box: { x: 80, y: 30, w: 800, h: 70, rotationDeg: 0 },
          text: {
            insets: { t: 4, r: 4, b: 4, l: 4 },
            contentHeight: 40,
            lines: [
              {
                runs: [{ text: '한글 발표 제목', italic: true, x: 0, widthPx: 200 }],
              },
            ],
          },
        },
        {
          type: 'text',
          sourceId: 'el-body',
          box: { x: 80, y: 400, w: 800, h: 110, rotationDeg: 0 },
          text: {
            insets: { t: 4, r: 4, b: 4, l: 4 },
            contentHeight: 50,
            lines: [{ runs: [{ text: '본문 내용', italic: false, x: 0, widthPx: 120 }] }],
          },
        },
      ],
    } as unknown as RenderSlide

    const findings = auditSlideFindings(slide, (id) => id, { extendedQuality: true })
    expect(findings.map((f) => f.code)).toContain('footer_rail_overflow')
    expect(findings.map((f) => f.code)).toContain('cjk_fake_italic')

    const heroSlide = {
      ...slide,
      nodes: [slide.nodes[0]],
    } as unknown as RenderSlide
    const heroFindings = auditSlideFindings(heroSlide, (id) => id, {
      extendedQuality: true,
      isCoverOrHero: true,
    })
    expect(heroFindings.map((f) => f.code)).toContain('hero_off_center')
  })
})
