import { createI18n, defineStrings } from '@genoffice/i18n'
import { ar } from './ar'
import { cs } from './cs'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { he } from './he'
import { hi } from './hi'
import { id } from './id'
import { it } from './it'
import { ja } from './ja'
import { ko } from './ko'
import { ms } from './ms'
import { nl } from './nl'
import { pl } from './pl'
import { pt } from './pt'
import { ru } from './ru'
import { th } from './th'
import { tr } from './tr'
import { vi } from './vi'
import { zh } from './zh'
import { zhTW } from './zh-TW'

export type MobileStringKey = keyof typeof zh

export const MOBILE_DICTS = defineStrings({
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

export const translateMobile = createI18n(MOBILE_DICTS)
