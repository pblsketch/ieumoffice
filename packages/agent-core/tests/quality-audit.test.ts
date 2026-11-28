import { describe, expect, it } from 'vitest'
import {
  auditHtmlQuality,
  auditSlideContentQuality,
  auditWhiteboardQuality,
  formatQualityReminder,
} from '../src/quality-audit'

describe('static quality audit core', () => {
  it('flags P0 placeholders, invented metrics, unrequested indigo/gradient/emojis, and formats reminders', () => {
    const html = `
      <style>
        .hero { background: linear-gradient(90deg, #6366f1, #06b6d4); color: #8b5cf6; }
      </style>
      <h1>✨ Feature One 🚀</h1>
      <p>Lorem ipsum — 10x faster with 99.9% uptime.</p>
    `
    const findings = auditHtmlQuality(html, { userPrompt: 'Create a Q3 status page' })
    const codes = findings.map((f) => f.code)
    expect(codes).toContain('placeholder_text')
    expect(codes).toContain('invented_metric')
    expect(codes).toContain('default_indigo')
    expect(codes).toContain('purple_cyan_gradient')
    expect(codes).toContain('emoji_icon_overuse')
    expect(formatQualityReminder(findings)).toContain('<quality-audit>')
  })

  it('exempts aesthetic rules explicitly requested by the user and verified attachment metrics', () => {
    const html = `
      <style>.hero { background: linear-gradient(90deg, #6366f1, #06b6d4); }</style>
      <h1>✨ Launch 🚀</h1>
      <p>Achieves 10x faster processing.</p>
    `
    const findings = auditHtmlQuality(html, {
      userPrompt: '보라색 그라데이션 배경에 이모지 넣어줘',
      attachmentText: 'Benchmark report: 10x faster than legacy batch',
    })
    expect(findings.map((f) => f.code)).toEqual([])
  })

  it('detects slide footer_rail_overflow, cjk_fake_italic, and hero_off_center', () => {
    const findings = auditSlideContentQuality([
      {
        slideNumber: 1,
        widthPx: 960,
        heightPx: 540,
        isCoverOrHero: true,
        elements: [
          {
            id: 'title',
            x: 60,
            y: 40,
            w: 800,
            h: 80,
            text: '분기 실적 요약',
            runs: [{ text: '분기 실적 요약', italic: true }],
            isHeading: true,
          },
          { id: 'body', x: 60, y: 420, w: 800, h: 90, text: '하단 본문' },
        ],
      },
    ])
    expect(findings.map((f) => f.code)).toContain('footer_rail_overflow')
    expect(findings.map((f) => f.code)).toContain('cjk_fake_italic')
  })

  it('detects whiteboard bounds overflow, excessive overlap, and palette overuse', () => {
    const findings = auditWhiteboardQuality([
      {
        id: 'p1',
        width: 800,
        height: 600,
        objects: [
          { id: 'a', x: 10, y: 10, w: 100, h: 100, fill: '#111111', stroke: '#222222' },
          { id: 'b', x: 20, y: 20, w: 100, h: 100, fill: '#333333', stroke: '#444444' },
          { id: 'c', x: 750, y: 10, w: 100, h: 50, fill: '#555555', stroke: '#666666' },
          { id: 'd', x: 300, y: 300, w: 50, h: 50, fill: '#777777' },
        ],
      },
    ])
    const codes = findings.map((f) => f.code)
    expect(codes).toContain('canvas_bounds_overflow')
    expect(codes).toContain('object_overlap')
    expect(codes).toContain('palette_overuse')
  })
})
