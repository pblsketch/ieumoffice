// The phone's save request mapping is a copy of the desktop main process's
// `writeWorkbookTo` (not exported from that Electron file). This test runs
// the desktop function's own text (read from sheets-main.ts, transpiled) next
// to the copy with the same session and request, and compares what each hands
// to `saveWorkbookViaSidecar`. When the desktop function changes, this fails
// until the copy follows.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { WorkbookSaveRequest } from '../../sheets/src/shared/desktop-api'

const captured: { request: unknown }[] = []

vi.mock('@genoffice/xlsx-gateway/gateway/xlsx-package-io', () => ({
  saveWorkbookViaSidecar: async (request: unknown) => {
    captured.push({ request })
    return { touchedEntries: ['copy'], removedEntries: [], addedEntries: [] }
  },
}))

const { writeWorkbookTo } = await import('../src/renderer/editors/sheets/save/writeWorkbookTo')

const DESKTOP_FILE = resolve(__dirname, '../../sheets/src/main/sheets-main.ts')
const COPY_FILE = resolve(__dirname, '../src/renderer/editors/sheets/save/writeWorkbookTo.ts')

/** `async function writeWorkbookTo(...) { ... }` as written in a source file. */
function functionText(source: string, exported: boolean): string {
  const head = `${exported ? 'export ' : ''}async function writeWorkbookTo(`
  const start = source.indexOf(head)
  if (start < 0) throw new Error('writeWorkbookTo not found')
  const end = source.indexOf('\n}\n', start)
  return source.slice(start, end + 2)
}

/** The body after the signature (the `): Promise<...> {` line). */
function bodyOf(text: string): string {
  const open = text.indexOf('>> {\n')
  return text.slice(open + 5)
}

type Saver = (request: unknown) => Promise<unknown>
type WriteWorkbookTo = (
  client: unknown,
  session: unknown,
  request: WorkbookSaveRequest,
  targetPath: string,
) => Promise<unknown>

/** The desktop function compiled from its source, with the saver injected. */
function desktopWriteWorkbookTo(saver: Saver): WriteWorkbookTo {
  const text = functionText(readFileSync(DESKTOP_FILE, 'utf8'), false)
  const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function('saveWorkbookViaSidecar', `${js}\nreturn writeWorkbookTo`)(saver)
}

const session = {
  snapshotPath: '/w/f-snapshot.xlsx',
  sheetNames: new Map([
    ['sheet-1', '대장'],
    ['sheet-2', 'Codes'],
    ['sheet-3', 'Old'],
  ]),
}

const range = { startRow: 1, endRow: 3, startColumn: 0, endColumn: 2 }

/** Touches every branch of the mapping: sheet ops, each structural op shape, per-sheet states. */
const request = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  mode: 'save',
  edits: [
    { sheetId: 'sheet-1', row: 0, column: 0, writeValue: true, value: 'a', formula: undefined },
    { sheetId: 'new-1', row: 2, column: 1, writeValue: true, value: 5, style: { bold: true } },
    { sheetId: 'sheet-2', row: 1, column: 1, writeValue: false, value: null, styleReset: true },
  ],
  bulkConstantFills: [
    { sheetId: 'sheet-1', startRow: 4, endRow: 9, startColumn: 0, endColumn: 0, value: 1 },
  ],
  structuralOps: [
    { sheetId: 'sheet-1', kind: 'insert-rows', index: 2, count: 1 },
    { sheetId: 'sheet-1', kind: 'merge', range },
    { sheetId: 'sheet-1', kind: 'set-row-heights', start: 1, end: 2, size: 30 },
    { sheetId: 'sheet-2', kind: 'set-row-outline', start: 1, end: 2, level: 1, collapsed: true },
    { sheetId: 'sheet-2', kind: 'set-row-outline', start: 3, end: 4, level: 2 },
    { sheetId: 'sheet-2', kind: 'set-outline-summary', summaryBelow: false, summaryRight: true },
    { sheetId: 'sheet-2', kind: 'set-rows-hidden', start: 5, end: 6, hidden: true },
    { sheetId: 'sheet-2', kind: 'set-row-style', start: 7, end: 7, style: { italic: true } },
    { sheetId: 'sheet-1', kind: 'move-rows', index: 5, count: 2, before: 1 },
  ],
  chartEdits: [{ drawingPath: 'xl/drawings/drawing1.xml', title: 't' }],
  visualEdits: [{ drawingPath: 'xl/drawings/drawing1.xml', anchor: {} }],
  visualAdditions: [{ sheetId: 'sheet-2', anchor: { from: {} }, chart: { kind: 'bar' } }],
  tableAdditions: [
    {
      sheetId: 'sheet-1',
      area: range,
      name: 'T1',
      columnNames: ['a', 'b', 'c'],
      style: 'TableStyleMedium2',
      bandedRows: true,
      headerRow: true,
      totalsRow: false,
      firstColumn: false,
      lastColumn: false,
      bandedColumns: false,
      filterButton: true,
    },
  ],
  tableEdits: [{ sheetId: 'sheet-1', name: 'T1', style: 'TableStyleLight1' }],
  pivotAdditions: [
    {
      sheetId: 'sheet-2',
      sourceSheetId: 'sheet-1',
      sourceArea: range,
      location: { row: 0, column: 5 },
      name: 'P1',
      fieldNames: ['a'],
      rowFieldIndices: [0],
      values: [],
    },
  ],
  sheetOps: [
    { kind: 'add-sheet', sheetId: 'new-1', name: '새 시트' },
    { kind: 'duplicate-sheet', sheetId: 'dup-1', sourceSheetId: 'sheet-2', name: 'Codes (2)' },
    { kind: 'rename-sheet', sheetId: 'sheet-2', newName: '코드' },
    { kind: 'set-sheet-hidden', sheetId: 'new-1', hidden: true },
    { kind: 'set-sheet-tab-color', sheetId: 'sheet-1', color: '#FF0000' },
    { kind: 'remove-sheet', sheetId: 'sheet-3' },
    { kind: 'reorder-sheets' },
  ],
  sheetOrder: ['sheet-2', 'sheet-1', 'new-1', 'dup-1'],
  filterStates: [{ sheetId: 'sheet-1', filter: null, hiddenRows: [3], visibilityRange: range }],
  hyperlinkEdits: [
    { sheetId: 'sheet-1', row: 0, column: 0, target: 'https://example.com' },
    { sheetId: 'sheet-1', row: 1, column: 0, target: null },
    { sheetId: 'sheet-2', row: 0, column: 0, target: '#A1' },
  ],
  cfStates: [{ sheetId: 'sheet-1', rules: [] }],
  dvStates: [{ sheetId: 'sheet-2', rules: [] }],
  pageSetupStates: [{ sheetId: 'sheet-1', orientation: 'landscape' }],
  noteStates: [{ sheetId: 'sheet-2', notes: [{ row: 0, column: 0, text: 'n' }] }],
  formulaValues: [
    { sheetId: 'sheet-1', row: 0, column: 3, value: 10 },
    { sheetId: 'sheet-1', row: 1, column: 3, value: { error: '#DIV/0!' } },
    { sheetId: 'sheet-2', row: 0, column: 3, value: 'x' },
  ],
  pivotCacheRefreshPaths: ['xl/pivotCache/pivotCacheDefinition1.xml'],
  pivotRefreshUpdates: [
    {
      cachePath: 'xl/pivotCache/pivotCacheDefinition1.xml',
      sheetId: 'sheet-2',
      newOutputRef: 'F1:H9',
    },
    {
      cachePath: 'xl/pivotCache/pivotCacheDefinition2.xml',
      sheetId: 'sheet-2',
      newOutputRef: 'F1:H9',
      relayout: { sheetId: 'sheet-2', sourceSheetId: 'sheet-1', name: 'P', fieldNames: [] },
    },
  ],
  sheetProtections: [{ sheetId: 'sheet-1', protected: true, verified: true }],
  sparklineAdditions: [{ sheetId: 'sheet-1', type: 'line', sparklines: [] }],
  definedNamesState: { names: [{ name: 'Total', formula: '대장!$C$1' }], preserveNames: [] },
  themeState: null,
  workbookProtectionState: { lockStructure: true },
  protectedRangeStates: [{ sheetId: 'sheet-2', ranges: [{ name: 'r', sqref: 'A1:B2' }] }],
} as unknown as WorkbookSaveRequest

describe('the copied writeWorkbookTo', () => {
  it('keeps the desktop body line for line', () => {
    const desktop = functionText(readFileSync(DESKTOP_FILE, 'utf8'), false)
    const copy = functionText(readFileSync(COPY_FILE, 'utf8'), true)
    expect(bodyOf(copy)).toBe(bodyOf(desktop))
    expect(bodyOf(copy).length).toBeGreaterThan(4000)
  })

  it('hands saveWorkbookViaSidecar the same request as the desktop function', async () => {
    const client = { name: 'archive-client' }
    const desktopCalls: unknown[] = []
    const desktop = desktopWriteWorkbookTo(async (saverRequest) => {
      desktopCalls.push(saverRequest)
      return { touchedEntries: ['desktop'], removedEntries: [], addedEntries: [] }
    })
    await desktop(client, session, request, '/w/f-target.xlsx')
    captured.length = 0
    const result = await writeWorkbookTo(client as never, session, request, '/w/f-target.xlsx')
    expect(result).toEqual({ touchedEntries: ['copy'], removedEntries: [], addedEntries: [] })
    expect(captured).toHaveLength(1)
    expect(desktopCalls).toHaveLength(1)
    const mine = captured[0]!.request as Record<string, unknown>
    const theirs = desktopCalls[0] as Record<string, unknown>
    expect(mine.client).toBe(client)
    expect(mine.sourcePath).toBe('/w/f-snapshot.xlsx')
    expect(mine.targetPath).toBe('/w/f-target.xlsx')
    expect(mine).toEqual(theirs)
    // The mapping did resolve names (not a vacuous comparison).
    expect(mine.sheetPlan).toMatchObject({
      renames: [{ sheetName: 'Codes', newName: '코드' }],
      removals: ['Old'],
      order: ['코드', '대장', '새 시트', 'Codes (2)'],
    })
    expect(mine).not.toHaveProperty('streamPatches')
  })

  it('refuses the same unknown sheets the desktop refuses', async () => {
    const desktop = desktopWriteWorkbookTo(async () => ({}))
    const bad = { ...request, edits: [{ ...request.edits[0]!, sheetId: 'ghost' }] }
    await expect(desktop({}, session, bad, '/w/t.xlsx')).rejects.toThrow('Unknown worksheet ghost.')
    await expect(writeWorkbookTo({} as never, session, bad, '/w/t.xlsx')).rejects.toThrow(
      'Unknown worksheet ghost.',
    )
  })
})
