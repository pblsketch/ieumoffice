// Bundled UI font contract: folder contents, OFL license, URL allowlist, and
// tokens.css wiring (kept separate from template-fonts and document fonts).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  UI_FONTS,
  UI_FONTS_MAX_BYTES,
  UI_FONTS_README,
  UI_FONT_FAMILY,
  UI_FONT_FILES,
  UI_FONT_HANGUL_FAMILY,
  uiFontFileOf,
  uiFontUrl,
} from '../src/ui-fonts'

const FOLDER = resolve(import.meta.dirname, '../ui-fonts')
const TOKENS_CSS = resolve(import.meta.dirname, '../src/tokens.css')

describe('ui-fonts folder', () => {
  it('holds every listed font file as a valid WOFF2 binary', () => {
    for (const file of UI_FONT_FILES) {
      const full = join(FOLDER, file)
      expect(statSync(full).isFile(), file).toBe(true)
      const head = readFileSync(full).subarray(0, 4).toString('ascii')
      expect(head, file).toBe('wOF2')
    }
  })

  it('ships an OFL 1.1 license text for every entry', () => {
    for (const entry of UI_FONTS) {
      expect(entry.license).toBe('OFL-1.1')
      const text = readFileSync(join(FOLDER, entry.licenseFile), 'utf8')
      expect(text, entry.licenseFile).toContain('SIL OPEN FONT LICENSE Version 1.1')
    }
  })

  it('holds only the font files, their license texts, and the readme', () => {
    const expected = new Set([
      ...UI_FONT_FILES,
      ...UI_FONTS.map((f) => f.licenseFile),
      UI_FONTS_README,
    ])
    expect(new Set(readdirSync(FOLDER))).toEqual(expected)
  })

  it('has a readme naming every font file, license, distributor, and version', () => {
    const readme = readFileSync(join(FOLDER, UI_FONTS_README), 'utf8')
    for (const entry of UI_FONTS) {
      expect(readme).toContain(entry.file)
      expect(readme).toContain(entry.family)
      expect(readme).toContain(entry.licenseFile)
      expect(readme).toContain(entry.licenseUrl)
      expect(readme).toContain(entry.distributorUrl)
      expect(readme).toContain(entry.version)
    }
  })

  it('stays within the size budget', () => {
    const total = UI_FONT_FILES.reduce((sum, file) => sum + statSync(join(FOLDER, file)).size, 0)
    expect(total).toBeLessThanOrEqual(UI_FONTS_MAX_BYTES)
  })
})

describe('ui-fonts URL allowlist', () => {
  it('round-trips every listed file', () => {
    for (const file of UI_FONT_FILES) {
      expect(uiFontFileOf(uiFontUrl(file))).toBe(file)
    }
  })

  it('refuses unlisted files, traversal paths, and other hosts or schemes', () => {
    for (const url of [
      uiFontUrl('README.md'),
      uiFontUrl('Pretendard-OFL.txt'),
      uiFontUrl('../../package.json'),
      'genoffice-app://ui-fonts/..%2F..%2Fpackage.json',
      'genoffice-app://ui-fonts/%E0%A4%A',
      'genoffice-app://docs/PretendardVariable.woff2',
      'genoffice-docx-media://ui-fonts/PretendardVariable.woff2',
      'not a url',
    ]) {
      expect(uiFontFileOf(url), url).toBeNull()
    }
  })
})

describe('tokens.css UI Pretendard wiring', () => {
  it('declares UI-only @font-face families and scopes full Pretendard to Korean UI', () => {
    const css = readFileSync(TOKENS_CSS, 'utf8')
    const url = uiFontUrl('PretendardVariable.woff2')
    expect(css).toContain(`font-family: '${UI_FONT_FAMILY}'`)
    expect(css).toContain(`font-family: '${UI_FONT_HANGUL_FAMILY}'`)
    expect(css).toContain(`url('${url}')`)
    // never collides with document font family name 'Pretendard'
    expect(css).not.toMatch(/@font-face\s*\{[^}]*font-family:\s*'Pretendard'/i)

    const koBlock = css.match(/:root:lang\(ko\)\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(koBlock).toContain(`'${UI_FONT_FAMILY}'`)
    expect(css).toContain(':root:lang(ko) body')
  })
})
