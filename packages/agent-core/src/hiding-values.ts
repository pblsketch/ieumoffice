/**
 * What the model sees in a hidden spreadsheet cell.
 *
 * A hidden column carries one label, so with the label alone the model would
 * see the same marker on every row and could not tell rows apart. Each value
 * gets a number of its own instead, `{{<label>-<NN>}}`: the same value always
 * the same number, a new value the next one, an empty cell counted as one
 * value. The numbers last as long as one numbering object (one per open
 * document) and are never written to the file. That equal values share a
 * number is visible to the model; the reader accepted that.
 *
 * A cell whose formula leans on hidden cells shows the labels it leans on,
 * with no number: `{{<label>+<label>}}`, labels in code point order.
 *
 * Renderer-safe, exported as `@genoffice/agent-core/hiding-values`.
 */

import { sanitizeLabel } from './redact-core'

const READ_DEFAULT_LABEL = 'private'

export type HiddenCellValue = string | number | boolean | Date | null | undefined

/** A number as the marker writes it: two digits at least, more when it needs them. */
export function serialText(n: number): string {
  return String(n).padStart(2, '0')
}

function labelOf(label: string): string {
  return sanitizeLabel(label) || READ_DEFAULT_LABEL
}

/** Values that look alike to the reader but differ in type stay apart; empties are one value. */
function valueKey(value: HiddenCellValue): string {
  if (value === null || value === undefined || value === '') return 'empty'
  if (value instanceof Date) return `d:${value.getTime()}`
  return `${typeof value}:${String(value)}`
}

export interface ValueNumbering {
  /** the number this label gives this value, assigning the next one when it is new */
  numberOf(label: string, value: HiddenCellValue): number
  /** what the model reads in place of the cell: `{{<label>-<NN>}}` */
  placeholder(label: string, value: HiddenCellValue): string
}

/** One numbering per open document. */
export function createValueNumbering(): ValueNumbering {
  const byLabel = new Map<string, Map<string, number>>()
  const numberOf = (label: string, value: HiddenCellValue): number => {
    const key = labelOf(label)
    let values = byLabel.get(key)
    if (!values) {
      values = new Map()
      byLabel.set(key, values)
    }
    const vk = valueKey(value)
    let n = values.get(vk)
    if (n === undefined) {
      n = values.size + 1
      values.set(vk, n)
    }
    return n
  }
  return {
    numberOf,
    placeholder: (label, value) => `{{${labelOf(label)}-${serialText(numberOf(label, value))}}}`,
  }
}

function compareCodePoints(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0)
    if (d !== 0) return d
  }
  return x.length - y.length
}

/** The marker of a cell that leans on hidden cells: their labels, no number. */
export function dependentPlaceholder(labels: Iterable<string>): string {
  const unique = [...new Set([...labels].map(labelOf))].sort(compareCodePoints)
  return `{{${unique.length > 0 ? unique.join('+') : READ_DEFAULT_LABEL}}}`
}
