/**
 * Names the save area gives its outputs (light: no save code behind it).
 */
import type { MobileWorkbookDocument } from '../desktop-api/sessions'

/** The document's name without its extension (`Book1` when it has none). */
export function documentStem(name: string): string {
  return name.replace(/\.[^.]*$/, '') || 'Book1'
}

/**
 * The recovery copy's title, the name a restored copy reopens under: the
 * document's own name for a workbook (`.xlsm` keeps its macros), `name.xlsx`
 * for a session converted from `.xls` or `.csv` (spec 2.5: it recovers as an
 * untitled `.xlsx`, whose first save is a Save As with that name).
 */
export function recoveryTitle(
  document: Pick<MobileWorkbookDocument, 'name' | 'converted'>,
): string {
  return document.converted ? `${documentStem(document.name)}.xlsx` : document.name
}

export function odsCopyName(name: string): string {
  return `${documentStem(name)}.ods`
}

export function csvCopyName(name: string): string {
  return `${documentStem(name)}.csv`
}

/** The desktop's macro rule: a workbook named `.xlsm` keeps that format. */
export function isMacroWorkbook(name: string): boolean {
  return /\.xlsm$/i.test(name)
}
