// The PC markup rules (apps/pdf/src/renderer/App.tsx `markupMatching`, `applyMarkup`,
// `applyHighlightPen`, `paintMarkups`, `recolorSelectionMarkup`, `recolorMarkupFromMenu`,
// `deleteMarkupFromMenu`) as pure op builders over the pending edits and the saved
// markups of each page. The feature dispatches what these return.
import type { MarkupInput, MarkupType } from '../../../../../../../pdf/src/shared/ipc'
import {
  MARKUP_COLORS,
  quadSetsMatch,
  quadToRect,
  type LocalMarkup,
} from '../../../../../../../pdf/src/renderer/annotations'
import type { SavedMarkupAnnot } from '../../../../../../../pdf/src/renderer/edit-state'
import {
  planHighlightPen,
  sameColor,
  type LineMarkupType,
  type Rgb,
} from '../../../../../../../pdf/src/renderer/selection-colors'
import type { EditSnapshot, Op } from '../../edit/types'

export const MARKUP_TYPES: readonly MarkupType[] = [
  'highlight',
  'underline',
  'squiggly',
  'strikeout',
]

/** A text selection: PDF-space quads by original page index. */
export type SelectionQuads = ReadonlyMap<number, number[][]>

export type MarkupMatch = { readonly pending: LocalMarkup } | { readonly saved: SavedMarkupAnnot }

/** What the rules read: the pending edits and the markups saved in the file per page. */
export interface MarkupWorld {
  readonly edits: EditSnapshot
  readonly saved: (pageIndex: number) => readonly SavedMarkupAnnot[]
}

/** /Subj of saved markups by object number (an accepted AI highlight's category). */
export type SubjectMap = ReadonlyMap<number, string>

const pendingDeleted = (edits: EditSnapshot): Set<number> =>
  new Set(edits.annotDeletes.map((d) => d.annot.objNum))

/** Saved markups of a page that are not pending deletion. */
export function liveSavedMarkups(world: MarkupWorld, pageIndex: number): SavedMarkupAnnot[] {
  const deleted = pendingDeleted(world.edits)
  return world.saved(pageIndex).filter((a) => !deleted.has(a.objNum))
}

/** The existing markup of `type` on exactly these quads: pending first, then saved. */
export function markupMatching(
  world: MarkupWorld,
  pageIndex: number,
  type: MarkupType,
  quads: number[][],
): MarkupMatch | null {
  const pending = world.edits.markups.find(
    (m) => m.pageIndex === pageIndex && m.type === type && quadSetsMatch(m.quads, quads),
  )
  if (pending) return { pending }
  const saved = liveSavedMarkups(world, pageIndex).find(
    (a) => a.type === type && quadSetsMatch(a.quads, quads),
  )
  return saved ? { saved } : null
}

export const markupColorOf = (m: MarkupMatch): Rgb =>
  'pending' in m ? m.pending.color : (m.saved.color ?? [...MARKUP_COLORS[m.saved.type]])

export const markupTypeOf = (m: MarkupMatch): MarkupType =>
  'pending' in m ? m.pending.type : m.saved.type

export const markupPageOf = (m: MarkupMatch): number =>
  'pending' in m ? m.pending.pageIndex : m.saved.pageIndex

const removeOps = (m: MarkupMatch | null): Op[] =>
  m && 'pending' in m
    ? [{ op: 'removeMarkup', id: m.pending.id }]
    : m && 'saved' in m
      ? [{ op: 'deleteSavedAnnot', annot: m.saved }]
      : []

/** Saved markups among the matches (their /Subj must be read before recoloring). */
export const savedOf = (matches: readonly MarkupMatch[]): SavedMarkupAnnot[] =>
  matches.flatMap((m) => ('saved' in m ? [m.saved] : []))

/**
 * Recolor existing markups and add new ones in one batch: a pending markup changes in
 * place, a saved one is replaced by a new markup on the same quads (keeping its /Subj).
 */
export function paintOps(
  color: Rgb,
  recolor: readonly MarkupMatch[],
  add: readonly MarkupInput[],
  subjects: SubjectMap = new Map(),
): Op[] {
  return [
    ...recolor.flatMap((m): Op[] => {
      if ('pending' in m) return [{ op: 'recolorMarkup', id: m.pending.id, color }]
      const subject = subjects.get(m.saved.objNum)
      return [
        { op: 'deleteSavedAnnot', annot: m.saved },
        {
          op: 'addMarkup',
          markup: {
            pageIndex: m.saved.pageIndex,
            type: m.saved.type,
            color,
            quads: m.saved.quads,
            ...(subject ? { subject } : {}),
          },
        },
      ]
    }),
    ...add.map((markup): Op => ({ op: 'addMarkup', markup })),
  ]
}

/**
 * Word-style toggle of one markup type over the selection: removed when every page
 * already carries it, else added to the pages that do not.
 */
export function toggleMarkupOps(
  world: MarkupWorld,
  selection: SelectionQuads,
  type: MarkupType,
  color: Rgb,
): { readonly ops: Op[]; readonly result: 'added' | 'removed' } {
  const matches = [...selection].map(
    ([pageIndex, quads]) =>
      [pageIndex, quads, markupMatching(world, pageIndex, type, quads)] as const,
  )
  if (matches.length > 0 && matches.every(([, , m]) => m !== null)) {
    return { ops: matches.flatMap(([, , m]) => removeOps(m)), result: 'removed' }
  }
  return {
    ops: matches.flatMap(([pageIndex, quads, m]): Op[] =>
      m ? [] : [{ op: 'addMarkup', markup: { pageIndex, type, color: [...color], quads } }],
    ),
    result: 'added',
  }
}

/** What a highlighter pen does to the selection (PC planHighlightPen). */
export type PenAction =
  | { readonly kind: 'remove'; readonly ops: Op[] }
  | {
      readonly kind: 'paint'
      readonly recolor: MarkupMatch[]
      readonly add: MarkupInput[]
    }

export function highlightPenAction(
  world: MarkupWorld,
  selection: SelectionQuads,
  pen: Rgb,
): PenAction {
  const pages = [...selection].map(([pageIndex, quads]) => {
    const m = markupMatching(world, pageIndex, 'highlight', quads)
    return { page: { pageIndex, quads, m }, existing: m ? markupColorOf(m) : null }
  })
  const plan = planHighlightPen(pages, pen)
  if (plan.kind === 'remove') {
    return { kind: 'remove', ops: plan.pages.flatMap(({ m }) => removeOps(m)) }
  }
  return {
    kind: 'paint',
    recolor: plan.recolor.flatMap(({ m }) => (m ? [m] : [])),
    add: plan.add.map(({ pageIndex, quads }) => ({
      pageIndex,
      type: 'highlight' as const,
      color: [...pen] as Rgb,
      quads,
    })),
  }
}

/** The markups of `type` on the selection that are not already `color` (the color row). */
export function recolorTargets(
  world: MarkupWorld,
  selection: SelectionQuads,
  type: MarkupType,
  color: Rgb,
): MarkupMatch[] {
  return [...selection].flatMap(([pageIndex, quads]) => {
    const m = markupMatching(world, pageIndex, type, quads)
    return m && !sameColor(markupColorOf(m), color) ? [m] : []
  })
}

/** Types the whole selection carries, and the one color each carries, if uniform. */
export function selectionMarkupState(
  world: MarkupWorld,
  selection: SelectionQuads,
): { readonly active: Set<MarkupType>; readonly colors: Map<MarkupType, Rgb> } {
  const active = new Set<MarkupType>()
  const colors = new Map<MarkupType, Rgb>()
  for (const type of MARKUP_TYPES) {
    const found = [...selection].map(([pageIndex, quads]) =>
      markupMatching(world, pageIndex, type, quads),
    )
    const first = found[0]
    if (!first || found.some((m) => !m)) continue
    active.add(type)
    const color = markupColorOf(first)
    if (found.every((m) => m && sameColor(markupColorOf(m), color))) colors.set(type, color)
  }
  return { active, colors }
}

/** Delete one markup (the markup sheet). */
export const deleteMarkupOps = (m: MarkupMatch): Op[] => removeOps(m)

/** Recolor one markup (the markup sheet; PC context menu: add new + delete old for saved). */
export const recolorMarkupOps = (m: MarkupMatch, color: Rgb, subjects?: SubjectMap): Op[] =>
  paintOps(color, [m], [], subjects)

const inQuad = (q: readonly number[], x: number, y: number, slack: number): boolean => {
  const [x1, y1, x2, y2] = quadToRect([...q])
  return x >= x1 - slack && x <= x2 + slack && y >= y1 - slack && y <= y2 + slack
}

/**
 * The markup under a PDF point: the newest pending one first, then saved ones not
 * pending deletion. `slack` widens each quad (PDF units) for a finger.
 */
export function markupAt(
  world: MarkupWorld,
  pageIndex: number,
  x: number,
  y: number,
  slack = 0,
): MarkupMatch | null {
  const pending = [...world.edits.markups]
    .reverse()
    .find((m) => m.pageIndex === pageIndex && m.quads.some((q) => inQuad(q, x, y, slack)))
  if (pending) return { pending }
  const saved = liveSavedMarkups(world, pageIndex)
    .reverse()
    .find((a) => a.quads.some((q) => inQuad(q, x, y, slack)))
  return saved ? { saved } : null
}

/** The line markup types (they remember one color each). */
export const isLineMarkup = (type: MarkupType): type is LineMarkupType => type !== 'highlight'
