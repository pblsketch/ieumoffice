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

const SKIPPED_COMMAND_LABEL_KEYS: Readonly<Record<string, MacroStringKey>> = {
  'edit:undo': 'cmdUndo',
  'edit:redo': 'cmdRedo',
  'edit:copy': 'cmdCopy',
  'edit:cut': 'cmdCut',
  'edit:paste': 'cmdPaste',
  'edit:paste-plain': 'cmdPaste',
  'edit:paste-special': 'cmdPaste',
  'edit:find': 'cmdFind',
  'edit:find-replace': 'cmdFind',
  'ieum:find-backward': 'cmdFind',
  'insert:image': 'cmdInsertImage',
  'insert:picture': 'cmdInsertImage',
  'insert:footnote': 'cmdInsertFootnote',
  'insert:endnote': 'cmdInsertEndnote',
  'insert:hyperlink': 'cmdInsertHyperlink',
  'insert:bookmark': 'cmdInsertBookmark',
  'insert:line-break': 'cmdLineBreak',
  'edit:line-break': 'cmdLineBreak',
  'key:line-break': 'cmdLineBreak',
  'insert:tab': 'cmdTab',
  'edit:tab': 'cmdTab',
  'key:tab': 'cmdTab',
  'edit:delete-object': 'cmdDeleteObject',
  'macro:outside-body': 'cmdOutsideBody',
}

const ASCII_PRINTABLE_RE = /^[\x20-\x7e]+$/

/**
 * Resolve a localized label for a skipped editor command during macro recording
 * so non-Korean UI locales never display hardcoded Korean studio labels.
 */
export function localizeSkippedCommandLabel(
  lang: Lang,
  commandId: string,
  rawLabel?: string,
): string {
  const key = SKIPPED_COMMAND_LABEL_KEYS[commandId]
  if (key) {
    return translate(lang, key)
  }
  const trimmed = typeof rawLabel === 'string' ? rawLabel.trim() : ''
  if (trimmed && (lang === 'ko' || ASCII_PRINTABLE_RE.test(trimmed))) {
    return trimmed
  }
  return translate(lang, 'cmdOtherAction', { id: commandId || trimmed || '?' })
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
