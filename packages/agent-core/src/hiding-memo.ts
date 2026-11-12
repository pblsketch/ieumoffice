/**
 * The word processor (HWP, HWPX) hiding mark: one memo per hidden span, whose
 * plain text is `[<prefix>] <label>`.
 *
 * ## A file contract
 *
 * The memo is saved in the document, so a memo written by this build, by an
 * older one, or typed by hand in another word processor must keep being
 * recognised. The prefix is "hide sensitive info" in the screen language at
 * the moment the memo is made, and recognition accepts the prefix of every
 * language whatever the current one is.
 *
 * `HIDING_MEMO_PREFIXES` is therefore append-only. A shipped prefix is never
 * changed or removed. To change the wording of a language, add the new
 * prefix at the end of that language's list: the last entry is the one new
 * memos are written with, and every entry stays recognised. A test pins every
 * shipped prefix.
 *
 * ## Matching
 *
 * Spaces around the memo are ignored, the prefix sits at the very start in
 * ASCII square brackets, and what follows the closing bracket is the label.
 * Spacing inside the brackets and the case of Latin (and other cased) letters
 * do not matter, so a prefix typed by hand still counts. Reading more memos
 * as hiding marks than intended only hides more; reading fewer would send a
 * hidden span to the model.
 *
 * Renderer-safe, exported as `@genoffice/agent-core/hiding-memo`.
 */

import { HIDING_LANGS, SENSITIVE_INFO_WORD, hidingLangOf, type HidingLang } from './hiding-langs'
import { sanitizeLabel } from './redact-core'

/** Append-only: add new wording at the end of a language's list, never edit or remove. */
export const HIDING_MEMO_PREFIXES: Readonly<Record<HidingLang, readonly string[]>> = {
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

/** What an empty stored label reads as: the shared default of `placeholderSource`. */
const READ_DEFAULT_LABEL = 'private'

/**
 * The form a prefix is compared in: composed, compatibility-folded, lower
 * case, with no spaces. Turkish dotted and dotless i fold to a plain `i` so
 * that upper-casing by hand in either convention still matches.
 */
function foldPrefix(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, '')
}

const KNOWN_PREFIXES: ReadonlySet<string> = new Set(
  HIDING_LANGS.flatMap((lang) => HIDING_MEMO_PREFIXES[lang].map(foldPrefix)),
)

/** The prefix a new hiding memo is written with in this screen language. */
export function hidingMemoPrefix(lang: string): string {
  const list = HIDING_MEMO_PREFIXES[hidingLangOf(lang)]
  return list[list.length - 1]
}

function labelToStore(label: string, lang: string): string {
  return sanitizeLabel(label) || SENSITIVE_INFO_WORD[hidingLangOf(lang)]
}

/** The memo text of a new hiding mark: `[<prefix>] <label>`. */
export function buildHidingMemoText(label: string, lang: string): string {
  return `[${hidingMemoPrefix(lang)}] ${labelToStore(label, lang)}`
}

interface ParsedMemo {
  /** the bracketed prefix exactly as the memo has it, brackets included */
  head: string
  /** everything after the closing bracket */
  rest: string
}

function parseMemo(text: string): ParsedMemo | null {
  const t = text.normalize('NFC').trim()
  if (!t.startsWith('[')) return null
  const close = t.indexOf(']')
  if (close < 0) return null
  if (!KNOWN_PREFIXES.has(foldPrefix(t.slice(1, close)))) return null
  return { head: t.slice(0, close + 1), rest: t.slice(close + 1) }
}

/** True when a memo's plain text is a hiding mark. */
export function isHidingMemoText(text: string): boolean {
  return parseMemo(text) !== null
}

/**
 * The label a hiding memo stands for, or null when the memo is an ordinary
 * one. An empty label reads as the shared default.
 */
export function readHidingMemoLabel(text: string): string | null {
  const parsed = parseMemo(text)
  if (!parsed) return null
  return sanitizeLabel(parsed.rest) || READ_DEFAULT_LABEL
}

/**
 * A hiding memo's text with a new label, keeping the prefix the memo already
 * has (it may be another language's). Null when the memo is an ordinary one:
 * an ordinary memo is never turned into a hiding mark by renaming.
 */
export function relabelHidingMemoText(text: string, label: string, lang: string): string | null {
  const parsed = parseMemo(text)
  if (!parsed) return null
  return `${parsed.head} ${labelToStore(label, lang)}`
}
