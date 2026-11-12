/**
 * Type shim: @genoffice/agent-core/sensitive-detect ships as TS source that
 * does not compile under this package's noUncheckedIndexedAccess. tsconfig
 * paths point type resolution here; runtime bundling (electron-vite, vitest)
 * still uses the real source. Keep the signatures in sync with
 * packages/agent-core/src/sensitive-detect.ts.
 */
import type { SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'

export interface TextPiece<L> {
  text: string
  location: L
  /** the header of the column this cell sits in, when the table has its headers on the row above */
  header?: string
}

export interface SensitiveCandidate<L> {
  kind: SensitiveKind
  /** offset into the piece's text where the value starts */
  start: number
  /** offset just past the value */
  end: number
  value: string
  location: L
}

/** The kind a piece announces when it is nothing but a label word ("name", "phone:"), else null. */
export function labelWordKind(text: string): SensitiveKind | null

/** True when a sheet column header says the column holds people's names. */
export function isNameColumnHeader(header: string): boolean

export function detectSensitive<L>(pieces: Iterable<TextPiece<L>>): SensitiveCandidate<L>[]
