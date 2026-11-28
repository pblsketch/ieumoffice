import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { useLang } from '../locale'
import { zh } from './zh'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'
import { fr } from './fr'
import { de } from './de'
import { es } from './es'
import { th } from './th'
import { id } from './id'
import { ru } from './ru'
import { ar } from './ar'
import { pt } from './pt'
import { it } from './it'
import { pl } from './pl'
import { cs } from './cs'
import { nl } from './nl'
import { ms } from './ms'
import { he } from './he'
import { hi } from './hi'
import { zhTW } from './zh-TW'
import { vi } from './vi'
import { tr } from './tr'

/** User-visible strings for HWP Table of Contents and Index dialogs and menus. */
export const tocStrings = defineStrings({
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
  tr,
})

const translate = createI18n(tocStrings)

export type TocStringKey = keyof typeof zh
export type TocTFunc = (key: TocStringKey, params?: Params) => string
export type TocDialogLabels = Record<TocStringKey, string>

export function translateToc(lang: Lang, key: TocStringKey, params?: Params): string {
  return translate(lang, key, params)
}

/** Build the complete localized label dictionary to pass into `installTocIndexMenu`. */
export function tocDialogLabelsFor(lang: Lang): TocDialogLabels {
  const out = {} as TocDialogLabels
  for (const key of Object.keys(zh) as TocStringKey[]) {
    out[key] = translate(lang, key)
  }
  return out
}

export function useTocI18n(): { lang: Lang; t: TocTFunc } {
  const lang = useLang()
  return { lang, t: (key, params) => translate(lang, key, params) }
}
