import {
  setSystemShortDate,
  shortDatePatternForSystemLocale,
} from '@genoffice/xlsx-gateway/shared/short-date'

let cached: string | undefined

/**
 * The phone's regional short-date pattern, the engine's `shortDateFormat`
 * (the desktop's `systemShortDate()` in sheets-main.ts reads the OS locale
 * the same way and hands it to the gateway too). The WebView's language list
 * stands in for the OS region.
 */
export function phoneShortDateFormat(): string {
  if (cached === undefined) {
    const locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'
    cached = shortDatePatternForSystemLocale(locale)
    setSystemShortDate(cached)
  }
  return cached
}
