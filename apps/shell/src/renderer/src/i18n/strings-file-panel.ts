import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './file-panel/zh'
import { en } from './file-panel/en'
import { ja } from './file-panel/ja'
import { ko } from './file-panel/ko'
import { fr } from './file-panel/fr'
import { de } from './file-panel/de'
import { es } from './file-panel/es'
import { th } from './file-panel/th'
import { id } from './file-panel/id'
import { ru } from './file-panel/ru'
import { ar } from './file-panel/ar'
import { pt } from './file-panel/pt'
import { it } from './file-panel/it'
import { pl } from './file-panel/pl'
import { cs } from './file-panel/cs'
import { nl } from './file-panel/nl'
import { ms } from './file-panel/ms'
import { he } from './file-panel/he'
import { hi } from './file-panel/hi'
import { zhTW } from './file-panel/zh-TW'
import { vi } from './file-panel/vi'
import { tr } from './file-panel/tr'

/**
 * The files panel beside editor tabs. Sharded per language; `zh` defines the
 * key set.
 */
export const filePanelStrings = defineStrings({
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

export type FilePanelStringKey = keyof typeof zh

const translate = createI18n(filePanelStrings)

export function filePanelText(lang: Lang, key: FilePanelStringKey, params?: Params): string {
  return translate(lang, key, params)
}
