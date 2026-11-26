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

export declare function findActiveOutlineIndex(
  items: readonly Pick<OutlineItem, 'sec' | 'para'>[],
  caret: OutlineCaret | null | undefined,
): number
