import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { ExistingMark } from '@genoffice/agent-core/sensitive-labels'
import { sanitizeLabel } from '@genoffice/agent-core/redact-core'
import type { SensitivePiece, SensitiveSpot } from '../ai/sensitive-find'
import { REDACT_MARK } from './redact'

/**
 * The document side of "find sensitive info": one piece per text block in
 * reading order (a table cell below the first row carries its column's first
 * cell as `header`), and the hide that marks a confirmed spot with the
 * editor's own command (`setRedaction`, the same one the right-click dialog
 * runs). Spans already under the mark are not offered again.
 */

export interface DocSpotLocation {
  /** the nearest heading above, or null before the first one */
  heading: string | null
  /** document position of each character of the piece's text */
  positions: readonly number[]
}

/** a leaf inline node (an image, a formula) reads as one placeholder character */
const LEAF = '￼'

interface Walk {
  pieces: SensitivePiece<DocSpotLocation>[]
  marks: ExistingMark[]
  heading: string | null
}

function textblockPiece(walk: Walk, node: PmNode, pos: number, header?: string): void {
  let text = ''
  const positions: number[] = []
  const hidden: Array<[number, number]> = []
  let open: { label: string; from: number; value: string } | null = null
  const close = () => {
    if (open) {
      hidden.push([open.from, text.length])
      if (open.value) walk.marks.push({ label: open.label, value: open.value })
    }
    open = null
  }
  node.forEach((child, offset) => {
    const at = pos + 1 + offset
    const mark = child.marks.find((m) => m.type.name === REDACT_MARK)
    const label = mark ? String(mark.attrs.label ?? '') : null
    if (open && open.label !== label) close()
    if (label !== null && !open) open = { label, from: text.length, value: '' }
    const piece = child.isText ? (child.text ?? '') : child.type.name === 'hardBreak' ? '\n' : LEAF
    for (let k = 0; k < piece.length; k++) positions.push(child.isText ? at + k : at)
    text += piece
    if (open && child.isText) open.value += piece
    if (!label) close()
  })
  close()
  if (node.type.name === 'heading') walk.heading = node.textContent.trim() || walk.heading
  const markType = node.type.schema.marks[REDACT_MARK]
  const markable = !!markType && node.type.allowsMarkType(markType)
  walk.pieces.push({
    text,
    location: { heading: walk.heading, positions },
    ...(header ? { header } : {}),
    hidden,
    ...(markable ? {} : { unhideable: { reason: 'unsupported' as const } }),
  })
}

function walkNode(walk: Walk, node: PmNode, pos: number, header?: string): void {
  if (node.isTextblock) {
    textblockPiece(walk, node, pos, header)
    return
  }
  if (node.type.name === 'table') {
    const heads: string[] = []
    node.firstChild?.forEach((cell) => heads.push(cell.textContent.trim()))
    node.forEach((row, rowOffset) => {
      const rowPos = pos + 1 + rowOffset
      let col = 0
      row.forEach((cell, cellOffset) => {
        const cellPos = rowPos + 1 + cellOffset
        const head = rowOffset > 0 ? heads[col] || undefined : undefined
        cell.forEach((child, childOffset) => walkNode(walk, child, cellPos + 1 + childOffset, head))
        col += 1
      })
    })
    return
  }
  node.forEach((child, offset) => walkNode(walk, child, pos + 1 + offset, header))
}

export function docPieces(doc: PmNode): {
  pieces: SensitivePiece<DocSpotLocation>[]
  existingMarks: ExistingMark[]
} {
  const walk: Walk = { pieces: [], marks: [], heading: null }
  // the document node itself has no opening token: its children start at 0
  doc.forEach((child, offset) => walkNode(walk, child, offset))
  return { pieces: walk.pieces, existingMarks: walk.marks }
}

/** The document range of a spot, or null when the characters are not text the mark can cover. */
export function spotRange(
  spot: SensitiveSpot<DocSpotLocation>,
): { from: number; to: number } | null {
  const { positions } = spot.location
  const from = positions[spot.start]
  const last = positions[spot.end - 1]
  if (from === undefined || last === undefined || last < from) return null
  return { from, to: last + 1 }
}

/**
 * Hide the spots with the editor's own command. A spot whose words are no
 * longer where they were found is skipped; the reader's selection is put back.
 */
export function hideDocSpots(
  editor: Editor,
  spots: readonly SensitiveSpot<DocSpotLocation>[],
): number {
  const { from: selFrom, to: selTo } = editor.state.selection
  let done = 0
  for (const spot of spots) {
    if (!spot.hideable) continue
    const range = spotRange(spot)
    if (!range) continue
    const size = editor.state.doc.content.size
    if (range.to > size) continue
    if (editor.state.doc.textBetween(range.from, range.to, '\n', LEAF) !== spot.value) continue
    const label = sanitizeLabel(spot.label)
    if (!label) continue
    // two steps, not one chain: the command reads the editor's committed selection,
    // which a chained selection change has not reached yet
    editor.commands.setTextSelection(range)
    if (editor.commands.setRedaction(label)) done += 1
  }
  const size = editor.state.doc.content.size
  editor.commands.setTextSelection({ from: Math.min(selFrom, size), to: Math.min(selTo, size) })
  return done
}

export function locateDocSpot(editor: Editor, spot: SensitiveSpot<DocSpotLocation>): void {
  const range = spotRange(spot)
  if (!range || range.to > editor.state.doc.content.size) return
  editor.chain().focus().setTextSelection(range).scrollIntoView().run()
}
