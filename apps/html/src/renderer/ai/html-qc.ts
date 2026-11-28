/**
 * Static post-AI quality audit for HTML documents (T12).
 * Runs only after AI-driven edits/generation; never blocks save or print.
 */
import { auditHtmlQuality, formatQualityReminder, type QualityFinding } from '@genoffice/agent-core'

export const HTML_QC_MAX_P0_ROUNDS = 2

export interface HtmlQcOptions {
  userPrompt?: string
  attachmentContext?: string
  /** Number of overflowing pages reported by `check_pages`, if measured */
  pageOverflowCount?: number
  /** Current P0 self-correction round (0-based) */
  round?: number
}

export interface HtmlQcResult {
  findings: QualityFinding[]
  p0Count: number
  p1Count: number
  /** Structured `<quality-audit>` reminder for P0 items within max rounds */
  p0Reminder: string | null
}

export function runHtmlStaticQualityAudit(html: string, options: HtmlQcOptions = {}): HtmlQcResult {
  const overflowPages =
    options.pageOverflowCount && options.pageOverflowCount > 0
      ? Array.from({ length: options.pageOverflowCount }, (_, i) => i + 1)
      : undefined
  const findings = auditHtmlQuality(html, {
    userPrompt: options.userPrompt,
    attachmentText: options.attachmentContext,
    ...(overflowPages ? { overflowPages } : {}),
  })
  const p0 = findings.filter((f) => f.severity === 'P0')
  const p1 = findings.filter((f) => f.severity === 'P1')
  const round = options.round ?? 0
  const p0Reminder =
    p0.length > 0 && round < HTML_QC_MAX_P0_ROUNDS ? formatQualityReminder(p0) : null
  return {
    findings,
    p0Count: p0.length,
    p1Count: p1.length,
    p0Reminder,
  }
}
