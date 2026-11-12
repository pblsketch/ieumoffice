import type { Node as PmNode } from '@tiptap/pm/model'
import {
  detectSensitive,
  labelWordKind,
  type TextPiece,
} from '@genoffice/agent-core/sensitive-detect'
import { createCandidateLabeler, type ExistingMark } from '@genoffice/agent-core/sensitive-labels'
import type { SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'
import {
  sensitiveContextOf,
  type SensitiveCandidateRow,
  type SensitiveUnhideableReason,
} from '@genoffice/ui'
import { REDACT_MARK } from '../ai/redact'

/**
 * "Find sensitive info" over a Word document.
 *
 * The document is read in reading order as text pieces: every paragraph of
 * the body, every paragraph of every table cell (a cell gets its column's
 * header, the first row's cell above it, unless the cell is itself a label),
 * then the places the model also reads but the hiding mark cannot reach:
 * nested tables and protected blocks in the body, headers and footers,
 * footnotes and endnotes, and comments. Those are listed and counted, with
 * their confirm button off.
 *
 * Text already under a hiding mark is not in the pieces: the finder cannot
 * see what is hidden, so it never offers it again and never confirms it.
 *
 * Everything here is rules only and on this PC; nothing is sent anywhere.
 */

/** one character of a piece maps to a document position, or to nothing (a gap) */
type PosMap = (number | null)[]

interface Piece {
  text: string
  /** body pieces only: the document position of each character */
  map: PosMap | null
  location: string
  reason?: SensitiveUnhideableReason
  header?: string
}

export interface DocSensitiveText {
  /** "Paragraph {n}" */
  paragraph: (n: number) => string
  /** "Table {n}, row {r}, column {c}" */
  tableCell: (n: number, r: number, c: number) => string
  header: string
  footer: string
  footnote: string
  endnote: string
  comment: string
}

/** The places outside the body the model reads, as plain text. */
export interface DocSensitiveExtras {
  headers?: readonly string[]
  footers?: readonly string[]
  footnotes?: readonly string[]
  endnotes?: readonly string[]
  comments?: readonly string[]
}

export interface DocSensitiveCandidate {
  /** stable across unrelated edits: kind, value and which occurrence it is */
  id: string
  kind: SensitiveKind
  value: string
  before: string
  after: string
  location: string
  hideable: boolean
  reason?: SensitiveUnhideableReason
  /** body candidates: the range the hiding mark goes over */
  range?: { from: number; to: number }
}

/** A gap in a piece: hidden text, a block or cell boundary. Never part of a candidate. */
const GAP = '\n'

const markName = (m: { type: { name: string } }) => m.type.name

function isHidden(node: PmNode): boolean {
  return node.marks.some((m) => markName(m) === REDACT_MARK)
}

/** The text of a textblock with each character's document position; hidden text is a gap. */
function textblockPiece(node: PmNode, pos: number): { text: string; map: PosMap } {
  let text = ''
  const map: PosMap = []
  let gapOpen = false
  node.forEach((child, offset) => {
    const at = pos + 1 + offset
    if (isHidden(child)) {
      if (!gapOpen) {
        text += GAP
        map.push(null)
        gapOpen = true
      }
      return
    }
    gapOpen = false
    if (child.isText) {
      const s = child.text ?? ''
      text += s
      for (let i = 0; i < s.length; i++) map.push(at + i)
      return
    }
    // an inline atom: a line break reads as one, anything else as a space
    text += child.type.name === 'hardBreak' ? '\n' : ' '
    map.push(at)
  })
  return { text, map }
}

function nestedTableTexts(node: PmNode): string[] {
  const model = node.attrs.model as {
    rows?: { paras?: string[]; nestedTables?: unknown[] }[][]
  } | null
  const out: string[] = []
  const walk = (m: typeof model) => {
    for (const row of m?.rows ?? [])
      for (const cell of row) {
        for (const p of cell.paras ?? []) out.push(p)
        for (const t of cell.nestedTables ?? []) walk(t as typeof model)
      }
  }
  walk(model)
  return out
}

/** The body as pieces, in reading order. */
function bodyPieces(doc: PmNode, text: DocSensitiveText): Piece[] {
  const pieces: Piece[] = []
  let paragraph = 0
  let tableNo = 0

  const unhideable = (s: string, location: string) => {
    for (const line of s.split(/\r?\n/))
      if (line.trim()) pieces.push({ text: line, map: null, location, reason: 'unsupported' })
  }

  const block = (node: PmNode, pos: number, location: string, header?: string) => {
    if (node.isTextblock) {
      const { text: s, map } = textblockPiece(node, pos)
      pieces.push({ text: s, map, location, ...(header ? { header } : {}) })
      return
    }
    if (node.type.name === 'docNestedTable') {
      for (const s of nestedTableTexts(node)) unhideable(s, location)
      return
    }
    if (node.type.name === 'docProtected') {
      unhideable(String(node.attrs.previewText ?? ''), location)
      return
    }
    node.forEach((child, offset) => block(child, pos + 1 + offset, location, header))
  }

  const table = (node: PmNode, pos: number) => {
    const n = ++tableNo
    /** columns still covered by a cell from a row above: column → rows left */
    const covered = new Map<number, number>()
    const headers: string[] = []
    let r = 0
    node.forEach((row, rowOffset) => {
      const rowPos = pos + 1 + rowOffset
      let col = 0
      row.forEach((cell, cellOffset) => {
        while ((covered.get(col) ?? 0) > 0) col++
        const span = Math.max(1, Number(cell.attrs.colspan) || 1)
        const rowspan = Math.max(1, Number(cell.attrs.rowspan) || 1)
        const cellText = cell.textContent.trim()
        if (r === 0) for (let c = 0; c < span; c++) headers[col + c] = cellText
        // a cell that is itself a label word is not a value under its column's header
        const header = r > 0 && labelWordKind(cellText) === null ? headers[col] : undefined
        const location = text.tableCell(n, r + 1, col + 1)
        const cellPos = rowPos + 1 + cellOffset
        cell.forEach((child, childOffset) =>
          block(child, cellPos + 1 + childOffset, location, header),
        )
        if (rowspan > 1) for (let c = 0; c < span; c++) covered.set(col + c, rowspan)
        col += span
      })
      for (const [c, left] of covered) {
        if (left <= 1) covered.delete(c)
        else covered.set(c, left - 1)
      }
      r++
    })
  }

  doc.forEach((node, offset) => {
    if (node.type.name === 'docTable') {
      table(node, offset)
      return
    }
    block(node, offset, text.paragraph(++paragraph))
  })
  return pieces
}

function extraPieces(extras: DocSensitiveExtras, text: DocSensitiveText): Piece[] {
  const pieces: Piece[] = []
  const add = (
    list: readonly string[] | undefined,
    location: string,
    reason: SensitiveUnhideableReason,
  ) => {
    for (const s of list ?? [])
      for (const line of s.split(/\r?\n/))
        if (line.trim()) pieces.push({ text: line, map: null, location, reason })
  }
  add(extras.headers, text.header, 'header-footer')
  add(extras.footers, text.footer, 'header-footer')
  add(extras.footnotes, text.footnote, 'note')
  add(extras.endnotes, text.endnote, 'note')
  add(extras.comments, text.comment, 'memo-text')
  return pieces
}

/** The hiding marks the document already has, with the words they cover, for the labels. */
export function existingHidingMarks(doc: PmNode): { marks: ExistingMark[]; labels: string[] } {
  const marks: ExistingMark[] = []
  const labels: string[] = []
  doc.descendants((node) => {
    if (!node.isTextblock) return true
    let open: ExistingMark | null = null
    node.forEach((child) => {
      const mark = child.marks.find((m) => markName(m) === REDACT_MARK)
      const label = mark ? String(mark.attrs.label ?? '') : ''
      if (!mark || !child.isText) {
        if (mark && label) labels.push(label)
        if (open) marks.push(open)
        open = null
        return
      }
      if (open && open.label === label) open.value += child.text ?? ''
      else {
        if (open) marks.push(open)
        open = { label, value: child.text ?? '' }
      }
    })
    if (open) marks.push(open)
    return false
  })
  return { marks: marks.filter((m) => m.label && m.value.trim()), labels }
}

const yieldToScreen = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** how many pieces are read between two pauses, so a long document does not freeze the screen */
const PIECES_PER_SLICE = 400

/**
 * Every candidate of the document, in reading order, already-dismissed ones
 * left out. `isExcluded` answers for a batch at once (one round trip).
 */
export async function findDocSensitive(
  doc: PmNode,
  extras: DocSensitiveExtras,
  options: {
    lang: string
    text: DocSensitiveText
    isExcluded?: (items: { kind: SensitiveKind; value: string }[]) => Promise<boolean[]>
  },
): Promise<DocSensitiveCandidate[]> {
  const pieces = [...bodyPieces(doc, options.text), ...extraPieces(extras, options.text)]
  const found: { kind: SensitiveKind; start: number; end: number; value: string; piece: number }[] =
    []
  for (let from = 0; from < pieces.length; from += PIECES_PER_SLICE) {
    // the piece before the slice comes along so a label word still announces the next value
    const start = Math.max(0, from - 1)
    const slice: TextPiece<number>[] = []
    for (let i = start; i < Math.min(pieces.length, from + PIECES_PER_SLICE); i++) {
      const p = pieces[i]
      slice.push({ text: p.text, location: i, ...(p.header ? { header: p.header } : {}) })
    }
    for (const c of detectSensitive(slice)) {
      if (c.location < from) continue
      found.push({ kind: c.kind, start: c.start, end: c.end, value: c.value, piece: c.location })
    }
    if (from + PIECES_PER_SLICE < pieces.length) await yieldToScreen()
  }

  const seen = new Map<string, number>()
  const all = found.flatMap((c) => {
    const piece = pieces[c.piece]
    let range: { from: number; to: number } | undefined
    if (piece.map) {
      const span = piece.map.slice(c.start, c.end)
      // a candidate that runs into hidden text or a gap is not offered
      if (span.length === 0 || span.some((p) => p === null)) return []
      range = { from: span[0] as number, to: (span[span.length - 1] as number) + 1 }
    }
    const key = `${c.kind}\u0000${c.value}`
    const nth = (seen.get(key) ?? 0) + 1
    seen.set(key, nth)
    const { before, after } = sensitiveContextOf(piece.text, c.start, c.end)
    return [
      {
        id: `${c.kind}:${nth}:${c.value}`,
        kind: c.kind,
        value: c.value,
        before,
        after,
        location: piece.location,
        hideable: range !== undefined,
        ...(piece.reason ? { reason: piece.reason } : {}),
        ...(range ? { range } : {}),
      } satisfies DocSensitiveCandidate,
    ]
  })
  if (all.length === 0 || !options.isExcluded) return all
  const excluded = await options.isExcluded(all.map((c) => ({ kind: c.kind, value: c.value })))
  return all.filter((_, i) => excluded[i] !== true)
}

/** The rows of the candidate list: hideable rows get a label, numbered after the document's own. */
export function candidateRows(
  doc: PmNode,
  candidates: readonly DocSensitiveCandidate[],
  lang: string,
): SensitiveCandidateRow[] {
  const existing = existingHidingMarks(doc)
  const labeler = createCandidateLabeler({
    lang,
    existingMarks: existing.marks,
    existingLabels: existing.labels,
  })
  return candidates.map((c) => ({
    id: c.id,
    kind: c.kind,
    value: c.value,
    before: c.before,
    after: c.after,
    location: c.location,
    label: c.hideable ? labeler.labelFor(c.kind, c.value) : '',
    hideable: c.hideable,
    ...(c.reason ? { reason: c.reason } : {}),
  }))
}
