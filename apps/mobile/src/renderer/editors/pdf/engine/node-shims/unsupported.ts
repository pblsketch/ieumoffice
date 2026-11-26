/**
 * Error for a Node or Electron facility the PC save code reaches that the
 * phone does not provide (file writes, Electron, signing, OCR, image edits).
 * The message is stable so callers and tests can recognise it.
 */
export const NOT_ON_MOBILE = 'not available on mobile'

export class NotOnMobileError extends Error {
  readonly code = 'ENOTONMOBILE'
  constructor(what: string) {
    super(`${NOT_ON_MOBILE}: ${what}`)
    this.name = 'NotOnMobileError'
  }
}

export function notOnMobile(what: string): never {
  throw new NotOnMobileError(what)
}
