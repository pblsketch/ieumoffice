/**
 * Suggested labels for found candidates: `<kind name>-<NN>`.
 *
 * Within one document the same value gets the same number (values compared
 * as `normalizeSensitiveValue` does, so a phone number written with and
 * without hyphens is one value). That holds across marks the document
 * already has: a value already hidden under a label gets that label again.
 * Numbering continues after the numbers a kind already has in the document,
 * whether or not the value behind them is known. The label never carries the
 * value.
 *
 * A spreadsheet suggests the kind name alone for its stored label; the
 * per-value number is added when the model reads it (`hiding-values.ts`).
 *
 * Renderer-safe, exported as `@genoffice/agent-core/sensitive-labels`.
 */

import { HIDING_LANGS } from './hiding-langs'
import { serialText } from './hiding-values'
import {
  SENSITIVE_KINDS,
  SENSITIVE_KIND_NAMES,
  normalizeSensitiveValue,
  sensitiveKindName,
  type SensitiveKind,
} from './sensitive-kinds'

/** A hiding mark the document already has, with the value it hides. */
export interface ExistingMark {
  label: string
  value: string
  /** the kind, when known; otherwise read from a `<kind name>-<NN>` label in any language */
  kind?: SensitiveKind
}

export interface CandidateLabelerOptions {
  /** the screen language the kind names are written in */
  lang: string
  /** labels the document already has whose values are not known, so numbering continues after them */
  existingLabels?: Iterable<string>
  /** marks the document already has with their values, so the same value gets the same label */
  existingMarks?: Iterable<ExistingMark>
}

export interface CandidateLabeler {
  labelFor(kind: SensitiveKind, value: string): string
}

const NUMBERED = /^(.*)-(\d+)$/

/** Every kind whose name, in any language, is this text (compared without case). */
const KINDS_BY_NAME: ReadonlyMap<string, readonly SensitiveKind[]> = (() => {
  const map = new Map<string, SensitiveKind[]>()
  for (const lang of HIDING_LANGS) {
    for (const kind of SENSITIVE_KINDS) {
      const key = SENSITIVE_KIND_NAMES[lang][kind].toLowerCase()
      const kinds = map.get(key) ?? []
      if (!kinds.includes(kind)) kinds.push(kind)
      map.set(key, kinds)
    }
  }
  return map
})()

function valueKey(kind: SensitiveKind, value: string): string {
  return `${kind}\u0000${normalizeSensitiveValue(kind, value)}`
}

/** One labeler per document. */
export function createCandidateLabeler(options: CandidateLabelerOptions): CandidateLabeler {
  const highest = new Map<string, number>()
  const noteNumber = (label: string): RegExpExecArray | null => {
    const m = NUMBERED.exec(label.trim())
    if (!m) return null
    const key = m[1].trim().toLowerCase()
    highest.set(key, Math.max(highest.get(key) ?? 0, Number.parseInt(m[2], 10)))
    return m
  }
  for (const label of options.existingLabels ?? []) noteNumber(label)

  const given = new Map<string, string>()
  for (const mark of options.existingMarks ?? []) {
    const label = mark.label.trim()
    const m = noteNumber(label)
    const kinds = mark.kind
      ? [mark.kind]
      : m
        ? (KINDS_BY_NAME.get(m[1].trim().toLowerCase()) ?? [])
        : []
    for (const kind of kinds) {
      const key = valueKey(kind, mark.value)
      if (!given.has(key)) given.set(key, label)
    }
  }

  return {
    labelFor(kind, value) {
      const key = valueKey(kind, value)
      const known = given.get(key)
      if (known) return known
      const name = sensitiveKindName(kind, options.lang)
      const nameKey = name.toLowerCase()
      const n = (highest.get(nameKey) ?? 0) + 1
      highest.set(nameKey, n)
      const label = `${name}-${serialText(n)}`
      given.set(key, label)
      return label
    },
  }
}
