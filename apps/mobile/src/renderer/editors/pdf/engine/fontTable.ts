/**
 * Where the app's bundled Korean fonts go in the virtual file table (spec 2.1,
 * 2.3). The PC save code keeps its edit-font ids; on the phone each id means
 * an app font, placed at the first regular-weight path the PC code tries for
 * that id (text-edit.ts EDIT_FONT_PATHS). Bold and italic paths stay empty,
 * so the PC code takes its own "no bold file" branch. Sans also sits at the
 * first FALLBACK_FONT_PATHS entry, and all three form the only "installed"
 * fonts font-metrics can find (findSystemFont, findFontCovering).
 *
 * Plain data with no imports: the parity test's PC reference run reads it too.
 */

export type BundledFontAsset = 'font:sans' | 'font:serif' | 'font:gothic'

export interface BundledFont {
  asset: BundledFontAsset
  /** The woff2 file in apps/mobile/src/renderer/assets/fonts */
  woff2: string
  /** Name of the decoded sfnt in the font folder font-metrics scans */
  sfntName: string
  /** Edit-font id of the PC code this font stands for, if any */
  editFontId: 'arial' | 'times' | 'courier'
  /** Paths the PC code reads by name that hold this font */
  paths: readonly string[]
}

/** text-edit.ts FALLBACK_FONT_PATHS[0] */
export const FALLBACK_FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

/** Font folder font-metrics scans on the phone: under its first Linux folder */
export const BUNDLED_FONT_DIR = '/usr/share/fonts/ieum'

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    asset: 'font:sans',
    woff2: 'GenOfficeSansKR-Regular-subset.woff2',
    sfntName: 'GenOfficeSansKR-Regular.ttf',
    editFontId: 'arial',
    paths: ['/System/Library/Fonts/Supplemental/Arial.ttf', FALLBACK_FONT_PATH],
  },
  {
    asset: 'font:serif',
    woff2: 'GenOfficeSerifKR-Regular-subset.woff2',
    sfntName: 'GenOfficeSerifKR-Regular.ttf',
    editFontId: 'times',
    paths: ['/System/Library/Fonts/Supplemental/Times New Roman.ttf'],
  },
  {
    asset: 'font:gothic',
    woff2: 'GenOfficeGothicKR-Regular-subset.woff2',
    sfntName: 'GenOfficeGothicKR-Regular.ttf',
    editFontId: 'courier',
    paths: ['/System/Library/Fonts/Supplemental/Courier New.ttf'],
  },
]
