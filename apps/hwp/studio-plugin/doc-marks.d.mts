export type MarkPrefix = '차례:' | '제목:' | '색인:' | '색인블록:' | '인용:' | '참고문헌:' | '설정:'

export declare const MARK_PREFIXES: Readonly<{
  toc: '차례:'
  heading: '제목:'
  index: '색인:'
  indexBlock: '색인블록:'
  citation: '인용:'
  bibliography: '참고문헌:'
  setting: '설정:'
}>

export declare const APP_MARK_PREFIXES: readonly MarkPrefix[]
export declare const SUBMISSION_STRIP_PREFIXES: readonly MarkPrefix[]
export declare const MAX_MARK_NAME_LEN: 64
export declare const RANGE_START: '시작'
export declare const RANGE_END: '끝'

export interface MarkDoc {
  getBookmarks(): string
  addBookmark(sec: number, para: number, charOffset: number, name: string): string
  deleteBookmark(sec: number, para: number, ctrlIdx: number): string
  renameBookmark(sec: number, para: number, ctrlIdx: number, newName: string): string
  getSectionCount(): number
  getParagraphCount(sec: number): number
  getParagraphLength?(sec: number, para: number): number
}

export interface MarkPlaceInput {
  sec?: number
  sectionIndex?: number
  para?: number
  paraIndex?: number
  paragraphIndex?: number
  offset?: number
  charOffset?: number
  charPos?: number
  inTable?: boolean
  inTextBox?: boolean
  isTextBox?: boolean
  inNote?: boolean
  inFootnote?: boolean
  inEndnote?: boolean
  inHeaderFooter?: boolean
  isHeader?: boolean
  isFooter?: boolean
  cellContext?: unknown
  equationControl?: unknown
  path?: unknown
  cellPath?: unknown
  parentParaIndex?: number
  cellIndex?: number
  cellParaIndex?: number
  noteIndex?: number
  noteType?: string
  headerFooter?: unknown
  place?: string
}

export interface ResolvedBodyPlace {
  sec: number
  para: number
  offset: number
}

export interface MarkEntry {
  name: string
  prefix: MarkPrefix
  sec: number
  para: number
  offset: number
  ctrlIdx: number
}

export interface DecodedSingleMark {
  prefix: MarkPrefix
  parts: string[]
  isChunk: false
}

export interface DecodedChunkMark {
  prefix: MarkPrefix
  isChunk: true
  chunkId: string
  index: number
  total: number
  slice: string
  parts: string[]
}

export type DecodedMarkName = DecodedSingleMark | DecodedChunkMark

export interface EncodeChunksOptions {
  maxLen?: number
  chunkId?: string
  existingNames?: Iterable<string> | Set<string>
}

export interface DecodedChunkEntry {
  prefix: MarkPrefix
  parts: string[]
  raw: string
  isChunked: boolean
  chunkId?: string
  chunkCount?: number
  names: string[]
  marks: MarkEntry[]
}

export interface IncompleteChunkGroup {
  prefix: MarkPrefix
  chunkId: string
  total: number
  received: number[]
  names: string[]
  marks: MarkEntry[]
}

export interface DecodeChunksResult {
  entries: DecodedChunkEntry[]
  incomplete: IncompleteChunkGroup[]
}

export type AddMarkResult =
  | { ok: true; name: string; sec: number; para: number; offset: number }
  | {
      ok: false
      reason: 'unsupported_place' | 'invalid_name' | 'name_too_long' | 'engine_error'
      maxLen?: number
      error?: string
    }

export type RemoveMarkResult =
  | { ok: true; name: string; sec: number; para: number; ctrlIdx: number }
  | { ok: false; reason: 'not_found' | 'invalid_mark' | 'engine_error'; error?: string }

export interface RenamedMark {
  from: string
  to: string
  sec: number
  para: number
  offset: number
  ctrlIdx: number
}

export interface FailedMarkDelete {
  name: string
  prefix: MarkPrefix | null
  sec: number
  para: number
  offset: number
  ctrlIdx: number
  error: string
}

export interface DeduplicateMarksResult {
  renamed: RenamedMark[]
  removed: MarkEntry[]
  failed?: FailedMarkDelete[]
}

export type AddRangeMarkResult =
  | {
      ok: true
      prefix: MarkPrefix
      id: string
      startName: string
      endName: string
      start: ResolvedBodyPlace
      end: ResolvedBodyPlace
    }
  | {
      ok: false
      reason:
        | 'unsupported_place'
        | 'invalid_range'
        | 'name_too_long'
        | 'duplicate_name'
        | 'invalid_name'
        | 'engine_error'
      maxLen?: number
      error?: string
    }

export interface MatchedRangeMark {
  prefix: MarkPrefix
  id: string
  key: string
  start: MarkEntry
  end: MarkEntry
}

export interface BrokenRangeMark extends MarkEntry {
  kind: 'start' | 'end'
  id: string
  reason: 'unpaired_start' | 'unpaired_end'
}

export interface FindRangeMarksResult {
  ranges: MatchedRangeMark[]
  broken: BrokenRangeMark[]
}

export interface RemovedBrokenMark extends MarkEntry {
  reason: 'unpaired_start' | 'unpaired_end' | 'incomplete_chunks'
}

export interface CleanupBrokenMarksResult {
  removed: RemovedBrokenMark[]
  failed?: FailedMarkDelete[]
}

export type WriteDocSettingResult =
  | { ok: true; key: string; names: string[]; failed?: FailedMarkDelete[] }
  | {
      ok: false
      reason:
        | 'invalid_key'
        | 'invalid_value'
        | 'unsupported_place'
        | 'invalid_name'
        | 'name_too_long'
        | 'engine_error'
      maxLen?: number
      error?: string
    }

export interface DeleteDocSettingResult {
  ok: boolean
  removed?: number
  failed?: FailedMarkDelete[]
  reason?: 'invalid_key'
}

export interface StripMarksResult {
  removed: number
  names: string[]
  failed?: FailedMarkDelete[]
}

export declare function markPrefixOf(name: unknown): MarkPrefix | null
export declare function isAppMarkName(name: unknown): boolean
export declare function isAppTocHyperlinkField(
  field:
    | {
        fieldType?: string
        command?: string
      }
    | null
    | undefined,
): boolean
export declare function encodeMarkField(value: string | number | boolean): string
export declare function decodeMarkField(value: string): string
export declare function encodeMarkName(
  prefix: MarkPrefix,
  fields: string | number | boolean | readonly (string | number | boolean)[],
): string
export declare function decodeMarkName(name: string): DecodedMarkName | null
export declare function encodeMarkChunks(
  prefix: MarkPrefix,
  payload: string | number | boolean | readonly (string | number | boolean)[],
  options?: EncodeChunksOptions,
): string[]
export declare function decodeMarkChunks(items: readonly (string | MarkEntry)[]): DecodeChunksResult
export declare function uniqueMarkName(
  existingNames: Iterable<string> | Set<string>,
  baseName: string,
  maxLen?: number,
): string
export declare function listMarks(
  doc: MarkDoc,
  prefixes?: MarkPrefix | readonly MarkPrefix[],
): MarkEntry[]
export declare function resolveBodyPlace(
  doc: MarkDoc,
  place: MarkPlaceInput | null | undefined,
): ResolvedBodyPlace | null
export declare function addMark(doc: MarkDoc, place: MarkPlaceInput, name: string): AddMarkResult
export declare function removeMark(
  doc: MarkDoc,
  mark:
    | string
    | (Partial<MarkEntry> & { sectionIndex?: number; paraIndex?: number; controlIndex?: number }),
): RemoveMarkResult
export declare function deduplicateMarks(
  doc: MarkDoc,
  prefixes?: MarkPrefix | readonly MarkPrefix[],
): DeduplicateMarksResult
export declare function addRangeMark(
  doc: MarkDoc,
  prefix: MarkPrefix,
  id: string | readonly string[] | null | undefined,
  startPlace: MarkPlaceInput,
  endPlace: MarkPlaceInput,
): AddRangeMarkResult
export declare function findRangeMarks(
  doc: MarkDoc,
  prefixes?: MarkPrefix | readonly MarkPrefix[],
): FindRangeMarksResult
export declare function cleanupBrokenMarks(
  doc: MarkDoc,
  prefixes?: MarkPrefix | readonly MarkPrefix[],
): CleanupBrokenMarksResult
export declare function writeDocSetting(
  doc: MarkDoc,
  key: string,
  value: unknown,
): WriteDocSettingResult
export declare function readAllDocSettings(doc: MarkDoc): Record<string, unknown>
export declare function readDocSetting<T = unknown>(
  doc: MarkDoc,
  key: string,
  defaultValue?: T,
): T | undefined
export declare function deleteDocSetting(doc: MarkDoc, key: string): DeleteDocSettingResult
export declare function stripMarks(
  doc: MarkDoc,
  prefixes?: MarkPrefix | readonly MarkPrefix[],
): StripMarksResult
