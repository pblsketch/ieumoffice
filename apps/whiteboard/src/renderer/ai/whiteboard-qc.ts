/**
 * Static post-AI quality audit for Whiteboard documents (T12).
 * Runs only after AI-driven edits/generation; never blocks save or export.
 */
import {
  auditWhiteboardQuality,
  formatQualityReminder,
  type QualityFinding,
  type WhiteboardAuditObject,
  type WhiteboardAuditPage,
} from '@genoffice/agent-core'
import type { BoardDocument } from '@genoffice/whiteboard-engine'

export const WHITEBOARD_QC_MAX_P0_ROUNDS = 2

export interface WhiteboardQcOptions {
  pageId?: string
  userPrompt?: string
  attachmentContext?: string
  round?: number
}

export interface WhiteboardQcResult {
  findings: QualityFinding[]
  p0Count: number
  p1Count: number
  p0Reminder: string | null
}

export function runWhiteboardStaticQualityAudit(
  doc: BoardDocument,
  options: WhiteboardQcOptions = {},
): WhiteboardQcResult {
  const page =
    (options.pageId ? doc.pages.find((p) => p.id === options.pageId) : undefined) ?? doc.pages[0]
  const pageObjects = page ? doc.objects.filter((o) => o.pageId === page.id) : doc.objects

  const auditObjects: WhiteboardAuditObject[] = pageObjects.map((obj) => {
    const raw = obj as unknown as Record<string, unknown>
    const fill = typeof raw.fill === 'string' ? raw.fill : undefined
    const stroke = typeof raw.stroke === 'string' ? raw.stroke : undefined
    const text =
      typeof raw.text === 'string'
        ? raw.text
        : typeof raw.label === 'string'
          ? raw.label
          : undefined
    return {
      id: obj.id,
      x: typeof raw.x === 'number' ? raw.x : 0,
      y: typeof raw.y === 'number' ? raw.y : 0,
      w: typeof raw.width === 'number' ? raw.width : 0,
      h: typeof raw.height === 'number' ? raw.height : 0,
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
      ...(text ? { text } : {}),
    }
  })

  const hasFiniteBounds =
    page &&
    page.format !== 'freeform' &&
    typeof page.width === 'number' &&
    typeof page.height === 'number' &&
    page.width > 0 &&
    page.height > 0

  const auditPage: WhiteboardAuditPage = {
    id: page?.id ?? 'page-1',
    name: page?.title,
    ...(hasFiniteBounds ? { width: page!.width, height: page!.height } : {}),
    objects: auditObjects,
  }

  const findings = auditWhiteboardQuality([auditPage], {
    userPrompt: options.userPrompt,
    attachmentText: options.attachmentContext,
  })
  const p0 = findings.filter((f) => f.severity === 'P0')
  const p1 = findings.filter((f) => f.severity === 'P1')
  const round = options.round ?? 0
  const p0Reminder =
    p0.length > 0 && round < WHITEBOARD_QC_MAX_P0_ROUNDS ? formatQualityReminder(p0) : null
  return {
    findings,
    p0Count: p0.length,
    p1Count: p1.length,
    p0Reminder,
  }
}
