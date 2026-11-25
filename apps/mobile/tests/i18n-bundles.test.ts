import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { MOBILE_DICTS, translateMobile } from '../src/renderer/i18n'
import { zh as baseZh } from '../src/renderer/i18n/zh'
import { aiStrings } from '../src/renderer/i18n/ai'
import { homeStrings } from '../src/renderer/i18n/home'
import { pdfStrings } from '../src/renderer/i18n/pdf'
import { pdfToolsStrings } from '../src/renderer/i18n/pdfTools'
import { readersStrings } from '../src/renderer/i18n/readers'
import { sheetsStrings } from '../src/renderer/i18n/sheets'
import { webStrings } from '../src/renderer/i18n/web'

const BUNDLES: Record<string, Record<string, Record<string, string>>> = {
  sheets: sheetsStrings,
  pdf: pdfStrings,
  pdfTools: pdfToolsStrings,
  web: webStrings,
  readers: readersStrings,
  home: homeStrings,
  ai: aiStrings,
}

describe('mobile per-track string bundles', () => {
  it('never defines the same key in two sources (base dictionary and the seven bundles)', () => {
    const sources: [string, Record<string, string>][] = [
      ['base', baseZh],
      ...Object.entries(BUNDLES).map(([name, bundle]): [string, Record<string, string>] => [
        name,
        bundle.zh,
      ]),
    ]
    const owner = new Map<string, string>()
    const clashes: string[] = []
    for (const [source, dict] of sources) {
      for (const key of Object.keys(dict)) {
        const first = owner.get(key)
        if (first) clashes.push(`${key} is defined in both ${first} and ${source}`)
        else owner.set(key, source)
      }
    }
    expect(clashes).toEqual([])
  })

  it('gives every bundle all UI languages with the zh key set', () => {
    for (const [name, bundle] of Object.entries(BUNDLES)) {
      expect(Object.keys(bundle).sort(), `${name} languages`).toEqual([...LANGS].sort())
      const keys = Object.keys(bundle.zh).sort()
      for (const lang of LANGS) {
        expect(Object.keys(bundle[lang]).sort(), `${name}.${lang} keys`).toEqual(keys)
      }
    }
  })

  it('carries the format-not-openable notice in every language', () => {
    expect(translateMobile('ko', 'formatNotOpenable')).toBe('이 파일 형식은 열 수 없습니다.')
    for (const lang of LANGS) {
      const text = MOBILE_DICTS[lang].formatNotOpenable
      expect(text.trim().length, `${lang}.formatNotOpenable`).toBeGreaterThan(0)
    }
  })
})
