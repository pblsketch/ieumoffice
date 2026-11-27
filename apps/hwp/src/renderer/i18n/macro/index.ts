import { useCallback } from 'react'
import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import type { MacroMenuLabels } from '../../../../studio-plugin/workpane-menu.mjs'
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

/** User-visible strings for HWP macro recording, manager, editor, and Tool menu items. */
export const macroStrings = defineStrings({
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

const translate = createI18n(macroStrings)

export type MacroStringKey = keyof typeof zh
export type MacroTFunc = (key: MacroStringKey, params?: Params) => string

export function translateMacro(lang: Lang, key: MacroStringKey, params?: Params): string {
  return translate(lang, key, params)
}

/** Build the localized Tool-menu label bundle for `installMacroMenu`. */
export function macroMenuLabelsFor(lang: Lang): MacroMenuLabels {
  return {
    recordToggle: translate(lang, 'menuRecordToggle'),
    manage: translate(lang, 'menuManage'),
  }
}

export function useMacroI18n(): { lang: Lang; t: MacroTFunc } {
  const lang = useLang()
  const t = useCallback<MacroTFunc>((key, params) => translate(lang, key, params), [lang])
  return { lang, t }
}
