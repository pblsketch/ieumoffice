/**
 * Static post-AI quality audit for Slides (T12).
 * Combines `@genoffice/pipelines/slides/layout-audit` extended geometry checks
 * (`footer_rail_overflow`, `cjk_fake_italic`, `hero_off_center`) with shared
 * `auditSlideContentQuality` from `@genoffice/agent-core`.
 */
import {
  auditSlideContentQuality,
  formatQualityReminder,
  type QualityFinding,
  type SlideAuditElement,
  type SlideAuditInput,
  type SlideAuditRun,
} from '@genoffice/agent-core'
import { auditSlideLayout } from '@genoffice/pipelines/slides/layout-audit'
import type { RenderSlide } from '@genoffice/pptx-render'

export const SLIDES_QC_MAX_P0_ROUNDS = 2

export interface SlidesStaticQcOptions {
  userPrompt?: string
  attachmentContext?: string
  round?: number
}

export interface SlidesStaticQcResult {
  findings: QualityFinding[]
  p0Count: number
  p1Count: number
  p0Reminder: string | null
}

function toSlideAuditInput(slide: RenderSlide, index: number): SlideAuditInput {
  const elements: SlideAuditElement[] = []
  const visit = (nodes: readonly unknown[]) => {
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue
      const n = raw as Record<string, unknown>
      const id = typeof n.sourceId === 'string' ? n.sourceId : `el-${elements.length + 1}`
      const x = typeof n.x === 'number' ? n.x : 0
      const y = typeof n.y === 'number' ? n.y : 0
      const w = typeof n.w === 'number' ? n.w : 0
      const h = typeof n.h === 'number' ? n.h : 0
      const fill =
        typeof n.fill === 'string'
          ? n.fill
          : n.fill &&
              typeof n.fill === 'object' &&
              typeof (n.fill as Record<string, unknown>).color === 'string'
            ? String((n.fill as Record<string, unknown>).color)
            : undefined
      const runs: SlideAuditRun[] = []
      let maxFontPt = 0
      if (Array.isArray(n.paragraphs)) {
        for (const p of n.paragraphs as Array<Record<string, unknown>>) {
          const pRuns = Array.isArray(p.runs) ? (p.runs as Array<Record<string, unknown>>) : []
          for (const r of pRuns) {
            const text = typeof r.text === 'string' ? r.text : ''
            if (typeof r.fontSizePt === 'number' && r.fontSizePt > maxFontPt) {
              maxFontPt = r.fontSizePt
            }
            if (text) runs.push({ text, ...(r.italic === true ? { italic: true } : {}) })
          }
        }
      }
      const joined = runs
        .map((r) => r.text)
        .join(' ')
        .trim()
      elements.push({
        id,
        x,
        y,
        w,
        h,
        ...(joined ? { text: joined } : {}),
        ...(runs.length > 0 ? { runs } : {}),
        ...(fill ? { fill } : {}),
        ...(maxFontPt >= 22 ? { isHeading: true } : {}),
      })
      if (Array.isArray(n.children)) visit(n.children)
    }
  }
  visit(slide.nodes as unknown[])
  return {
    slideNumber: index + 1,
    widthPx: slide.widthPx || 960,
    heightPx: slide.heightPx || 540,
    isCoverOrHero: index === 0,
    elements,
  }
}

export function runSlidesStaticQualityAudit(
  slides: readonly RenderSlide[],
  options: SlidesStaticQcOptions = {},
): SlidesStaticQcResult {
  const auditInputs = slides.map((s, i) => toSlideAuditInput(s, i))
  const findings: QualityFinding[] = auditSlideContentQuality(auditInputs, {
    userPrompt: options.userPrompt,
    attachmentText: options.attachmentContext,
  })
  const seen = new Set(findings.map((f) => `${f.code}:${f.location ?? ''}`))

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!
    const slideNum = i + 1
    const layoutIssues = auditSlideLayout(slide, undefined, {
      extendedQuality: true,
    })
    for (let j = 0; j < layoutIssues.length; j++) {
      const issue = layoutIssues[j]!
      const loc = `Slide ${slideNum}`
      if (issue.includes('footer_rail_overflow') && !seen.has(`footer_rail_overflow:${loc}`)) {
        seen.add(`footer_rail_overflow:${loc}`)
        findings.push({
          id: `slide-${slideNum}-footer-${j}`,
          severity: 'P0',
          code: 'footer_rail_overflow',
          location: loc,
          message: issue,
        })
      } else if (issue.includes('cjk_fake_italic') && !seen.has(`cjk_fake_italic:${loc}`)) {
        seen.add(`cjk_fake_italic:${loc}`)
        findings.push({
          id: `slide-${slideNum}-cjk-${j}`,
          severity: 'P0',
          code: 'cjk_fake_italic',
          location: loc,
          message: issue,
        })
      } else if (issue.includes('hero_off_center') && !seen.has(`hero_off_center:${loc}`)) {
        seen.add(`hero_off_center:${loc}`)
        findings.push({
          id: `slide-${slideNum}-hero-${j}`,
          severity: 'P1',
          code: 'hero_off_center',
          location: loc,
          message: issue,
        })
      }
    }
  }

  const p0 = findings.filter((f) => f.severity === 'P0')
  const p1 = findings.filter((f) => f.severity === 'P1')
  const round = options.round ?? 0
  const p0Reminder =
    p0.length > 0 && round < SLIDES_QC_MAX_P0_ROUNDS ? formatQualityReminder(p0) : null
  return {
    findings,
    p0Count: p0.length,
    p1Count: p1.length,
    p0Reminder,
  }
}
