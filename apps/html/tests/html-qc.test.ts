import { describe, expect, it } from 'vitest'
import { runHtmlStaticQualityAudit } from '../src/renderer/ai/html-qc'

describe('HTML static quality audit', () => {
  it('flags P0 placeholders and emits reminder up to max 2 rounds', () => {
    const html = '<html><body><h1>🚀 Summary</h1><p>Lorem ipsum dolor sit amet.</p></body></html>'
    const r0 = runHtmlStaticQualityAudit(html, { round: 0, pageOverflowCount: 1 })
    expect(r0.p0Count).toBeGreaterThan(0)
    expect(r0.p0Reminder).toContain('<quality-audit>')
    expect(r0.findings.some((f) => f.code === 'page_overflow')).toBe(true)

    const r2 = runHtmlStaticQualityAudit(html, { round: 2 })
    expect(r2.p0Reminder).toBeNull()
  })

  it('respects explicit user aesthetic request exemptions', () => {
    const html = '<style>.hero{color:#6366f1}</style><h1>✨ Launch</h1>'
    const exempted = runHtmlStaticQualityAudit(html, {
      userPrompt: '보라색 인디고 테마와 이모지 넣어줘',
    })
    expect(exempted.findings.some((f) => f.code === 'default_indigo')).toBe(false)
    expect(exempted.findings.some((f) => f.code === 'emoji_icon_overuse')).toBe(false)
  })
})
