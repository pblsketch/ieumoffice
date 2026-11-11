import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isWithin, privateInput, privateOutput } from './privacy.mjs'

const sandbox = mkdtempSync(path.join(tmpdir(), 'ieum-hwp-validation-paths-'))
const checkout = path.join(sandbox, 'checkout')
const sibling = path.join(sandbox, 'checkout-private')
mkdirSync(checkout)
mkdirSync(sibling)
after(() => {
  assert.equal(path.dirname(realpathSync(sandbox)), realpathSync(tmpdir()))
  assert.ok(path.basename(sandbox).startsWith('ieum-hwp-validation-paths-'))
  rmSync(sandbox, { recursive: true })
})

test('uses path components on Windows, including drive changes and UNC paths', () => {
  const windows = path.win32
  assert.equal(isWithin('C:\\repo', 'C:\\repo\\report', windows), true)
  assert.equal(isWithin('C:\\repo', 'C:\\outputs\\report', windows), false)
  assert.equal(isWithin('C:\\repo', 'D:\\report', windows), false)
  assert.equal(isWithin('C:\\repo', 'C:\\repository\\report', windows), false)
  assert.equal(isWithin('C:\\REPO', 'c:\\repo', windows), true)
  assert.equal(isWithin('\\\\server\\share\\repo', '\\\\server\\share\\private', windows), false)
})
test('refuses checkout output before creating a directory', () => {
  const target = path.join(checkout, 'must-not-exist')
  assert.throws(() => privateOutput(target, checkout), /OUTPUT_MUST_BE_PRIVATE/)
  assert.equal(existsSync(target), false)
})
test('accepts a real sibling directory and refuses an existing output', () => {
  const target = path.join(sibling, 'new-run')
  assert.equal(privateOutput(target, checkout), realpathSync(target))
  assert.throws(() => privateOutput(target, checkout), { code: 'EEXIST' })
})
test('resolves directory links before allowing private output or input', (context) => {
  const linked = path.join(sibling, 'linked-checkout')
  try {
    symlinkSync(checkout, linked, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error
    context.skip('Host does not permit creating the test directory link')
    return
  }
  const target = path.join(linked, 'must-not-exist')
  assert.throws(() => privateOutput(target, checkout), /OUTPUT_MUST_BE_PRIVATE/)
  assert.equal(existsSync(path.join(checkout, 'must-not-exist')), false)
  writeFileSync(path.join(checkout, 'input.hwp'), 'unchanged')
  assert.throws(
    () => privateInput(path.join(linked, 'input.hwp'), checkout),
    /INPUT_MUST_BE_PRIVATE/,
  )
})
test('prevents an input or manifest inside the report tree from being overwritten', () => {
  const output = privateOutput(path.join(sibling, 'overlap-run'), checkout)
  const input = path.join(output, 'report.json')
  writeFileSync(input, 'private source')
  assert.throws(() => privateInput(input, checkout, output), /INPUT_OVERLAPS_OUTPUT/)
})
