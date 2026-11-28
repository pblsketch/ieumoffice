import { useCallback } from 'react'
import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import type { BibliographyMenuLabels } from '../../../../studio-plugin/workpane-menu.mjs'
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

/** User-visible strings for the HWP workpane Bibliography tab and Tool menu items. */
export const biblioStrings = defineStrings({
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

const translate = createI18n(biblioStrings)

export type BiblioStringKey = keyof typeof zh
export type BiblioTFunc = (key: BiblioStringKey, params?: Params) => string

export function translateBiblio(lang: Lang, key: BiblioStringKey, params?: Params): string {
  return translate(lang, key, params)
}

/** Build the localized Tool-menu label bundle for `installBibliographyMenu`. */
export function bibliographyMenuLabelsFor(lang: Lang): BibliographyMenuLabels {
  return {
    insertCitation: translate(lang, 'menuInsertCitation'),
    insertBibliography: translate(lang, 'menuInsertBibliography'),
    refreshBibliography: translate(lang, 'menuRefreshBibliography'),
    openTab: translate(lang, 'menuOpenTab'),
  }
}

export function useBiblioI18n(): { lang: Lang; t: BiblioTFunc } {
  const lang = useLang()
  const t = useCallback<BiblioTFunc>((key, params) => translate(lang, key, params), [lang])
  return { lang, t }
}
