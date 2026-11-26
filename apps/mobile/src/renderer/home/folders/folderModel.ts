// Pure helpers of the [Folders] tab (HOME-T8): checks on bridge answers, the lost-folder reason,
// the platform for the confirm dialog, and the screen string for a failed open.
import {
  appInfo,
  HOME_ERROR_KEYS,
  type AppPlatform,
  type FolderEntry,
  type LinkedFolder,
} from '@genoffice/mobile-bridge/home'
import { isMobileCommandError, type MobileClient } from '@genoffice/mobile-bridge/transport'
import type { MobileStringKey } from '../../i18n'
import type { HomeHost } from '../homeHost'
import { homeActErrorKeyOf } from '../actions'

/** A linked folder as the screen can draw it; anything else in the answer is skipped. */
export function isLinkedFolder(value: unknown): value is LinkedFolder {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string'
}

/** A folder entry as the screen can draw it; anything else in the answer is skipped. */
export function isFolderEntry(value: unknown): value is FolderEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string'
}

/** Keeps the drawable items of a list answer; not a list at all → empty. */
export function drawable<T>(value: unknown, check: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(check) : []
}

export function isLost(folder: LinkedFolder): boolean {
  return folder.status === 'lost'
}

/** The written reason of a lost folder (never only a color). */
export function lostReasonKey(folder: LinkedFolder): MobileStringKey {
  if (folder.lostReason === 'missing') return 'homeFolderLostMissing'
  if (folder.lostReason === 'revoked') return 'homeFolderLostRevoked'
  return 'homeFolderLost'
}

/** Sub-folders first, then files; each group keeps the backend's order. */
export function splitEntries(entries: readonly FolderEntry[]): {
  readonly dirs: FolderEntry[]
  readonly files: FolderEntry[]
} {
  return {
    dirs: entries.filter((entry) => entry.isDir),
    files: entries.filter((entry) => !entry.isDir),
  }
}

/** The client of a host that may be an empty object (the slot test draws the tab with `{}`). */
export function hostClient(host: HomeHost | null | undefined): MobileClient | null {
  const client = (host as Partial<HomeHost> | null | undefined)?.client
  return client ?? null
}

export function isUserCancel(err: unknown): boolean {
  return isMobileCommandError(err) && err.code === 'USER_CANCELLED'
}

export function isFolderLostError(err: unknown): boolean {
  return isMobileCommandError(err) && err.messageKey === HOME_ERROR_KEYS.folderLost
}

/** The screen string for a failed folder action or open; null when the user cancelled. */
export function folderErrorKey(err: unknown): MobileStringKey | null {
  if (isFolderLostError(err)) return 'homeFolderLost'
  return homeActErrorKeyOf(err)
}

const platforms = new WeakMap<MobileClient, Promise<AppPlatform>>()

/** The platform from the app info, asked once per client; 'other' when unknown. */
export function platformOf(client: MobileClient | null): Promise<AppPlatform> {
  if (!client) return Promise.resolve('other')
  let known = platforms.get(client)
  if (!known) {
    known = appInfo(client).then(
      (info) => {
        const platform = (info as { platform?: unknown } | null)?.platform
        return platform === 'android' || platform === 'ios' ? platform : 'other'
      },
      () => 'other' as const,
    )
    platforms.set(client, known)
  }
  return known
}

/** The count of an answer to countFolderEntries; 0 when the answer has none. */
export function countOf(value: unknown): number {
  const count = (value as { count?: unknown } | null)?.count
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : 0
}
