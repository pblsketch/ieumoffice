import type { BibEntry, CitationStyle } from './citation-styles.d.mts'
import type { MarkDoc, MarkEntry, MarkPlaceInput, MatchedRangeMark } from './doc-marks.d.mts'

export declare const CIT_STYLE_SETTING_KEY: '인용꼴'
export declare const CIT_META_SETTING_KEY: '인용'
export declare const BIB_SETTING_KEY: '참고문헌'
export declare const DEFAULT_BIBLIOGRAPHY_TITLE: string

export type AuditIssueKind =
  | 'missing_from_bibliography'
  | 'uncited_in_bibliography'
  | 'wrong_sort_order'
  | 'missing_disambiguation'
  | 'manual_citation_edit'
  | 'unverified_citation'

export declare const AUDIT_ISSUE_KINDS: readonly AuditIssueKind[]

export interface CitationDoc extends MarkDoc {
  getLogicalLength?(sec: number, para: number): number
  getTextRange(sec: number, para: number, start: number, count: number): string
  insertText(sec: number, para: number, offset: number, text: string): string
  deleteText(sec: number, para: number, offset: number, length: number): string
  replaceText(sec: number, para: number, offset: number, length: number, text: string): string
  splitParagraph(sec: number, para: number, offset: number): string
  deleteParagraph(sec: number, para: number): string
  applyStyle(sec: number, para: number, styleId: number): string
  applyParaFormat(sec: number, para: number, propsJson: string): string
  applyCharFormat(sec: number, para: number, start: number, end: number, propsJson: string): string
  getStyleList?(): string
  getStyleAt?(sec: number, para: number): string
  getControls?(): string
  getCursorModel?(): string
  getPageOfPosition?(sec: number, para: number): string
  getControlTextPositions?(sec: number, para: number): string
  getCellParagraphLengthByPath?(sec: number, para: number, pathJson: string): number
  getCellParagraphLength?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
  ): number
  getTextInCellByPath?(
    sec: number,
    para: number,
    pathJson: string,
    start: number,
    count: number,
  ): string
  getTextInCell?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
    start: number,
    count: number,
  ): string
  deleteTextInCellByPath?(
    sec: number,
    para: number,
    pathJson: string,
    offset: number,
    length: number,
  ): string
  deleteTextInCell?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
    offset: number,
    length: number,
  ): string
  insertTextInCellByPath?(
    sec: number,
    para: number,
    pathJson: string,
    offset: number,
    text: string,
  ): string
  insertTextInCell?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
    offset: number,
    text: string,
  ): string
  getFootnoteInfo?(sec: number, para: number, controlIndex: number): string
  getNoteEditInfo?(sec: number, para: number, controlIndex: number): string
  deleteTextInFootnote?(
    sec: number,
    para: number,
    controlIndex: number,
    notePara: number,
    offset: number,
    length: number,
  ): string
  insertTextInFootnote?(
    sec: number,
    para: number,
    controlIndex: number,
    notePara: number,
    offset: number,
    text: string,
  ): string
}

export interface CellPathStep {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

export interface CitationPlaceInput extends MarkPlaceInput {
  kind?: 'body' | 'table' | 'textbox' | 'footnote' | 'endnote' | 'header' | 'footer'
  controlIndex?: number
  noteControl?: number
  notePara?: number
  noteParaIndex?: number
  path?: readonly CellPathStep[]
  cellPath?: readonly CellPathStep[]
}

export interface CitationItemInput {
  key: string
  locator?: string
  prefix?: string
  suffix?: string
}

export interface CitationMarkItem {
  key: string
  locator?: string
  prefix?: string
  suffix?: string
  resolvedKey?: string | null
  verified?: boolean | null
}

export interface CitationMarkRecord {
  id: string
  sec: number
  para: number
  startOffset: number
  endOffset: number
  offset: number
  length: number
  text: string
  writtenText: string | null
  mode: 'parenthetical' | 'narrative'
  items: CitationMarkItem[]
  keys: string[]
  isManuallyEdited: boolean
  start: MarkEntry
  end: MarkEntry
}

export type SetCitationStyleResult =
  | { ok: true; style: CitationStyle }
  | {
      ok: false
      reason:
        | 'invalid_style'
        | 'invalid_key'
        | 'invalid_value'
        | 'unsupported_place'
        | 'invalid_name'
        | 'name_too_long'
        | 'setting_write_failed'
        | 'engine_error'
      error?: string
      failed?: unknown[]
    }

export interface InsertCitationOptions {
  entries: readonly BibEntry[]
  items?: readonly (CitationItemInput | string)[]
  key?: string
  mode?: 'parenthetical' | 'narrative'
  style?: CitationStyle
  place?: CitationPlaceInput
}

export type InsertCitationResult =
  | {
      ok: true
      marked: true
      placeKind: 'body'
      text: string
      sec: number
      para: number
      startOffset: number
      endOffset: number
      offset: number
      length: number
      id: string
      keys: string[]
      renumbered?: number
      skippedManual?: SkippedManualCitation[]
    }
  | {
      ok: true
      marked: false
      placeKind: 'table' | 'textbox' | 'footnote' | 'endnote'
      text: string
      sec: number
      para: number
      path?: CellPathStep[]
      noteControl?: number
      notePara?: number
      offset: number
      length: number
      keys: string[]
      renumbered?: number
      skippedManual?: SkippedManualCitation[]
    }
  | {
      ok: false
      reason:
        | 'invalid_style'
        | 'empty_items'
        | 'missing_entry'
        | 'unverified_entry'
        | 'unsupported_place'
        | 'inside_citation'
        | 'inside_bibliography'
        | 'not_found'
        | 'invalid_range'
        | 'name_too_long'
        | 'duplicate_name'
        | 'invalid_name'
        | 'mark_delete_failed'
        | 'setting_write_failed'
        | 'engine_error'
      missingKeys?: string[]
      unverifiedKeys?: string[]
      error?: string
      failed?: unknown[]
    }

export interface ParsedPatternRef {
  authorHint?: string
  year?: string
  number?: number
  matchedKey?: string
}

export interface PatternCitationMatch {
  kind: 'body' | 'table' | 'textbox' | 'footnote' | 'endnote'
  sec: number
  para: number
  path?: CellPathStep[]
  noteControl?: number
  notePara?: number
  offset: number
  length: number
  text: string
  page: number
  patternKind: 'parenthetical' | 'narrative' | 'ieee'
  parsedRefs: ParsedPatternRef[]
}

export type RewriteCitationKeysResult =
  | { ok: true; updated: number }
  | {
      ok: false
      reason:
        | 'invalid_key'
        | 'invalid_value'
        | 'unsupported_place'
        | 'invalid_name'
        | 'name_too_long'
        | 'setting_write_failed'
        | 'engine_error'
      error?: string
      failed?: unknown[]
    }

export type RenumberIeeeResult =
  | { ok: true; updated: number; skippedManual?: SkippedManualCitation[] }
  | {
      ok: false
      reason:
        | 'unsupported_place'
        | 'mark_delete_failed'
        | 'setting_write_failed'
        | 'invalid_range'
        | 'name_too_long'
        | 'duplicate_name'
        | 'invalid_name'
        | 'engine_error'
      error?: string
      failed?: unknown[]
    }

export interface SkippedManualCitation {
  id: string
  kind?: 'body' | 'table' | 'textbox' | 'footnote' | 'endnote'
  sec: number
  para: number
  path?: CellPathStep[]
  noteControl?: number
  notePara?: number
  offset: number
  length: number
  currentText: string
  expectedText: string | null
}

export interface SwitchCitationStyleOptions {
  refreshBibliography?: boolean
  allowOverwriteManual?: boolean
}

export type SwitchCitationStyleResult =
  | {
      ok: true
      style: CitationStyle
      updatedCitations: number
      skippedManual: SkippedManualCitation[]
      missingKeys: string[]
      unverifiedKeys: string[]
      bibliographyRefreshed: boolean
      bibliographyResult: BibliographyWriteResult | null
    }
  | {
      ok: false
      reason:
        | 'invalid_style'
        | 'unsupported_place'
        | 'mark_delete_failed'
        | 'setting_write_failed'
        | 'invalid_key'
        | 'invalid_value'
        | 'invalid_name'
        | 'name_too_long'
        | 'invalid_range'
        | 'duplicate_name'
        | 'engine_error'
      error?: string
      failed?: unknown[]
    }

export interface UnmarkedBibliographyLine {
  sec: number
  para: number
  text: string
}

export type DetectUnmarkedBibliographyResult =
  | { found: false }
  | {
      found: true
      headingPara: { sec: number; para: number; text: string }
      range: { sec: number; startPara: number; endPara: number }
      lines: UnmarkedBibliographyLine[]
    }

export interface BibliographyModifiedLine {
  index: number
  expected: string
  actual: string
  sec: number
  para: number
}

export interface BibliographyManualEditsResult {
  hasManualEdits: boolean
  modifiedLines: BibliographyModifiedLine[]
  range: MatchedRangeMark | null
}

export interface BibliographyOptions {
  title?: string | null
  style?: CitationStyle
  place?: CitationPlaceInput
  replaceExisting?: boolean
  replaceLegacy?: boolean
  skipLegacyCheck?: boolean
  allowOverwriteManual?: boolean
  includeAllLibrary?: boolean
}

export type BibliographyWriteResult =
  | {
      ok: true
      count: number
      style: CitationStyle
      title: string | null
      sec: number
      startPara: number
      endPara: number
      keys: string[]
      expectedLines: string[]
      preservedMissingKeys: string[]
      refreshed?: boolean
      updatedCitations?: number
      skippedManual?: SkippedManualCitation[]
      range: {
        startName: string
        endName: string
        start: { sec: number; para: number; offset: number }
        end: { sec: number; para: number; offset: number }
      }
    }
  | {
      ok: false
      reason:
        | 'invalid_style'
        | 'unsupported_place'
        | 'not_found'
        | 'no_entries'
        | 'unverified_entry'
        | 'multi_section_range'
        | 'legacy_bibliography_found'
        | 'manual_edits'
        | 'has_objects'
        | 'mark_delete_failed'
        | 'setting_write_failed'
        | 'invalid_key'
        | 'invalid_value'
        | 'invalid_name'
        | 'name_too_long'
        | 'engine_error'
      unverifiedKeys?: string[]
      missingKeys?: string[]
      legacy?: Extract<DetectUnmarkedBibliographyResult, { found: true }>
      modifiedLines?: BibliographyModifiedLine[]
      range?: MatchedRangeMark | { sec: number; startPara: number; endPara: number }
      error?: string
      failed?: unknown[]
    }

export type AuditIssueReason =
  'missing_title' | 'ieee_number_mismatch' | 'unmarked_style_mismatch' | 'unmarked_manual_edit'

export interface AuditIssue {
  type: AuditIssueKind
  reason?: AuditIssueReason
  missingTitle?: boolean
  kind: 'body' | 'table' | 'textbox' | 'footnote' | 'endnote'
  sec: number
  para: number
  path?: CellPathStep[]
  noteControl?: number
  notePara?: number
  offset: number
  length: number
  text: string
  key?: string
  keys?: string[]
  id?: string
  inLibrary?: boolean
  hasBibliography?: boolean
  actualIndex?: number
  expectedIndex?: number
  expectedSuffix?: string
  expectedToken?: string
  expectedText?: string | null
}

export interface AuditCitationsOptions {
  style?: CitationStyle
}

export interface AuditCitationsResult {
  ok: true
  style: CitationStyle
  issues: AuditIssue[]
  counts: Record<AuditIssueKind, number>
}

export interface CheckBibliographyStalenessOptions {
  bibEntries?: readonly BibEntry[]
  entries?: readonly BibEntry[]
}

export interface CheckBibliographyStalenessResult {
  stale: boolean
  reason?: 'entries_changed' | 'style_changed' | 'ieee_order_changed'
  hasBibliography: boolean
  ieeeOutOfOrder: boolean
}

export declare function getDocumentCitationStyle(doc: CitationDoc): CitationStyle
export declare function setDocumentCitationStyle(
  doc: CitationDoc,
  style: CitationStyle,
): SetCitationStyleResult
export declare function listCitationMarks(
  doc: CitationDoc,
  entries?: readonly BibEntry[] | null,
): CitationMarkRecord[]
export declare function insertCitation(
  doc: CitationDoc,
  options: InsertCitationOptions,
): InsertCitationResult
export declare function renumberIeeeCitations(
  doc: CitationDoc,
  entries?: readonly BibEntry[] | null,
): RenumberIeeeResult
export declare function findPatternCitations(
  doc: CitationDoc,
  entries?: readonly BibEntry[] | null,
): PatternCitationMatch[]
export declare function rewriteCitationKeys(
  doc: CitationDoc,
  keyMap: Map<string, string> | Record<string, string>,
  entries?: readonly BibEntry[] | null,
): RewriteCitationKeysResult
export declare function switchCitationStyle(
  doc: CitationDoc,
  newStyle: CitationStyle,
  entries: readonly BibEntry[],
  options?: SwitchCitationStyleOptions,
): SwitchCitationStyleResult
export declare function detectUnmarkedBibliography(
  doc: CitationDoc,
): DetectUnmarkedBibliographyResult
export declare function detectBibliographyManualEdits(
  doc: CitationDoc,
): BibliographyManualEditsResult
export declare function insertBibliographyBlock(
  doc: CitationDoc,
  entries: readonly BibEntry[],
  options?: BibliographyOptions,
): BibliographyWriteResult
export declare function refreshBibliographyBlock(
  doc: CitationDoc,
  entries: readonly BibEntry[],
  options?: BibliographyOptions,
): BibliographyWriteResult
export declare function auditCitations(
  doc: CitationDoc,
  entries?: readonly BibEntry[],
  options?: AuditCitationsOptions,
): AuditCitationsResult
export declare function checkBibliographyStaleness(
  doc: CitationDoc,
  options?: CheckBibliographyStalenessOptions,
): CheckBibliographyStalenessResult
