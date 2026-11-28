/**
 * Keyboard shortcut letter resolution that works across Latin layouts (QWERTY,
 * Dvorak, AZERTY, Colemak) and non-Latin layouts / IMEs (Korean, Japanese,
 * Cyrillic, Greek, Hebrew, Arabic).
 */

export interface ShortcutLetterEvent {
  key: string
  code?: string | undefined
  altKey?: boolean | undefined
  isComposing?: boolean | undefined
}

/** Standard 2-beolsik Hangul Jamo to physical QWERTY letter fallback when `code` is absent. */
const HANGUL_JAMO_TO_LATIN: Readonly<Record<string, string>> = {
  ㅂ: 'q',
  ㅃ: 'q',
  ㅈ: 'w',
  ㅉ: 'w',
  ㄷ: 'e',
  ㄸ: 'e',
  ㄱ: 'r',
  ㄲ: 'r',
  ㅅ: 't',
  ㅆ: 't',
  ㅛ: 'y',
  ㅕ: 'u',
  ㅑ: 'i',
  ㅐ: 'o',
  ㅒ: 'o',
  ㅔ: 'p',
  ㅖ: 'p',
  ㅁ: 'a',
  ㄴ: 's',
  ㅇ: 'd',
  ㄹ: 'f',
  ㅎ: 'g',
  ㅗ: 'h',
  ㅓ: 'j',
  ㅏ: 'k',
  ㅣ: 'l',
  ㅋ: 'z',
  ㅌ: 'x',
  ㅊ: 'c',
  ㅍ: 'v',
  ㅠ: 'b',
  ㅜ: 'n',
  ㅡ: 'm',
}

/**
 * Resolve the ASCII lowercase letter ('a'..'z') for a keyboard shortcut event.
 *
 * - On Latin layouts, `event.key` wins so Dvorak/AZERTY/Colemak keep their own
 *   letters rather than physical QWERTY positions.
 * - On non-Latin layouts or active IMEs (e.g. Korean 'ㅍ' on macOS or 'Process'
 *   on Windows Chromium), falls back to the physical `event.code` (`KeyA`..`KeyZ`),
 *   then to the 2-beolsik Hangul Jamo table when `code` is empty.
 * - Returns null when Alt is held (protects AltGr accented characters on European
 *   layouts) or while an input method is actively composing inside a text field.
 */
export function shortcutLetterOf(event: ShortcutLetterEvent): string | null {
  const typed = (event.key ?? '').toLowerCase()
  if (/^[a-z]$/.test(typed)) return typed
  if (event.altKey || event.isComposing) return null
  const codeMatch = /^Key([A-Z])$/.exec(event.code ?? '')
  if (codeMatch) return codeMatch[1]!.toLowerCase()
  return HANGUL_JAMO_TO_LATIN[event.key] ?? null
}

/** True when `event` matches ASCII shortcut `letter` (case-insensitive). */
export function isShortcutLetter(event: ShortcutLetterEvent, letter: string): boolean {
  return shortcutLetterOf(event) === letter.toLowerCase()
}
