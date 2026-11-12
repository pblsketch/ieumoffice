/**
 * Suggested labels for found candidates: `<kind name>-<NN>`.
 *
 * Within one document the same value gets the same number (values compared
 * as `normalizeSensitiveValue` does, so a phone number written with and
 * without hyphens is one value), and numbering continues after the numbers a
 * kind already has in the document. The label never carries the value.
 *
 * A spreadsheet suggests the kind name alone for its stored label; the
 * per-value number is added when the model reads it (`hiding-values.ts`).
 *
 * Renderer-safe, exported as `@genoffice/agent-core/sensitive-labels`.
 */

import { serialText } from './hiding-values'
import { normalizeSensitiveValue, sensitiveKindName, type SensitiveKind } from './sensitive-kinds'

export interface CandidateLabelerOptions {
  /** the screen language the kind names are written in */
  lang: string
  /** labels the document already has, so numbering continues after them */
  existingLabels?: Iterable<string>
}

export interface CandidateLabeler {
  labelFor(kind: SensitiveKind, value: string): string
}

const NUMBERED = /^(.*)-(\d+)$/

/** One labeler per document. */
export function createCandidateLabeler(options: CandidateLabelerOptions): CandidateLabeler {
  const highest = new Map<string, number>()
  for (const label of options.existingLabels ?? []) {
    const m = NUMBERED.exec(label.trim())
    if (!m) continue
    const key = m[1].trim().toLowerCase()
    highest.set(key, Math.max(highest.get(key) ?? 0, Number.parseInt(m[2], 10)))
  }
  const given = new Map<string, string>()
  return {
    labelFor(kind, value) {
      const valueKey = `${kind}\u0000${normalizeSensitiveValue(kind, value)}`
      const known = given.get(valueKey)
      if (known) return known
      const name = sensitiveKindName(kind, options.lang)
      const key = name.toLowerCase()
      const n = (highest.get(key) ?? 0) + 1
      highest.set(key, n)
      const label = `${name}-${serialText(n)}`
      given.set(valueKey, label)
      return label
    },
  }
}
