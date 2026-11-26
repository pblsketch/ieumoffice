/**
 * Plain text of a slide, for search and screen readers: text boxes and shapes, table
 * cells, group children (at any depth), SmartArt previews and chart text overlays, in
 * z-order. Master/layout decorations (footers, slide numbers) are not slide content and
 * are left out. One line per paragraph; empty paragraphs are dropped.
 */
import type { Slide, SlideElement, TextBody } from '@genoffice/pptx-engine'

function bodyLines(body: TextBody | undefined, out: string[]): void {
  for (const para of body?.paragraphs ?? []) {
    const line = para.runs.map((run) => run.text).join('')
    if (line.trim()) out.push(line)
  }
}

function elementLines(el: SlideElement, out: string[]): void {
  switch (el.type) {
    case 'text':
    case 'shape':
      bodyLines(el.text, out)
      break
    case 'group':
      for (const child of el.children) elementLines(child, out)
      break
    case 'table':
      for (const row of el.rows) for (const cell of row) if (!cell.merged) bodyLines(cell.text, out)
      break
    case 'chart':
      for (const shape of el.userShapes ?? []) bodyLines(shape.text, out)
      break
    case 'passthrough':
      for (const shape of el.previewShapes ?? []) elementLines(shape, out)
      break
    case 'picture':
      break
  }
}

/** The slide's words, one paragraph per line */
export function slideText(slide: Slide): string {
  const out: string[] = []
  for (const el of slide.elements) elementLines(el, out)
  return out.join('\n')
}
