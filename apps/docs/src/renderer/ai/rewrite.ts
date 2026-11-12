import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { PmMark, PmNode } from '../editor/convert'
import { commentAnchors } from '../editor/comments'
import { isTrackedDeleted } from './doc-utils'
import { baseTextStyle } from './inherit-formatting'
import {
  addItems,
  emptyInventory,
  keepIssuesMessage,
  keepTallyText,
  parseDrop,
  projectInline,
  recordShown,
  restoreBlocks,
  restoreInline,
  wasShown,
  widenToItems,
  LINK_MARK,
  type KeepInventory,
  type TextItem,
} from './keep-tokens'
import { noteAnchors, renumber, type AiNotesAccess, type NoteKind } from './note-ops'
import {
  blockRangePositions,
  blockReplacementTr,
  inheritBlockFormatting,
  inlineReplacementTr,
  modelViewOfRange,
  parseHtmlFragment,
  parseInlineFragment,
  type AiTrack,
  type NumIds,
} from './protocol'
import { redactTextBetween } from './redact-view'

/**
 * The write half of the model's round trip: everything replace_blocks and
 * replace_selection do between the tool input and the dispatch. A rewrite
 * lands only when its keep tokens account for every object of the range
 * (keep-tokens.ts); otherwise the document is left as it was and the model is
 * told exactly what to fix.
 */

export const READ_MAX_CHARS = 24_000

export interface RewriteRequest {
  html: string
  drop?: unknown
}

export interface RewriteEnv {
  track?: AiTrack
  notes?: AiNotesAccess
  comments?: { remove?(id: string): boolean }
}

export interface RewriteOutcome {
  ok: boolean
  output: string
}

const fail = (output: string): RewriteOutcome => ({ ok: false, output })
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text

/**
 * read_blocks: the model view of a range, paged. The range counts as shown
 * once the read reaches its end, which is what lets a rewrite of formatted
 * blocks through.
 */
export function readBlocks(
  editor: Editor,
  range: { start: number; end: number },
  offset: number,
): RewriteOutcome {
  const html = modelViewOfRange(editor, range.start, range.end).html
  if (offset > 0 && offset >= html.length) {
    return fail(`offset ${offset} is beyond the content (${html.length} characters in total)`)
  }
  const slice = html.slice(offset, offset + READ_MAX_CHARS)
  const end = offset + slice.length
  if (end >= html.length) {
    const blocks: ProseMirrorNode[] = []
    for (let i = range.start; i <= range.end; i++) blocks.push(editor.state.doc.child(i))
    recordShown(editor, blocks)
  }
  const note =
    end < html.length
      ? `\n…(truncated: ${html.length} characters in total, call read_blocks again with offset=${end} to continue)`
      : offset > 0
        ? `\n(end of range: ${html.length} characters in total)`
        : ''
  if (slice) return { ok: true, output: slice + note }
  let deletedBlocks = 0
  for (let i = range.start; i <= range.end; i++) {
    if (isTrackedDeleted(editor.state.doc.child(i))) deletedBlocks++
  }
  return {
    ok: true,
    output:
      deletedBlocks > 0
        ? `(the ${deletedBlocks} block(s) in this range are pending tracked deletions — that text is already deleted and hidden from reads; do not delete or rewrite it again)`
        : '(range is empty)',
  }
}

/** where an id lives in the whole document, for a refusal that names a move across the range edge */
function whereIsIn(editor: Editor): (key: string) => number | null {
  let all: KeepInventory | null = null
  return (key) => {
    all ??= modelViewOfRange(editor, 0, editor.state.doc.childCount - 1).inventory
    return all.entries.get(key)?.blockIndex ?? null
  }
}

/** footnote/endnote marks and comment ids a write may take the last anchor of */
interface Anchored {
  notes: Array<{ kind: NoteKind; id: string }>
  comments: Set<string>
}

function anchoredIn(doc: ProseMirrorNode, from: number, to: number): Anchored {
  const notes: Anchored['notes'] = []
  const comments = new Set<string>()
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'docNoteRef')
      notes.push({ kind: node.attrs.kind as NoteKind, id: String(node.attrs.id) })
    if (node.isInline) {
      const mark = node.marks.find((m) => m.type.name === 'comment')
      for (const id of String(mark?.attrs.ids ?? '').split(' ')) if (id) comments.add(id)
    }
    return true
  })
  // a range carried by paragraph attrs is outside what a rewrite accounts for
  doc.forEach((block) => {
    for (const key of ['commentStarts', 'commentEnds']) {
      const ids = block.attrs?.[key]
      if (Array.isArray(ids)) for (const id of ids) comments.delete(String(id))
    }
  })
  return { notes, comments }
}

function renumberNotes(tr: Transaction): void {
  renumber(tr, 'footnote')
  renumber(tr, 'endnote')
}

/**
 * Word's rule for an untracked write: a note whose last reference is gone, or
 * a comment whose last anchored character is gone, goes with it. Decided from
 * the document after the write, so a retry finds nothing left to do.
 */
function settleAnchors(editor: Editor, before: Anchored, env: RewriteEnv): void {
  if (env.track) return
  const notes = env.notes
  if (notes) {
    const live = noteAnchors(editor.state.doc)
    for (const { kind, id } of before.notes) {
      if (live.has(`${kind}:${id}`)) continue
      if ((notes.protectedMarkBlock?.(kind, id) ?? null) !== null) continue
      if (notes.list(kind).some((n) => n.id === id)) notes.remove(kind, id)
    }
  }
  const remove = env.comments?.remove
  if (remove && before.comments.size > 0) {
    const live = new Set(commentAnchors(editor.state.doc).map((a) => a.id))
    for (const id of before.comments) if (!live.has(id)) remove.call(env.comments, id)
  }
}

function blocksBetween(doc: ProseMirrorNode, from: number, to: number): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = []
  doc.forEach((node, offset) => {
    if (offset >= from && offset + node.nodeSize <= to) out.push(node)
  })
  return out
}

export function rewriteBlocks(
  editor: Editor,
  range: { start: number; end: number },
  req: RewriteRequest,
  env: RewriteEnv & { numIds: NumIds },
): RewriteOutcome {
  const label = `blocks ${range.start}-${range.end}`
  const view = modelViewOfRange(editor, range.start, range.end)
  const doc = editor.state.doc
  const unread = view.formatted.filter((i) => !wasShown(editor, doc.child(i)))
  if (unread.length > 0) {
    const read = readBlocks(editor, range, 0)
    return fail(
      `Not applied: ${unread.length > 1 ? 'blocks' : 'block'} ${unread.join(', ')} ${unread.length > 1 ? 'carry' : 'carries'} formatting, notes or pictures the block list does not show. ` +
        `Rewrite from this HTML (the same as read_blocks ${range.start}-${range.end}) and keep its tokens:\n${read.output}`,
    )
  }
  const inv = view.inventory
  const drop = parseDrop(req.drop, inv)
  if (Array.isArray(drop)) return fail(keepIssuesMessage(drop, inv, label))
  let parsed: PmNode[]
  try {
    parsed = parseHtmlFragment(req.html, env.numIds, 'tokens')
  } catch (e) {
    return fail(errorText(e))
  }
  if (parsed.length === 0) return fail('html did not parse into any content blocks')
  // a tracked rewrite keeps the old blocks (struck through) next to the new
  // ones, so the anchors stay with the old blocks until the user accepts
  const inherited = inheritBlockFormatting(editor, range.start, range.end, parsed, !env.track)
  const restored = restoreBlocks(inherited, inv, drop)
  if (!restored.ok) return fail(keepIssuesMessage(restored.issues, inv, label, whereIsIn(editor)))

  const { from, to } = blockRangePositions(editor, range.start, range.end)
  const before = anchoredIn(doc, from, to)
  let built: ReturnType<typeof blockReplacementTr>
  try {
    built = blockReplacementTr(
      editor,
      range.start,
      range.end,
      restored.nodes,
      env.track,
      restored.once,
    )
  } catch (e) {
    return fail(errorText(e))
  }
  if ('error' in built) return fail(built.error)
  if (before.notes.length > 0) renumberNotes(built.tr)
  editor.view.dispatch(built.tr)
  settleAnchors(editor, before, env)
  // the model authored these blocks, so it has seen them
  recordShown(editor, blocksBetween(editor.state.doc, built.inserted.from, built.inserted.to))
  const tally = keepTallyText(inv, restored.used, drop)
  const tracked =
    env.track && before.comments.size > 0
      ? ' As a tracked change, the comments stay on the original (struck-through) text, not on the new text; accepting the change removes them, as in Word.'
      : ''
  return {
    ok: true,
    output: `Replaced ${label} with ${restored.nodes.length} block(s); they took the paragraph formatting and base text style of the blocks they replace.${tally ? ` ${tally}` : ''}${tracked} Block indexes have changed; use get_document_context if needed.`,
  }
}

const TAG_MARKS = new Set(['bold', 'italic', 'underline', 'strike'])

/**
 * replace_selection inside one text block. Text the fragment writes without a
 * span or tags of its own continues the replaced text: its span, its style,
 * and (when the fragment writes no tags or links at all) its tags and link.
 */
export function rewriteSelection(
  editor: Editor,
  range: { from: number; to: number },
  req: RewriteRequest,
  env: RewriteEnv,
): RewriteOutcome {
  const doc = editor.state.doc
  const $from = doc.resolve(range.from)
  const blockIndex = $from.index(0)
  const start = $from.start()
  const real = doc.child(blockIndex).toJSON() as PmNode
  const base = baseTextStyle(real.content)
  const items = projectInline(real.content ?? [], base)
  const sel = widenToItems(items, range.from - start, range.to - start)
  const inv = emptyInventory()
  addItems(inv, items, blockIndex, sel)
  const label = `the selected text of block ${blockIndex}`
  const drop = parseDrop(req.drop, inv)
  if (Array.isArray(drop)) return fail(keepIssuesMessage(drop, inv, label))
  let inline: PmNode[]
  try {
    inline = parseInlineFragment(req.html, 'tokens')
  } catch (e) {
    return fail(errorText(e))
  }
  if (inline.length === 0) return fail('html did not parse into any text')

  const anchor =
    items.find(
      (it): it is TextItem =>
        it.kind === 'text' && it.from + it.text.length > sel.from && it.from < sel.to,
    ) ?? null
  const anchorMarks: PmMark[] = anchor?.node.marks ?? []
  const restored = restoreInline(inline, inv, drop, {
    style: anchor
      ? anchor.span
        ? base.mark
        : (anchorMarks.find((m) => m.type === 'docTextStyle') ?? null)
      : base.mark,
    span: anchor?.span ?? null,
    tags: anchorMarks.filter((m) => TAG_MARKS.has(m.type)),
    link: anchor?.link ?? null,
    styled: inline.some((n) =>
      (n.marks ?? []).some(
        (m) => TAG_MARKS.has(m.type) || m.type === 'link' || m.type === LINK_MARK,
      ),
    ),
  })
  if (!restored.ok) return fail(keepIssuesMessage(restored.issues, inv, label, whereIsIn(editor)))

  let nodes: ProseMirrorNode[]
  try {
    nodes = restored.nodes.map((n) => editor.schema.nodeFromJSON(n))
  } catch (e) {
    return fail(errorText(e))
  }
  const from = start + sel.from
  const to = start + sel.to
  // the echo quotes what was replaced back to the model, so a selection
  // covering a withheld span would undo the withholding right here
  const oldText = redactTextBetween(editor.getJSON(), from, to, ' ')
  const before = anchoredIn(doc, from, to)
  const tr = inlineReplacementTr(editor, from, to, nodes, env.track, restored.once)
  if (before.notes.length > 0) renumberNotes(tr)
  editor.view.dispatch(tr)
  settleAnchors(editor, before, env)
  const { from: newFrom, to: newTo } = editor.state.selection
  // restored withheld runs are real words: quote the new text as the model may read it
  const newText = redactTextBetween(editor.getJSON(), newFrom, newTo, ' ')
  const tally = keepTallyText(inv, restored.used, drop)
  return {
    ok: true,
    output: `Replaced the selected text in block ${blockIndex}: "${clip(oldText, 200)}" → "${clip(newText, 200)}". The rest of the block is unchanged; the new text is now selected.${tally ? ` ${tally}` : ''}`,
  }
}
