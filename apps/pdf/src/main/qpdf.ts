/**
 * Add or remove a PDF's password with qpdf compiled to WebAssembly (the PDF
 * tools window, decision 0030). Runs in the shell's PDF job process. The
 * qpdf-calling core moved to @genoffice/pdf-ops (shared with the phone app);
 * this file hands it the qpdf factory and the wasm on disk, and keeps every
 * name it exported for its importers.
 */
import { randomUUID } from 'node:crypto'
import createQpdf from '@neslinesli93/qpdf-wasm'
import { qpdfDecrypt, qpdfEncrypt, type CreateQpdf, type EncryptOptions } from '@genoffice/pdf-ops'

export { QpdfFailedError, WrongPasswordError } from '@genoffice/pdf-ops'
export type { EncryptOptions } from '@genoffice/pdf-ops'

/** `bytes` locked with AES-256 */
export async function encryptPdfBytes(
  wasmPath: string,
  bytes: Uint8Array,
  options: EncryptOptions,
): Promise<Uint8Array> {
  const restrict = options.ownerPassword !== undefined
  // with no restrictions, nobody needs the owner password: a random one
  const owner = options.ownerPassword ?? randomUUID()
  return qpdfEncrypt(createQpdf as unknown as CreateQpdf, wasmPath, bytes, {
    userPassword: options.userPassword,
    ownerPassword: owner,
    restrict,
  })
}

/** `bytes` without its password, opened with `password` */
export async function decryptPdfBytes(
  wasmPath: string,
  bytes: Uint8Array,
  password: string,
  /**
   * Whether the password opens the file (PDFium, repair.ts pdfiumOpens). This
   * build of qpdf prints its messages straight to the console, so a wrong
   * password is told apart from other failures this way, before qpdf runs.
   */
  opens: (bytes: Uint8Array, password: string) => 'ok' | 'wrong-password' | 'unreadable',
): Promise<Uint8Array> {
  return qpdfDecrypt(createQpdf as unknown as CreateQpdf, wasmPath, bytes, password, opens)
}
