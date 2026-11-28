// Shared shapes of the home file actions (HOME-T7). The parts know only FileRef, display data and
// the bridge wrappers; which list they serve comes in as `listKind`.
import type { FileRef } from '@genoffice/mobile-bridge/home'
import type { MobileClient, MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import type { ToastRequest } from '../../components/Toast'

/** Which list the rows belong to; it decides the menu items and the selection bar. */
export type HomeListKind = 'recent' | 'favorites' | 'folder' | 'incoming'

/** One file row as the parts draw and act on it. */
export interface HomeFileItem {
  /** Unique within the list: the React key and the selection key. */
  readonly key: string
  readonly fileRef: FileRef
  /** File name, extension included. */
  readonly name: string
  readonly format?: MobileDocFormat
  readonly isPicture?: boolean
  /** Known type ('application/pdf', 'image/jpeg', …); derived from the name when left out. */
  readonly mime?: string
  readonly sizeBytes?: number
  /** Opened, modified or added time (ms) for the second line. */
  readonly time?: number
  /** Linked folder name for the second line. */
  readonly location?: string
  /** Starred: shows the mark and allows "move to group". */
  readonly favorite?: boolean
  /** Group of a starred file (null = no group). */
  readonly groupId?: string | null
}

/** Items of a row's [⋯] menu. */
export type HomeRowAction =
  | 'select'
  | 'share'
  | 'rename'
  | 'duplicate'
  | 'favoriteAdd'
  | 'favoriteRemove'
  | 'moveToGroup'
  | 'removeFromList'
  | 'delete'

/** Buttons of the selection bar and items of its [⋯]. */
export type HomeBulkAction =
  | 'share'
  | 'removeFromList'
  | 'delete'
  | 'merge'
  | 'imagesToPdf'
  | 'favoriteAdd'
  | 'favoriteRemove'
  | 'moveToGroup'

/** What the actions need from the app: the bridge client and the app's toast. */
export interface HomeActionsHost {
  readonly client: MobileClient
  showToast(input: ToastRequest | string): void
  /** Called after a change when the list gives no `onChanged`. */
  refreshHome?(): Promise<void>
}

/** The change an action made, for a list that refreshes selectively. */
export type HomeActionChange =
  'rename' | 'duplicate' | 'favorite' | 'group' | 'groups' | 'removeFromList' | 'delete'
