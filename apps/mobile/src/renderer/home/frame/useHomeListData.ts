// What the recent tab reads besides the recent list App hands in (HOME-T6): favorites, groups,
// folder names for the location line. Any failed or odd answer reads as an empty list.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listFavorites,
  listFolders,
  listGroups,
  recentMeta,
  type FavoriteEntry,
  type FavoriteGroup,
  type RecentMetaEntry,
} from '@genoffice/mobile-bridge/home'
import type { MobileClient, RecentDocEntry } from '@genoffice/mobile-bridge/transport'

export interface HomeListData {
  readonly favorites: readonly FavoriteEntry[]
  readonly groups: readonly FavoriteGroup[]
  /** Recent id → linked folder name. */
  readonly recentLocation: ReadonlyMap<string, string>
  /** Linked folder id → folder name (for starred files inside a folder). */
  readonly folderNames: ReadonlyMap<string, string>
}

const EMPTY: HomeListData = {
  favorites: [],
  groups: [],
  recentLocation: new Map(),
  folderNames: new Map(),
}

async function listOrEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    const list = await read()
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export interface HomeListDataState {
  readonly data: HomeListData
  /** Reads everything again (after an action changed files or lists). */
  reload(): Promise<void>
}

/**
 * Reads the favorites, groups and location hints through `client`; without a client everything
 * stays empty. Reads again when the recent list App passes in changes (a refresh happened).
 */
export function useHomeListData(
  client: MobileClient | null,
  recentDocs: readonly RecentDocEntry[],
): HomeListDataState {
  const [data, setData] = useState<HomeListData>(EMPTY)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    if (!client) return
    seq.current += 1
    const mine = seq.current
    const [favorites, groups, meta, folders] = await Promise.all([
      listOrEmpty(() => listFavorites(client)),
      listOrEmpty(() => listGroups(client)),
      listOrEmpty<RecentMetaEntry>(() => recentMeta(client)),
      listOrEmpty(() => listFolders(client)),
    ])
    if (mine !== seq.current) return
    const recentLocation = new Map<string, string>()
    const folderNames = new Map<string, string>()
    for (const folder of folders) {
      if (folder && typeof folder.id === 'string' && typeof folder.name === 'string') {
        folderNames.set(folder.id, folder.name)
      }
    }
    for (const entry of meta) {
      if (!entry || typeof entry.id !== 'string') continue
      if (typeof entry.folderName === 'string' && entry.folderName.length > 0) {
        recentLocation.set(entry.id, entry.folderName)
        if (entry.folderId && !folderNames.has(entry.folderId)) {
          folderNames.set(entry.folderId, entry.folderName)
        }
      }
    }
    setData({ favorites, groups, recentLocation, folderNames })
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload, recentDocs])

  useEffect(
    () => () => {
      // Late answers after the home went away are dropped.
      seq.current += 1
    },
    [],
  )

  return { data, reload }
}
