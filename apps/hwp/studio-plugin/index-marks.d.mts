import type {
  MarkDoc,
  MarkPlaceInput,
  MatchedRangeMark,
  RemovedBrokenMark,
  RenamedMark,
  ResolvedBodyPlace,
} from './doc-marks.d.mts'

export declare const INDEX_BLOCK_ID: '기본'
export declare const INDEX_BLOCK_SETTING_KEY: '색인블록'
export declare const DEFAULT_INDEX_TITLE: '찾아보기'
export declare const DEFAULT_INDEX_COLUMNS: 2
export declare const DEFAULT_INDEX_LAYOUT: 'dotted-tab'

export type IndexLayout = 'dotted-tab' | 'table'
export type IndexColumnCount = 1 | 2 | 3

export interface IndexDoc extends MarkDoc {
  getParagraphLength(sec: number, para: number): number
  getTextRange(sec: number, para: number, charOffset: number, count: number): string
  insertText(sec: number, para: number, charOffset: number, text: string): string
  deleteText(sec: number, para: number, charOffset: number, count: number): string
  replaceText(
    sec: number,
    para: number,
    charOffset: number,
    length: number,
    newText: string,
  ): string
  insertParagraph(sec: number, para: number): string
  splitParagraph(sec: number, para: number, charOffset: number): string
  deleteParagraph(sec: number, para: number): string
  splitSection(sec: number, para: number, charOffset: number): string
  mergeSection(sec: number): string
  getPageDef(sec: number): string
  getColumnDef(sec: number): string
  setColumnDef(
    sec: number,
    columnCount: number,
    columnType: number,
    sameWidth: number,
    spacingHu: number,
  ): string
  applyCharFormat(
    sec: number,
    para: number,
    startOffset: number,
    endOffset: number,
    propsJson: string,
  ): string
  applyParaFormat(sec: number, para: number, propsJson: string): string
  applyStyle?(sec: number, para: number, styleId: number): string
  getStyleList?(): string
  getCharIndexAtStreamPos?(listId: number, paraInList: number, pos: number): string
  createTableEx(optionsJson: string): string
  deleteTableControl?(sec: number, parentPara: number, controlIdx: number): string
  getTableDimensions(sec: number, parentPara: number, controlIdx: number): string
  setCellProperties(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    propsJson: string,
  ): string
  getCellParagraphLength(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
  ): number
  getTextInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    charOffset: number,
    count: number,
  ): string
  insertTextInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    charOffset: number,
    text: string,
  ): string
  deleteTextInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    charOffset: number,
    count: number,
  ): string
  applyCharFormatInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    startOffset: number,
    endOffset: number,
    propsJson: string,
  ): string
  applyParaFormatInCell(
    sec: number,
    parentPara: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    propsJson: string,
  ): string
  pageCount?(): number
  getPageOfPosition?(sec: number, para: number): string
  getPageInfo?(pageNum: number): string
  getPageNumberPos?(sec: number): string
  getPageNumberPosition?(sec: number): string
  canvasMetricsActive?(): boolean
  selectCanvasMetrics?(enabled: boolean): boolean
  getControls?(): string
}

export interface ResolvedIndexWord {
  word: string
  sec: number
  para: number
  start: number
  end: number
  offset: number
  length: number
}

export interface AddIndexMarkOptions {
  term?: string
  subTerm?: string
  selectedText?: string
}

export type AddIndexMarkResult =
  | {
      ok: true
      id: string
      term: string
      subTerm: string
      sec: number
      para: number
      offset: number
      names: string[]
    }
  | {
      ok: false
      reason:
        | 'unsupported_place'
        | 'not_found'
        | 'invalid_term'
        | 'invalid_name'
        | 'name_too_long'
        | 'engine_error'
      maxLen?: number
      error?: string
    }

export interface AddIndexMarksAllOptions {
  term?: string
  query?: string
  subTerm?: string
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface AddedIndexMarkSummary {
  id: string
  term: string
  subTerm: string
  sec: number
  para: number
  offset: number
  names: string[]
}

export interface SkippedNonBodyCounts {
  tableCell: number
  textBox: number
  footnote: number
  endnote: number
}

export type AddIndexMarksAllResult =
  | {
      ok: true
      added: number
      skippedNonBody: number
      skippedCounts: SkippedNonBodyCounts
      marks: AddedIndexMarkSummary[]
    }
  | {
      ok: false
      reason: string
      error?: string
    }

export interface IndexMarkItem {
  id: string
  term: string
  subTerm: string
  sec: number
  para: number
  offset: number
  page: number
  pageLabel: string
  physicalPage: number
  numberingRun: number
  names: string[]
}

export type RemoveIndexMarkResult =
  { ok: true; removed: number; names: string[] } | { ok: false; reason: 'not_found' }

export type RemoveIndexMarksByTermResult =
  | { ok: true; removedMarks: number; removedBookmarks: number; names: string[] }
  | { ok: false; reason: 'invalid_term' }

export interface IndexPageRef {
  page: number
  pageLabel: string
  physicalPage: number
  numberingRun: number
}

export interface IndexSubEntry {
  subTerm: string
  pages: IndexPageRef[]
  pagesText: string
}

export interface IndexMainEntry {
  term: string
  heading: string
  pages: IndexPageRef[]
  pagesText: string
  subEntries: IndexSubEntry[]
}

export interface IndexGroup {
  heading: string | null
  entries: IndexMainEntry[]
}

export interface GroupIndexEntriesResult {
  groups: IndexGroup[]
  entries: IndexMainEntry[]
}

export interface BuildIndexBlockOptions {
  title?: string | null
  columns?: IndexColumnCount
  columnGapMm?: number
  groupHeadings?: boolean
  layout?: IndexLayout
  where?: 'before' | 'after'
}

export interface RefreshIndexBlockOptions extends BuildIndexBlockOptions {
  allowOverwriteManual?: boolean
}

export interface ModifiedIndexLine {
  lineIndex: number
  expected: string | null
  actual: string | null
}

export interface BuiltIndexRange {
  startName: string
  endName: string
  start: ResolvedBodyPlace
  end: ResolvedBodyPlace
}

export interface CleanedIndexMarksSummary {
  deduplicated: number
  brokenRemoved: number
  renamed: RenamedMark[]
  removedBroken: RemovedBrokenMark[]
}

export type BuildIndexBlockResult =
  | {
      ok: true
      refreshed?: boolean
      sec: number
      startPara: number
      endPara: number
      columns: IndexColumnCount
      layout: IndexLayout
      groupHeadings: boolean
      title: string
      entryCount: number
      groupCount: number
      lines: string[]
      range: BuiltIndexRange
      cleanedMarks?: CleanedIndexMarksSummary
    }
  | {
      ok: false
      reason:
        | 'in_table'
        | 'unsupported_place'
        | 'not_found'
        | 'no_index_marks'
        | 'index_block_exists'
        | 'invalid_options'
        | 'manual_edits'
        | 'broken_range'
        | 'invalid_range'
        | 'name_too_long'
        | 'duplicate_name'
        | 'invalid_name'
        | 'engine_error'
      error?: string
      modifiedLines?: ModifiedIndexLine[]
      range?: MatchedRangeMark
      cleanedMarks?: CleanedIndexMarksSummary
    }

export interface IndexStalenessResult {
  stale: boolean
  reason?: 'pages_changed' | 'entries_changed'
}

export declare function resolveIndexWordAt(
  doc: IndexDoc | null | undefined,
  place: MarkPlaceInput | null | undefined,
): ResolvedIndexWord | null

export declare function compareIndexTerms(a: string, b: string): number

export declare function indexGroupHeadingOf(term: string): string

export declare function groupIndexEntries(
  marks: readonly Pick<
    IndexMarkItem,
    'term' | 'subTerm' | 'page' | 'pageLabel' | 'physicalPage' | 'numberingRun'
  >[],
  options?: { groupHeadings?: boolean },
): GroupIndexEntriesResult

export declare function addIndexMark(
  doc: IndexDoc,
  place: MarkPlaceInput,
  termOrOptions?: string | AddIndexMarkOptions,
): AddIndexMarkResult

export declare function addIndexMarksAll(
  doc: IndexDoc,
  termOrOptions: string | AddIndexMarksAllOptions,
): AddIndexMarksAllResult

export declare function listIndexMarks(doc: IndexDoc | null | undefined): IndexMarkItem[]

export declare function removeIndexMark(
  doc: IndexDoc,
  markIdOrNames: string | readonly string[] | { id?: string; names?: readonly string[] },
): RemoveIndexMarkResult

export declare function removeIndexMarksByTerm(
  doc: IndexDoc,
  term: string,
  subTerm?: string,
): RemoveIndexMarksByTermResult

export declare function buildIndexBlock(
  doc: IndexDoc,
  place: MarkPlaceInput,
  options?: BuildIndexBlockOptions,
): BuildIndexBlockResult

export declare function refreshIndexBlock(
  doc: IndexDoc,
  options?: RefreshIndexBlockOptions,
): BuildIndexBlockResult

export declare function checkIndexStaleness(doc: IndexDoc | null | undefined): IndexStalenessResult
