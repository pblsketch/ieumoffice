/**
 * Why a save, Save As, copy or share did not reach its target, and the
 * sentence the person reads. In every case below the original document is
 * as it was (the save writes it only as its last step).
 *
 * Engine and gateway errors are not here: they go through the desktop's
 * own `localizeSaveError` (`SAVE_ERROR_PATTERNS` in save-actions.ts), and an
 * error that table does not know is shown as it is, as on the desktop.
 */
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import type { MobileStringKey } from '../../../i18n'

/** `messageKey` of the Rust refusal for a document changed after it was opened. */
export const DISK_CHANGED_MESSAGE_KEY = 'mobile.sheets.diskChanged'

export type SheetsSaveFailureKind =
  'cancelled' | 'read-only' | 'disk-changed' | 'too-large' | 'unreadable' | 'lock-failed' | 'other'

/** Locking the saved workbook again with its password failed. */
export class SheetsLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetsLockError'
  }
}

export function saveFailureKind(error: unknown): SheetsSaveFailureKind {
  if (error instanceof SheetsLockError) return 'lock-failed'
  if (error instanceof Error && error.name === 'SheetsSaveUnreadableError') return 'unreadable'
  if (isMobileCommandError(error)) {
    if (error.code === 'USER_CANCELLED') return 'cancelled'
    if (error.code === 'FILE_TOO_LARGE') return 'too-large'
    if (error.code === 'READ_ONLY_URI') return 'read-only'
    if (error.messageKey === DISK_CHANGED_MESSAGE_KEY) return 'disk-changed'
  }
  return 'other'
}

const FAILURE_TEXT: Partial<Record<SheetsSaveFailureKind, MobileStringKey>> = {
  'disk-changed': 'sheetsSaveErrDiskChanged',
  'too-large': 'sheetsSaveErrTooLarge',
  unreadable: 'sheetsSaveErrUnreadable',
  'lock-failed': 'sheetsSaveErrLockFailed',
  'read-only': 'sheetsSaveFailed',
}

/**
 * The sentence for a failure: the phone's own text for the failures the
 * phone adds, else the error's message (an engine sentence the desktop table
 * may still translate), else the general "could not save".
 */
export function saveFailureMessage(
  error: unknown,
  translate: (key: MobileStringKey) => string,
): string {
  const key = FAILURE_TEXT[saveFailureKind(error)]
  if (key) return translate(key)
  if (isMobileCommandError(error)) return error.detail ?? translate('sheetsSaveFailed')
  if (error instanceof Error && error.message) return error.message
  return translate('sheetsSaveFailed')
}
