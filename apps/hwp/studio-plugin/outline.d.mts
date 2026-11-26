import type { DeleteDocSettingResult, MarkDoc, WriteDocSettingResult } from './doc-marks.d.mts'

export declare const DOC_OUTLINE_MAP_KEY: '개요수준'
export declare const MIN_OUTLINE_LEVEL: 1
export declare const MAX_OUTLINE_LEVEL: 10
export declare const DEFAULT_OUTLINE_STYLE_MAP: Readonly<Record<string, number>>

export type OutlineStyleMap = Record<string, number>

export interface OutlineDoc extends MarkDoc {
  getOutlineNavigation(): string
  getStyleList(): string
  getStyleAt(sec: number, para: number): string
  getParagraphLength(sec: number, para: number): number
  getTextRange(sec: number, para: number, charOffset: number, count: number): string
  getPageOfPosition?(sec: number, para: number): string
  getPageInfo?(pageNum: number): string
  getPageNumberPos?(sec: number): string
  getPageNumberPosition?(sec: number): string
  applyStyle?(sec: number, para: number, styleId: number): string
  getParaPropertiesAt?(sec: number, para: number): string
  setParaShapeId?(sec: number, para: number, paraShapeId: number): string
  getLogicalLength?(sec: number, para: number): number
  copySelection?(
    sec: number,
    startPara: number,
    startCharOffset: number,
    endPara: number,
    endCharOffset: number,
  ): string
  copySelectionLogical?(
    sec: number,
    startPara: number,
    startLogicalOffset: number,
    endPara: number,
    endLogicalOffset: number,
  ): string
  pasteInternal?(sec: number, para: number, charOffset: number): string
  clearClipboard?(): void
  insertParagraph?(sec: number, para: number): string
  deleteParagraph?(sec: number, para: number): string
  getControls?(): string
  getFieldList?(): string
  getMemoList?(): string
}

export interface OutlineItem {
  level: number
  number: string
  title: string
  page: number
  pageLabel?: string
  physicalPage: number
  sec: number
  para: number
  source: 'outline' | 'style'
  styleName: string
}

export interface ReadOutlineOptions {
  appStyleMap?: OutlineStyleMap | null | undefined
}

export interface ReadOutlineResult {
  items: OutlineItem[]
  effectiveStyleMap: OutlineStyleMap
  hasDocStyleMap: boolean
  docStyleMap: OutlineStyleMap | null
}

export interface OutlineCaret {
  sec: number
  para: number
}

export interface SplitHeadingText {
  number: string
  title: string
}

export type WriteDocOutlineMapResult =
  (WriteDocSettingResult & { map?: OutlineStyleMap }) | (DeleteDocSettingResult & { map: null })

export declare function normalizeOutlineStyleMap(raw: unknown): OutlineStyleMap

export declare function resolveOutlineStyleMap(
  appMap: OutlineStyleMap | null | undefined,
  docMap: OutlineStyleMap | null | undefined,
): OutlineStyleMap

export declare function splitStyleHeadingText(rawText: string): SplitHeadingText

export declare function readDocOutlineMap(doc: MarkDoc | null | undefined): OutlineStyleMap | null

export declare function writeDocOutlineMap(
  doc: MarkDoc,
  map: OutlineStyleMap | null | undefined,
): WriteDocOutlineMapResult

export declare function readOutline(
  doc: OutlineDoc | null | undefined,
  options?: ReadOutlineOptions,
): ReadOutlineResult

export interface OutlinePlace {
  sec: number
  para: number
  offset: number
  length: number
}

export interface OutlineLevelChange {
  sec: number
  para: number
  fromLevel: number
  toLevel: number
  styleName: string
}

export interface ChangeOutlineLevelParams {
  sec: number
  para: number
  delta: 1 | -1
  singleOnly?: boolean
  appStyleMap?: OutlineStyleMap | null
}

export type ChangeOutlineLevelResult =
  | {
      ok: true
      changed: OutlineLevelChange[]
      place: OutlinePlace
    }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'unsupported_place'
        | 'level_out_of_range'
        | 'no_mapped_style'
        | 'missing_style_in_doc'
      title?: string
      sec?: number
      para?: number
      fromLevel?: number
      targetLevel?: number
      styleName?: string
    }

export interface MoveOutlineSectionParams {
  source: { sec: number; para: number }
  target: { sec: number; para: number }
  position: 'before' | 'after'
  appStyleMap?: OutlineStyleMap | null
}

export type MoveOutlineSectionResult =
  | {
      ok: true
      movedParagraphs: number
      newStart: { sec: number; para: number }
      place: OutlinePlace
    }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'unsupported_place'
        | 'cross_section'
        | 'first_para_layout'
        | 'target_inside_source'
        | 'no_change'
        | 'objects_changed'
        | 'bookmarks_lost'
        | 'engine_error'
      error?: string
      mutated?: boolean
    }

export declare function findActiveOutlineIndex(
  items: readonly Pick<OutlineItem, 'sec' | 'para'>[],
  caret: OutlineCaret | null | undefined,
): number

export declare function changeOutlineLevel(
  doc: OutlineDoc | null | undefined,
  params: ChangeOutlineLevelParams,
): ChangeOutlineLevelResult

export declare function moveOutlineSection(
  doc: OutlineDoc | null | undefined,
  params: MoveOutlineSectionParams,
): MoveOutlineSectionResult
