import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { MOBILE_DICTS, translateMobile, type MobileStringKey } from '../src/renderer/i18n'
import { MOBILE_KOREAN_FONTS, MOBILE_KOREAN_FONT_FAMILIES } from '../src/renderer/assets/fonts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FONTS_DIR = resolve(HERE, '../src/renderer/assets/fonts')

describe('mobile i18n completeness and branding', () => {
  it('covers every language in LANGS with non-empty values for all zh keys', () => {
    expect(Object.keys(MOBILE_DICTS).sort()).toEqual([...LANGS].sort())
    const expectedKeys = Object.keys(MOBILE_DICTS.zh) as MobileStringKey[]
    expect(expectedKeys.length).toBeGreaterThan(40)

    for (const lang of LANGS) {
      const dict = MOBILE_DICTS[lang]
      expect(Object.keys(dict).sort()).toEqual([...expectedKeys].sort())
      for (const key of expectedKeys) {
        expect(dict[key].trim().length, `${lang}.${key} should be non-empty`).toBeGreaterThan(0)
      }
    }
  })

  it('applies brandText substitution for product names across languages', () => {
    expect(translateMobile('ko', 'appTitle')).toBe('이음오피스')
    expect(translateMobile('en', 'appTitle')).toBe('IeumOffice')
    expect(translateMobile('ko', 'aiSharingDeclinedDesc')).toContain('이음오피스')
    expect(translateMobile('en', 'aiSharingDeclinedDesc')).toContain('IeumOffice')
  })
})

describe('mobile bundled OFL-1.1 Korean fonts', () => {
  it('ships all declared OFL-1.1 woff2 assets and license file', () => {
    expect(MOBILE_KOREAN_FONTS.length).toBeGreaterThanOrEqual(4)
    expect(existsSync(resolve(FONTS_DIR, 'LICENSE-OFL.txt'))).toBe(true)
    expect(existsSync(resolve(FONTS_DIR, 'fonts.css'))).toBe(true)
    for (const font of MOBILE_KOREAN_FONTS) {
      expect(font.license).toBe('OFL-1.1')
      expect(existsSync(resolve(FONTS_DIR, font.file)), `missing ${font.file}`).toBe(true)
    }
    expect(MOBILE_KOREAN_FONT_FAMILIES).toContain('함초롬바탕')
    expect(MOBILE_KOREAN_FONT_FAMILIES).toContain('맑은 고딕')
  })

  it('bundles Pretendard UI woff2 weights and OFL-1.1 notice with device fallback and doc isolation', () => {
    expect(existsSync(resolve(FONTS_DIR, 'Pretendard-Regular.woff2'))).toBe(true)
    expect(existsSync(resolve(FONTS_DIR, 'Pretendard-Bold.woff2'))).toBe(true)
    expect(existsSync(resolve(FONTS_DIR, 'Pretendard-OFL.txt'))).toBe(true)
    expect(existsSync(resolve(FONTS_DIR, 'ui-font.css'))).toBe(true)

    const uiFontCss = readFileSync(resolve(FONTS_DIR, 'ui-font.css'), 'utf8')
    expect(uiFontCss).toContain("font-family: 'Pretendard';")
    expect(uiFontCss).toContain('Pretendard-Regular.woff2')
    expect(uiFontCss).toContain('Pretendard-Bold.woff2')

    const tokensCss = readFileSync(
      resolve(HERE, '../src/renderer/styles/mobile-tokens.css'),
      'utf8',
    )
    expect(tokensCss).toContain("@import '../assets/fonts/ui-font.css';")
    expect(tokensCss).toContain("--m-font-ui: 'Pretendard', var(--gs-font-sans);")
    for (const lang of ['ja', 'zh', 'zh-TW', 'th', 'ar', 'he', 'hi']) {
      expect(tokensCss).toContain(`:root:lang(${lang})`)
    }
    // Markdown/plain-text document bodies stay on --gs-font-sans rather than inheriting Pretendard.
    expect(tokensCss).toMatch(
      /\.mobile-markdown-preview\s*\{[^}]*font-family:\s*var\(--gs-font-sans\);/,
    )
    expect(tokensCss).toMatch(
      /\.mobile-plain-text-view\s*\{[^}]*font-family:\s*var\(--gs-font-sans\);/,
    )
    expect(tokensCss).toMatch(
      /\.mobile-markdown-textarea\s*\{[^}]*font-family:\s*var\(--gs-font-sans\);/,
    )
  })
})
