/**
 * Bundled UI font files shared by every window and editor chrome (separate from
 * packages/ui/template-fonts/, which belongs to document design templates and
 * document font pickers).
 *
 * The files live in packages/ui/ui-fonts/ (outside src/, so no editor build
 * imports them as an asset) and ship once in the installer as resources/ui-fonts
 * (apps/shell/electron-builder.cjs). Main-process protocol handlers serve listed
 * files only under `genoffice-app://ui-fonts/<file>`.
 *
 * Plain data and string helpers with no imports: renderer and main-process code
 * both read it.
 */

export const UI_FONT_SCHEME = 'genoffice-app'
export const UI_FONT_HOST = 'ui-fonts'
export const UI_FONTS_README = 'README.md'

export const UI_FONT_FAMILY = 'UI Pretendard'
export const UI_FONT_HANGUL_FAMILY = 'UI Pretendard Hangul'

export interface UiFontEntry {
  readonly file: string
  readonly family: string
  readonly license: 'OFL-1.1'
  readonly licenseFile: string
  readonly licenseUrl: string
  readonly distributorUrl: string
  readonly sourceUrl: string
  readonly version: string
  readonly downloaded: string
}

export const UI_FONTS: readonly UiFontEntry[] = [
  {
    file: 'PretendardVariable.woff2',
    family: 'Pretendard Variable',
    license: 'OFL-1.1',
    licenseFile: 'Pretendard-OFL.txt',
    licenseUrl:
      'https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/dist/LICENSE.txt',
    distributorUrl: 'https://github.com/orioncactus/pretendard',
    sourceUrl:
      'https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
    version: '1.309',
    downloaded: '2026-11-25',
  },
]

export const UI_FONT_FILES: readonly string[] = UI_FONTS.map((f) => f.file)

export const UI_FONTS_MAX_BYTES = 4 * 1024 * 1024

/** The URL a renderer loads a bundled UI font file from. */
export function uiFontUrl(file: string): string {
  return `${UI_FONT_SCHEME}://${UI_FONT_HOST}/${encodeURIComponent(file)}`
}

/** The listed UI font file a URL names, or null for any other URL. */
export function uiFontFileOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${UI_FONT_SCHEME}:` || parsed.hostname !== UI_FONT_HOST) {
    return null
  }
  let name: string
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return UI_FONT_FILES.includes(name) ? name : null
}
