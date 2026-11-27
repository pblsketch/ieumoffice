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

/** User-visible strings for the HWP left workpane shell. */
export const workpaneStrings = defineStrings({
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

const translate = createI18n(workpaneStrings)

export type WorkpaneStringKey = keyof typeof zh
export type WorkpaneTFunc = (key: WorkpaneStringKey, params?: Params) => string

export function translateWorkpane(lang: Lang, key: WorkpaneStringKey, params?: Params): string {
  return translate(lang, key, params)
}

export function useWorkpaneI18n(): { lang: Lang; t: WorkpaneTFunc } {
  const lang = useLang()
  return { lang, t: (key, params) => translate(lang, key, params) }
}
