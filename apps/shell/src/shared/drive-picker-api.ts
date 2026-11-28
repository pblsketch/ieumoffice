/**
 * The in-app "Attach from Google Drive" window: an editor's AI panel asks the
 * shell for Drive files to attach, the shell opens this modal window showing
 * the Drive files already chosen in this app (with search, pagination, and a
 * button to add more via Google's picker), and the shell validates the ticked
 * ids against what it listed or received from Google's picker before
 * downloading them. Tokens never cross this boundary.
 */
import type { Lang } from '@genoffice/i18n'
import type { DriveConnectFailure, DriveListResult, DriveListingRequest } from './drive-api'

export const DRIVE_PICKER_CHANNELS = {
  getInit: 'drive-picker:get-init',
  list: 'drive-picker:list',
  pickMore: 'drive-picker:pick-more',
  choose: 'drive-picker:choose',
  cancel: 'drive-picker:cancel',
} as const

export const DRIVE_PICKER_PAGE_KEY = 'aiOfficeDrivePicker'

export type DrivePickerTheme = 'light' | 'dark' | 'system'

export interface DrivePickerInit {
  lang: Lang
  theme: DrivePickerTheme
}

export type DrivePickerPickMoreResult =
  | { ok: true; picked: string[] }
  | { ok: false; reason: DriveConnectFailure | 'busy' | 'not-connected' }

export type DrivePickerChooseResult = { ok: true } | { ok: false; kind: 'unavailable' }

/** The picker window's window.aiOfficeDrivePicker */
export interface DrivePickerApi {
  getInit(): Promise<DrivePickerInit>
  onThemeChanged(handler: (theme: DrivePickerTheme) => void): () => void
  list(listing: DriveListingRequest, pageToken?: string): Promise<DriveListResult>
  pickMore(): Promise<DrivePickerPickMoreResult>
  choose(ids: string[]): Promise<DrivePickerChooseResult>
  cancel(): Promise<void>
}
