import type { SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'

/**
 * The rows of the candidate list, as an editor hands them to
 * `<SensitiveCandidateList>`. The list knows no format: `id` is the editor's
 * own handle for the spot, `location` is already the text to show, and the
 * editor decides whether a spot can be hidden. Hiding and remembering an
 * exclusion are the editor's work; the list only reports what was pressed.
 */

/** Why a spot cannot be hidden, in words the list knows in every language */
export type SensitiveUnhideableReason =
  | 'memo-overlap'
  | 'header-footer'
  | 'note'
  | 'memo-text'
  | 'distribution'
  | 'sheet-name'
  | 'chart-title'
  | 'cell-note'
  | 'unsupported'

export interface SensitiveCandidateRow {
  /** the editor's handle for this spot; given back on confirm, exclude and locate */
  readonly id: string
  readonly kind: SensitiveKind
  /** the text that was found */
  readonly value: string
  /** a few characters before and after it, shown around the value */
  readonly before?: string | undefined
  readonly after?: string | undefined
  /** where it is, as the editor names it ("Page 2", "Sheet1!B4") */
  readonly location: string
  /** the label the model will see instead (`이름-01`); shown as `{{이름-01}}` */
  readonly label: string
  /** false: shown and counted, but its confirm button is off */
  readonly hideable: boolean
  readonly reason?: SensitiveUnhideableReason | undefined
  /** the editor's own reason text, used when no known reason fits */
  readonly reasonText?: string | undefined
}

export interface SensitiveCandidateSummary {
  /** every row, the spots that cannot be hidden included: what the first-send alert counts */
  readonly total: number
  readonly hideable: number
  readonly unhideable: number
}

export function sensitiveCandidateSummary(
  rows: readonly SensitiveCandidateRow[],
): SensitiveCandidateSummary {
  const hideable = rows.filter((r) => r.hideable).length
  return { total: rows.length, hideable, unhideable: rows.length - hideable }
}

/** The ids "hide all" confirms: only rows that can be hidden */
export function hideableCandidateIds(rows: readonly SensitiveCandidateRow[]): string[] {
  return rows.filter((r) => r.hideable).map((r) => r.id)
}

/** How many characters of text the list shows on each side of a value */
export const SENSITIVE_CONTEXT_CHARS = 12

/**
 * The text around a found value, cut to a few characters on each side, with
 * an ellipsis where it was cut and line breaks shown as spaces.
 * `start`/`end` are the value's offsets in `text` (the finder's output).
 */
export function sensitiveContextOf(
  text: string,
  start: number,
  end: number,
  size: number = SENSITIVE_CONTEXT_CHARS,
): { before: string; after: string } {
  const flat = (s: string) => s.replace(/\s+/g, ' ')
  const from = Math.max(0, start - size)
  const to = Math.min(text.length, end + size)
  const before = (from > 0 ? '…' : '') + flat(text.slice(from, Math.max(from, start)))
  const after = flat(text.slice(Math.min(end, to), to)) + (to < text.length ? '…' : '')
  return { before, after }
}
