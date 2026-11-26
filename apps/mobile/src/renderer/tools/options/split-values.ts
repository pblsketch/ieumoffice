/**
 * Split's values the form needs besides `checkOptions`: the PC tools window's
 * defaults, its default page range (the two halves), and the size field's
 * number and unit converted to and from bytes.
 */
import type { SplitSizeUnit } from '@genoffice/pdf-ops/split-plan'

const KB = 1024
const MB = 1024 * 1024

/** The PC window's split defaults, without the subfolder (the phone saves no folders) */
export const SPLIT_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  splitMode: 'ranges',
  splitMergeRanges: false,
  splitFixedKind: 'pagesPerFile',
  splitFixedValue: 1,
  splitBookmarkLevel: 1,
  splitIncludeLeading: true,
  splitMaxBytes: 10 * MB,
  splitPrefix: '',
  splitPattern: 'numbered',
})

/**
 * A screen-only key: the range the form filled in by itself, so it is filled
 * again for another file's page count while the user has not changed it.
 * `checkOptions` does not read it.
 */
export const AUTO_RANGES_KEY = 'splitRangesAuto'

/** The PC window's default range: the two halves, or "1" for a single page */
export function defaultSplitRanges(pageCount: number): string {
  if (pageCount < 2) return '1'
  const half = Math.floor(pageCount / 2)
  return `1-${half}, ${half + 1}-${pageCount}`
}

const unitBytes = (unit: SplitSizeUnit) => (unit === 'MB' ? MB : KB)

/** Bytes from the typed size; 0 (refused by `checkOptions`) when it is not a positive number */
export function sizeToBytes(text: string, unit: SplitSizeUnit): number {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return 0
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * unitBytes(unit))
}

/** The size field's number and unit for a byte count: MB from 1 MB up, KB below */
export function bytesToSize(bytes: number): { text: string; unit: SplitSizeUnit } {
  if (!Number.isFinite(bytes) || bytes <= 0) return { text: '', unit: 'MB' }
  const unit: SplitSizeUnit = bytes >= MB ? 'MB' : 'KB'
  const value = Math.round((bytes / unitBytes(unit)) * 100) / 100
  return { text: String(value), unit }
}
