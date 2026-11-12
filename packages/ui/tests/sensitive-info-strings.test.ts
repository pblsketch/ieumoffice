import { describe, expect, it } from 'vitest'
import { LANGS, type Lang } from '@genoffice/i18n'
import { HIDING_MEMO_PREFIXES } from '@genoffice/agent-core/hiding-memo'
import {
  SENSITIVE_INFO_STRINGS,
  sensitiveFeatureName,
  sensitiveInfoText,
  type SensitiveInfoStringKey,
} from '../src/strings-sensitive-info'

const KEYS = Object.keys(SENSITIVE_INFO_STRINGS.zh) as SensitiveInfoStringKey[]
const NON_LATIN: readonly Lang[] = ['zh', 'ja', 'ko', 'th', 'ru', 'ar', 'he', 'hi', 'zh-TW']

/** the placeholders each string carries; every language must keep the same ones */
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('SENSITIVE_INFO_STRINGS', () => {
  it('has every key, non-empty, in every UI language', () => {
    expect(Object.keys(SENSITIVE_INFO_STRINGS).sort()).toEqual([...LANGS].sort())
    for (const lang of LANGS) {
      const dict = SENSITIVE_INFO_STRINGS[lang] as Record<string, string>
      expect(Object.keys(dict).sort(), lang).toEqual([...KEYS].sort())
      for (const key of KEYS) expect(dict[key]?.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
    }
  })

  it('keeps the same placeholders in every language', () => {
    for (const key of KEYS) {
      const want = placeholders(SENSITIVE_INFO_STRINGS.en[key])
      for (const lang of LANGS) {
        expect(placeholders(SENSITIVE_INFO_STRINGS[lang][key]), `${lang}.${key}`).toEqual(want)
      }
    }
  })

  it('is translated, not copied from English, in non-Latin-script languages', () => {
    for (const lang of NON_LATIN) {
      for (const key of KEYS) {
        expect(SENSITIVE_INFO_STRINGS[lang][key], `${lang}.${key}`).not.toBe(
          SENSITIVE_INFO_STRINGS.en[key],
        )
      }
    }
  })

  it('names the feature with the hiding memo prefix of each language', () => {
    for (const lang of LANGS) {
      const prefixes = HIDING_MEMO_PREFIXES[lang]
      expect(sensitiveFeatureName(lang), lang).toBe(prefixes[prefixes.length - 1])
    }
    expect(sensitiveFeatureName('ko')).toBe('민감정보 가리기')
    expect(sensitiveFeatureName('en')).toBe('Hide sensitive info')
  })

  it('says the spec sentences in Korean', () => {
    expect(sensitiveInfoText('ko', 'featureDesc')).toBe(
      '고른 부분은 AI에게 보내지 않습니다. 파일에는 그대로 남습니다.',
    )
    expect(sensitiveInfoText('ko', 'findButton')).toBe('민감정보 찾기')
    expect(sensitiveInfoText('ko', 'unhideable')).toBe('이 자리는 가릴 수 없음')
    expect(sensitiveInfoText('ko', 'unhideableBecause', { reason: '메모와 겹침' })).toBe(
      '이 자리는 가릴 수 없음(메모와 겹침)',
    )
    expect(sensitiveInfoText('ko', 'alertCountsAttachments', { doc: 3, att: 2 })).toBe(
      '민감정보로 보이는 것: 이 문서 3개, 첨부 2개',
    )
    expect(sensitiveInfoText('ko', 'alertReview')).toBe('확인하기')
    expect(sensitiveInfoText('ko', 'alertSend')).toBe('그냥 보내기')
    expect(sensitiveInfoText('ko', 'alertBodyLocal')).toContain('이 PC 안의 AI')
    expect(sensitiveInfoText('ko', 'memoNote', { n: 4 })).toBe(
      '메모 4개가 생기고, 문서를 받는 사람에게도 보입니다.',
    )
  })

  it('never says the AI does the hiding or the finding', () => {
    for (const lang of ['ko', 'en'] as const) {
      for (const key of KEYS) {
        const text = SENSITIVE_INFO_STRINGS[lang][key]
        expect(text, `${lang}.${key}`).not.toMatch(/AI 가림|AI가 가|AI hides|AI finds|AI가 찾/)
      }
    }
  })
})
