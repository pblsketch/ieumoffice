export type BibEntryType =
  'article' | 'book' | 'chapter' | 'thesis' | 'report' | 'conference' | 'webpage' | 'other'

export type CitationStyle = 'apa' | 'chicago' | 'mla' | 'ieee'

export type EntryLanguage = 'ko' | 'en'

export type BibEntrySource = 'manual' | 'import' | 'document' | 'ai'

export declare const ENTRY_TYPES: readonly BibEntryType[]
export declare const CITATION_STYLES: readonly CitationStyle[]
export declare const DEFAULT_CITATION_STYLE: 'apa'
export declare const ENTRY_LANGUAGES: readonly EntryLanguage[]
export declare const ENTRY_SOURCES: readonly BibEntrySource[]
export declare const BIBLIOGRAPHY_HANGING_INDENT_PT: 24
export declare const IEEE_HANGING_INDENT_PT: 20
export declare const DEFAULT_BIBLIOGRAPHY_TITLE_KO: string
export declare const DEFAULT_BIBLIOGRAPHY_TITLE_EN: string

export interface BibAuthor {
  family?: string
  given?: string
  literal?: string
  isOrganization?: boolean
}

export type BibAuthorInput = string | BibAuthor

export interface BibEntry {
  id: string
  key: string
  oldKeys: string[]
  type: BibEntryType
  authors: BibAuthor[]
  editors?: BibAuthor[]
  year?: string
  title: string
  containerTitle?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  place?: string
  edition?: string
  degree?: string
  institution?: string
  doi?: string
  url?: string
  accessed?: string
  language: EntryLanguage
  tags: string[]
  memo?: string
  verified: boolean
  source?: BibEntrySource
  createdAt?: string
  updatedAt?: string
}

export type CitationEntry = BibEntry

export interface BibEntryInput {
  id?: string
  key?: string
  oldKeys?: readonly string[]
  type?: string
  authors?: readonly BibAuthorInput[]
  editors?: readonly BibAuthorInput[]
  year?: string | number
  title?: string
  containerTitle?: string
  volume?: string | number
  issue?: string | number
  pages?: string
  publisher?: string
  place?: string
  edition?: string
  degree?: string
  institution?: string
  doi?: string
  url?: string
  accessed?: string
  language?: EntryLanguage
  tags?: readonly string[]
  memo?: string
  verified?: boolean
  source?: BibEntrySource
  createdAt?: string
  updatedAt?: string
}

export interface NormalizeBibEntryOptions {
  id?: string
  existingKeys?: Iterable<string> | Set<string>
  existingIds?: Iterable<string> | Set<string>
}

export type RenameBibEntryKeyResult =
  { ok: true; entry: BibEntry } | { ok: false; reason: 'invalid_key' | 'duplicate_key' }

export interface BibSegment {
  text: string
  italic?: boolean
}

export interface FormatBibliographyContext {
  disambiguationSuffix?: string
  disambiguation?: Map<string, string> | Record<string, string>
  ieeeNumber?: number
  ieeeNumbers?: Map<string, number> | Record<string, number>
}

export interface FormattedBibliographyEntry {
  key: string
  text: string
  segments: BibSegment[]
  language: EntryLanguage
  style: CitationStyle
  disambiguation?: string
  number?: number
}

export interface SortBibliographyOptions {
  citedKeysInOrder?: readonly string[]
}

export interface FormattedBibliographyList {
  style: CitationStyle
  entries: FormattedBibliographyEntry[]
  disambiguation: Map<string, string>
  ieeeNumbers: Map<string, number>
}

export interface InTextCitationItem {
  entry: BibEntry
  locator?: string
  prefix?: string
  suffix?: string
}

export interface FormatInTextOptions {
  mode?: 'parenthetical' | 'narrative'
  disambiguation?: Map<string, string> | Record<string, string>
  shortTitles?: Map<string, string> | Record<string, string>
  allEntries?: readonly BibEntry[]
  ieeeNumbers?: Map<string, number> | Record<string, number>
}

export interface SortOrderMismatch {
  key: string
  actualIndex: number
  expectedIndex: number
}

export interface SortOrderComparison {
  inOrder: boolean
  actualOrder: string[]
  expectedOrder: string[]
  mismatches: SortOrderMismatch[]
}

export interface MissingDisambiguationIssue {
  key: string
  expectedSuffix: string
  expectedToken: string
  year: string
}

export declare function isCitationStyle(value: unknown): value is CitationStyle
export declare function isEntryType(value: unknown): value is BibEntryType
export declare function getBibliographyHangingIndentPt(style?: CitationStyle): number
export declare function normalizeAuthor(input: BibAuthorInput | null | undefined): BibAuthor | null
export declare function formatAuthorDisplay(
  input: BibAuthorInput | null | undefined,
  lang?: EntryLanguage,
): string
export declare function detectEntryLanguage(
  entry: Partial<BibEntryInput> | Partial<BibEntry> | null | undefined,
): EntryLanguage
export declare function sanitizeCitationKey(raw: unknown): string
export declare function generateCitationKey(
  entry: Partial<BibEntryInput> | Partial<BibEntry>,
  existingKeys?: Iterable<string> | Set<string>,
): string
export declare function normalizeBibEntry(
  raw: BibEntryInput | Partial<BibEntry> | null | undefined,
  options?: NormalizeBibEntryOptions,
): BibEntry
export declare function renameBibEntryKey(
  entry: BibEntry,
  nextKey: string,
  existingKeys?: Iterable<string> | Set<string>,
): RenameBibEntryKeyResult
export declare function resolveEntryByKey(
  entries: readonly BibEntry[],
  key: string,
): BibEntry | null
export declare function formatLocator(
  locator: string | null | undefined,
  style?: CitationStyle,
  lang?: EntryLanguage,
): string
export declare function formatEdition(
  edition: string | number | null | undefined,
  style?: CitationStyle,
  language?: EntryLanguage,
): string
export declare function assignIeeeNumbers(
  citedKeysInOrder: readonly string[],
  entries?: readonly BibEntry[],
): Map<string, number>
export declare function sortBibliographyEntries(
  entries: readonly BibEntry[],
  style?: CitationStyle,
  options?: SortBibliographyOptions,
): BibEntry[]
export declare function assignDisambiguationSuffixes(
  entries: readonly BibEntry[],
  style?: CitationStyle,
): Map<string, string>
export declare function assignMlaShortTitles(entries: readonly BibEntry[]): Map<string, string>
export declare function formatBibliographyEntry(
  entry: BibEntry,
  style?: CitationStyle,
  context?: FormatBibliographyContext,
): FormattedBibliographyEntry
export declare function formatBibliographyText(
  entry: BibEntry,
  style?: CitationStyle,
  context?: FormatBibliographyContext,
): string
export declare function formatBibliographyList(
  entries: readonly BibEntry[],
  style?: CitationStyle,
  options?: SortBibliographyOptions,
): FormattedBibliographyList
export declare function formatInTextCitation(
  input: InTextCitationItem | BibEntry | readonly (InTextCitationItem | BibEntry)[],
  style?: CitationStyle,
  options?: FormatInTextOptions,
): string
export declare function compareSortOrder(
  actualKeys: readonly string[],
  expectedKeys: readonly string[],
): SortOrderComparison
export declare function findMissingDisambiguation(
  entries: readonly BibEntry[],
  renderedTextsByKey: Map<string, string> | Record<string, string>,
  style?: CitationStyle,
): MissingDisambiguationIssue[]
