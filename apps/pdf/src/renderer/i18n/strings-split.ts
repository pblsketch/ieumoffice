import { createI18n, defineStrings } from '@genoffice/i18n'
import { zh } from './split/zh'
import { en } from './split/en'
import { ja } from './split/ja'
import { ko } from './split/ko'
import { fr } from './split/fr'
import { de } from './split/de'
import { es } from './split/es'
import { th } from './split/th'
import { id } from './split/id'
import { ru } from './split/ru'
import { ar } from './split/ar'
import { pt } from './split/pt'
import { it } from './split/it'
import { pl } from './split/pl'
import { cs } from './split/cs'
import { nl } from './split/nl'
import { ms } from './split/ms'
import { he } from './split/he'
import { hi } from './split/hi'
import { zhTW } from './split/zh-TW'
import { vi } from './split/vi'
import { tr } from './split/tr'

/** Copy for the PDF editor's Split PDF dialog */
export const splitStrings = defineStrings({
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

export type SplitStringKey = keyof typeof zh

export const splitText = createI18n(splitStrings)
