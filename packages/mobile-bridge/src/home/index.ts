/**
 * Owned by mobile v1 track T6 (home/settings).
 *
 * Holds the home screen and settings Tauri command wrappers, built on
 * `invokeMobileCommand` from `../transport` with `client.transport`, so the track does not
 * widen `MobileClient`. The root `src/index.ts` does not re-export this module.
 *
 * Wrappers that return a list fall back to `[]` when the answer is not an array, because the
 * test doubles answer unknown commands with `{ ok: true }`.
 */
import {
  invokeMobileCommand,
  MobileCommandError,
  type MobileClient,
  type MobileDocSession,
} from '../transport'
import type {
  AppInfo,
  ClearStorageKind,
  ClearStorageResult,
  CountFolderEntriesResult,
  DeleteFilesResult,
  FavoriteEntry,
  FavoriteGroup,
  FileRef,
  FileRefBytes,
  FileRefBytesPayload,
  FolderEntry,
  HomeOkResult,
  IncomingBatch,
  LinkedFolder,
  RecentMetaEntry,
  StorageUsage,
  UnlinkFolderResult,
} from './types'

export * from './types'

function call<T>(
  client: MobileClient,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invokeMobileCommand<T>(client.transport, command, args)
}

async function callList<T>(
  client: MobileClient,
  command: string,
  args?: Record<string, unknown>,
): Promise<T[]> {
  const res = await call<unknown>(client, command, args)
  return Array.isArray(res) ? (res as T[]) : []
}

/** Drops keys whose value is `undefined` so optional arguments are left out of the payload. */
function withoutUndefined(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Decodes base64 with `atob` only, so it runs in a webview without Node's `Buffer`. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

// Linked folders

export function listFolders(client: MobileClient): Promise<LinkedFolder[]> {
  return callList<LinkedFolder>(client, 'mobile_home_list_folders')
}

/** Opens the system folder picker; rejects with `USER_CANCELLED` when the user backs out. */
export function linkFolder(client: MobileClient, replaceId?: string): Promise<LinkedFolder> {
  return call(client, 'mobile_home_link_folder', withoutUndefined({ replaceId }))
}

export function unlinkFolder(client: MobileClient, id: string): Promise<UnlinkFolderResult> {
  return call(client, 'mobile_home_unlink_folder', { id })
}

export function countFolderEntries(
  client: MobileClient,
  id: string,
): Promise<CountFolderEntriesResult> {
  return call(client, 'mobile_home_count_folder_entries', { id })
}

/** `path` is the chain of sub-folder names below the linked folder (empty for its top). */
export function listFolder(
  client: MobileClient,
  folderId: string,
  path: readonly string[],
): Promise<FolderEntry[]> {
  return callList<FolderEntry>(client, 'mobile_home_list_folder', { folderId, path: [...path] })
}

export function openFolderEntry(
  client: MobileClient,
  folderId: string,
  entryId: string,
): Promise<MobileDocSession> {
  return call(client, 'mobile_home_open_folder_entry', { folderId, entryId })
}

// Favorites and groups

export function listFavorites(client: MobileClient): Promise<FavoriteEntry[]> {
  return callList<FavoriteEntry>(client, 'mobile_home_list_favorites')
}

export function setFavorite(
  client: MobileClient,
  fileRef: FileRef,
  on: boolean,
): Promise<FavoriteEntry[]> {
  return callList<FavoriteEntry>(client, 'mobile_home_set_favorite', { fileRef, on })
}

export function listGroups(client: MobileClient): Promise<FavoriteGroup[]> {
  return callList<FavoriteGroup>(client, 'mobile_home_list_groups')
}

/** Creates a group when `id` is left out, renames group `id` otherwise. */
export function saveGroup(
  client: MobileClient,
  params: { readonly name: string; readonly id?: string },
): Promise<FavoriteGroup[]> {
  return callList<FavoriteGroup>(
    client,
    'mobile_home_save_group',
    withoutUndefined({ id: params.id, name: params.name }),
  )
}

export function deleteGroup(client: MobileClient, id: string): Promise<FavoriteGroup[]> {
  return callList<FavoriteGroup>(client, 'mobile_home_delete_group', { id })
}

/** `groupId: null` moves the favorites out of every group. */
export function moveToGroup(
  client: MobileClient,
  refs: readonly FileRef[],
  groupId: string | null,
): Promise<FavoriteEntry[]> {
  return callList<FavoriteEntry>(client, 'mobile_home_move_to_group', {
    refs: [...refs],
    groupId,
  })
}

// File actions

/** Resolves with the file's new reference. */
export function renameFile(
  client: MobileClient,
  fileRef: FileRef,
  newBaseName: string,
): Promise<FileRef> {
  return call(client, 'mobile_home_rename', { fileRef, newBaseName })
}

/** `copySuffix` is the UI language's "copy" word; resolves `null` when a save dialog was cancelled. */
export async function duplicateFile(
  client: MobileClient,
  fileRef: FileRef,
  copySuffix: string,
): Promise<FileRef | null> {
  const res = await call<FileRef | null | undefined>(client, 'mobile_home_duplicate', {
    fileRef,
    copySuffix,
  })
  return res ?? null
}

export async function deleteFiles(
  client: MobileClient,
  refs: readonly FileRef[],
): Promise<DeleteFilesResult> {
  const res = await call<Partial<DeleteFilesResult> | null | undefined>(
    client,
    'mobile_home_delete',
    { refs: [...refs] },
  )
  const deleted = res?.deleted
  const failed = res?.failed
  return {
    deleted: Array.isArray(deleted) ? deleted : [],
    failed: Array.isArray(failed) ? failed : [],
  }
}

export function shareFiles(client: MobileClient, refs: readonly FileRef[]): Promise<HomeOkResult> {
  return call(client, 'mobile_home_share_files', { refs: [...refs] })
}

/** Reads one file's bytes on demand (the PDF tools' `readBytes`). */
export async function readFileRefBytes(
  client: MobileClient,
  fileRef: FileRef,
): Promise<FileRefBytes> {
  const res = await call<Partial<FileRefBytesPayload> | null | undefined>(
    client,
    'mobile_home_read_bytes',
    { fileRef },
  )
  if (!res || typeof res.bytesBase64 !== 'string') {
    throw new MobileCommandError({
      code: 'INTERNAL_ERROR',
      messageKey: 'mobile.internalError',
      detail: 'mobile_home_read_bytes returned no bytes.',
    })
  }
  return {
    bytes: base64ToBytes(res.bytesBase64),
    name: typeof res.name === 'string' ? res.name : '',
    mime: typeof res.mime === 'string' ? res.mime : '',
  }
}

/** Folder location hints for recent rows; `RecentDocEntry` itself stays unchanged. */
export function recentMeta(client: MobileClient): Promise<RecentMetaEntry[]> {
  return callList<RecentMetaEntry>(client, 'mobile_home_recent_meta')
}

// Incoming files and the sample document

/**
 * Takes the waiting batch of shared files. Resolves `null` when nothing is waiting or when a
 * single document stays on the `consumePendingOpenIntent` path.
 */
export async function takeIncoming(client: MobileClient): Promise<IncomingBatch | null> {
  const res = await call<unknown>(client, 'mobile_home_take_incoming')
  if (
    res &&
    typeof res === 'object' &&
    !Array.isArray(res) &&
    Array.isArray((res as { entries?: unknown }).entries)
  ) {
    return res as IncomingBatch
  }
  return null
}

export function openIncomingEntry(
  client: MobileClient,
  batchId: string,
  entryId: string,
): Promise<MobileDocSession> {
  return call(client, 'mobile_home_open_incoming_entry', { batchId, entryId })
}

/** Opens the bundled read-only sample document; it is not added to the recent list. */
export function openSample(client: MobileClient, lang: string): Promise<MobileDocSession> {
  return call(client, 'mobile_home_open_sample', { lang })
}

// Settings: storage, app info, screen, links

export function storageUsage(client: MobileClient): Promise<StorageUsage> {
  return call(client, 'mobile_home_storage_usage')
}

/** `keepDocKey` keeps the recovery copy of the document that is open now. */
export function clearStorage(
  client: MobileClient,
  kind: ClearStorageKind,
  keepDocKey?: string,
): Promise<ClearStorageResult> {
  return call(client, 'mobile_home_clear_storage', withoutUndefined({ kind, keepDocKey }))
}

export function appInfo(client: MobileClient): Promise<AppInfo> {
  return call(client, 'mobile_home_app_info')
}

/** Tracks call this through the `useKeepScreenOn` hook, not directly. */
export async function setKeepScreenOn(client: MobileClient, on: boolean): Promise<void> {
  await call<HomeOkResult>(client, 'mobile_home_keep_screen_on', { on })
}

/** Opens an https URL in the system browser; other schemes reject with `mobile.home.urlRefused`. */
export function openExternalUrl(client: MobileClient, url: string): Promise<HomeOkResult> {
  return call(client, 'mobile_home_open_external_url', { url })
}
