/**
 * Type shim: @genoffice/agent-core/hiding-values ships as TS source that does
 * not compile under this package's noUncheckedIndexedAccess. tsconfig paths
 * point type resolution here; runtime bundling (electron-vite, vitest) still
 * uses the real source. Keep the signatures in sync with
 * packages/agent-core/src/hiding-values.ts.
 */
export type HiddenCellValue = string | number | boolean | Date | null | undefined

/** A number as the marker writes it: two digits at least, more when it needs them. */
export function serialText(n: number): string

export interface ValueNumbering {
  /** the number this label gives this value, assigning the next one when it is new */
  numberOf(label: string, value: HiddenCellValue): number
  /** what the model reads in place of the cell: `{{<label>-<NN>}}` */
  placeholder(label: string, value: HiddenCellValue): string
}

/** One numbering per open document. */
export function createValueNumbering(): ValueNumbering

/** The marker of a cell that leans on hidden cells: their labels, no number. */
export function dependentPlaceholder(labels: Iterable<string>): string
