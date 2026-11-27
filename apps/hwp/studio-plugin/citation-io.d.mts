import type { BibEntry, BibEntryInput, BibEntrySource } from './citation-styles.mjs'

export type BibliographyFormat = 'bibtex' | 'ris' | 'csl-json'
export type ImportFailureReason = 'too_large' | 'empty' | 'invalid_format'
export type DuplicateMatchReason = 'doi' | 'title_year'

export declare const MAX_IMPORT_BYTES: number
export declare const MAX_IMPORT_ENTRIES: number
export declare const BIBLIOGRAPHY_FORMATS: readonly BibliographyFormat[]

export type ImportInput = string | Uint8Array

export interface ParseImportOptions {
  maxBytes?: number
  maxEntries?: number
  existingKeys?: Iterable<string> | Set<string>
  existingIds?: Iterable<string> | Set<string>
  source?: BibEntrySource
}

export interface ParseBibliographyFileOptions extends ParseImportOptions {
  format?: BibliographyFormat
  filename?: string
}

export interface ExportBibliographyOptions {
  tag?: string
  lineEnding?: '\n' | '\r\n'
}

export interface ParseSuccessResult {
  ok: true
  entries: BibEntry[]
  warnings: string[]
}

export interface ParseFailureResult {
  ok: false
  reason: ImportFailureReason
  error: string
  maxBytes?: number
  actualBytes?: number
  entries: BibEntry[]
  warnings: string[]
}

export type ParseImportResult = ParseSuccessResult | ParseFailureResult

export type ParseBibliographyFileResult =
  | (ParseSuccessResult & { format: BibliographyFormat })
  | (ParseFailureResult & { format: BibliographyFormat | null })

export interface ParsedDocumentReferenceLine {
  lineIndex: number
  rawLine: string
  entry: BibEntry
}

export interface UnparsedDocumentReferenceLine {
  lineIndex: number
  rawLine: string
  reason: string
}

export interface ParseDocumentReferenceLinesSuccess {
  ok: true
  parsed: ParsedDocumentReferenceLine[]
  unparsed: UnparsedDocumentReferenceLine[]
  entries: BibEntry[]
  warnings: string[]
}

export interface ParseDocumentReferenceLinesFailure {
  ok: false
  reason: ImportFailureReason
  error: string
  maxBytes?: number
  actualBytes?: number
  parsed: ParsedDocumentReferenceLine[]
  unparsed: UnparsedDocumentReferenceLine[]
  entries: BibEntry[]
  warnings: string[]
}

export type ParseDocumentReferenceLinesResult =
  ParseDocumentReferenceLinesSuccess | ParseDocumentReferenceLinesFailure

export interface DuplicateMatchOptions {
  matchByDoi?: boolean
  matchByTitleYear?: boolean
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  matchReason: DuplicateMatchReason | null
}

export interface DuplicateMatch {
  candidate: BibEntry | BibEntryInput
  candidateIndex: number
  existingKey: string
  existingId: string
  matchReason: DuplicateMatchReason
  source: 'existing' | 'batch'
}

export interface ImportPreviewPlan {
  toAdd: BibEntry[]
  duplicates: DuplicateMatch[]
  totalCandidates: number
}

export declare function sanitizeImportedField(value: unknown): string
export declare function hasFormulaPrefix(text: unknown): boolean
export declare function parseBibTeX(
  input: ImportInput,
  options?: ParseImportOptions,
): ParseImportResult
export declare function exportBibTeX(
  entries: readonly (BibEntry | BibEntryInput)[],
  options?: ExportBibliographyOptions,
): string
export declare function parseRis(
  input: ImportInput,
  options?: ParseImportOptions,
): ParseImportResult
export declare function exportRis(
  entries: readonly (BibEntry | BibEntryInput)[],
  options?: ExportBibliographyOptions,
): string
export declare function parseCslJson(
  input: ImportInput,
  options?: ParseImportOptions,
): ParseImportResult
export declare function exportCslJson(
  entries: readonly (BibEntry | BibEntryInput)[],
  options?: ExportBibliographyOptions,
): string
export declare function detectBibliographyFormat(
  input: ImportInput,
  filename?: string,
): BibliographyFormat | null
export declare function parseBibliographyFile(
  input: ImportInput,
  options?: ParseBibliographyFileOptions,
): ParseBibliographyFileResult
export declare function exportBibliography(
  entries: readonly (BibEntry | BibEntryInput)[],
  format: BibliographyFormat,
  options?: ExportBibliographyOptions,
): string
export declare function parseDocumentReferenceLines(
  input: ImportInput | readonly string[],
  options?: ParseImportOptions,
): ParseDocumentReferenceLinesResult
export declare function normalizeDoi(doi: string | null | undefined): string
export declare function normalizeTitleForMatch(title: string | null | undefined): string
export declare function isDuplicateEntry(
  candidate: Partial<BibEntry> | BibEntryInput | null | undefined,
  existing: Partial<BibEntry> | BibEntryInput | null | undefined,
  options?: DuplicateMatchOptions,
): DuplicateCheckResult
export declare function planImportPreview(
  candidates: readonly (BibEntry | BibEntryInput)[],
  existingEntries?: readonly BibEntry[],
  options?: DuplicateMatchOptions,
): ImportPreviewPlan
export declare function findDuplicateEntries(
  candidates: readonly (BibEntry | BibEntryInput)[],
  existingEntries?: readonly BibEntry[],
  options?: DuplicateMatchOptions,
): DuplicateMatch[]
