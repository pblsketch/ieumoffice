// What the annotation feature remembers on the device (spec 3.4): the three
// highlighter pens and the line markup colors under the PC storage keys and in the PC
// format (apps/pdf/src/renderer/selection-colors.ts), and the author name the mobile
// HWP memo sheet keeps. Nothing here leaves the device.
import {
  HIGHLIGHT_PENS_KEY,
  LINE_MARKUP_COLORS_KEY,
  parseHighlightPens,
  parseLineMarkupColors,
  type LineMarkupType,
  type Rgb,
} from '../../../../../../../pdf/src/renderer/selection-colors'

/** The key components/MemoSheet.tsx stores the memo author under (shared on purpose). */
export const MEMO_AUTHOR_KEY = 'ieum.mobile.memoAuthor'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage full or unavailable: the value still holds for this session
  }
}

export function loadHighlightPens(): Rgb[] {
  return parseHighlightPens(read(HIGHLIGHT_PENS_KEY))
}

export function saveHighlightPens(pens: readonly Rgb[]): void {
  write(HIGHLIGHT_PENS_KEY, JSON.stringify(pens))
}

export function loadLineMarkupColors(): Record<LineMarkupType, Rgb> {
  return parseLineMarkupColors(read(LINE_MARKUP_COLORS_KEY))
}

export function saveLineMarkupColors(colors: Record<LineMarkupType, Rgb>): void {
  write(LINE_MARKUP_COLORS_KEY, JSON.stringify(colors))
}

/** The remembered author name; '' when none (the save then uses the PC default). */
export function loadAuthor(): string {
  return read(MEMO_AUTHOR_KEY)?.trim() ?? ''
}

export function saveAuthor(name: string): void {
  const trimmed = name.trim()
  if (trimmed) write(MEMO_AUTHOR_KEY, trimmed)
}
