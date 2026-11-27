// Pure rules of the home frame (HOME-T6, spec 3.1-3.3): which tab to show, which new-document
// cards to draw, and the filter chips of the recent tab.
import { useSyncExternalStore } from 'react'
import type { FavoriteEntry, FavoriteGroup, FolderEntry } from '@genoffice/mobile-bridge/home'
import type { MobileDocFormat, RecentDocEntry } from '@genoffice/mobile-bridge/transport'
import type { EditorKind } from '../../editors/editorKind'
import {
  homeCardItemsOf,
  visibleCardOrder,
  type HomeCardItem,
} from '../../settings/sections/homeSettingsModel'
import type { HomeTabId } from '../homeTabs'

// ── Last tab ────────────────────────────────────────────────────────────────

/** A tab the home can show in place; [Settings] leaves the home, so it is never remembered. */
export type HomeContentTabId = Exclude<HomeTabId, 'settings'>

// Lives as long as the app runs, so coming back from settings or a document shows the same tab.
let lastTab: HomeContentTabId = 'recent'

export function getLastHomeTab(): HomeContentTabId {
  return lastTab
}

export function rememberHomeTab(tab: HomeContentTabId): void {
  lastTab = tab
}

// ── List sort & view mode ───────────────────────────────────────────────────

export type HomeSortField = 'date' | 'name'
export type HomeSortDir = 'desc' | 'asc'
export type HomeViewMode = 'list' | 'grid'

export interface HomeListPrefs {
  readonly sortField: HomeSortField
  readonly sortDir: HomeSortDir
  readonly viewMode: HomeViewMode
}

const DEFAULT_LIST_PREFS: HomeListPrefs = {
  sortField: 'date',
  sortDir: 'desc',
  viewMode: 'list',
}

let listPrefs: HomeListPrefs = DEFAULT_LIST_PREFS
const listPrefListeners = new Set<() => void>()

function subscribeListPrefs(listener: () => void): () => void {
  listPrefListeners.add(listener)
  return () => {
    listPrefListeners.delete(listener)
  }
}

export function getHomeListPrefs(): HomeListPrefs {
  return listPrefs
}

export function updateHomeListPrefs(patch: Partial<HomeListPrefs>): void {
  listPrefs = { ...listPrefs, ...patch }
  for (const listener of [...listPrefListeners]) listener()
}

export function useHomeListPrefs(): HomeListPrefs {
  return useSyncExternalStore(subscribeListPrefs, getHomeListPrefs, getHomeListPrefs)
}

function compareByName(a: string, b: string, dir: HomeSortDir): number {
  const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  return dir === 'asc' ? cmp : -cmp
}

function compareByTime(a: number | undefined, b: number | undefined, dir: HomeSortDir): number {
  const ta = typeof a === 'number' && Number.isFinite(a) ? a : 0
  const tb = typeof b === 'number' && Number.isFinite(b) ? b : 0
  const cmp = ta - tb
  return dir === 'asc' ? cmp : -cmp
}

export function sortRecentEntries(
  entries: readonly RecentDocEntry[],
  field: HomeSortField,
  dir: HomeSortDir,
): RecentDocEntry[] {
  return [...entries].sort((a, b) => {
    const primary =
      field === 'name'
        ? compareByName(a.name, b.name, dir)
        : compareByTime(a.openedAt, b.openedAt, dir)
    return primary !== 0 ? primary : compareByName(a.name, b.name, 'asc')
  })
}

export function sortFavoriteEntries(
  entries: readonly FavoriteEntry[],
  field: HomeSortField,
  dir: HomeSortDir,
): FavoriteEntry[] {
  return [...entries].sort((a, b) => {
    const primary =
      field === 'name'
        ? compareByName(a.name, b.name, dir)
        : compareByTime(a.addedAt, b.addedAt, dir)
    return primary !== 0 ? primary : compareByName(a.name, b.name, 'asc')
  })
}

export function sortFolderEntries(
  entries: readonly FolderEntry[],
  field: HomeSortField,
  dir: HomeSortDir,
): FolderEntry[] {
  return [...entries].sort((a, b) => {
    const primary =
      field === 'name'
        ? compareByName(a.name, b.name, dir)
        : compareByTime(a.modifiedAt, b.modifiedAt, dir)
    return primary !== 0 ? primary : compareByName(a.name, b.name, 'asc')
  })
}

/** Tests only: back to the tab and list preferences the app starts with. */
export function resetHomeFrameForTest(): void {
  lastTab = 'recent'
  listPrefs = DEFAULT_LIST_PREFS
  for (const listener of [...listPrefListeners]) listener()
}

// ── New-document cards ──────────────────────────────────────────────────────

export interface HomeCardPrefs {
  readonly homeKindsOrder: readonly string[]
  readonly homeKindsHidden: readonly string[]
}

/**
 * The cards the home and the [+] sheet show (spec 3.2): cards of editors that are on, in the user's
 * order, without the hidden ones. The rules are the settings screen's (homeSettingsModel).
 */
export function homeCardList(
  kinds: readonly EditorKind[],
  prefs: HomeCardPrefs,
  isEditorOn: (id: string) => boolean,
): HomeCardItem[] {
  const items = homeCardItemsOf(kinds)
  const shownIds = items.filter((item) => isEditorOn(item.kind.id)).map((item) => item.id)
  const order = visibleCardOrder(
    items.map((item) => item.id),
    prefs.homeKindsOrder,
    shownIds,
  )
  return order
    .filter((id) => !prefs.homeKindsHidden.includes(id))
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is HomeCardItem => item !== undefined)
}

/** The format a card creates: the HWP card follows the "new HWP document format" setting. */
export function cardFormat(item: HomeCardItem, hwpFormat: 'hwp' | 'hwpx'): MobileDocFormat {
  return item.id === 'hwp' ? hwpFormat : item.format
}

// ── Filter chips ────────────────────────────────────────────────────────────

/** Format family of a recent document: HWP (.hwp, .hwpx), Markdown (.md, .txt), else the format. */
export function formatFamily(format: MobileDocFormat): string {
  if (format === 'hwp' || format === 'hwpx') return 'hwp'
  if (format === 'md' || format === 'txt') return 'md'
  return format
}

/** The families in the recent list, ordered by the registry's formats (unknown ones last). */
export function recentFamilies(
  recent: readonly RecentDocEntry[],
  kinds: readonly EditorKind[],
): string[] {
  const present = new Set(recent.map((doc) => formatFamily(doc.format)))
  const ordered: string[] = []
  for (const kind of kinds) {
    for (const format of kind.formats) {
      const family = formatFamily(format)
      if (present.has(family) && !ordered.includes(family)) ordered.push(family)
    }
  }
  for (const family of present) if (!ordered.includes(family)) ordered.push(family)
  return ordered
}

export type HomeChip =
  | { readonly id: 'all'; readonly kind: 'all' }
  | { readonly id: 'favorites'; readonly kind: 'favorites' }
  | {
      readonly id: string
      readonly kind: 'group'
      readonly groupId: string
      readonly name: string
    }
  | { readonly id: string; readonly kind: 'family'; readonly family: string }

/**
 * The chips over the list (spec 3.3): [All], [Favorites] and one per group when the favorites can
 * be read, then format chips only when the recent list holds two families or more.
 */
export function homeChips(
  recent: readonly RecentDocEntry[],
  groups: readonly FavoriteGroup[],
  kinds: readonly EditorKind[],
  withFavorites: boolean,
): HomeChip[] {
  const chips: HomeChip[] = [{ id: 'all', kind: 'all' }]
  if (withFavorites) {
    chips.push({ id: 'favorites', kind: 'favorites' })
    for (const group of groups) {
      chips.push({ id: `group:${group.id}`, kind: 'group', groupId: group.id, name: group.name })
    }
  }
  const families = recentFamilies(recent, kinds)
  if (families.length >= 2) {
    for (const family of families) chips.push({ id: `family:${family}`, kind: 'family', family })
  }
  return chips
}

/** The recent documents a recent-list chip ([All] or a format) shows. */
export function filterRecent(
  recent: readonly RecentDocEntry[],
  chip: HomeChip,
): readonly RecentDocEntry[] {
  if (chip.kind !== 'family') return recent
  return recent.filter((doc) => formatFamily(doc.format) === chip.family)
}

/** The favorites a favorites-list chip ([Favorites] or a group) shows. */
export function filterFavorites(
  favorites: readonly FavoriteEntry[],
  chip: HomeChip,
): readonly FavoriteEntry[] {
  if (chip.kind !== 'group') return favorites
  return favorites.filter((entry) => entry.groupId === chip.groupId)
}

/** Whether the chip lists favorites (the other chips list recent documents). */
export function chipListsFavorites(chip: HomeChip): boolean {
  return chip.kind === 'favorites' || chip.kind === 'group'
}
