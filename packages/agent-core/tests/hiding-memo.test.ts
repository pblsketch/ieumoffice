import { describe, expect, it } from 'vitest'
import { LANGS } from '../../i18n/src/index'
import { HIDING_LANGS, SENSITIVE_INFO_WORD, hidingLangOf } from '../src/hiding-langs'
import {
  HIDING_MEMO_PREFIXES,
  buildHidingMemoText,
  hidingMemoPrefix,
  isHidingMemoText,
  readHidingMemoLabel,
  relabelHidingMemoText,
} from '../src/hiding-memo'
import { MAX_LABEL_LENGTH } from '../src/redact-core'

/**
 * The memo text is a file contract: a hiding memo written by one build, or
 * typed by hand in another word processor, must be recognised by every later
 * build. So every prefix that ever shipped is pinned here, word for word. A
 * test that fails because a prefix changed is the point — add a new one at
 * the end of that language's list instead, and keep the old one.
 */
const SHIPPED_PREFIXES: Record<string, readonly string[]> = {
  zh: ['隐藏敏感信息'],
  en: ['Hide sensitive info'],
  ja: ['機密情報を隠す'],
  ko: ['민감정보 가리기'],
  fr: ['Masquer les informations sensibles'],
  de: ['Sensible Daten ausblenden'],
  es: ['Ocultar información sensible'],
  th: ['ซ่อนข้อมูลอ่อนไหว'],
  id: ['Sembunyikan informasi sensitif'],
  ru: ['Скрыть конфиденциальные данные'],
  ar: ['إخفاء المعلومات الحساسة'],
  pt: ['Ocultar informações sensíveis'],
  it: ['Nascondi informazioni sensibili'],
  pl: ['Ukryj dane wrażliwe'],
  cs: ['Skrýt citlivé údaje'],
  nl: ['Gevoelige gegevens verbergen'],
  ms: ['Sembunyikan maklumat sensitif'],
  he: ['הסתרת מידע רגיש'],
  hi: ['संवेदनशील जानकारी छिपाएँ'],
  'zh-TW': ['隱藏敏感資訊'],
  vi: ['Ẩn thông tin nhạy cảm'],
  tr: ['Hassas bilgileri gizle'],
}

describe('the languages a hiding mark knows', () => {
  it('are exactly the screen languages', () => {
    expect([...HIDING_LANGS].sort()).toEqual([...LANGS].sort())
  })

  it('fall back to English for a language the table does not know yet', () => {
    expect(hidingLangOf('ko')).toBe('ko')
    expect(hidingLangOf('zh-TW')).toBe('zh-TW')
    expect(hidingLangOf('xx')).toBe('en')
  })

  it('each have a word for an empty label that survives label cleaning', () => {
    expect(SENSITIVE_INFO_WORD.ko).toBe('민감정보')
    for (const lang of HIDING_LANGS) {
      const word = SENSITIVE_INFO_WORD[lang]
      expect(word.length).toBeGreaterThan(0)
      expect(word.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH)
      expect(word).not.toMatch(/[{}<>="'*/[\]]/)
    }
  })
})

describe('the memo prefix table', () => {
  it('still holds every prefix that shipped, in its place', () => {
    for (const [lang, shipped] of Object.entries(SHIPPED_PREFIXES)) {
      const now = HIDING_MEMO_PREFIXES[lang as keyof typeof HIDING_MEMO_PREFIXES]
      expect(now, lang).toBeDefined()
      // append-only: what shipped is a prefix of what is there now
      expect(now.slice(0, shipped.length), lang).toEqual(shipped)
    }
  })

  it('has a prefix for every screen language and no other', () => {
    expect(Object.keys(HIDING_MEMO_PREFIXES).sort()).toEqual([...LANGS].sort())
    expect(Object.keys(SHIPPED_PREFIXES).sort()).toEqual([...LANGS].sort())
  })

  it('writes Korean exactly as the spec says', () => {
    expect(hidingMemoPrefix('ko')).toBe('민감정보 가리기')
    expect(buildHidingMemoText('학생 이름', 'ko')).toBe('[민감정보 가리기] 학생 이름')
  })

  it('writes with the newest prefix of the language', () => {
    for (const lang of HIDING_LANGS) {
      const list = HIDING_MEMO_PREFIXES[lang]
      expect(hidingMemoPrefix(lang)).toBe(list[list.length - 1])
    }
  })

  it('has no prefix a bracket or label rule could break', () => {
    for (const lang of HIDING_LANGS) {
      for (const prefix of HIDING_MEMO_PREFIXES[lang]) {
        expect(prefix).toBe(prefix.trim())
        expect(prefix).not.toMatch(/[[\]]/)
      }
    }
  })
})

describe('building a hiding memo', () => {
  it('cleans the label', () => {
    expect(buildHidingMemoText('  학생   {이름}  ', 'ko')).toBe('[민감정보 가리기] 학생 이름')
  })

  it('stores the language word for "sensitive info" when the label is empty', () => {
    expect(buildHidingMemoText('   ', 'ko')).toBe('[민감정보 가리기] 민감정보')
    expect(buildHidingMemoText('', 'en')).toBe('[Hide sensitive info] Sensitive info')
  })

  it('uses English for an unknown language', () => {
    expect(buildHidingMemoText('x', 'xx')).toBe('[Hide sensitive info] x')
  })

  it('caps the label at the shared limit', () => {
    const text = buildHidingMemoText('가'.repeat(MAX_LABEL_LENGTH + 5), 'ko')
    expect(readHidingMemoLabel(text)).toHaveLength(MAX_LABEL_LENGTH)
  })
})

describe('recognising a hiding memo', () => {
  it('reads back what every language writes, whatever the current language', () => {
    for (const lang of HIDING_LANGS) {
      const text = buildHidingMemoText('label one', lang)
      expect(isHidingMemoText(text), lang).toBe(true)
      expect(readHidingMemoLabel(text), lang).toBe('label one')
    }
  })

  it('recognises every prefix in the table, old ones included', () => {
    for (const lang of HIDING_LANGS) {
      for (const prefix of HIDING_MEMO_PREFIXES[lang]) {
        expect(readHidingMemoLabel(`[${prefix}] a`), `${lang} ${prefix}`).toBe('a')
      }
    }
  })

  it('ignores spaces around the memo and inside the label', () => {
    expect(readHidingMemoLabel('  \n [민감정보 가리기]   학생   이름 \n')).toBe('학생 이름')
    expect(readHidingMemoLabel('[민감정보 가리기]학생')).toBe('학생')
    expect(readHidingMemoLabel('[민감정보 가리기]\n학생 이름')).toBe('학생 이름')
  })

  it('takes a prefix typed by hand with different spacing', () => {
    expect(readHidingMemoLabel('[민감정보가리기] 학생')).toBe('학생')
    expect(readHidingMemoLabel('[ 민감정보  가리기 ] 학생')).toBe('학생')
    expect(readHidingMemoLabel('[Hide  sensitive info] x')).toBe('x')
  })

  it('does not care about the case of a Latin prefix', () => {
    expect(readHidingMemoLabel('[HIDE SENSITIVE INFO] x')).toBe('x')
    expect(readHidingMemoLabel('[hide sensitive info] x')).toBe('x')
    expect(readHidingMemoLabel('[sensible daten AUSBLENDEN] x')).toBe('x')
    expect(readHidingMemoLabel('[HASSAS BİLGİLERİ GİZLE] x')).toBe('x')
    expect(readHidingMemoLabel('[Скрыть КОНФИДЕНЦИАЛЬНЫЕ данные] x')).toBe('x')
  })

  it('takes Hangul a Mac wrote decomposed', () => {
    expect(readHidingMemoLabel('[민감정보 가리기] 이름'.normalize('NFD'))).toBe('이름')
  })

  it('reads an empty label as the shared default', () => {
    expect(readHidingMemoLabel('[민감정보 가리기]')).toBe('private')
    expect(readHidingMemoLabel('[민감정보 가리기]   ')).toBe('private')
    expect(readHidingMemoLabel('[민감정보 가리기] {}')).toBe('private')
  })

  it('needs the prefix at the very start, in ASCII brackets', () => {
    expect(isHidingMemoText('메모 [민감정보 가리기] 이름')).toBe(false)
    expect(isHidingMemoText('［민감정보 가리기］ 이름')).toBe(false)
    expect(isHidingMemoText('(민감정보 가리기) 이름')).toBe(false)
    expect(isHidingMemoText('민감정보 가리기 이름')).toBe(false)
    expect(isHidingMemoText('[민감정보 가리기 이름')).toBe(false)
  })

  it('leaves an ordinary memo alone', () => {
    expect(isHidingMemoText('검토 필요')).toBe(false)
    expect(isHidingMemoText('[검토] 내일까지')).toBe(false)
    expect(isHidingMemoText('[민감정보] 이름')).toBe(false)
    expect(isHidingMemoText('')).toBe(false)
    expect(readHidingMemoLabel('[검토] 내일까지')).toBeNull()
  })
})

describe('renaming a hiding memo', () => {
  it('keeps the prefix the memo already has and changes the label', () => {
    expect(relabelHidingMemoText('[Hide sensitive info] old', '새 이름', 'ko')).toBe(
      '[Hide sensitive info] 새 이름',
    )
    expect(relabelHidingMemoText(' [민감정보가리기] 옛', '새', 'ko')).toBe('[민감정보가리기] 새')
  })

  it('stores the language word when the new label is empty', () => {
    expect(relabelHidingMemoText('[민감정보 가리기] 옛', '  ', 'ko')).toBe(
      '[민감정보 가리기] 민감정보',
    )
  })

  it('refuses an ordinary memo', () => {
    expect(relabelHidingMemoText('검토 필요', '새', 'ko')).toBeNull()
  })
})
