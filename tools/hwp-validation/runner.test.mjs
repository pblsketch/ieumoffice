import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  realpathSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { root, hash, engineIdentity, loadEngine } from './runtime.mjs'

const sandbox = mkdtempSync(join(tmpdir(), 'ieum-hwp-validation-runner-'))
const meta = JSON.parse(readFileSync(join(root, 'vendor/rhwp-core/package.json'), 'utf8'))
const run = (...args) =>
  spawnSync(
    process.execPath,
    [join(root, 'tools/hwp-validation/run.mjs'), '--engine-version', meta.version, ...args],
    { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 },
  )
after(() => {
  assert.equal(dirname(realpathSync(sandbox)), realpathSync(tmpdir()))
  assert.ok(basename(sandbox).startsWith('ieum-hwp-validation-runner-'))
  rmSync(sandbox, { recursive: true })
})

test('runs real HWP/HWPX edits, merged-cell round-trips and refusal checks', async () => {
  const output = join(sandbox, 'successful')
  const result = run('--synthetic', '--out', output, '--artifacts')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
  assert.equal(report.engineVersion, meta.version)
  assert.equal(report.wasmSha256, meta.rhwp.wasmSha256)
  assert.equal(report.officialComparison, false)
  assert.equal(report.passed, true)
  assert.equal(report.results.length, 2)
  assert.deepEqual(
    report.results.map((entry) => entry.format),
    ['hwp', 'hwpx'],
  )
  for (const entry of report.results) {
    assert.equal(entry.status, 'PASS')
    assert.equal(entry.tableCount, 1)
    for (const check of [
      'unchangedTables',
      'unchangedLayout',
      'reopenedTables',
      'reopenedLayout',
      'requestedTextOnly',
      'otherTableCellsUnchanged',
      'nonemptyCellProtected',
      'missingTargetRejectedWithoutMutation',
      'renderKeepsNativeBytes',
      'sourceUnchanged',
    ])
      assert.equal(entry.checks[check], true, check)
    assert.ok(readFileSync(join(output, entry.id, `edited.${entry.format}`)).length > 0)
  }
  assert.equal(JSON.stringify(report).includes('Original paragraph.'), false)
  assert.equal(JSON.stringify(report).includes(sandbox), false)
  // Refuse a second run without replacing either previous report or document artifacts.
  const previous = hash(readFileSync(join(output, 'report.json')))
  assert.equal(run('--synthetic', '--out', output).status, 2)
  assert.equal(hash(readFileSync(join(output, 'report.json'))), previous)

  const source = join(sandbox, 'immutable-source.hwp')
  copyFileSync(join(output, 'synthetic-inputs/synthetic.hwp'), source)
  const before = hash(readFileSync(source))
  const invalid = join(sandbox, 'invalid.hwp')
  writeFileSync(invalid, 'private document text that is not HWP')
  // Tabs are inserted through the native editor API; the plugin deliberately
  // accepts only one line of plain text in replaceText.
  const HwpDocument = await loadEngine(engineIdentity(meta.version))
  const withTab = HwpDocument.createEmpty()
  let tabBytes
  try {
    withTab.createBlankDocument()
    withTab.insertText(0, 0, 0, 'A\tB')
    tabBytes = withTab.exportHwp()
  } finally {
    withTab.free()
  }
  const tabSource = join(sandbox, 'unmeasured-tab.hwp')
  writeFileSync(tabSource, tabBytes)
  const { newTabsOf } = createRequire(import.meta.url)(join(output, 'host-save-helpers.cjs'))
  const spots = newTabsOf(tabBytes, 'hwp')
  assert.equal(spots.length, 1)
  const manifest = join(sandbox, 'cases.json')
  writeFileSync(
    manifest,
    JSON.stringify({
      cases: [
        { id: 'invalid-signature', path: invalid },
        { id: 'missing-target', path: source, find: 'not present', replace: 'never written' },
        { id: 'unmeasured-tab', path: tabSource },
        {
          id: 'invalid-tab-width',
          path: tabSource,
          measuredTabs: [{ ...spots[0], width: 0, type: 0, fill: 0 }],
        },
        { id: 'unchanged-real-engine', path: source },
        { id: 'literal-dollar', path: source, find: 'Original paragraph.', replace: '$& literal' },
      ],
    }),
  )
  const failedOutput = join(sandbox, 'failures')
  const failed = run('--manifest', manifest, '--out', failedOutput)
  assert.equal(failed.status, 1, failed.stdout + failed.stderr)
  const failedReport = JSON.parse(readFileSync(join(failedOutput, 'report.json'), 'utf8'))
  assert.equal(failedReport.passed, false)
  assert.deepEqual(
    failedReport.results.map((entry) => entry.status),
    ['FAIL', 'FAIL', 'FAIL', 'FAIL', 'PASS', 'PASS'],
  )
  assert.equal(failedReport.results[0].error, 'INPUT_SIGNATURE_INVALID')
  assert.equal(failedReport.results[1].error, 'REPLACEMENT_MUST_MATCH_ONCE')
  assert.equal(failedReport.results[2].error, 'TAB_MEASUREMENTS_REQUIRED')
  assert.equal(failedReport.results[3].error, 'INVALID_TAB_MEASUREMENTS')
  assert.equal(failedReport.results[5].checks.requestedTextOnly, true)
  assert.equal(hash(readFileSync(source)), before)
  assert.equal(JSON.stringify(failedReport).includes('private document text'), false)
})

test('refuses a changed engine pin and invalid budgets before creating output', () => {
  const output = join(sandbox, 'setup-error')
  const mismatch = spawnSync(
    process.execPath,
    [
      join(root, 'tools/hwp-validation/run.mjs'),
      '--engine-version',
      'unreviewed-engine',
      '--synthetic',
      '--out',
      output,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  assert.equal(mismatch.status, 2)
  assert.match(mismatch.stderr, /ENGINE_VERSION_MISMATCH/)
  assert.equal(existsSync(output), false)
  assert.equal(run('--synthetic', '--out', output, '--tolerance', '1').status, 2)
  assert.equal(run('--synthetic', '--out', output, '--max-pages', 'NaN').status, 2)
  assert.equal(existsSync(output), false)
})
