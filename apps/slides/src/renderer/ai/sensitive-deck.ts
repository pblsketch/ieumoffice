import type { ExistingMark } from '@genoffice/agent-core/sensitive-labels'
import type { EditParagraph, EditRun } from '@genoffice/pptx-ops'
import type {
  SensitiveBodyInfo,
  SensitiveRunInfo,
  SlidesSensitiveText,
} from '../../shared/sensitive-text'
import type { SensitivePiece, SensitiveSpot } from './sensitive-find'

/**
 * The deck side of "find sensitive info": the pieces the finder reads (one per
 * paragraph of every text body, in slide order, then each slide's speaker
 * notes and review comments line by line) and the ops that hide a confirmed
 * candidate.
 *
 * Hiding goes through the same text ops a typed edit does (`setText`, and
 * `setTableCell` for a cell): every run is handed back as it was, traced to its
 * source run so nothing about it changes, and only the run a candidate sits in
 * is cut so the candidate becomes a run of its own with the mark and the
 * underline the mark needs. Speaker notes are plain text with nowhere to hold a
 * mark, and review comments hold none either (the AI reads both), so their
 * candidates are shown and counted but cannot be hidden.
 */

export type DeckSpotLocation =
  | { kind: 'text'; body: number; para: number; slide: number; table: boolean }
  | { kind: 'notes'; slide: number; line: number }
  | { kind: 'comment'; slide: number; index: number; line: number }

export interface DeckPieceWords {
  slide: (n: number) => string
  notes: string
  table: string
  comment: string
}

const paragraphText = (runs: readonly SensitiveRunInfo[]): string =>
  runs.map((r) => r.text).join('')

/** `[start, end)` of each run in its paragraph's text */
function runSpans(runs: readonly SensitiveRunInfo[]): Array<[number, number]> {
  let at = 0
  return runs.map((r) => {
    const span: [number, number] = [at, at + r.text.length]
    at += r.text.length
    return span
  })
}

function hiddenRanges(runs: readonly SensitiveRunInfo[]): Array<[number, number]> {
  const spans = runSpans(runs)
  return runs.flatMap((r, i) => (r.redact && r.text ? [spans[i]!] : []))
}

/** The marks the deck already has, one per stretch of runs under one label. */
function marksOf(runs: readonly SensitiveRunInfo[]): ExistingMark[] {
  const out: ExistingMark[] = []
  let label: string | null = null
  let value = ''
  for (const run of [...runs, { text: '' } as SensitiveRunInfo]) {
    const next = run.redact ?? null
    if (next !== label) {
      if (label && value) out.push({ label, value })
      label = next
      value = ''
    }
    if (next) value += run.text
  }
  return out
}

export function deckPieces(
  text: SlidesSensitiveText,
  words: DeckPieceWords,
): { pieces: SensitivePiece<DeckSpotLocation>[]; existingMarks: ExistingMark[] } {
  const pieces: SensitivePiece<DeckSpotLocation>[] = []
  const existingMarks: ExistingMark[] = []
  const bySlide = new Map<number, number[]>()
  text.bodies.forEach((b, i) => {
    const list = bySlide.get(b.slide) ?? []
    list.push(i)
    bySlide.set(b.slide, list)
  })
  const slides = Math.max(
    text.notes.length,
    text.comments.length,
    ...text.bodies.map((b) => b.slide + 1),
    0,
  )
  for (let slide = 0; slide < slides; slide++) {
    for (const bodyIndex of bySlide.get(slide) ?? []) {
      const body = text.bodies[bodyIndex]!
      body.paragraphs.forEach((runs, para) => {
        existingMarks.push(...marksOf(runs))
        pieces.push({
          text: paragraphText(runs),
          location: { kind: 'text', body: bodyIndex, para, slide, table: !!body.cell },
          ...(body.header ? { header: body.header } : {}),
          hidden: hiddenRanges(runs),
          ...(body.unreachable ? { unhideable: { reason: 'unsupported' as const } } : {}),
        })
      })
    }
    const notes = text.notes[slide] ?? ''
    if (notes) {
      notes.split('\n').forEach((line, i) => {
        pieces.push({
          text: line,
          location: { kind: 'notes', slide, line: i },
          unhideable: { reasonText: words.notes },
        })
      })
    }
    ;(text.comments[slide] ?? []).forEach((comment, index) => {
      comment.split('\n').forEach((line, i) => {
        pieces.push({
          text: line,
          location: { kind: 'comment', slide, index, line: i },
          unhideable: { reason: 'memo-text' },
        })
      })
    })
  }
  return { pieces, existingMarks }
}

export function deckLocationText(location: DeckSpotLocation, words: DeckPieceWords): string {
  const page = words.slide(location.slide + 1)
  if (location.kind === 'notes') return `${page} · ${words.notes}`
  if (location.kind === 'comment') return `${page} · ${words.comment}`
  return location.table ? `${page} · ${words.table}` : page
}

/** A candidate a split would damage: it touches a field, an equation or a break. */
export function deckSpotBlocked(
  text: SlidesSensitiveText,
  location: DeckSpotLocation,
  start: number,
  end: number,
): boolean {
  if (location.kind !== 'text') return false
  const runs = text.bodies[location.body]?.paragraphs[location.para]
  if (!runs) return true
  const spans = runSpans(runs)
  return runs.some((r, i) => r.fixed && start < spans[i]![1] && spans[i]![0] < end)
}

interface Cut {
  start: number
  end: number
  label: string
}

/** One paragraph handed back as it is, with the cut stretches made runs of their own. */
export function paragraphWithCuts(
  runs: readonly SensitiveRunInfo[],
  para: number,
  cuts: readonly Cut[],
): EditParagraph {
  const spans = runSpans(runs)
  const out: EditRun[] = []
  runs.forEach((run, ri) => {
    const [from, to] = spans[ri]!
    const inside = cuts
      .filter((c) => c.start < to && from < c.end)
      .sort((a, b) => a.start - b.start)
    if (inside.length === 0 || run.fixed) {
      out.push({ text: run.text, srcRun: ri })
      return
    }
    let at = from
    for (const cut of inside) {
      const s = Math.max(cut.start, from)
      const e = Math.min(cut.end, to)
      if (s > at) out.push({ text: run.text.slice(at - from, s - from), srcRun: ri })
      if (e > s) {
        out.push({
          text: run.text.slice(s - from, e - from),
          srcRun: ri,
          redact: cut.label,
          underline: true,
        })
      }
      at = Math.max(at, e)
    }
    if (at < to) out.push({ text: run.text.slice(at - from), srcRun: ri })
  })
  return { runs: out, srcPara: para }
}

/**
 * The ops that hide the given spots: one per text body, every paragraph of it
 * handed back. A spot whose paragraph no longer reads as it did when it was
 * found is skipped (the deck changed under the list).
 */
export function deckHideOps(
  text: SlidesSensitiveText,
  found: SlidesSensitiveText,
  spots: readonly SensitiveSpot<DeckSpotLocation>[],
): { ops: unknown[]; hidden: string[] } {
  const byBody = new Map<number, Map<number, Cut[]>>()
  const hidden: string[] = []
  for (const spot of spots) {
    const loc = spot.location
    if (loc.kind !== 'text' || !spot.hideable) continue
    const was = found.bodies[loc.body]
    const now = text.bodies[loc.body]
    if (!was || !now || !sameBody(was, now)) continue
    const before = was.paragraphs[loc.para]
    const runs = now.paragraphs[loc.para]
    if (!before || !runs || paragraphText(before) !== paragraphText(runs)) continue
    if (paragraphText(runs).slice(spot.start, spot.end) !== spot.value) continue
    if (deckSpotBlocked(text, loc, spot.start, spot.end)) continue
    if (hiddenRanges(runs).some(([s, e]) => spot.start < e && s < spot.end)) continue
    const paras = byBody.get(loc.body) ?? new Map<number, Cut[]>()
    const cuts = paras.get(loc.para) ?? []
    cuts.push({ start: spot.start, end: spot.end, label: spot.label })
    paras.set(loc.para, cuts)
    byBody.set(loc.body, paras)
    hidden.push(spot.id)
  }
  const ops: unknown[] = []
  for (const [bodyIndex, paras] of byBody) {
    const body = text.bodies[bodyIndex]!
    if (body.unreachable) continue
    const paragraphs = body.paragraphs.map((runs, pi) =>
      paragraphWithCuts(runs, pi, paras.get(pi) ?? []),
    )
    const target = { slide: body.slide, el: body.el }
    ops.push(
      body.cell
        ? { op: 'setTableCell', target, row: body.cell.row, col: body.cell.col, paragraphs }
        : { op: 'setText', target, paragraphs, ...(body.group ? { group: body.group } : {}) },
    )
  }
  return { ops, hidden }
}

function sameBody(a: SensitiveBodyInfo, b: SensitiveBodyInfo): boolean {
  return (
    a.slide === b.slide &&
    a.el === b.el &&
    a.group === b.group &&
    a.cell?.row === b.cell?.row &&
    a.cell?.col === b.cell?.col
  )
}
