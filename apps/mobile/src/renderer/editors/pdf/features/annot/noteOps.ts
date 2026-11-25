// Sticky notes and their replies with the PC rules (apps/pdf/src/renderer/App.tsx
// `confirmNoteDraft`, `replyToNote`, `noteEditOps`, `deleteNoteItem`) over the PC thread
// model (note-threads.ts): pending notes are `addDrawing` kind note, saved ones are
// edited through `editSavedNote` and deleted through `deleteSavedAnnot`.
import { DRAW_COLORS } from '../../../../../../../pdf/src/renderer/DrawLayer'
import {
  threadSubtree,
  visibleNoteThreads,
  type NoteInput,
  type NoteThreadItem,
  type SavedNoteAnnot,
} from '../../../../../../../pdf/src/renderer/note-threads'
import type { EditSnapshot, Op } from '../../edit/types'

type Rgb = [number, number, number]

/** The PC note color when nothing else was chosen (its draw color default). */
export const NOTE_DEFAULT_COLOR: Rgb = [...DRAW_COLORS[0]!.rgb]

/** The rectangle a note is saved with (PC save-pdf.ts): 20 × 18 below-right of `at`. */
export const noteRect = (at: readonly [number, number]): [number, number, number, number] => [
  at[0],
  at[1] - 18,
  at[0] + 20,
  at[1],
]

/** Pending note drawings of one page, replies included (PC `pendingNotesOn`). */
export function pendingNotesOn(
  edits: EditSnapshot,
  pageIndex: number,
): { id: string; input: NoteInput }[] {
  return edits.drawings.flatMap((d) =>
    d.input.kind === 'note' && d.input.pageIndex === pageIndex
      ? [{ id: d.id, input: d.input }]
      : [],
  )
}

/** The threads of one page as the screen shows them (PC `threadsFromSaved`). */
export function pageThreads(
  edits: EditSnapshot,
  pageIndex: number,
  savedNotes: readonly SavedNoteAnnot[],
): NoteThreadItem[] {
  return visibleNoteThreads(
    [...savedNotes],
    pendingNotesOn(edits, pageIndex),
    new Set(edits.annotDeletes.map((d) => d.annot.objNum)),
    new Map(
      edits.noteEdits
        .filter((e) => e.annot.pageIndex === pageIndex)
        .map((e) => [e.annot.objNum, e.contents]),
    ),
  )
}

const authorPart = (author: string): { author?: string } => (author ? { author } : {})

/** A new note at `at` (PDF user space, the note's top-left). */
export function newNoteOp(o: {
  id: string
  pageIndex: number
  at: [number, number]
  contents: string
  author: string
  now: number
  color?: Rgb
}): Op {
  return {
    op: 'addDrawing',
    id: o.id,
    drawing: {
      kind: 'note',
      pageIndex: o.pageIndex,
      color: o.color ?? [...NOTE_DEFAULT_COLOR],
      at: o.at,
      contents: o.contents,
      ...authorPart(o.author),
      createdMs: o.now,
    },
  }
}

/** A reply to a thread's root (flat threads: /IRT → root). */
export function replyOp(o: {
  pageIndex: number
  root: NoteThreadItem
  contents: string
  author: string
  now: number
}): Op {
  const { root } = o
  return {
    op: 'addDrawing',
    drawing: {
      kind: 'note',
      pageIndex: o.pageIndex,
      color: root.color ?? [...NOTE_DEFAULT_COLOR],
      at: root.at,
      contents: o.contents,
      ...authorPart(o.author),
      createdMs: o.now,
      ...(root.saved
        ? {
            replyToSaved: {
              objNum: root.saved.objNum,
              rect: root.saved.rect,
              contents: root.saved.contents,
            },
          }
        : root.pendingId !== null
          ? { replyToLocalId: root.pendingId }
          : {}),
    },
  }
}

/** Ops rewriting one comment; null when nothing changes. */
export function noteEditOps(item: NoteThreadItem, text: string): Op[] | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed === item.contents) return null
  if (item.pendingId !== null)
    return [{ op: 'setNoteContents', id: item.pendingId, contents: trimmed }]
  if (item.saved) {
    // a save never runs while edits are accepted on mobile (the store is locked), so
    // there is no in-flight write to force the entry for
    return [{ op: 'editSavedNote', annot: item.saved, contents: trimmed, force: false }]
  }
  return null
}

/** Delete a comment and everything under it. */
export function noteDeleteOps(item: NoteThreadItem): Op[] {
  const { saved, pendingIds } = threadSubtree(item)
  return [
    ...saved.map((annot): Op => ({ op: 'deleteSavedAnnot', annot })),
    ...pendingIds.map((id): Op => ({ op: 'removeDrawing', id })),
  ]
}
