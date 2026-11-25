// Default hooks into the PC PDF main-process code, loaded only when needed.
//
// Both PC modules expect Node: pdf-crypt.ts uses node:crypto and Buffer, blank-pdf.ts
// returns a Buffer. Under the test runner (Node) they work as they are; in the web view
// they work once the T2 Node stand-ins (PDF-T1, editors/pdf/engine) are wired into the
// build. Until then the probe reports "unavailable" (an encrypted file opens view-only,
// as on PC when its handler refuses) and the blank factory fails with a clear error.
// PDF-T4 may replace either hook through `createPdfEditorKind` (e.g. with the engine worker).
import { PdfOpenError, type PdfUnlockProbe } from '../openTypes'

/** PC `decryptPdf`: which password opened the file and what its /P allows. */
export const pcUnlockProbe: PdfUnlockProbe = async (bytes, password) => {
  let crypt: typeof import('../../../../../../pdf/src/main/pdf-crypt')
  try {
    crypt = await import('../../../../../../pdf/src/main/pdf-crypt')
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  try {
    const decrypted = await crypt.decryptDocument(bytes, password)
    return {
      ok: true,
      unlockedAs: decrypted.unlockedAs,
      modifying: decrypted.permissions.modifying,
    }
  } catch (err) {
    if (err instanceof crypt.WrongPasswordError) return { ok: false, reason: 'wrong-password' }
    if (err instanceof crypt.CertificateEncryptionError) {
      return { ok: false, reason: 'certificate-encryption' }
    }
    return { ok: false, reason: 'unavailable' }
  }
}

/** PC `blankPdfBuffer`: the single A4 page the PC "New PDF" starts from. */
export async function pcBlankPdfBytes(): Promise<Uint8Array> {
  if (typeof Buffer === 'undefined') throw new PdfOpenError('blank-unavailable')
  const { blankPdfBuffer } = await import('../../../../../../pdf/src/main/blank-pdf')
  const buffer = await blankPdfBuffer()
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice()
}
