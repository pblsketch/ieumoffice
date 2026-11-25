// Owner: track T6. Pure helpers of the settings rows for editors and home cards (spec 3.2, 3.10, 3.11).
import { htmlLang, type Lang, type Params } from '@genoffice/i18n'
import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../../editors/editorKind'
import type { MobileStringKey } from '../../i18n/strings'
import { PDF_TOOLS_ID } from '../../home/prefsStore'

type Translate = (key: MobileStringKey, params?: Params) => string

/** Names for the kinds registered before `labelKey` existed. */
const KIND_FALLBACK_LABELS: Readonly<Record<string, MobileStringKey>> = {
  hwp: 'homeSetEditorHwp',
  markdown: 'homeSetEditorMarkdown',
  [PDF_TOOLS_ID]: 'homeSetEditorPdfTools',
}

/** The name of an editor kind (or 'pdfTools') in the settings lists. */
export function editorLabel(kind: Pick<EditorKind, 'id' | 'labelKey'>, t: Translate): string {
  if (kind.labelKey) return t(kind.labelKey)
  const fallback = KIND_FALLBACK_LABELS[kind.id]
  return fallback ? t(fallback) : kind.id
}

/** One new-document card: the HWP card stands for .hwp and .hwpx, other kinds get one per format. */
export interface HomeCardItem {
  readonly id: string
  readonly kind: EditorKind
  readonly format: MobileDocFormat
}

export function homeCardItemsOf(kinds: readonly EditorKind[]): HomeCardItem[] {
  const items: HomeCardItem[] = []
  for (const kind of kinds) {
    const formats = kind.createFormats ?? []
    if (formats.length === 0) continue
    if (kind.id === 'hwp') {
      items.push({ id: 'hwp', kind, format: formats[0] })
      continue
    }
    for (const format of formats) {
      if (!items.some((item) => item.id === format)) items.push({ id: format, kind, format })
    }
  }
  return items
}

/** The card's name: the kind's name, with the format when the kind creates more than one. */
export function cardLabel(item: HomeCardItem, t: Translate): string {
  const name = editorLabel(item.kind, t)
  const formats = item.kind.createFormats ?? []
  return item.id !== 'hwp' && formats.length > 1 ? `${name} (.${item.format})` : name
}

/**
 * The whole stored order: the saved ids first (unknown ones kept in place, repeats dropped), then
 * the registry's cards the saved list does not name, in registry order.
 */
function fullOrder(allIds: readonly string[], order: readonly string[]): string[] {
  const full: string[] = []
  for (const id of order) if (!full.includes(id)) full.push(id)
  for (const id of allIds) if (!full.includes(id)) full.push(id)
  return full
}

/** The cards listed in settings (`shownIds`: cards of editors that are on), in the user's order. */
export function visibleCardOrder(
  allIds: readonly string[],
  order: readonly string[],
  shownIds: readonly string[],
): string[] {
  return fullOrder(allIds, order).filter((id) => shownIds.includes(id))
}

/**
 * Moves card `id` one place up (-1) or down (+1) among the shown cards and returns the new stored
 * order; cards of turned-off editors and unknown ids keep their places. Null when it cannot move.
 */
export function moveCardItem(
  allIds: readonly string[],
  order: readonly string[],
  shownIds: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const full = fullOrder(allIds, order)
  const shown = full.filter((item) => shownIds.includes(item))
  const at = shown.indexOf(id)
  const other = shown[at + delta]
  if (at < 0 || other === undefined) return null
  const a = full.indexOf(id)
  const b = full.indexOf(other)
  full[a] = other
  full[b] = id
  return full
}

/** The hidden list with `id` added or removed; every other id stays as it was. */
export function setCardHidden(hidden: readonly string[], id: string, hide: boolean): string[] {
  const rest = hidden.filter((item) => item !== id)
  return hide ? [...rest, id] : rest
}

/**
 * The editors-off list after switching `id`. When every editor kind is stored off (which reads as
 * all on), the switch starts from "all kinds on" so it changes what the screen shows.
 */
export function nextEditorsOff(
  stored: readonly string[],
  kindIds: readonly string[],
  id: string,
  on: boolean,
): string[] {
  const allKindsOff = kindIds.length > 0 && kindIds.every((kindId) => stored.includes(kindId))
  const base = allKindsOff ? stored.filter((item) => !kindIds.includes(item)) : [...stored]
  const rest = base.filter((item) => item !== id)
  return on ? rest : [...rest, id]
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
const SIZE_SHORT = ['B', 'KB', 'MB', 'GB'] as const

/** A byte count in the screen language's units ("4 KB"). */
export function formatBytes(bytes: number, lang: Lang): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  try {
    return new Intl.NumberFormat(htmlLang(lang), {
      style: 'unit',
      unit: SIZE_UNITS[unit],
      unitDisplay: 'short',
      maximumFractionDigits: unit === 0 ? 0 : 1,
    }).format(value)
  } catch {
    return `${Math.round(value * 10) / 10} ${SIZE_SHORT[unit]}`
  }
}
