// Read-only judgment of an opened PDF, the same rule as the PC PDF editor
// (apps/pdf/src/renderer/App.tsx `readOnly`) plus the phone's own case: a file
// the app may not write back (writable: false) can only be saved under a new name.

/** Why a PDF opens view-only; null when it may be edited. */
export type PdfReadOnlyReason = 'encrypted' | 'damaged' | 'notWritable'

/** What the password that opened the document allows (PC `diskLock`). */
export interface PdfLock {
  readonly unlockedAsOwner: boolean
  /** The /P bit "modify contents" (§7.6.3.2). */
  readonly modifying: boolean
}

export interface PdfReadOnlyInput {
  /** Blank stand-ins replaced lost pages (PC page-tree-patch): the save side still sees the damage. */
  readonly damaged: boolean
  /** The file carries an /Encrypt dictionary. */
  readonly encrypted: boolean
  /** The session's own security handler accepted the password (PC `sessionUnlocked`). */
  readonly sessionUnlocked: boolean
  readonly lock: PdfLock | null
  readonly writable: boolean
  readonly isUntitled: boolean
}

/**
 * PC rule: damaged → view-only; encrypted → view-only unless our own handler
 * unlocked it, and a session holding only the user password (or the empty one
 * of an owner-only file) is bound by /P: modifying denied means view-only.
 * The owner password ignores /P. Untitled documents live in memory and are
 * always editable; a file the app cannot write back is view-only here and
 * reaches edits through "save as".
 */
export function pdfReadOnlyReason(input: PdfReadOnlyInput): PdfReadOnlyReason | null {
  if (input.damaged) return 'damaged'
  if (
    input.encrypted &&
    (!input.sessionUnlocked ||
      (input.lock !== null && !input.lock.unlockedAsOwner && !input.lock.modifying))
  ) {
    return 'encrypted'
  }
  if (!input.isUntitled && !input.writable) return 'notWritable'
  return null
}
