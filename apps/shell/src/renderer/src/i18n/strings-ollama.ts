import { createI18n, defineStrings, type Lang } from '@genoffice/i18n'
import { zh } from './ollama/zh'
import { en } from './ollama/en'
import { ko } from './ollama/ko'
import { ja } from './ollama/ja'
import { fr } from './ollama/fr'
import { de } from './ollama/de'
import { es } from './ollama/es'
import { th } from './ollama/th'
import { id } from './ollama/id'
import { ru } from './ollama/ru'
import { ar } from './ollama/ar'
import { pt } from './ollama/pt'
import { it } from './ollama/it'
import { pl } from './ollama/pl'
import { cs } from './ollama/cs'
import { nl } from './ollama/nl'
import { ms } from './ollama/ms'
import { he } from './ollama/he'
import { hi } from './ollama/hi'
import { zhTW } from './ollama/zh-TW'
import { vi } from './ollama/vi'
import { tr } from './ollama/tr'

export const ollamaStrings = defineStrings({
  zh,
  en,
  ko,
  ja,
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
export type OllamaStringKey = keyof typeof zh
const translate = createI18n(ollamaStrings)
export function ollamaText(lang: Lang, key: OllamaStringKey): string {
  return translate(lang, key)
}
