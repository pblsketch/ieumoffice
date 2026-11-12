/**
 * What the model receives from every workbook read tool when cells are hidden:
 * the tool output itself (executeWorkbookTool) is checked, not just the
 * filter, so a value that slips past shows up here.
 */
import { describe, expect, it } from 'vitest'
import { createValueNumbering } from '@genoffice/agent-core/hiding-values'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

import {
  buildWorkbookContext,
  executeWorkbookTool,
  type SheetsSkillDeps,
} from '../src/renderer/ai/tools'
import { createWorkbookSkill } from '../src/renderer/ai/workbook-skill'
import { formulaRefAreas, type HidingNode } from '../src/renderer/hiding/dependents'
import type { HidingSheet, SheetHidingMark } from '../src/renderer/hiding/marks'
import { withSheetHiding, HIDING_UNAVAILABLE } from '../src/renderer/hiding/skill-guard'
import { createSheetHidingView, type SheetHidingState } from '../src/renderer/hiding/view'

const SHEETS: HidingSheet[] = [
  { id: 's1', name: 'Roster' },
  { id: 's2', name: 'Summary' },
]

type Cell = { value: CellScalar; formula?: string }
const GRID: Record<string, Record<string, Cell>> = {
  s1: {
    A1: { value: 'No' },
    B1: { value: 'Name' },
    C1: { value: 'Score' },
    A2: { value: 1 },
    B2: { value: 'Kim Minji' },
    C2: { value: 90 },
    A3: { value: 2 },
    B3: { value: 'Lee Jun' },
    C3: { value: 80 },
    A4: { value: 3 },
    B4: { value: 'Kim Minji' },
    C4: { value: 70 },
    B6: { value: '=SECRET', formula: '=UPPER("secret")' },
    D2: { value: 'KIM MINJI', formula: '=UPPER(B2)' },
    E2: { value: 180, formula: '=C2*2' },
  },
  s2: {
    A1: { value: 'Kim Minji', formula: '=Roster!D2' },
    B1: { value: 240, formula: '=SUM(Roster!C2:C4)' },
  },
}

const MARKS: SheetHidingMark[] = [
  {
    name: 'IeumHide_이름',
    label: '이름',
    areas: [{ sheetId: 's1', startRow: 1, endRow: 1_048_575, startColumn: 1, endColumn: 1 }],
  },
]

function nodes(): HidingNode[] {
  const out: HidingNode[] = []
  for (const [sheetId, cells] of Object.entries(GRID)) {
    for (const [address, cell] of Object.entries(cells)) {
      if (!cell.formula) continue
      const column = address.charCodeAt(0) - 65
      const row = Number(address.slice(1)) - 1
      out.push({
        area: { sheetId, startRow: row, endRow: row, startColumn: column, endColumn: column },
        refs: formulaRefAreas(cell.formula, sheetId, { sheets: SHEETS }),
      })
    }
  }
  return out
}

function harness(state?: () => SheetHidingState) {
  const numbering = createValueNumbering()
  const view = createSheetHidingView(MARKS, numbering, nodes(), new Set(), { sheets: SHEETS })
  const proposed: unknown[] = []
  const base: SheetsSkillDeps = {
    getActiveSheetInfo: () => ({
      mode: 'lazy',
      sheetId: 's1',
      sheetName: 'Roster',
      knownAddresses: [],
      sheets: SHEETS.map((sheet) => ({ ...sheet, rows: 10, columns: 6 })),
      selection: 'B1:B10',
      selectionColumns: ['Name'],
    }),
    readCells: (addresses, sheetId) =>
      Object.fromEntries(
        addresses.map((address) => [address, GRID[sheetId ?? 's1']?.[address] ?? { value: null }]),
      ),
    readFormats: () => ({}),
    readSheetFeatures: () => 'unfiltered features',
    findCells: (options) => ({
      matches: Object.entries(GRID).flatMap(([sheetId, cells]) =>
        Object.entries(cells)
          .filter(([, cell]) =>
            `${String(cell.value)} ${cell.formula ?? ''}`
              .toLowerCase()
              .includes(options.query.toLowerCase()),
          )
          .map(([address, cell]) => ({
            sheetName: SHEETS.find((sheet) => sheet.id === sheetId)!.name,
            address,
            value: cell.value,
            formula: cell.formula,
          })),
      ),
      truncated: false,
      incompleteSheets: [],
    }),
    selectRange: () => ({ ok: true, sheetName: 'Roster' }),
    tracePrecedents: (_sheetId, address) =>
      address === 'D2'
        ? {
            formula: '=UPPER(B2)',
            value: 'KIM MINJI',
            refs: [
              {
                label: 'B2',
                cellCount: 1,
                hasError: false,
                samples: [{ address: 'B2', value: 'Kim Minji' }],
              },
            ],
          }
        : { formula: undefined, value: GRID.s1?.[address]?.value ?? null, refs: [] },
    traceDependents: () => ({
      dependents: [
        { sheetName: 'Roster', address: 'D2', formula: '=UPPER(B2)', value: 'KIM MINJI' },
        { sheetName: 'Summary', address: 'A1', formula: '=Roster!D2', value: 'Kim Minji' },
      ],
      truncated: false,
      incompleteSheets: [],
    }),
    aggregateRange: async () => ({ ok: false, error: 'passed through' }),
    proposeOperations: (operations) => {
      proposed.push(operations)
      return {
        ok: true,
        plan: {
          transactionId: 't',
          baseRevision: 0,
          cellChanges: [
            {
              sheetId: 's1',
              address: 'D2',
              before: { value: 'KIM MINJI', formula: '=UPPER(B2)' },
              after: { value: 1 },
            },
          ],
          sheetRenames: [],
          structuralChanges: [],
          formatChanges: [],
          warnings: [],
        },
      }
    },
    createDocument: async () => ({ ok: true, name: 'x.xlsx' }),
  }
  const hooks = {
    state: state ?? ((): SheetHidingState => ({ ok: true, view })),
    readSheetFeatures: (_sheetId: string | undefined, v: typeof view) =>
      `features hidden=${String(v.active)}`,
  }
  const deps = withSheetHiding(base, hooks)
  const run = async (name: string, input: Record<string, unknown>) =>
    (await executeWorkbookTool({ id: 'c', name, input }, deps)).output
  return { deps, run, proposed, hooks, base }
}

const SECRET = /Kim Minji|KIM MINJI|Lee Jun|secret/i

describe('read tools see hidden cells as numbered labels', () => {
  it('read_range: values, empties and formula text inside the mark are hidden, numbered per value', async () => {
    const { run } = harness()
    const out = await run('read_range', { range: 'A1:E6' })
    expect(out).not.toMatch(SECRET)
    const rows = out.split('\n')
    expect(rows[3]).toContain('{{이름-01}}') // B2 Kim Minji
    expect(rows[4]).toContain('{{이름-02}}') // B3 Lee Jun
    expect(rows[5]).toContain('{{이름-01}}') // B4 Kim Minji again
    expect(rows[6]).toContain('{{이름-03}}') // B5 empty counts as a value
    expect(rows[7]).toContain('{{이름-04}}') // B6 formula text hidden too
    expect(rows[2]).toContain('Name') // the header stays visible
    // a formula leaning on B2 keeps its text and loses its value
    expect(out).toContain('{{이름}} (=UPPER(B2))')
    expect(out).toContain('180 (=C2*2)')
  })

  it('keeps one numbering across reads of the open document', async () => {
    const { run } = harness()
    await run('read_cells', { addresses: ['B3'] })
    const second = await run('read_cells', { addresses: ['B2', 'B3'] })
    expect(second).toBe('B2: {{이름-02}}\nB3: {{이름-01}}')
  })

  it('read_cells on another sheet hides cells leaning across sheets', async () => {
    const { run } = harness()
    const out = await run('read_cells', { addresses: ['A1', 'B1'], sheetId: 's2' })
    expect(out).toBe('A1: {{이름}} (=Roster!D2)\nB1: 240 (=SUM(Roster!C2:C4))')
  })

  it('find_cells never matches a hidden value or a leaning value', async () => {
    const { run } = harness()
    const out = await run('find_cells', { query: 'kim' })
    expect(out).toBe('No matching cells found.')
    const formula = await run('find_cells', { query: 'UPPER(B2)' })
    expect(formula).toContain('Roster!D2: {{이름}} (=UPPER(B2))')
    expect(formula).not.toMatch(SECRET)
    const values = await run('find_cells', { query: 'UPPER(B2)', look_in: 'values' })
    expect(values).toBe('No matching cells found.')
  })

  it('aggregate_range refuses ranges holding hidden or leaning cells', async () => {
    const { run } = harness()
    expect(await run('aggregate_range', { range: 'B1:B9' })).toMatch(/Refused/)
    expect(await run('aggregate_range', { range: 'D1:D9' })).toMatch(/Refused/)
    expect(await run('aggregate_range', { range: 'C1:C9' })).toBe('passed through')
  })

  it('trace_precedents and trace_dependents hide values and hidden formula text', async () => {
    const { run } = harness()
    const pre = await run('trace_precedents', { address: 'D2' })
    expect(pre).not.toMatch(SECRET)
    expect(pre).toContain('B2={{이름-01}}')
    const hiddenCell = await run('trace_precedents', { address: 'B6' })
    expect(hiddenCell).not.toMatch(SECRET)
    expect(hiddenCell).toContain('{{이름-')
    const dep = await run('trace_dependents', { address: 'B2' })
    expect(dep).not.toMatch(SECRET)
    expect(dep).toContain('Summary!A1 = {{이름}} (=Roster!D2)')
  })

  it('read_sheet_features goes through the hiding-aware reader', async () => {
    const { run } = harness()
    expect(await run('read_sheet_features', {})).toBe('features hidden=true')
  })

  it('a header row outside the mark keeps the selected column names', () => {
    const { deps } = harness()
    expect(deps.getActiveSheetInfo().selectionColumns).toEqual(['Name'])
  })

  it('a frozen selection on another sheet drops the names of its hidden header row', () => {
    // Summary's header row is hidden; the run's selection was taken there and
    // the user has since moved to Roster, whose header row is not hidden.
    const header: SheetHidingMark[] = [
      {
        name: 'IeumHide_이름',
        label: '이름',
        areas: [{ sheetId: 's2', startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]
    const view = createSheetHidingView(header, createValueNumbering(), [], new Set(), {
      sheets: SHEETS,
    })
    const { base } = harness()
    const info = {
      ...base.getActiveSheetInfo(),
      selection: 'Summary!A1:A9',
      selectionFrozen: true,
      selectionColumns: ['Kim Minji'],
      selectionSheetId: 's2',
    }
    const deps = withSheetHiding(
      { ...base, getActiveSheetInfo: () => info },
      { state: () => ({ ok: true, view }), readSheetFeatures: () => '' },
    )
    expect(deps.getActiveSheetInfo().selectionColumns).toBeUndefined()
    expect(buildWorkbookContext(deps)).not.toContain('Kim Minji')
    // without the selection's sheet, any sheet's hidden header row counts
    const { selectionSheetId: _unknown, ...unsure } = info
    const unsureDeps = withSheetHiding(
      { ...base, getActiveSheetInfo: () => unsure },
      { state: () => ({ ok: true, view }), readSheetFeatures: () => '' },
    )
    expect(unsureDeps.getActiveSheetInfo().selectionColumns).toBeUndefined()
  })

  it('a frozen selection on a sheet whose header row is not hidden keeps its names', () => {
    const { base } = harness()
    const info = {
      ...base.getActiveSheetInfo(),
      selectionColumns: ['Total'],
      selectionSheetId: 's2',
    }
    const deps = withSheetHiding(
      { ...base, getActiveSheetInfo: () => info },
      {
        state: () => ({
          ok: true,
          view: createSheetHidingView(MARKS, createValueNumbering(), [], new Set(), {
            sheets: SHEETS,
          }),
        }),
        readSheetFeatures: () => '',
      },
    )
    expect(deps.getActiveSheetInfo().selectionColumns).toEqual(['Total'])
  })

  it('propose_operations masks the before value of a leaning cell it overwrites', async () => {
    const { run } = harness()
    const out = await run('propose_operations', {
      summary: 's',
      operations: [{ op: 'set_cell', sheetId: 's1', address: 'D2', value: 1 }],
    })
    expect(out).not.toMatch(SECRET)
    expect(out).toContain('D2: {{이름}} (=UPPER(B2)) → 1')
  })

  it('propose_operations refuses a write into hidden cells before anything is applied', async () => {
    const { run, proposed } = harness()
    const out = await run('propose_operations', {
      summary: 's',
      operations: [{ op: 'set_cell', sheetId: 's1', address: 'B2', value: 'x' }],
    })
    expect(out).toMatch(/Rejected/)
    expect(proposed).toHaveLength(0)
  })

  it('create_document refuses to copy a sheet holding hidden or leaning cells', async () => {
    const { run } = harness()
    expect(await run('create_document', { type: 'xlsx' })).toMatch(/Rejected/)
    expect(await run('create_document', { type: 'csv', sheetId: 's2' })).toMatch(/Rejected/)
  })
})

describe('the skill fails closed when the marks cannot be resolved', () => {
  it('gives the model no context and no tool output', async () => {
    const { base, hooks } = harness(() => ({ ok: false, names: ['IeumHide_x'] }))
    const skill = createWorkbookSkill(base, { ...hooks, prepare: async () => {} })
    expect(skill.buildContext?.()).toBe(HIDING_UNAVAILABLE)
    const result = await skill.executeTool({
      id: 'c',
      name: 'read_range',
      input: { range: 'A1:B2' },
    })
    expect(result.output).toBe(HIDING_UNAVAILABLE)
    expect(result.isError).toBe(true)
  })

  it('adds where the hidden ranges are to the context', () => {
    const { base, hooks } = harness()
    const skill = createWorkbookSkill(base, { ...hooks, prepare: async () => {} })
    const context = skill.buildContext?.() ?? ''
    expect(context).toContain('- {{이름}}: Roster!B2:B')
  })
})
