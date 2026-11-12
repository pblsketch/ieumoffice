/**
 * The spreadsheet hiding mark: a workbook-scoped defined name
 * `IeumHide[<n>]_<label>` whose reference is the hidden range.
 *
 * ## A file contract
 *
 * The name is saved in the workbook and shown in Excel's Name Box, so its
 * shape never changes: recognised by `^IeumHide(\d*)_(.+)$` without case, as
 * Excel compares names. `<n>` is the duplicate number, present only from 2
 * on, and it comes before the label so that digits or periods inside the
 * label are never mistaken for it.
 *
 * The label is cleaned with the shared rule (`sanitizeLabel`) and then
 * written in the characters a name may hold: letters of any script (with
 * their combining marks, which Thai and Hindi words need), decimal digits,
 * underscores and periods stay, everything else (spaces and `-` included)
 * becomes `_`, one for one. It is read back as it stands; underscores are not
 * turned back into spaces. The label never carries a per-value number: those
 * are added when the model reads the range (`hiding-values.ts`).
 *
 * Renderer-safe, exported as `@genoffice/agent-core/hiding-name`.
 */

import { SENSITIVE_INFO_WORD, hidingLangOf } from './hiding-langs'
import { sanitizeLabel } from './redact-core'

export const HIDING_NAME_PATTERN = /^IeumHide(\d*)_(.+)$/i

const HEAD = 'IeumHide'
const NOT_NAME_CHAR = /[^\p{L}\p{M}\p{Nd}_.]/gu
const READ_DEFAULT_LABEL = 'private'

/** The label as a name stores it, from what the reader typed. */
export function hidingNameLabel(label: string, lang: string): string {
  const cleaned = sanitizeLabel(label) || SENSITIVE_INFO_WORD[hidingLangOf(lang)]
  return cleaned.replace(NOT_NAME_CHAR, '_')
}

/** The defined name for a label; `n` is the duplicate number (1 means none). */
export function buildHidingName(label: string, lang: string, n = 1): string {
  const number = Number.isInteger(n) && n >= 2 ? String(n) : ''
  return `${HEAD}${number}_${hidingNameLabel(label, lang)}`
}

export interface HidingName {
  /** the duplicate number; 1 when the name has none */
  n: number
  /** the label exactly as the name has it, cleaned with the shared rule */
  label: string
}

/** The mark a defined name stands for, or null when it is not a hiding mark. */
export function parseHidingName(name: string): HidingName | null {
  const m = HIDING_NAME_PATTERN.exec(name)
  if (!m) return null
  return {
    n: m[1] ? Number.parseInt(m[1], 10) : 1,
    label: sanitizeLabel(m[2]) || READ_DEFAULT_LABEL,
  }
}

/** True when a defined name is a hiding mark. */
export function isHidingName(name: string): boolean {
  return HIDING_NAME_PATTERN.test(name)
}

/**
 * The name a new mark for `label` takes in a workbook that already has
 * `existingNames`: the label alone when free, otherwise the lowest free
 * duplicate number from 2. Names and labels are compared without case.
 */
export function nextHidingName(
  label: string,
  lang: string,
  existingNames: Iterable<string>,
): string {
  const wanted = hidingNameLabel(label, lang).toLowerCase()
  const taken = new Set<string>()
  const used = new Set<number>()
  for (const name of existingNames) {
    taken.add(name.toLowerCase())
    const m = HIDING_NAME_PATTERN.exec(name)
    if (m && m[2].toLowerCase() === wanted) used.add(m[1] ? Number.parseInt(m[1], 10) : 1)
  }
  for (let n = 1; ; n++) {
    if (used.has(n)) continue
    const name = buildHidingName(label, lang, n)
    if (!taken.has(name.toLowerCase())) return name
  }
}
