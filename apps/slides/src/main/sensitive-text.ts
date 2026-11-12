import type { Paragraph, Slide, SlideElement, TableElement, TextRun } from '@genoffice/pptx-engine'
import type {
  SensitiveBodyInfo,
  SensitiveRunInfo,
  SlidesSensitiveText,
} from '../shared/sensitive-text'

/**
 * The deck's text for "find sensitive info", read off the model the ops edit
 * (not the laid-out render tree, whose wrapped lines do not map back to runs).
 * Read-only: nothing here changes the deck.
 */

function runInfo(run: TextRun): SensitiveRunInfo {
  const fixed =
    !!run.field || run.rawXml !== undefined || run.paraMark === true || run.text === '\n'
  return {
    text: run.text,
    ...(run.redact ? { redact: run.redact } : {}),
    ...(fixed ? { fixed: true as const } : {}),
  }
}

function paragraphsOf(paragraphs: readonly Paragraph[] | undefined): SensitiveRunInfo[][] {
  return (paragraphs ?? []).map((p) => p.runs.map(runInfo))
}

function plainText(paragraphs: readonly Paragraph[] | undefined): string {
  return (paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join('')).join(' ')
}

function tableBodies(
  slide: number,
  el: TableElement,
  where: { group?: string; unreachable?: true },
): SensitiveBodyInfo[] {
  const out: SensitiveBodyInfo[] = []
  const head = el.rows[0] ?? []
  el.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.merged || !cell.text) return
      const above = r > 0 ? head[c] : undefined
      const header = above && !above.merged ? plainText(above.text?.paragraphs).trim() : ''
      out.push({
        slide,
        el: el.id,
        ...where,
        cell: { row: r, col: c },
        ...(header ? { header } : {}),
        paragraphs: paragraphsOf(cell.text.paragraphs),
      })
    })
  })
  return out
}

function elementBodies(
  slide: number,
  el: SlideElement,
  group: string | undefined,
  depth: number,
): SensitiveBodyInfo[] {
  // setText reaches a shape directly on the slide or directly inside one group;
  // setTableCell reaches only a table on the slide itself
  const unreachable = depth > 1 ? ({ unreachable: true } as const) : {}
  const where = { ...(group ? { group } : {}), ...unreachable }
  if (el.type === 'group') {
    return el.children.flatMap((child) => elementBodies(slide, child, el.id, depth + 1))
  }
  if (el.type === 'table') {
    return tableBodies(slide, el, depth > 0 ? { ...where, unreachable: true } : where)
  }
  if ((el.type === 'text' || el.type === 'shape') && el.text) {
    return [{ slide, el: el.id, ...where, paragraphs: paragraphsOf(el.text.paragraphs) }]
  }
  return []
}

export function deckSensitiveText(
  slides: readonly Slide[],
  notesOf: (slide: Slide) => string,
  commentsOf: (slide: Slide) => string[] = () => [],
): SlidesSensitiveText {
  return {
    bodies: slides.flatMap((slide, i) =>
      slide.elements.flatMap((el) => elementBodies(i, el, undefined, 0)),
    ),
    notes: slides.map((slide) => {
      try {
        return notesOf(slide)
      } catch {
        return ''
      }
    }),
    comments: slides.map((slide) => {
      try {
        return commentsOf(slide)
      } catch {
        return []
      }
    }),
  }
}
