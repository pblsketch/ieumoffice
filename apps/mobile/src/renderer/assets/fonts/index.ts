import './fonts.css'

export interface MobileKoreanFontEntry {
  readonly family: string
  readonly file: string
  readonly license: 'OFL-1.1'
  readonly aliases: readonly string[]
}

export const MOBILE_KOREAN_FONTS: readonly MobileKoreanFontEntry[] = [
  {
    family: 'GenOffice Serif KR',
    file: 'GenOfficeSerifKR-Regular-subset.woff2',
    license: 'OFL-1.1',
    aliases: ['함초롬바탕', 'HCR Batang', '바탕', 'Batang', '나눔명조'],
  },
  {
    family: 'GenOffice Sans KR',
    file: 'GenOfficeSansKR-Regular-subset.woff2',
    license: 'OFL-1.1',
    aliases: ['함초롬돋움', 'HCR Dotum', '맑은 고딕', 'Malgun Gothic'],
  },
  {
    family: 'GenOffice Gothic KR',
    file: 'GenOfficeGothicKR-Regular-subset.woff2',
    license: 'OFL-1.1',
    aliases: ['나눔고딕', 'NanumGothic'],
  },
  {
    family: 'GenOffice Che Latin KR',
    file: 'GenOfficeCheLatinKR.woff2',
    license: 'OFL-1.1',
    aliases: [],
  },
] as const

export const MOBILE_KOREAN_FONT_FAMILIES: readonly string[] = MOBILE_KOREAN_FONTS.flatMap(
  (entry) => [entry.family, ...entry.aliases],
)

/** Ensures bundled Korean @font-face declarations are loaded before HWP Canvas2D layout. */
export async function registerMobileKoreanFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const loads = MOBILE_KOREAN_FONTS.map((entry) =>
    document.fonts.load(`16px "${entry.family}"`).catch(() => []),
  )
  await Promise.all(loads)
}
