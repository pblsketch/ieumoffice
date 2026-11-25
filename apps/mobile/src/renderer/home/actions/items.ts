// Pure rules of the home file actions (HOME-T7): rows from bridge data, menu and bar contents,
// name checks, error keys, and the PDF tools start built from picked files.
import {
  readFileRefBytes,
  type FavoriteEntry,
  type FolderEntry,
  type IncomingEntry,
} from '@genoffice/mobile-bridge/home'
import {
  isMobileCommandError,
  type MobileClient,
  type RecentDocEntry,
} from '@genoffice/mobile-bridge/transport'
import type { MobileStringKey } from '../../i18n'
import type { PdfToolInput, PdfToolStart } from '../pdfToolsLink'
import type { HomeBulkAction, HomeFileItem, HomeListKind, HomeRowAction } from './types'

/** Picture extensions the home lists (spec 3.5). */
export const HOME_PICTURE_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'heic',
  'heif',
]

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
}

/** Splits "report.final.md" into "report.final" and ".md"; a leading dot is part of the base. */
export function splitFileName(name: string): { readonly base: string; readonly ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot) }
}

function extensionOf(name: string): string {
  return splitFileName(name).ext.slice(1).toLowerCase()
}

/** The file's type: the known one, else from the extension, else a generic byte stream. */
export function itemMime(item: HomeFileItem): string {
  if (item.mime) return item.mime
  if (item.format === 'pdf') return 'application/pdf'
  return MIME_BY_EXTENSION[extensionOf(item.name)] ?? 'application/octet-stream'
}

export function isPdfItem(item: HomeFileItem): boolean {
  return item.format === 'pdf' || itemMime(item) === 'application/pdf'
}

export function isPictureItem(item: HomeFileItem): boolean {
  if (item.isPicture) return true
  if (item.format) return false
  return itemMime(item).startsWith('image/')
}

export interface RowExtras {
  readonly favorite?: boolean
  readonly groupId?: string | null
  readonly location?: string
}

export function recentFileItem(entry: RecentDocEntry, extras: RowExtras = {}): HomeFileItem {
  return {
    key: `recent:${entry.id}`,
    fileRef: { kind: 'recent', id: entry.id },
    name: entry.name,
    format: entry.format,
    time: entry.openedAt,
    location: extras.location,
    favorite: extras.favorite ?? false,
    groupId: extras.groupId ?? null,
  }
}

export function favoriteFileItem(
  entry: FavoriteEntry,
  extras: { readonly location?: string } = {},
): HomeFileItem {
  return {
    key: `favorite:${entry.docKey}`,
    fileRef: { kind: 'favorite', docKey: entry.docKey },
    name: entry.name,
    format: entry.format,
    time: entry.addedAt,
    location: extras.location,
    favorite: true,
    groupId: entry.groupId,
  }
}

export function folderFileItem(
  folderId: string,
  entry: FolderEntry,
  extras: RowExtras = {},
): HomeFileItem {
  return {
    key: `folder:${folderId}:${entry.id}`,
    fileRef: { kind: 'folder', folderId, entryId: entry.id },
    name: entry.name,
    format: entry.format,
    isPicture: entry.isPicture,
    sizeBytes: entry.sizeBytes,
    time: entry.modifiedAt,
    location: extras.location,
    favorite: extras.favorite ?? false,
    groupId: extras.groupId ?? null,
  }
}

export function incomingFileItem(batchId: string, entry: IncomingEntry): HomeFileItem {
  return {
    key: `incoming:${batchId}:${entry.id}`,
    fileRef: { kind: 'incoming', batchId, entryId: entry.id },
    name: entry.name,
    format: entry.format,
    isPicture: entry.isPicture,
    mime: entry.mime || undefined,
    sizeBytes: entry.sizeBytes,
    favorite: false,
  }
}

/**
 * A row's [⋯] items (spec 3.6). Received files are temporary copies, so they only share and select.
 * "Move to group" needs a starred file; "remove from list" is for the recent list (in the favorites
 * list it would repeat "remove from favorites", so that list shows only the latter).
 */
export function rowMenuActions(item: HomeFileItem, listKind: HomeListKind): HomeRowAction[] {
  if (listKind === 'incoming') return ['select', 'share']
  const actions: HomeRowAction[] = ['select', 'share', 'rename', 'duplicate']
  actions.push(item.favorite ? 'favoriteRemove' : 'favoriteAdd')
  if (item.favorite) actions.push('moveToGroup')
  if (listKind === 'recent') actions.push('removeFromList')
  actions.push('delete')
  return actions
}

export interface SelectionBarLayout {
  /** Buttons on the bar, left to right. */
  readonly bar: HomeBulkAction[]
  /** Items behind the bar's [⋯]; empty means no [⋯]. */
  readonly more: HomeBulkAction[]
}

/**
 * The selection bar for the picked files (spec 3.7). `pdfToolsReady` = PDF tools on and T3 linked;
 * then all-PDF adds [merge] and all-picture adds [make PDF].
 */
export function selectionBarActions(
  items: readonly HomeFileItem[],
  options: { readonly listKind: HomeListKind; readonly pdfToolsReady: boolean },
): SelectionBarLayout {
  const { listKind, pdfToolsReady } = options
  const bar: HomeBulkAction[] = ['share']
  const more: HomeBulkAction[] = []
  if (listKind === 'recent' || listKind === 'favorites') bar.push('removeFromList')
  if (listKind === 'folder') bar.push('delete')
  if (pdfToolsReady && items.length > 0) {
    if (items.every(isPdfItem)) bar.push('merge')
    else if (items.every(isPictureItem)) bar.push('imagesToPdf')
  }
  if (listKind !== 'incoming') {
    const allStarred = items.length > 0 && items.every((item) => item.favorite)
    more.push(allStarred ? 'favoriteRemove' : 'favoriteAdd')
    if (allStarred) more.push('moveToGroup')
    if (listKind !== 'folder') more.push('delete')
  }
  return { bar, more }
}

/** Refuses an empty base name or one with a slash or a backslash; null when it may be sent. */
export function validateBaseName(base: string): 'homeActNameInvalid' | null {
  const trimmed = base.trim()
  if (trimmed.length === 0 || /[/\\]/.test(trimmed)) return 'homeActNameInvalid'
  return null
}

const ERROR_KEYS: Readonly<Record<string, MobileStringKey>> = {
  'mobile.home.nameInvalid': 'homeActNameInvalid',
  'mobile.home.nameTaken': 'homeActNameTaken',
  'mobile.home.notSupportedHere': 'homeActNotSupportedHere',
  'mobile.home.groupNameInvalid': 'homeActGroupNameInvalid',
  'mobile.home.groupNameTaken': 'homeActGroupNameTaken',
  'mobile.home.folderLost': 'homeActFolderLost',
  'mobile.format.notOpenable': 'formatNotOpenable',
}

/** The screen string for a backend `messageKey` (spec 3.20); unknown ones say "could not do it". */
export function homeActErrorKey(messageKey: string | undefined): MobileStringKey {
  return (messageKey && ERROR_KEYS[messageKey]) || 'homeActFailed'
}

/** The screen string for a rejected action, or null when the user cancelled it. */
export function homeActErrorKeyOf(err: unknown): MobileStringKey | null {
  if (isMobileCommandError(err)) {
    if (err.code === 'USER_CANCELLED') return null
    return homeActErrorKey(err.messageKey)
  }
  return 'homeActFailed'
}

/**
 * The T3 tools start for the picked files, in pick order. Each input reads its bytes only when the
 * tool calls `readBytes()`, so the tool can read one file at a time.
 */
export function buildPdfToolStart(
  kind: 'merge' | 'imagesToPdf',
  items: readonly HomeFileItem[],
  client: MobileClient,
): PdfToolStart {
  const inputs: PdfToolInput[] = items.map((item) => ({
    name: item.name,
    mime: itemMime(item),
    sizeBytes: item.sizeBytes,
    readBytes: async () => (await readFileRefBytes(client, item.fileRef)).bytes,
  }))
  return { kind, inputs }
}
