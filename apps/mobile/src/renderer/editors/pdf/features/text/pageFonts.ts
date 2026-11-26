// The PostScript names of the fonts a page draws its text with, as PDF.js knows them
// after building the page's operator list (the viewer already built it while drawing,
// so this is usually a cache hit). The Text box tool uses them to predict whether an
// edit keeps the document's own face (spec 2.3).
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Font id (PDF.js loadedName, the `fontName` of text items) → BaseFont name. */
export type PageFontNames = ReadonlyMap<string, string>

interface FontObject {
  readonly name?: unknown
}

export async function loadPageFontNames(
  proxy: PDFDocumentProxy,
  pageIndex: number,
  fontIds: Iterable<string>,
): Promise<PageFontNames> {
  const names = new Map<string, string>()
  try {
    const page = await proxy.getPage(pageIndex + 1)
    await page.getOperatorList()
    for (const id of fontIds) {
      if (!page.commonObjs.has(id)) continue
      const font = page.commonObjs.get(id) as FontObject | null
      if (font && typeof font.name === 'string') names.set(id, font.name)
    }
  } catch {
    // unknown names only weaken the prediction; the save decides for itself
  }
  return names
}

/** PC text-edit.ts STANDARD_LATIN_FONTS: the base-14 Latin faces a viewer always has. */
const STANDARD_LATIN_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
])

const WIN_ANSI_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

/** PC text-edit.ts winAnsiCovers. */
export function winAnsiCovers(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) continue
    if (!WIN_ANSI_HIGH.includes(ch)) return false
  }
  return true
}

/**
 * PC keptStandardFont, from the renderer side: a base-14 face drawn without a font
 * program keeps drawing WinAnsi text. An embedded subset always carries the six-letter
 * tag ("ABCDEF+"), so an untagged standard name is the unembedded face.
 */
export function keepsStandardFace(fontName: string | undefined, newText: string): boolean {
  if (!fontName || /^[A-Z]{6}\+/.test(fontName)) return false
  return STANDARD_LATIN_FONTS.has(fontName) && winAnsiCovers(newText.replace(/\n/g, ''))
}
