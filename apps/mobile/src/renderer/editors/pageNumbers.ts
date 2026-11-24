/**
 * Page numbers for HWP documents on the phone: the common places and shapes of
 * the PC editor's page number command (studio-plugin/document-looks.mjs,
 * engine patch 0014 tables 134 and 150), applied with the same rule.
 */

/** The engine calls page numbers need. */
export interface PageNumberDocument {
  getSectionCount(): number
  getPageNumberPos(sectionIdx: number): string
  setPageNumberPos(sectionIdx: number, format: number, position: number, dash: boolean): string
}

/** Places offered on the phone, with their engine codes (table 150). */
export const PAGE_NUMBER_PLACES = {
  none: 0,
  bottomCenter: 5,
  bottomRight: 6,
  topCenter: 2,
  topRight: 3,
} as const

/** Shapes offered on the phone, with their engine codes (table 134). */
export const PAGE_NUMBER_SHAPES = {
  digit: 0,
  upperRoman: 2,
  lowerRoman: 3,
  hangulSyllable: 6,
} as const

export type PageNumberPlace = keyof typeof PAGE_NUMBER_PLACES
export type PageNumberShape = keyof typeof PAGE_NUMBER_SHAPES

export interface PageNumberSetting {
  readonly place: PageNumberPlace
  readonly shape: PageNumberShape
  /** Dashes around the number (- 1 -). */
  readonly dash: boolean
}

export const DEFAULT_PAGE_NUMBER: PageNumberSetting = {
  place: 'bottomCenter',
  shape: 'digit',
  dash: true,
}

function nameOf<T extends Record<string, number>>(table: T, code: unknown): keyof T | null {
  return (Object.keys(table) as Array<keyof T>).find((name) => table[name] === code) ?? null
}

/**
 * The first section's page number, or null when the document has a place or
 * shape the phone does not offer (left as it is unless the person changes it).
 */
export function readPageNumber(doc: PageNumberDocument): PageNumberSetting | null {
  try {
    const found = (
      JSON.parse(doc.getPageNumberPos(0)) as {
        pageNumber?: { format: number; position: number; dash: boolean } | null
      }
    ).pageNumber
    if (!found || found.position === 0) return { ...DEFAULT_PAGE_NUMBER, place: 'none' }
    const place = nameOf(PAGE_NUMBER_PLACES, found.position)
    const shape = nameOf(PAGE_NUMBER_SHAPES, found.format)
    if (!place || !shape) return null
    return { place, shape, dash: found.dash }
  } catch {
    return null
  }
}

/**
 * Numbers the pages as the PC editor does: the first section always, later
 * sections only where they already have a page number of their own.
 */
export function applyPageNumber(doc: PageNumberDocument, setting: PageNumberSetting): void {
  const format = PAGE_NUMBER_SHAPES[setting.shape]
  const position = PAGE_NUMBER_PLACES[setting.place]
  const sections = doc.getSectionCount()
  for (let sec = 0; sec < sections; sec += 1) {
    if (sec > 0) {
      const own = (JSON.parse(doc.getPageNumberPos(sec)) as { pageNumber?: unknown }).pageNumber
      if (own == null) continue
    }
    const result = JSON.parse(doc.setPageNumberPos(sec, format, position, setting.dash)) as {
      ok?: boolean
    }
    if (!result.ok) throw new Error('the engine refused the page number')
  }
}
