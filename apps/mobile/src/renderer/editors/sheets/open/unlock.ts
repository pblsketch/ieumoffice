/**
 * Opening a password-protected workbook (spec 2.1, 5.1): the working copy
 * in the work folder is probed; an encrypted one is decrypted, by the engine
 * library, into a new file there, after asking for the password (again after
 * a wrong one). The plain workbook never crosses the WebView bridge; the
 * encrypted copy is deleted once it is decrypted. Cancelling throws
 * `USER_CANCELLED` (App opens nothing and says nothing).
 *
 * The desktop counterpart is `unlockOfficeFile`
 * (packages/electron-utils/src/office-encryption.ts) in its main process.
 */
import {
  sheetsDecrypt,
  sheetsProbeEncryption,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsTempStat,
} from '@genoffice/mobile-bridge/sheets'
import type { SheetsEngineClient } from '../desktop-api/engine'
import type { MobileStringKey } from '../../../i18n'

/** The open stops with a notice the person can read (not a retry, not a cancel). */
export class SheetsOpenRefusal extends Error {
  readonly key: MobileStringKey

  constructor(key: MobileStringKey, message: string) {
    super(message)
    this.name = 'SheetsOpenRefusal'
    this.key = key
  }
}

export interface UnlockedWorkingCopy {
  readonly path: string
  readonly size: number
  /** The plain file's kind: `xlsx` (a package, its original extension) or `xls` (to convert). */
  readonly ext: string
  /** Kept in memory for the save, which locks the saved workbook again with it. */
  readonly password: string
}

export interface UnlockOptions {
  /** One password prompt; `retry` says the last one did not open the file. */
  readonly ask: (retry: boolean) => Promise<string>
  /** The refusal text in the UI language. */
  readonly refusal: (key: MobileStringKey) => string
}

/**
 * Returns the decrypted working copy, or `null` when `copy` is not encrypted
 * (the caller keeps it). The encrypted copy is deleted only after it was
 * decrypted; on any failure the caller still owns (and deletes) it.
 */
export async function unlockWorkingCopy(
  client: SheetsEngineClient,
  copy: { readonly path: string; readonly ext: string },
  options: UnlockOptions,
): Promise<UnlockedWorkingCopy | null> {
  const probe = await sheetsProbeEncryption(client, copy.path)
  if (!probe.ok) throw new Error(probe.error.message)
  if (!probe.result.encrypted) return null
  if (!probe.result.supported) {
    throw new SheetsOpenRefusal(
      'sheetsEncryptionUnsupported',
      options.refusal('sheetsEncryptionUnsupported'),
    )
  }
  const plainExt = probe.result.document === 'xls' ? 'xls' : copy.ext === 'xlsm' ? 'xlsm' : 'xlsx'
  let retry = false
  for (;;) {
    const password = await options.ask(retry)
    const { path: target } = await sheetsTempNewPath(client, plainExt)
    const answer = await sheetsDecrypt(client, copy.path, target, password)
    if (answer.ok) {
      await sheetsTempDelete(client, copy.path).catch(() => undefined)
      const stat = await sheetsTempStat(client, target)
      return {
        path: target,
        size: stat?.size ?? 0,
        ext: answer.result.document === 'xls' ? 'xls' : plainExt,
        password,
      }
    }
    // A failed decrypt leaves no target file; nothing to delete here.
    switch (answer.error.code) {
      case 'wrong_password':
        retry = true
        continue
      case 'damaged':
        throw new SheetsOpenRefusal(
          'sheetsEncryptionDamaged',
          options.refusal('sheetsEncryptionDamaged'),
        )
      case 'unsupported':
        throw new SheetsOpenRefusal(
          'sheetsEncryptionUnsupported',
          options.refusal('sheetsEncryptionUnsupported'),
        )
      default:
        throw new Error(answer.error.message)
    }
  }
}
