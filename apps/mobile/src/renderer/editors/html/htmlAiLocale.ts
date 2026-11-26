// The mobile stand-in for the desktop HTML editor's `i18n/locale` module, for the desktop modules
// the HTML AI reuses (config/tracks/web.ts redirects their import here). The desktop `t` reads a
// language its React provider sets while it renders; the phone never renders that provider, so
// the tool summaries would always come out in the provider's default. Here the AI run says which
// language the summaries use. Everything else is the desktop module itself.
import { createI18n, type Lang, type Params } from '@genoffice/i18n'
import { strings } from '../../../../../html/src/renderer/i18n/strings'
import type { StringKey } from '../../../../../html/src/renderer/i18n/locale'

export {
  aiLangDirective,
  LocaleProvider,
  useI18n,
  type StringKey,
  type TFunc,
} from '../../../../../html/src/renderer/i18n/locale'

const translate = createI18n(strings)

let currentLang: () => Lang = () => 'en'

/** The language the desktop tools' summaries are written in, read on every call. */
export function setHtmlToolLang(lang: () => Lang): void {
  currentLang = lang
}

export function t(key: StringKey, params?: Params): string {
  return translate(currentLang(), key, params)
}
