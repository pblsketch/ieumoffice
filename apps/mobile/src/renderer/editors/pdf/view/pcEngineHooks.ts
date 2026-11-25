// Default hooks into the PC PDF main-process code, loaded only when needed.
//
// Both PC modules expect Node: pdf-crypt.ts uses node:crypto and Buffer, blank-pdf.ts
// returns a Buffer. Under the test runner (Node) they work as they are; in the web view
// the T2 build rule (editors/pdf/engine/build/nodeShimPlugin.ts) gives every module
// under apps/pdf/src/main its Node stand-ins, including an imported `Buffer`, so they
// work there too. A probe that still fails reports "unavailable" (an encrypted file
// opens view-only, as on PC when its handler refuses).
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
  try {
    const { blankPdfBuffer } = await import('../../../../../../pdf/src/main/blank-pdf')
    // a Node Buffer in tests, the stand-in Buffer (a Uint8Array too) in the web view
    const buffer = await blankPdfBuffer()
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice()
  } catch (err) {
    throw new PdfOpenError('blank-unavailable', { cause: err })
  }
}
