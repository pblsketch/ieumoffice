import type { HwpDocument } from '@rhwp/core'

export type FindScopeKind = 'body' | 'table' | 'textbox' | 'footnote' | 'endnote'

export interface FindCellStep {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

export interface FindCharFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font?: string
  size?: number
  color?: string
}

export interface FindOptions {
  query?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  style?: string | null
  charFormat?: FindCharFormat | null
}

export interface FindMatch {
  index: number
  kind: FindScopeKind
  sec: number
  para: number
  path?: FindCellStep[]
  noteControl?: number
  notePara?: number
  noteNumber?: number
  anchorOffset?: number
  offset: number
  length: number
  matchText: string
  beforeText: string
  afterText: string
  page: number
  spansObject?: true
  inCitation?: true
}

export type FindResult =
  | { ok: true; total: number; matches: FindMatch[] }
  | { ok: false; reason: 'invalid_regex'; error: string }

export type FindReplaceSelection = 'all' | { indices: number[] }

export interface FindPlace {
  sec: number
  para: number
  path?: FindCellStep[]
  kind?: 'footnote' | 'endnote'
  noteControl?: number
  notePara?: number
  offset: number
  length: number
}

export type FindReplaceResult =
  | {
      ok: true
      replaced: number
      skippedObjects: number
      skippedCitations: number
      firstPlace?: FindPlace
    }
  | { ok: false; reason: 'invalid_regex' | 'bad_replacement'; error: string }

export interface RevealFindResult {
  ok: boolean
  enteredNote?: boolean
}

export declare function findMatches(doc: HwpDocument, options?: FindOptions): FindResult

export declare function replaceFindMatches(
  doc: HwpDocument,
  options: FindOptions,
  replacement: string,
  selection?: FindReplaceSelection,
): FindReplaceResult

export declare function revealFindMatch(services: unknown, match: FindMatch): RevealFindResult
