// The desktop code behind the phone's edit toolbar. These fail when that
// desktop code changes, so the change is noticed and carried over to
// apps/mobile/src/renderer/editors/sheets/toolbar/ (see the file headers):
// - the command strings the toolbar sends are the desktop ribbon's;
// - the dispatcher's context still has the fields the phone fills;
// - the App.tsx and lazy-find.ts text the phone re-states is unchanged.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PC_RIBBON_CONTEXT_KEYS,
  pcLazyFind,
  pcOpExecutor,
  pcRibbonActions,
  pcUniverSyncFind,
} from '../src/renderer/editors/sheets/toolbar/pcToolbarModules'
import {
  borderCommand,
  colorCommand,
  toolbarCommands,
  toolbarGroups,
} from '../src/renderer/editors/sheets/toolbar/groups'

const RENDERER = resolve(__dirname, '../../sheets/src/renderer')
const read = (file: string) => readFileSync(resolve(RENDERER, file), 'utf8')

/** Whitespace-insensitive digest of the desktop text between two markers. */
function blockDigest(file: string, start: string, end: string): string {
  const text = read(file)
  const from = text.indexOf(start)
  const to = text.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`marker not found in ${file}: ${start}`)
  const block = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(block).digest('hex')
}

describe('the desktop code behind the phone edit toolbar', () => {
  it('exports what the toolbar calls', () => {
    expect(typeof pcRibbonActions.handleRibbonCommand).toBe('function')
    expect(typeof pcRibbonActions.parseStyleCommand).toBe('function')
    expect(typeof pcOpExecutor.planFromOps).toBe('function')
    expect(typeof pcOpExecutor.applyChangePlan).toBe('function')
    for (const name of [
      'scalarToText',
      'buildLazyCellTest',
      'coveredByWindow',
      'collectJournalMatches',
      'journalShadowKeys',
      'sidecarQuery',
      'coerceReplaceValue',
    ] as const) {
      expect(typeof pcLazyFind[name], name).toBe('function')
    }
    expect(typeof pcUniverSyncFind.ensureLazyRangeLoaded).toBe('function')
  })

  it('fills every field of the desktop ribbon context', () => {
    const text = read('ribbon-actions.ts')
    const start = text.indexOf('export interface RibbonCommandContext {')
    const end = text.indexOf('\n}\n', start)
    const fields = text
      .slice(start, end)
      .split('\n')
      .slice(1)
      .map((line) => /^ {2}([A-Za-z]+)\??:/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined)
    expect(fields.length).toBeGreaterThan(20)
    expect([...PC_RIBBON_CONTEXT_KEYS].sort()).toEqual([...fields].sort())
  })

  it('still has the App.tsx and lazy-find.ts text the toolbar re-states', () => {
    // A new digest means the desktop text changed: carry the change over to
    // toolbar/runRibbon.ts or toolbar/find.ts, then update the digest here.
    expect(
      blockDigest(
        'App.tsx',
        '/** Ribbon/dialog edits run the same executor as AI proposals (op-executor.ts). */',
        'function handleUndo(',
      ),
      'App.tsx runUiOps and opExecutorContext',
    ).toBe('aed826840238e241a41741fabb70721d4cb2300e0619c442004c6cf8cb2e1752')
    expect(
      blockDigest(
        'App.tsx',
        '/** App-scope refs/state bundle for the extracted ribbon dispatcher (ribbon-actions.ts). */',
        'const functionArgumentsHost',
      ),
      'App.tsx ribbonContext',
    ).toBe('3c23c73e889ef02f3b9a9769a8de9de58914e66218a1615177e38be836a60714')
    expect(
      blockDigest(
        'App.tsx',
        "if (command === 'calculate-now' || command === 'calculate-sheet') {",
        '/// Adds every cell of the active selection',
      ),
      'App.tsx handleRibbonCommand calculation branch',
    ).toBe('b08ab7cecd5f7902e9190e49aaf1e5f2da91fd6f2b89ca295ed8a0a5f7998559')
    expect(
      blockDigest('App.tsx', '{fullLoadPrompt && (', '{visualDialog && visualDialogTarget && ('),
      'App.tsx full-load dialog',
    ).toBe('545b5faa6367d031ec6939f9e9a310af3ae26e3434ae133a7d1893954c368d06')
    expect(
      blockDigest(
        'lazy-find.ts',
        'private focusExtra(match: LazyCellMatch): void {',
        'private emitMerged(): void {',
      ),
      'lazy-find.ts focusExtra and writeExtraReplacement',
    ).toBe('17942de71034578d8e64b3fcf590251d0dced86cebe2b3dd7d24a8f56a8b512a')
    expect(
      blockDigest('lazy-find.ts', 'function replaceAllOccurrences(', 'function compareTriples('),
      'lazy-find.ts replaceAllOccurrences',
    ).toBe('127271077b73f7df0ec798d516f44b04a73e6de369a9caf1c3877d197b8ca82d')
  })
})

describe('the toolbar command strings', () => {
  const shell = read('ExcelShell.tsx')
  const shortcuts = read('global-shortcuts.ts')

  it('are the ones the desktop ribbon (or its keyboard shortcut) sends', () => {
    const templates: [RegExp, string][] = [
      [/^format:/, 'onCommand(`format:${category.pattern}`)'],
      [/^font-family:/, 'onCommand(`font-family:${value}`)'],
      [/^font-size:\d/, 'onCommand(`font-size:${value}`)'],
      [/^border:/, 'onCommand(`border:${value}:${borderColor}`)'],
      [/^font-color:#/, "onCommand(hex ? `font-color:${hex}` : 'font-color:auto')"],
      [/^fill:#/, "onCommand(hex ? `fill:${hex}` : 'fill:none')"],
      [/^autofn:/, 'onCommand(`autofn:${value}`)'],
      [/^merge:/, 'onCommand(`merge:${value}`)'],
    ]
    for (const command of toolbarCommands(toolbarGroups('en'), { lang: 'en' })) {
      const template = templates.find(([pattern]) => pattern.test(command))
      if (template) {
        // Built with the desktop ribbon's own helpers (numberFormatCategories, …).
        expect(shell.includes(template[1]), `${command}: ${template[1]}`).toBe(true)
        continue
      }
      const quoted = `'${command}'`
      expect(shell.includes(quoted) || shortcuts.includes(quoted), command).toBe(true)
    }
    for (const value of ['center', 'unmerge']) {
      expect(shell).toContain(`{ value: '${value}', label: t('app`)
    }
    for (const fn of ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN']) {
      expect(shell).toContain(`{ value: '${fn}',`)
    }
    for (const kind of ['all', 'outer', 'thick-outer', 'top', 'bottom', 'left', 'right', 'none']) {
      expect(shell).toMatch(new RegExp(String.raw`value: '${kind}',\s+label: t\('appBorder`))
      expect(borderCommand(kind)).toBe(`border:${kind}:#000000`)
    }
    expect(shell).toContain("useState('#000000')")
    expect(colorCommand('font-color', null)).toBe('font-color:auto')
    expect(colorCommand('fill', null)).toBe('fill:none')
  })

  it('offer no edit command for charts, pivot tables or conditional formatting (view only)', () => {
    for (const lang of ['en', 'ko'] as const) {
      for (const command of toolbarCommands(toolbarGroups(lang), { lang })) {
        expect(command, command).not.toMatch(
          /chart|pivot|^cf-|conditional|sparkline|slicer|timeline|refresh-all|format-as-table|table-/,
        )
      }
    }
  })
})
