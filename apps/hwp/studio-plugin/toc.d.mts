import type { MarkEntry, MarkPlaceInput, MarkPrefix } from './doc-marks.d.mts'
import type { OutlineDoc, OutlineStyleMap } from './outline.d.mts'

export type TocKind = 'body' | 'table' | 'figure' | 'equation'
export type TocKindId = '본문' | '표' | '그림' | '수식'
export type CaptionTocKind = 'table' | 'figure' | 'equation'
export type CaptionTocKindId = '표' | '그림' | '수식'
export type TocLayout = 'dotted-tab' | 'table'

export declare const TOC_KINDS: Readonly<{
  body: '본문'
  table: '표'
  figure: '그림'
  equation: '수식'
}>

export declare const TOC_LAYOUTS: readonly TocLayout[]
export declare const DEFAULT_TOC_MAX_LEVEL: 3
export declare const DEFAULT_TOC_TITLE: '차례'
export declare const DEFAULT_TOC_TITLES: Readonly<{
  body: '차례'
  table: '표 차례'
  figure: '그림 차례'
  equation: '수식 차례'
}>
export declare const DEFAULT_TOC_INDENT_PT: 14

export interface TocDoc extends OutlineDoc {
  getPageDef(sec: number): string
  getColumnDef?(sec: number): string
  getStyleDetail?(styleId: number): string
  getCharPropertiesAt?(sec: number, para: number, charOffset: number): string
  getControls?(): string
  listObjectCaptions?(): string
  insertText(sec: number, para: number, charOffset: number, text: string): string
  deleteText(sec: number, para: number, charOffset: number, count: number): string
  splitParagraph(sec: number, para: number, charOffset: number): string
  deleteRange(
    sec: number,
    startPara: number,
    startOffset: number,
    endPara: number,
    endOffset: number,
  ): string
  applyParaFormat(sec: number, para: number, propsJson: string): string
  applyCharFormat(
    sec: number,
    para: number,
    startOffset: number,
    endOffset: number,
    propsJson: string,
  ): string
  pasteHtml?(sec: number, para: number, charOffset: number, html: string): string
  getControlTextPositions?(sec: number, para: number): string
  getTableDimensions?(sec: number, para: number, controlIndex: number): string
  getCellInfo?(sec: number, para: number, controlIndex: number, cellIndex: number): string
  getCellParagraphCount?(sec: number, para: number, controlIndex: number, cellIndex: number): number
  getCellParagraphLength?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellPara: number,
  ): number
  getTextInCell?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellPara: number,
    offset: number,
    count: number,
  ): string
  insertTextInCell?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellPara: number,
    offset: number,
    text: string,
  ): string
  deleteTextInCell?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellPara: number,
    offset: number,
    count: number,
  ): string
  applyCellStyle?(
    sec: number,
    para: number,
    controlIndex: number,
    cellIndex: number,
    cellPara: number,
    styleId: number,
  ): string
  deleteTableControl?(sec: number, para: number, controlIndex: number): string
  insertHyperlinkEx?(payloadJson: string): unknown
  getHyperlinkContext?(targetJson: string): string
  removeHyperlinkEx?(optionsJson: string): void
  canvasMetricsActive?(): boolean
  selectCanvasMetrics?(active: boolean): void
}

export interface TocHelpers {
  contentsOf?: (doc: TocDoc, made: string[][]) => Record<string, unknown> | null
  tocLookOf?: (doc: TocDoc, entries: readonly { level: number }[]) => TocLook
  tocHtml?: (rows: readonly TocHtmlRow[], widthPt: number) => string
  withPortableWidths?: <T>(doc: TocDoc, fn: () => T) => T
  textWidthPt?: (doc: TocDoc, sec: number) => number
  columnWidthUnits?: (doc: TocDoc, sec: number) => number
  oneLine?: (text: string, look: TocLevelLook, widthPt: number) => string
  tablesOf?: (doc: TocDoc) => { tables: TocTableInfo[] }
}

export interface TocFont {
  family: string
  points: number
}

export interface TocLevelLook {
  style: number | null
  font: TocFont
  indentPt: number
}

export interface TocLook {
  levels: Map<number, TocLevelLook>
  title: {
    style: number
    font: TocFont
    bold: boolean
    color?: string
  }
}

export interface TocHtmlRow {
  text: string
  look: TocLevelLook
  page: number | string
}

export interface TocTableInfo {
  sec: number
  para: number
  path: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>
  rows: number
  cols: number
  cells?: number
}

export interface PrintedPageLabel {
  page: number
  label: string
  physicalPage: number
}

export interface TocRangeInfo {
  kind: TocKind
  kindId: TocKindId | string
  id: string
  key: string
  start: MarkEntry
  end: MarkEntry
}

export interface TocMeta {
  v: number
  kind: TocKind
  layout: TocLayout
  maxLevel: number
  links: boolean
  title: string | null
  lines: string[]
}

export interface CaptionCellPathStep {
  controlIndex: number
  cellIndex: number
  cellParaIndex: number
}

export interface TocEntry {
  level: number
  number?: string
  title?: string
  text: string
  page: number
  pageLabel: string
  physicalPage?: number
  sec: number
  para: number
  source?: string
  styleName?: string
  objectKind?: string
  controlIndex?: number
  cellPath?: CaptionCellPathStep[]
  bookmark?: string
}

export interface CaptionTocEntry extends TocEntry {
  level: 1
  title: string
  source: 'object-caption' | 'caption-paragraph'
}

export interface CollectCaptionTocOptions {
  helpers?: TocHelpers
}

export interface CollectCaptionTocResult {
  kind: CaptionTocKind
  kindId: CaptionTocKindId
  entries: CaptionTocEntry[]
  objectCaptionsUnavailable?: true
  warning?: string
}

export interface LegacyTocInfo {
  found: true
  source: 'lines' | 'table'
  sec: number
  startPara: number
  endPara: number
  title: string | null
  tableIndex?: number
  tablePara?: number
  tableControlIndex?: number
}

export interface TocModifiedLine {
  index: number
  expected: string
  actual: string
}

export interface TocOptions {
  kind?: TocKind | TocKindId
  layout?: TocLayout
  maxLevel?: number
  links?: boolean
  title?: string | null
  appStyleMap?: OutlineStyleMap | null
  replaceLegacy?: boolean
  replaceExisting?: boolean
  skipLegacyCheck?: boolean
  allowOverwriteManual?: boolean
  made?: string[][]
  anchorPrefix?: MarkPrefix
  collectEntries?: (
    doc: TocDoc,
    options: TocOptions,
  ) => TocEntry[] | { entries: TocEntry[]; objectCaptionsUnavailable?: boolean; warning?: string }
  helpers?: TocHelpers
}

export type TocWriteResult =
  | {
      ok: true
      kind: TocKind
      kindId: TocKindId
      layout: TocLayout
      count: number
      pages: number[]
      pageLabels: string[]
      entries: TocEntry[]
      range: { sec: number; startPara: number; endPara: number }
      linksApplied: boolean
      linksUnsupportedInTable?: true
      objectCaptionsUnavailable?: true
      warning?: string
      place: { sec: number; para: number; offset: number; length: number }
    }
  | {
      ok: false
      reason:
        | 'in_table'
        | 'unsupported_place'
        | 'not_found'
        | 'invalid_options'
        | 'toc_exists'
        | 'multi_section_range'
        | 'legacy_toc_found'
        | 'no_entries'
        | 'manual_edits'
        | 'engine_error'
      kind?: TocKind
      kindId?: TocKindId
      range?: TocRangeInfo
      legacy?: LegacyTocInfo
      modifiedLines?: TocModifiedLine[]
      objectCaptionsUnavailable?: true
      warning?: string
      error?: string
    }

export interface EnsureBookmarkResult {
  ok: boolean
  name?: string
  created?: boolean
  sec?: number
  para?: number
  reason?: string
  error?: string
}

export interface TocStaleEntryDiff {
  index: number
  currentText: string | null
  expectedText: string | null
  currentPage: string | null
  expectedPage: string | null
}

export interface TocStaleItem {
  kind: TocKind
  kindId: TocKindId | string
  reason: 'pages_changed' | 'entries_changed'
  range: TocRangeInfo
  details: {
    currentCount: number
    expectedCount: number
    changedEntries: TocStaleEntryDiff[]
  }
}

export interface CheckTocStalenessOptions {
  kind?: TocKind | TocKindId
  appStyleMap?: OutlineStyleMap | null
  collectors?: Partial<
    Record<
      TocKind,
      (
        doc: TocDoc,
        options: TocOptions,
      ) =>
        TocEntry[] | { entries: TocEntry[]; objectCaptionsUnavailable?: boolean; warning?: string }
    >
  >
  helpers?: TocHelpers
}

export interface CheckTocStalenessResult {
  stale: boolean
  items: TocStaleItem[]
  objectCaptionsUnavailable?: true
  warning?: string
}

export declare function registerTocHelpers(helpers: TocHelpers | null | undefined): void
export declare function formatPageNumberLabel(num: number, format: number): string | null
export declare function readPrintedPageLabel(
  doc: TocDoc,
  sec: number,
  para: number,
  caches?: { pageInfoCache?: Map<number, unknown>; pageFormatCache?: Map<number, number> } | null,
): PrintedPageLabel
export declare function resolveTocKind(
  kind?: TocKind | TocKindId,
): { kind: TocKind; kindId: TocKindId } | null
export declare function tocSettingKey(kind?: TocKind | TocKindId): string
export declare function listTocRanges(doc: TocDoc | null | undefined): TocRangeInfo[]
export declare function findTocRange(
  doc: TocDoc | null | undefined,
  kind?: TocKind | TocKindId,
): TocRangeInfo | null
export declare function readTocMeta(
  doc: TocDoc | null | undefined,
  kind?: TocKind | TocKindId,
): TocMeta | null
export declare function ensureHeadingBookmark(
  doc: TocDoc,
  sec: number,
  para: number,
  label: string,
  options?: { prefix?: MarkPrefix },
): EnsureBookmarkResult
export declare function collectBodyTocEntries(
  doc: TocDoc,
  options?: { maxLevel?: number; appStyleMap?: OutlineStyleMap | null },
): TocEntry[]
export declare function classifyCaptionParagraph(
  text: string,
  styleName?: string | { name?: string; englishName?: string } | null,
  doc?: TocDoc | null,
  sec?: number,
  para?: number,
): CaptionTocKind | null
export declare function collectCaptionTocEntries(
  doc: TocDoc | null | undefined,
  kind: CaptionTocKind | CaptionTocKindId,
  options?: CollectCaptionTocOptions,
): CollectCaptionTocResult
export declare function detectLegacyToc(
  doc: TocDoc | null | undefined,
  options?: { made?: string[][]; helpers?: TocHelpers },
): LegacyTocInfo | null
export declare function insertTocBlock(
  doc: TocDoc | null | undefined,
  place: MarkPlaceInput,
  options?: TocOptions,
): TocWriteResult
export declare function refreshTocBlock(
  doc: TocDoc | null | undefined,
  options?: TocOptions,
): TocWriteResult
export interface TocManualEditsResult {
  hasManualEdits: boolean
  modifiedLines: TocModifiedLine[]
  range?: TocRangeInfo
}

export declare function detectTocManualEdits(
  doc: TocDoc | null | undefined,
  kind?: TocKind | TocKindId,
  options?: { helpers?: TocHelpers },
): TocManualEditsResult
export declare function checkTocStaleness(
  doc: TocDoc | null | undefined,
  options?: CheckTocStalenessOptions,
): CheckTocStalenessResult
