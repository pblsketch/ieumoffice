// A workbook the phone encrypted (the engine library's `encrypt`, kept as a
// sample by its Rust tests) opens with the desktop's own decryption
// (packages/electron-utils/src/office-encryption.ts), byte for byte. The
// other direction (desktop-encrypted samples on the phone) is in
// apps/mobile/src-tauri/src/sheets/engine-lib/src/crypto_tests.rs.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OfficeDecryptError,
  decryptOfficeFile,
  isEncryptedOfficeFile,
} from '@genoffice/electron-utils/office-encryption'

const FIXTURES = resolve(__dirname, '../src-tauri/src/sheets/engine-lib/tests/fixtures/crypto')
const read = (name: string) => readFileSync(resolve(FIXTURES, name))

describe('a workbook the phone encrypted, on the desktop', () => {
  it('decrypts to the plain workbook with the desktop code', async () => {
    const locked = read('small.mobile-agile.xlsx')
    expect(isEncryptedOfficeFile(locked)).toBe(true)
    const plain = await decryptOfficeFile(locked, '비밀번호 pw1')
    expect(Buffer.compare(plain, read('small.xlsx'))).toBe(0)
  }, 180_000)

  it('refuses a wrong password the way the desktop reports it', async () => {
    await expect(decryptOfficeFile(read('small.mobile-agile.xlsx'), 'nope')).rejects.toSatisfy(
      (error: unknown) => error instanceof OfficeDecryptError && error.reason === 'wrong-password',
    )
  }, 180_000)
})
