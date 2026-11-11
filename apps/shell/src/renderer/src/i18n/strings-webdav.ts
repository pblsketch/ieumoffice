import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './webdav/zh'
import { en } from './webdav/en'
import { ja } from './webdav/ja'
import { ko } from './webdav/ko'
import { fr } from './webdav/fr'
import { de } from './webdav/de'
import { es } from './webdav/es'
import { th } from './webdav/th'
import { id } from './webdav/id'
import { ru } from './webdav/ru'
import { ar } from './webdav/ar'
import { pt } from './webdav/pt'
import { it } from './webdav/it'
import { pl } from './webdav/pl'
import { cs } from './webdav/cs'
import { nl } from './webdav/nl'
import { ms } from './webdav/ms'
import { he } from './webdav/he'
import { hi } from './webdav/hi'
import { zhTW } from './webdav/zh-TW'
import { vi } from './webdav/vi'

/**
 * WebDAV on the home screen and in Settings → Integrations: adding servers,
 * browsing their folders and opening their files. Sharded per language; `zh` defines the key set.
 */
export const webdavUiStrings = defineStrings({
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
})

export type WebDavStringKey = keyof typeof zh

const translate = createI18n(webdavUiStrings)

export function webdavUiText(lang: Lang, key: WebDavStringKey, params?: Params): string {
  return translate(lang, key, params)
}
