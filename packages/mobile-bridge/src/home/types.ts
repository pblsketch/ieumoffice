import type { MobileDocFormat } from '../transport'

/** Points at one file the home screen shows, whichever list it came from. */
export type FileRef =
  | { readonly kind: 'recent'; readonly id: string }
  | { readonly kind: 'favorite'; readonly docKey: string }
  | { readonly kind: 'folder'; readonly folderId: string; readonly entryId: string }
  | { readonly kind: 'incoming'; readonly batchId: string; readonly entryId: string }

export interface LinkedFolder {
  readonly id: string
  readonly name: string
  readonly status: 'ok' | 'lost'
  readonly lostReason?: string
  readonly addedAt: number
}

/** `id` is a key that is only valid inside the listing it came from. */
export interface FolderEntry {
  readonly id: string
  readonly name: string
  readonly isDir: boolean
  readonly format?: MobileDocFormat
  readonly isPicture: boolean
  readonly sizeBytes?: number
  readonly modifiedAt?: number
}

export interface FavoriteEntry {
  readonly docKey: string
  readonly name: string
  readonly format: MobileDocFormat
  readonly groupId: string | null
  readonly folderId?: string
  readonly addedAt: number
}

export interface FavoriteGroup {
  readonly id: string
  readonly name: string
}

export interface IncomingEntry {
  readonly id: string
  readonly name: string
  readonly mime: string
  readonly format?: MobileDocFormat
  readonly isPicture: boolean
  readonly sizeBytes?: number
}

export interface IncomingBatch {
  readonly id: string
  readonly entries: IncomingEntry[]
}

export interface UnlinkFolderResult {
  readonly removedEntries: number
}

export interface CountFolderEntriesResult {
  readonly count: number
}

export interface DeleteFilesFailure {
  readonly fileRef: FileRef
  readonly messageKey: string
}

export interface DeleteFilesResult {
  readonly deleted: FileRef[]
  readonly failed: DeleteFilesFailure[]
}

/** Raw answer of `mobile_home_read_bytes`. */
export interface FileRefBytesPayload {
  readonly bytesBase64: string
  readonly name: string
  readonly mime: string
}

export interface FileRefBytes {
  readonly bytes: Uint8Array
  readonly name: string
  readonly mime: string
}

/** Location hint for one recent row; `id` matches `RecentDocEntry.id`. */
export interface RecentMetaEntry {
  readonly id: string
  readonly folderId?: string
  readonly folderName?: string
}

export interface StorageUsage {
  readonly recoveryBytes: number
  readonly tempBytes: number
  readonly backupBytes: number
}

export type ClearStorageKind = 'temp' | 'recovery'

export interface ClearStorageResult {
  readonly freedBytes: number
}

export type AppPlatform = 'android' | 'ios' | 'other'

export interface AppInfo {
  readonly version: string
  readonly platform: AppPlatform
  readonly osVersion: string
}

export interface HomeOkResult {
  readonly ok: boolean
}

/** Message keys the home commands reject with (`MobileCommandError.messageKey`). */
export const HOME_ERROR_KEYS = {
  nameInvalid: 'mobile.home.nameInvalid',
  nameTaken: 'mobile.home.nameTaken',
  notSupportedHere: 'mobile.home.notSupportedHere',
  groupNameInvalid: 'mobile.home.groupNameInvalid',
  groupNameTaken: 'mobile.home.groupNameTaken',
  folderLost: 'mobile.home.folderLost',
  urlRefused: 'mobile.home.urlRefused',
} as const

export type HomeErrorKey = (typeof HOME_ERROR_KEYS)[keyof typeof HOME_ERROR_KEYS]
