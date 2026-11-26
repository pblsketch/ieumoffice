// A workbook opened with a password and saved on the phone goes back locked
// with the same password; the desktop's own decryption opens the result.
// `small.mobile-relocked.xlsx` is what the phone's save path wrote to the
// original (Rust test `a_password_workbook_is_saved_locked_again_with_its_password`
// in src-tauri/src/sheets/tests.rs: the desktop-encrypted sample decrypted
// into the work folder, locked again by `encrypt`, written through storage).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decryptOfficeFile,
  isEncryptedOfficeFile,
} from '@genoffice/electron-utils/office-encryption'

const FIXTURES = resolve(__dirname, '../src-tauri/src/sheets/engine-lib/tests/fixtures/crypto')
const read = (name: string) => readFileSync(resolve(FIXTURES, name))

describe('a password workbook the phone saved, on the desktop', () => {
  it('is encrypted, and decrypts with the same password to the saved workbook', async () => {
    const saved = read('small.mobile-relocked.xlsx')
    expect(isEncryptedOfficeFile(saved)).toBe(true)
    // Not the desktop's own bytes: the phone locked it again.
    expect(Buffer.compare(saved, read('small.pc-agile.xlsx'))).not.toBe(0)
    const plain = await decryptOfficeFile(saved, '비밀번호 pw1')
    expect(Buffer.compare(plain, read('small.xlsx'))).toBe(0)
  }, 180_000)
})
