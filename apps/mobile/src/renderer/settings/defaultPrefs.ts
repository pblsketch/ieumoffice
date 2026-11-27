// Owned by track T6: the app settings' first values (the shape lives in mobile-bridge's transport).
import { LANGS, normalizeLang, type Lang } from '@genoffice/i18n'
import type { MobileAppPrefs } from '@genoffice/mobile-bridge/transport'

const SUPPORTED_LANG_SET = new Set<string>(LANGS)

/** Maps one BCP-47 tag to a supported app language, or null when unsupported. */
function matchSupportedLang(tag: string): Lang | null {
  const cleaned = tag.trim().replace(/_/g, '-')
  if (!cleaned) return null
  const lower = cleaned.toLowerCase()
  if (lower.startsWith('zh')) {
    if (
      lower.includes('-tw') ||
      lower.includes('-hk') ||
      lower.includes('-mo') ||
      lower.includes('-hant')
    ) {
      return 'zh-TW'
    }
    return 'zh'
  }
  const base = lower.split('-')[0] ?? ''
  // Legacy Android/Java locale aliases.
  if (base === 'in') return 'id'
  if (base === 'iw') return 'he'
  if (SUPPORTED_LANG_SET.has(base)) return base as Lang
  return null
}

/**
 * Picks the first supported app language from the OS locale list, falling back to English when
 * none of the system locales match the 22 supported languages.
 */
export function detectSystemLang(languages?: readonly string[]): Lang {
  const candidates =
    languages ??
    (typeof navigator !== 'undefined'
      ? navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : []
      : [])
  for (const tag of candidates) {
    const matched = matchSupportedLang(tag)
    if (matched) return matched
  }
  return 'en'
}

/** Resolves stored prefs.lang: explicit user choice wins, empty/missing follows system locale. */
export function resolveInitialLang(storedLang?: string | null): Lang {
  if (typeof storedLang === 'string' && storedLang.trim().length > 0) {
    return normalizeLang(storedLang)
  }
  return detectSystemLang()
}

/** A fresh install's values. A field missing from stored settings reads differently: see home/prefsStore.ts. */
export const DEFAULT_PREFS: MobileAppPrefs = {
  lang: detectSystemLang(),
  theme: 'system',
  hwpDefaultFormat: 'hwpx',
  // AI starts hidden on mobile; the user turns it on in Settings.
  aiEnabled: false,
  editorsOff: [],
  homeKindsHidden: [],
  homeKindsOrder: [],
  keepScreenOnWhileReading: true,
  firstRunDone: false,
  tipsSeen: [],
  lastSeenVersion: '',
}
