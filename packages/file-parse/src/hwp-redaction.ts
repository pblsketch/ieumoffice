import type { HwpDocument } from '@rhwp/core'
import { readHidingMemoLabel } from '@genoffice/agent-core/hiding-memo'
import { placeholderSource } from '@genoffice/agent-core/redact-core'
import { RedactionMarkError } from './redaction-error'

/**
 * Hidden spans of a Hangul document, read as another file's material.
 *
 * The mark is a memo whose text is `[<prefix>] <label>` (recognised by
 * @genoffice/agent-core/hiding-memo, every screen language's prefix); its
 * anchor is the hidden span. The engine lists each memo with the paragraph it
 * sits in, the path to a table cell or text box inside that paragraph, and the
 * character range of the anchor.
 *
 * Every hiding memo has to be placed exactly: a list that cannot be read, a
 * place the reader does not know (header, footer, notes), a range that does
 * not fit its paragraph, or a memo spanning paragraphs (the engine gives no
 * range for it) throws, and the document is not read. Ordinary memos are left
 * as they are.
 */

/** One memo as the engine lists it. */
export interface HwpListedMemo {
  id?: number
  index?: number
  author?: string
  date?: string | null
  text?: string
  place?: string
  sectionIndex?: number | null
  paraIndex?: number | null
  startCharIdx?: number | null
  endCharIdx?: number | null
  path?: Array<{
    type: string
    controlIndex?: number
    cellIndex?: number
    paraIndex?: number
  }> | null
  page?: number
}

/** One step from a body paragraph into a table cell or text box, as the ...ByPath calls take it. */
export interface HwpCellStep {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

/** One hidden span, placed. */
export interface HwpHiddenRange {
  label: string
  section: number
  /** the body paragraph the span, or the control holding it, sits in */
  paragraph: number
  /** null for the body paragraph itself, else the way into a cell or text box paragraph */
  path: HwpCellStep[] | null
  start: number
  end: number
  /** the hidden words as the engine reads them */
  text: string
}

/** The document's memos. A list that cannot be read is refused rather than read as empty. */
export function hwpMemoListOf(doc: HwpDocument): HwpListedMemo[] {
  let listed: unknown
  try {
    listed = JSON.parse(doc.getMemoList())
  } catch {
    throw new RedactionMarkError('the memo list cannot be read')
  }
  if (!Array.isArray(listed)) throw new RedactionMarkError('the memo list cannot be read')
  return listed as HwpListedMemo[]
}

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

function stepsOf(path: HwpListedMemo['path']): HwpCellStep[] | null {
  if (!Array.isArray(path) || path.length === 0) return null
  const steps: HwpCellStep[] = []
  for (const step of path) {
    const cellIndex = step.type === 'textbox' ? 0 : step.type === 'cell' ? step.cellIndex : -1
    if (!isIndex(step.controlIndex) || !isIndex(cellIndex) || !isIndex(step.paraIndex)) return null
    steps.push({ controlIndex: step.controlIndex, cellIndex, cellParaIndex: step.paraIndex })
  }
  return steps
}

const unplaced = () => new RedactionMarkError('a hiding memo cannot be placed in the text')

/** Where one hiding memo's anchor is, checked against the document. */
function placeOf(doc: HwpDocument, memo: HwpListedMemo, label: string): HwpHiddenRange {
  const section = memo.sectionIndex
  const paragraph = memo.paraIndex
  const start = memo.startCharIdx
  const end = memo.endCharIdx
  if (!isIndex(section) || !isIndex(paragraph) || !isIndex(start) || !isIndex(end)) throw unplaced()
  if (start >= end) throw unplaced()
  try {
    if (section >= doc.getSectionCount() || paragraph >= doc.getParagraphCount(section)) {
      throw unplaced()
    }
    if (memo.place === 'body' && (memo.path === null || memo.path === undefined)) {
      if (end > doc.getParagraphLength(section, paragraph)) throw unplaced()
      const text = doc.getTextRange(section, paragraph, start, end - start)
      return { label, section, paragraph, path: null, start, end, text }
    }
    const path = memo.place === 'tableCell' || memo.place === 'textBox' ? stepsOf(memo.path) : null
    if (!path) throw unplaced()
    const json = JSON.stringify(path)
    if (end > doc.getCellParagraphLengthByPath(section, paragraph, json)) throw unplaced()
    const text = doc.getTextInCellByPath(section, paragraph, json, start, end - start)
    return { label, section, paragraph, path, start, end, text }
  } catch (thrown) {
    if (thrown instanceof RedactionMarkError) throw thrown
    throw unplaced()
  }
}

/** Every hiding memo of the list, placed; throws when one cannot be. */
export function hwpHiddenRangesOf(
  doc: HwpDocument,
  memos: readonly HwpListedMemo[],
): HwpHiddenRange[] {
  const out: HwpHiddenRange[] = []
  for (const memo of memos) {
    const label = readHidingMemoLabel(String(memo.text ?? ''))
    if (label !== null) out.push(placeOf(doc, memo, label))
  }
  return out
}

/** The key a walked paragraph is found by: the body paragraph, or one step into a cell. */
export function hiddenKey(section: number, paragraph: number, step?: HwpCellStep): string {
  return step
    ? `${section}:${paragraph}:${step.controlIndex}:${step.cellIndex}:${step.cellParaIndex}`
    : `${section}:${paragraph}`
}

/** The hidden ranges by the walked paragraph they sit in; deeper ones are not walked. */
export function hiddenByParagraph(
  ranges: readonly HwpHiddenRange[],
): Map<string, HwpHiddenRange[]> {
  const out = new Map<string, HwpHiddenRange[]>()
  for (const range of ranges) {
    if (range.path && range.path.length !== 1) continue
    const key = hiddenKey(range.section, range.paragraph, range.path?.[0])
    out.set(key, [...(out.get(key) ?? []), range])
  }
  return out
}

/**
 * A paragraph's text with its hidden ranges as their labels. `read(offset,
 * count)` reads the paragraph through the engine, so offsets stay the
 * engine's. Overlapping ranges are hidden as one, under the first label.
 */
export function concealedParagraph(
  length: number,
  ranges: readonly HwpHiddenRange[],
  read: (offset: number, count: number) => string,
): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number; label: string }> = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ start: range.start, end: range.end, label: range.label })
  }
  let out = ''
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) out += read(cursor, range.start - cursor)
    out += placeholderSource(range.label)
    cursor = Math.max(cursor, range.end)
  }
  if (length > cursor) out += read(cursor, length - cursor)
  return out
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const MARKER = /\{\{[^{}]*\}\}/g

/**
 * What hides the hidden words in text the walk did not produce: the lines the
 * engine's plain-text export carries that no walked paragraph accounts for (a
 * text box, a table inside a cell, a paragraph whose export differs, as an
 * empty fill-in field's guide makes it). Every occurrence of a hidden piece is
 * replaced, more than the editor hides but never less, and a piece that still
 * shows (spaced differently, split across lines) fails the read.
 */
export function concealerOf(ranges: readonly HwpHiddenRange[]): (line: string) => string {
  const pieces = new Map<string, string>()
  for (const range of ranges) {
    for (const part of range.text.split(/[\r\n\t]+/)) {
      for (const piece of [part.trim(), normalize(part)]) {
        if (piece && !pieces.has(piece)) pieces.set(piece, placeholderSource(range.label))
      }
    }
  }
  const ordered = [...pieces.keys()].sort((a, b) => b.length - a.length)
  if (ordered.length === 0) return (line) => line
  const pattern = new RegExp(
    ordered.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  )
  return (line) => {
    const out = line.replace(pattern, (found) => pieces.get(found)!)
    const left = normalize(out.replace(MARKER, ' '))
    if (ordered.some((piece) => left.includes(normalize(piece)))) {
      throw new RedactionMarkError('hidden words show in a form that cannot be hidden')
    }
    return out
  }
}
