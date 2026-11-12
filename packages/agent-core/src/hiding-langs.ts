/**
 * The screen languages a hiding mark is written in.
 *
 * Hiding marks (a word processor memo's prefix, the label stored when the
 * reader leaves it empty, a candidate's kind name) are written in the screen
 * language at the moment they are made, and read back in any language. So
 * every table keyed by language here must cover every screen language.
 *
 * The codes are listed here rather than imported from `@genoffice/i18n`: this
 * package takes no dependencies. A test compares the list with i18n `LANGS`,
 * so a language added there and not here fails a test instead of falling back
 * to English unseen.
 *
 * A file with no imports, exported as `@genoffice/agent-core/hiding-langs`.
 */

export const HIDING_LANGS = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'cs',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
  'vi',
  'tr',
] as const

export type HidingLang = (typeof HIDING_LANGS)[number]

/** The language a table is read in: the one given, or English when the table does not know it. */
export function hidingLangOf(lang: string): HidingLang {
  return (HIDING_LANGS as readonly string[]).includes(lang) ? (lang as HidingLang) : 'en'
}

/**
 * The label stored when the reader leaves it empty: "sensitive info" in the
 * screen language. Reading an empty stored label falls back to the shared
 * `private` instead (`placeholderSource`), so this is only ever written.
 */
export const SENSITIVE_INFO_WORD: Readonly<Record<HidingLang, string>> = {
  zh: '敏感信息',
  en: 'Sensitive info',
  ja: '機密情報',
  ko: '민감정보',
  fr: 'Informations sensibles',
  de: 'Sensible Daten',
  es: 'Información sensible',
  th: 'ข้อมูลอ่อนไหว',
  id: 'Informasi sensitif',
  ru: 'Конфиденциальные данные',
  ar: 'معلومات حساسة',
  pt: 'Informações sensíveis',
  it: 'Informazioni sensibili',
  pl: 'Dane wrażliwe',
  cs: 'Citlivé údaje',
  nl: 'Gevoelige gegevens',
  ms: 'Maklumat sensitif',
  he: 'מידע רגיש',
  hi: 'संवेदनशील जानकारी',
  'zh-TW': '敏感資訊',
  vi: 'Thông tin nhạy cảm',
  tr: 'Hassas bilgi',
}
