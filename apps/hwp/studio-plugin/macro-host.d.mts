/**
 * Type definitions for the synchronous HWP/HWPX macro host and document API.
 */

import type { HwpDocument } from '@rhwp/core'
import type { MacroErrorCode, MacroLimits, MacroLimitsInput } from './macro-interpreter.d.mts'
import type { BibEntry } from './citation-styles.d.mts'
import type { OutlineStyleMap } from './outline.d.mts'
import type { TocKind } from './toc.d.mts'

export declare const MAX_MACRO_MESSAGES: number
export declare const MAX_MACRO_MESSAGE_LENGTH: number
export declare const MAX_MACRO_TOTAL_MESSAGE_CHARS: number
export declare const MAX_TABLE_ROWS: number
export declare const MAX_TABLE_COLS: number

export interface MacroHostLimits extends MacroLimits {
  readonly maxInsertCharsPerCall: number
  readonly maxTotalInsertChars: number
  readonly maxRegexLength: number
}

export type MacroHostLimitsInput = MacroLimitsInput &
  Partial<{
    maxInsertCharsPerCall: number
    maxTotalInsertChars: number
    maxRegexLength: number
  }>

export declare const DEFAULT_MACRO_HOST_LIMITS: Readonly<{
  readonly maxInsertCharsPerCall: number
  readonly maxTotalInsertChars: number
  readonly maxRegexLength: number
}>

export declare function assertSafeMacroRegex(pattern: string, maxRegexLength?: number): void

export interface MacroCaret {
  sec: number
  para: number
  offset: number
}

export interface MacroSelectionRange {
  startSec: number
  startPara: number
  startOffset: number
  endSec: number
  endPara: number
  endOffset: number
}

export interface MacroSelectionInfo extends MacroSelectionRange {
  text: string
}

export interface MacroCharFormatProps {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number
  size?: number
  fontName?: string
  font?: string
  color?: string
  textColor?: string
}

export interface MacroParaFormatProps {
  align?: 'left' | 'center' | 'right' | 'justify'
  alignment?: 'left' | 'center' | 'right' | 'justify'
  lineSpacing?: number
  leftMargin?: number
  marginLeft?: number
  rightMargin?: number
  marginRight?: number
  firstLineIndent?: number
  indent?: number
  spaceBefore?: number
  spacingBefore?: number
  spaceAfter?: number
  spacingAfter?: number
  pageBreakBefore?: boolean
}

export interface MacroFindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  style?: string | null
}

export interface MacroFindMatchItem {
  kind: 'body' | 'table' | 'textbox' | 'footnote' | 'endnote'
  sec: number
  para: number
  offset: number
  length: number
  matchText: string
  page: number
}

export interface MacroReplaceAllSummary {
  replaced: number
  skippedObjects: number
  skippedCitations: number
}

export interface MacroReplaceNextSummary {
  replaced: number
  found: boolean
  sec?: number
  para?: number
  offset?: number
}

export interface MacroInsertTableSummary {
  ok: true
  rows: number
  cols: number
  paraIdx: number
  controlIdx: number
}

export interface MacroStyleInfo {
  id: number
  name: string
}

export interface MacroHostOptions {
  caret?: MacroCaret
  selection?: MacroSelectionRange | null
  limits?: MacroHostLimitsInput
  now?: () => number
  appStyleMap?: OutlineStyleMap | null
  bibEntries?: readonly BibEntry[]
  onRecoveryReport?: (report: Promise<unknown>) => void
}

export interface MacroExecutionState {
  caret: MacroCaret
  selection: MacroSelectionRange | null
  selectionAnchor?: MacroCaret | null
  pendingCharFormat?: Record<string, unknown> | null
  atLineEnd?: boolean
  messages: string[]
  messageChars?: number
  messagesTruncated?: boolean
  totalInsertedChars?: number
  allowedTableDelta: number
  mutated: boolean
  lastError: {
    code: MacroHostErrorCode
    message: string
    unsupportedAction?: string
  } | null
  lastFind: (MacroFindOptions & { query: string; replacement?: string }) | null
  limits: Readonly<MacroHostLimits>
  now?: () => number
  startTime?: number
  recordError(
    code: MacroHostErrorCode,
    message: string,
    extra?: { unsupportedAction?: string },
  ): void
}

export interface MacroDocumentApi {
  insertText(text: string | number | boolean): void
  breakPara(): void
  breakPage(): void
  deleteSelection(): boolean
  deleteBackward(count?: number): boolean
  deleteForward(count?: number): boolean
  moveDocBegin(): void
  moveDocEnd(): void
  moveParaBegin(): void
  moveParaEnd(): void
  moveLineBegin(): void
  moveLineEnd(): void
  moveLeft(count?: number): void
  moveRight(count?: number): void
  moveUp(count?: number): void
  moveDown(count?: number): void
  moveWordLeft(count?: number): void
  moveWordRight(count?: number): void
  selectLeft(count?: number): void
  selectRight(count?: number): void
  selectUp(count?: number): void
  selectDown(count?: number): void
  selectWordLeft(count?: number): void
  selectWordRight(count?: number): void
  selectLineBegin(): void
  selectLineEnd(): void
  selectParaBegin(): void
  selectParaEnd(): void
  selectDocBegin(): void
  selectDocEnd(): void
  select(
    fromSec: number,
    fromPara: number,
    fromOffset: number,
    toSec: number,
    toPara: number,
    toOffset: number,
  ): void
  selectAll(): void
  cancelSelection(): void
  getCaret(): MacroCaret
  getSelection(): MacroSelectionInfo | null
  setCharFormat(props: MacroCharFormatProps): void
  setParaFormat(props: MacroParaFormatProps): void
  applyStyle(nameOrId: string | number): void
  find(query: string, opts?: MacroFindOptions): MacroFindMatchItem[]
  replaceAll(query: string, replacement: string, opts?: MacroFindOptions): MacroReplaceAllSummary
  replaceNext(query: string, replacement: string, opts?: MacroFindOptions): MacroReplaceNextSummary
  insertTable(rows: number, cols: number): MacroInsertTableSummary
  changeOutlineLevel(
    sec: number,
    para: number,
    delta: 1 | -1,
    opts?: { singleOnly?: boolean; appStyleMap?: OutlineStyleMap | null },
  ): { ok: true; changed: unknown[] }
  refreshToc(kind?: TocKind): { ok: true; refreshed: number; kinds: string[] }
  refreshIndex(): { ok: true; entryCount: number; groupCount: number }
  refreshBibliography(): { ok: true; count: number; style: string }
  refreshAll(): { ok: true; refreshed: number }
  getText(): string
  getSectionCount(): number
  getParagraphCount(sec?: number): number
  getParagraphText(sec: number, para: number): string
  listStyles(): MacroStyleInfo[]
  message(text: unknown): void
}

export type MacroHostErrorCode =
  | MacroErrorCode
  | 'unsupported_action'
  | 'unsupported_place'
  | 'object_loss'
  | 'memo_loss'
  | 'invalid_argument'
  | 'engine_error'

export interface MacroHostSuccess {
  ok: true
  value: unknown
  messages: string[]
  caret: MacroCaret
  steps: number
  elapsedMs: number
  changed: boolean
}

export interface MacroHostFailure {
  ok: false
  code: MacroHostErrorCode
  error: string
  line: number | null
  column: number | null
  phase?: 'post_run'
  unsupportedAction?: string
  messages: string[]
  steps: number
  elapsedMs: number
}

export type MacroHostResult = MacroHostSuccess | MacroHostFailure

export interface MacroTransactionContext {
  doc(): HwpDocument
  deferPagination?(): void
  markNoOp?(): void
}

export interface MacroTransactionHost {
  transaction<T>(label: string, fn: (tx: MacroTransactionContext) => T): T
}

export declare function createMacroApi(
  doc: HwpDocument,
  state?: MacroExecutionState,
  options?: MacroHostOptions,
): MacroDocumentApi

export declare function runMacroOnDocument(
  doc: HwpDocument,
  source: string,
  options?: MacroHostOptions,
): MacroHostResult

export declare function executeMacroTransaction(
  hostOrDoc: MacroTransactionHost | HwpDocument,
  source: string,
  options?: MacroHostOptions,
): MacroHostResult
