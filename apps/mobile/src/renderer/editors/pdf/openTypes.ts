// Light types and errors of the PDF open path; the kind imports these without the viewer chunk.
import { MobileCommandError } from '@genoffice/mobile-bridge/transport'

/** Asks for the open password; null when the person cancels. `wrong`: the last one failed. */
export type PdfPasswordPrompt = (request: {
  readonly fileName: string
  readonly wrong: boolean
}) => Promise<string | null>

/** What the app's own security handler says about a password (PC `decryptPdf`). */
export type PdfUnlockOutcome =
  | { readonly ok: true; readonly unlockedAs: 'user' | 'owner'; readonly modifying: boolean }
  | {
      readonly ok: false
      readonly reason: 'wrong-password' | 'certificate-encryption' | 'unavailable'
    }

export type PdfUnlockProbe = (bytes: Uint8Array, password: string) => Promise<PdfUnlockOutcome>

export type PdfOpenErrorKind = 'unreadable' | 'certificate' | 'blank-unavailable'

/** A PDF that cannot be shown; the kind turns `kind` into the banner text. */
export class PdfOpenError extends Error {
  readonly kind: PdfOpenErrorKind

  constructor(kind: PdfOpenErrorKind, options?: { cause?: unknown }) {
    super(`pdf open failed: ${kind}`, options)
    this.name = 'PdfOpenError'
    this.kind = kind
  }
}

/**
 * The password prompt was cancelled: nothing opens. USER_CANCELLED keeps the file
 * picker path silent; the empty message keeps the other open paths (which show an
 * open error's message as a banner) silent too.
 */
export class PdfOpenCancelledError extends MobileCommandError {
  constructor() {
    super({ code: 'USER_CANCELLED', messageKey: 'mobile.pdf.passwordCancelled' })
    this.message = ''
  }
}
