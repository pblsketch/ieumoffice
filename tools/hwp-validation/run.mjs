#!/usr/bin/env node
// Adapted from gusdhks-wq/openoffice edb6f0af (Apache-2.0); see README.md.
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assets, assetsEqual } from './assets.mjs'
import { layout, compareLayout } from './layout.mjs'
import { privateInput, privateOutput } from './privacy.mjs'
import { root, hash, engineIdentity, loadEngine, loadSaveHelpers } from './runtime.mjs'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const codeOf = (error) =>
  /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'ENGINE_OR_IO_ERROR'

function pluginFor(doc, agentPlugin) {
  return agentPlugin.activate({
    read: (fn) => fn(doc),
    transaction: (_label, fn) => fn({ doc: () => doc, deferPagination: () => {} }),
    events: { on: () => () => {} },
    automation: { execute: () => null },
  })
}

function tables(plugin) {
  const list = plugin.listTables()
  if (list.partial || list.count !== list.tables?.length) throw Error('TABLE_LIST_PARTIAL')
  return list.tables.map(({ table, rows, cols, inTable }) => {
    const cells = []
    const visited = new Set()
    let row = 1
    do {
      if (!Number.isInteger(row) || row < 1 || visited.has(row)) throw Error('TABLE_READ_LOOP')
      visited.add(row)
      const result = plugin.readTable(table, row)
      if (!result.ok) throw Error('TABLE_READ_FAILED')
      cells.push(...result.cells)
      if (cells.length > 100000) throw Error('TABLE_CELL_BUDGET_EXCEEDED')
      row = result.nextRow
    } while (row !== undefined)
    return { table, rows, cols, inTable: inTable ?? null, cells }
  })
}

function snapshot(doc, agentPlugin) {
  const plugin = pluginFor(doc, agentPlugin)
  const text = plugin.readText()
  if (typeof text !== 'string') throw Error('TEXT_READ_FAILED')
  return { text, tables: tables(plugin), pages: doc.pageCount() }
}

function rawExport(doc, format) {
  if (format === 'hwp') {
    const verified = JSON.parse(doc.exportHwpVerify())
    if (!verified.recovered || verified.pageCountBefore !== verified.pageCountAfter)
      throw Error('HWP_EXPORT_VERIFY_FAILED')
    return doc.exportHwp()
  }
  return doc.exportHwpx()
}

const tabKey = (spot) => JSON.stringify([spot.sec, spot.para, spot.cells, spot.tab, spot.tabs])

function serialize(doc, format, sourceBase, measurements, helpers) {
  const raw = rawExport(doc, format)
  const needed = helpers.newTabsOf(raw, format)
  const supplied = measurements ?? []
  // Headless Node cannot invent the UI's font measurements. A refusal here is
  // stricter than the product's warning policy and is reported as such.
  if (!Array.isArray(supplied)) throw Error('INVALID_TAB_MEASUREMENTS')
  const measured = needed.map((spot) => {
    const matches = supplied.filter((value) => tabKey(value) === tabKey(spot))
    if (matches.length !== 1) throw Error('TAB_MEASUREMENTS_REQUIRED')
    const value = matches[0]
    if (
      !Number.isInteger(value.width) ||
      value.width <= 0 ||
      value.width > 0x7fffffff ||
      !Number.isInteger(value.type) ||
      value.type < 0 ||
      value.type > 3 ||
      !Number.isInteger(value.fill) ||
      value.fill < 0 ||
      value.fill > 255
    )
      throw Error('INVALID_TAB_MEASUREMENTS')
    return value
  })
  const fixed = helpers.applySaveFixes(raw, format, measured, sourceBase)
  if (fixed.tailsSkipped) throw Error('HOST_PRESERVATION_REFUSED')
  if (!helpers.bytesMatchFormat(fixed.bytes, format)) throw Error('OUTPUT_SIGNATURE_INVALID')
  if (helpers.newTabsOf(fixed.bytes, format).length > 0) throw Error('TAB_MEASUREMENTS_INCOMPLETE')
  return fixed.bytes
}

async function runCase(item, context) {
  const { HwpDocument, agentPlugin, helpers, output, tolerance, maxPages, artifacts } = context
  const result = { id: item.id, checks: {}, warnings: [], geometry: {} }
  const opened = new Set()
  const open = (bytes) => {
    const doc = new HwpDocument(bytes)
    opened.add(doc)
    return doc
  }
  const close = (doc) => {
    doc.free()
    opened.delete(doc)
  }
  let sourceHash
  let sourceState
  try {
    sourceState = statSync(item.path)
    if (sourceState.size > 128 * 1024 * 1024) throw Error('SOURCE_SIZE_BUDGET_EXCEEDED')
    const source = readFileSync(item.path)
    sourceHash = hash(source)
    const format = extname(item.path).slice(1).toLowerCase()
    if (!['hwp', 'hwpx'].includes(format)) throw Error('UNSUPPORTED_FORMAT')
    result.format = format
    result.checks.inputSignature = helpers.bytesMatchFormat(source, format)
    if (!result.checks.inputSignature) throw Error('INPUT_SIGNATURE_INVALID')
    const base =
      format === 'hwp'
        ? { tails: helpers.sectionTailsOf(source), kinds: helpers.fieldKindsOf(source) }
        : {}
    const sourceAssets = await assets(source, format)
    let doc = open(source)
    const before = snapshot(doc, agentPlugin)
    let beforeLayout = layout(doc, maxPages)
    // Compare a no-edit save first: serializer/preservation loss is distinct
    // from a requested text edit that legitimately changes pagination.
    const baselineBytes = serialize(doc, format, base, item.measuredTabs, helpers)
    const baseline = open(baselineBytes)
    const baselineState = snapshot(baseline, agentPlugin)
    result.geometry.unchanged = compareLayout(beforeLayout, layout(baseline, maxPages), tolerance)
    beforeLayout = null
    result.checks.unchangedLayout = result.geometry.unchanged.equal
    result.checks.unchangedText = baselineState.text === before.text
    result.checks.unchangedTables = same(baselineState.tables, before.tables)
    result.checks.unchangedPages = baselineState.pages === before.pages
    result.checks.unchangedAssets = assetsEqual(sourceAssets, await assets(baselineBytes, format))
    close(baseline)
    close(doc)

    doc = open(source)
    const plugin = pluginFor(doc, agentPlugin)
    if (item.find !== undefined) {
      if (before.text.split(item.find).length !== 2) throw Error('REPLACEMENT_MUST_MATCH_ONCE')
      const edited = plugin.replaceText(item.find, item.replace)
      result.checks.editAppliedOnce = edited.ok === true && edited.count === 1
      result.checks.requestedTextOnly =
        plugin.readText() === before.text.replace(item.find, () => item.replace)
    }
    if (item.tableEdit) {
      const edit = item.tableEdit
      const prior = snapshot(doc, agentPlugin)
      const expectedTables = structuredClone(prior.tables)
      const cell = expectedTables
        .find((table) => table.table === edit.table)
        ?.cells.find((value) => value.row === edit.row && value.col === edit.col)
      if (!cell?.text) throw Error('TABLE_EDIT_REQUIRES_NONEMPTY_CELL')
      cell.text = edit.text
      const priorBytes = hash(format === 'hwp' ? doc.exportHwp() : doc.exportHwpx())
      const refused = plugin.fillCells(edit.table, [edit], false)
      result.checks.nonemptyCellProtected =
        !refused.ok &&
        same(snapshot(doc, agentPlugin), prior) &&
        hash(format === 'hwp' ? doc.exportHwp() : doc.exportHwpx()) === priorBytes
      const applied = plugin.fillCells(edit.table, [edit], true)
      result.checks.tableEditApplied = applied.ok === true
      result.checks.otherTableCellsUnchanged = same(tables(plugin), expectedTables)
    }
    const expected = snapshot(doc, agentPlugin)
    let expectedLayout = layout(doc, maxPages)
    const bytes = serialize(doc, format, base, item.measuredTabs, helpers)
    const reopened = open(bytes)
    const actual = snapshot(reopened, agentPlugin)
    result.geometry.reopened = compareLayout(expectedLayout, layout(reopened, maxPages), tolerance)
    expectedLayout = null
    result.checks.reopenedLayout = result.geometry.reopened.equal
    result.checks.reopenedText = actual.text === expected.text
    result.checks.reopenedTables = same(actual.tables, expected.tables)
    result.checks.reopenedPages = actual.pages === expected.pages
    result.checks.reopenedAssets = assetsEqual(sourceAssets, await assets(bytes, format))
    result.pages = { input: before.pages, edited: expected.pages, reopened: actual.pages }
    result.tableCount = actual.tables.length
    result.assetCount = Object.keys(sourceAssets).length
    if (before.pages !== expected.pages) result.warnings.push('EDIT_CHANGED_PAGINATION')
    const pua = new Set()
    for (const char of actual.text) {
      const cp = char.codePointAt(0)
      if (
        (cp >= 0xe000 && cp <= 0xf8ff) ||
        (cp >= 0xf0000 && cp <= 0xffffd) ||
        (cp >= 0x100000 && cp <= 0x10fffd)
      )
        pua.add(cp)
    }
    if (pua.size) result.warnings.push('PRIVATE_USE_FONT_COVERAGE_REQUIRES_VISUAL_REVIEW')
    // Rejected edits must preserve native bytes as well as visible text/table summaries.
    const missing = '__absent_' + sourceHash.slice(0, 16) + '__'
    if (actual.text.includes(missing)) throw Error('NEGATIVE_TEST_COLLISION')
    const beforeRefusal = hash(format === 'hwp' ? reopened.exportHwp() : reopened.exportHwpx())
    const rejected = pluginFor(reopened, agentPlugin).replaceText(missing, 'must not appear')
    result.checks.missingTargetRejectedWithoutMutation =
      !rejected.ok &&
      same(snapshot(reopened, agentPlugin), actual) &&
      hash(format === 'hwp' ? reopened.exportHwp() : reopened.exportHwpx()) === beforeRefusal
    result.checks.allPagesRender = false
    let directory
    if (artifacts) {
      directory = join(output, item.id)
      mkdirSync(directory)
      writeFileSync(join(directory, `edited.${format}`), bytes, { flag: 'wx' })
    }
    for (let page = 0; page < reopened.pageCount(); page++) {
      const svg = reopened.renderPageSvg(page)
      if (!svg.startsWith('<svg')) throw Error('PAGE_RENDER_FAILED')
      if (directory) writeFileSync(join(directory, `page-${page + 1}.svg`), svg, { flag: 'wx' })
    }
    result.checks.allPagesRender = true
    result.checks.renderKeepsNativeBytes =
      hash(format === 'hwp' ? reopened.exportHwp() : reopened.exportHwpx()) === beforeRefusal
  } catch (error) {
    // Never copy exception messages containing document text or filenames into a report.
    result.error = codeOf(error)
  } finally {
    for (const doc of opened) doc.free()
    if (sourceHash) {
      try {
        const state = statSync(item.path)
        result.checks.sourceUnchanged =
          state.size === sourceState.size &&
          state.mtimeMs === sourceState.mtimeMs &&
          hash(readFileSync(item.path)) === sourceHash
      } catch {
        result.checks.sourceUnchanged = false
      }
    }
  }
  result.status =
    result.error || Object.values(result.checks).some((value) => value !== true) ? 'FAIL' : 'PASS'
  return result
}

function manifestCases(file, output) {
  const manifest = privateInput(resolve(file), root, output)
  const data = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!Array.isArray(data.cases) || data.cases.length === 0) throw Error('INVALID_MANIFEST')
  return data.cases.map((item) => ({
    ...item,
    path: privateInput(resolve(dirname(manifest), item.path), root, output),
  }))
}

function syntheticCases(HwpDocument, output) {
  const directory = join(output, 'synthetic-inputs')
  mkdirSync(directory)
  const doc = HwpDocument.createEmpty()
  try {
    doc.createBlankDocument()
    doc.insertText(0, 0, 0, 'Synthetic heading')
    doc.splitParagraph(0, 0, doc.getParagraphLength(0, 0))
    doc.insertText(0, 1, 0, 'Original paragraph.')
    doc.splitParagraph(0, 1, doc.getParagraphLength(0, 1))
    doc.pasteHtml(
      0,
      2,
      0,
      '<table><tr><td>Kind</td><td>Value</td></tr><tr><td>Target</td><td>Old value</td></tr><tr><td colspan="2">Merged cell</td></tr></table>',
    )
    return ['hwp', 'hwpx'].map((format) => {
      const path = join(directory, `synthetic.${format}`)
      writeFileSync(path, rawExport(doc, format), { flag: 'wx' })
      return {
        id: `synthetic-${format}`,
        path,
        find: 'Original paragraph.',
        replace: 'A longer replacement paragraph for round-trip testing.',
        tableEdit: { table: 1, row: 2, col: 2, text: 'Updated value' },
      }
    })
  } finally {
    doc.free()
  }
}

async function main(args) {
  const flags = new Map()
  const switches = new Set(['--synthetic', '--artifacts', '--help'])
  const values = new Set(['--out', '--manifest', '--engine-version', '--tolerance', '--max-pages'])
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flags.has(flag) || (!switches.has(flag) && !values.has(flag)))
      throw Error('INVALID_ARGUMENT')
    if (switches.has(flag)) flags.set(flag, true)
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw Error('INVALID_ARGUMENT')
      flags.set(flag, value)
    }
  }
  if (flags.has('--help')) {
    console.log(
      'node tools/hwp-validation/run.mjs --engine-version <pinned version> --out <NEW private directory> (--synthetic | --manifest <private JSON>) [--artifacts] [--tolerance 0.5] [--max-pages 200]',
    )
    return
  }
  if (!flags.has('--out') || (!flags.has('--synthetic') && !flags.has('--manifest')))
    throw Error('MISSING_ARGUMENT')
  const tolerance = Number(flags.get('--tolerance') ?? 0.5)
  compareLayout(null, null, tolerance)
  const maxPages = Number(flags.get('--max-pages') ?? 200)
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000)
    throw Error('INVALID_PAGE_BUDGET')
  const identity = engineIdentity(flags.get('--engine-version'))
  const output = privateOutput(flags.get('--out'), root)
  let cases = flags.has('--manifest') ? manifestCases(flags.get('--manifest'), output) : []
  const HwpDocument = await loadEngine(identity)
  const { helpers, sha256 } = loadSaveHelpers(output)
  const { agentPlugin } = await import(
    pathToFileURL(join(root, 'apps/hwp/studio-plugin/agent-plugin.mjs')).href
  )
  if (flags.has('--synthetic')) cases = cases.concat(syntheticCases(HwpDocument, output))
  const ids = new Set(['synthetic-inputs'])
  for (const item of cases) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id))
      throw Error('INVALID_OR_DUPLICATE_CASE_ID')
    ids.add(item.id)
    if (
      (item.find !== undefined || item.replace !== undefined) &&
      (typeof item.find !== 'string' || !item.find || typeof item.replace !== 'string')
    )
      throw Error('INVALID_REPLACEMENT')
    if (
      item.tableEdit &&
      (!['table', 'row', 'col'].every(
        (key) => Number.isInteger(item.tableEdit[key]) && item.tableEdit[key] > 0,
      ) ||
        typeof item.tableEdit.text !== 'string')
    )
      throw Error('INVALID_TABLE_EDIT')
  }
  const results = []
  for (const item of cases)
    results.push(
      await runCase(item, {
        HwpDocument,
        agentPlugin,
        helpers,
        output,
        tolerance,
        maxPages,
        artifacts: flags.has('--artifacts'),
      }),
    )
  const passed = results.length > 0 && results.every((result) => result.status === 'PASS')
  const report = {
    schemaVersion: 2,
    engineVersion: identity.version,
    wasmSha256: identity.wasmSha256,
    hostSaveHelpersSha256: sha256,
    node: process.version,
    coordinateToleranceCssPx: tolerance,
    maxPages,
    scope:
      'Engine + existing host preservation helpers, not Electron disk save, official Hancom comparison, all fonts or full visual fidelity.',
    officialComparison: false,
    passed,
    results,
  }
  writeFileSync(join(realpathSync(output), 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  })
  for (const result of results) console.log(`${result.id}: ${result.status} (round-trip only)`)
  process.exitCode = passed ? 0 : 1
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(`SETUP_ERROR: ${codeOf(error)}`)
  process.exitCode = 2
}
