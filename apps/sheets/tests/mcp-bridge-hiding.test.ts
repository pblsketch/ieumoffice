/**
 * The in-app MCP server reaches the live grid through the renderer bridge
 * (mcp-bridge.ts). With the AI skill's hiding hooks, a read of hidden cells
 * answers their labels (민감정보 가리기), a batch that would reach them is
 * refused with `hidden_content` before it runs, and a workbook whose marks
 * cannot be resolved answers nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createValueNumbering } from '@genoffice/agent-core/hiding-values'
import { formulaRefAreas } from '../src/renderer/hiding/dependents'
import type { HidingSheet, SheetHidingMark } from '../src/renderer/hiding/marks'
import { createSheetHidingView, type SheetHidingState } from '../src/renderer/hiding/view'
import { installSheetsMcpBridge, type McpSheetHandlers } from '../src/renderer/mcp-bridge'

type CommandListener = (message: {
  requestId: number
  command: string
  payload: Record<string, unknown>
}) => void

let commandListener: CommandListener | undefined
const reportMcpResult = vi.fn()

beforeEach(() => {
  commandListener = undefined
  reportMcpResult.mockReset()
  ;(globalThis as unknown as { window: unknown }).window = {
    desktopApi: {
      onMcpCommand: (listener: CommandListener) => {
        commandListener = listener
        return () => {}
      },
      reportMcpResult,
      signalMcpReady: () => {},
    },
  }
})

const SHEETS: HidingSheet[] = [{ id: 's1', name: 'Roster' }]
const MARKS: SheetHidingMark[] = [
  {
    name: 'IeumHide_이름',
    label: '이름',
    areas: [{ sheetId: 's1', startRow: 1, endRow: 1_048_575, startColumn: 1, endColumn: 1 }],
  },
]
const CELLS: Record<string, { value: unknown; display?: string; formula?: string }> = {
  A2: { value: 1 },
  B2: { value: 'Kim Minji', display: 'Kim Minji' },
  D2: { value: 'KIM MINJI', formula: '=UPPER(B2)' },
}

function state(): SheetHidingState {
  const view = createSheetHidingView(
    MARKS,
    createValueNumbering(),
    [
      {
        area: { sheetId: 's1', startRow: 1, endRow: 1, startColumn: 3, endColumn: 3 },
        refs: formulaRefAreas('=UPPER(B2)', 's1', { sheets: SHEETS }),
      },
    ],
    new Set(),
    { sheets: SHEETS },
  )
  return { ok: true, view }
}

function handlers(overrides: Partial<McpSheetHandlers> = {}): McpSheetHandlers {
  return {
    hasWorkbook: () => true,
    context: () => ({ sheetId: 's1' }),
    readCells: (addresses) => Object.fromEntries(addresses.map((a) => [a, CELLS[a]])),
    sheets: () => [{ id: 's1', name: 'Roster' }],
    focusSheet: () => {},
    applyOps: vi.fn().mockResolvedValue({ ok: true, applied: true }),
    saveTo: vi.fn().mockResolvedValue({ ok: true }),
    hiding: {
      state,
      prepare: async () => {},
      readSheetFeatures: () => '',
      operation: {},
    },
    ...overrides,
  }
}

async function send(h: McpSheetHandlers, command: string, payload: Record<string, unknown>) {
  const uninstall = installSheetsMcpBridge(h)
  commandListener!({ requestId: 1, command, payload })
  uninstall()
  await vi.waitFor(() => expect(reportMcpResult).toHaveBeenCalledTimes(1))
  return reportMcpResult.mock.calls[0]![0] as {
    ok: boolean
    result?: { cells?: Record<string, { value: unknown; display?: unknown; formula?: string }> }
    error?: string
  }
}

describe('in-app MCP sheet reads and edits with hidden cells', () => {
  it('reads a hidden cell as its label and a leaning cell as the label it leans on', async () => {
    const reply = await send(handlers(), 'read_sheet', { addresses: ['A2', 'B2', 'D2'] })
    expect(reply.ok).toBe(true)
    expect(JSON.stringify(reply)).not.toMatch(/Kim Minji|KIM MINJI/i)
    expect(reply.result!.cells!.A2!.value).toBe(1)
    expect(reply.result!.cells!.B2!.value).toMatch(/^\{\{이름-\d+\}\}$/)
    expect(reply.result!.cells!.B2!.display).toBeUndefined()
    expect(reply.result!.cells!.D2).toMatchObject({ value: '{{이름}}', formula: '=UPPER(B2)' })
  })

  it('refuses a write to a hidden cell before it runs', async () => {
    const applyOps = vi.fn()
    const reply = await send(handlers({ applyOps }), 'apply_ops', {
      ops: [{ op: 'set_cell', sheetId: 's1', address: 'B3', value: 'x' }],
    })
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/^hidden_content: /)
    expect(applyOps).not.toHaveBeenCalled()
  })

  it('lets an edit elsewhere through', async () => {
    const applyOps = vi.fn().mockResolvedValue({ ok: true })
    const reply = await send(handlers({ applyOps }), 'apply_ops', {
      ops: [{ op: 'set_cell', sheetId: 's1', address: 'A5', value: 'x' }],
    })
    expect(reply.ok).toBe(true)
    expect(applyOps).toHaveBeenCalledTimes(1)
  })

  it('answers nothing for a workbook whose marks cannot be resolved', async () => {
    const reply = await send(
      handlers({
        hiding: {
          state: () => ({ ok: false, names: ['IeumHide_x'] }),
          prepare: async () => {},
          readSheetFeatures: () => '',
        },
      }),
      'read_sheet',
      { addresses: ['A2'] },
    )
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/^hidden_content: /)
    expect(JSON.stringify(reply)).not.toContain('Kim')
  })

  it('a read without addresses drops header names of a hidden first row', async () => {
    const header: SheetHidingMark[] = [
      {
        name: 'IeumHide_이름',
        label: '이름',
        areas: [{ sheetId: 's1', startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }],
      },
    ]
    const headerState = (): SheetHidingState => ({
      ok: true,
      view: createSheetHidingView(header, createValueNumbering(), [], new Set(), {
        sheets: SHEETS,
      }),
    })
    const context = () => ({ sheetId: 's1', sheetName: 'Roster', selectionColumns: ['Kim Minji'] })
    const reply = await send(
      handlers({
        context,
        hiding: { state: headerState, prepare: async () => {}, readSheetFeatures: () => '' },
      }),
      'read_sheet',
      {},
    )
    expect(reply.ok).toBe(true)
    expect(JSON.stringify(reply)).not.toContain('Kim Minji')
    expect(reply.result).toMatchObject({ context: { sheetId: 's1', sheetName: 'Roster' } })
  })

  it('a read without addresses drops header names a frozen selection took on another sheet', async () => {
    // During a run the overview names the columns from the first row of the
    // sheet the selection was taken on, not the sheet the user moved to.
    const sheets: HidingSheet[] = [
      { id: 's1', name: 'Roster' },
      { id: 's2', name: 'Private' },
    ]
    const header: SheetHidingMark[] = [
      {
        name: 'IeumHide_이름',
        label: '이름',
        areas: [{ sheetId: 's2', startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
      },
    ]
    const headerState = (): SheetHidingState => ({
      ok: true,
      view: createSheetHidingView(header, createValueNumbering(), [], new Set(), { sheets }),
    })
    for (const context of [
      () => ({ sheetId: 's1', selectionSheetId: 's2', selectionColumns: ['Kim Minji'] }),
      // an overview that does not say the selection's sheet is checked against every sheet
      () => ({ sheetId: 's1', selectionColumns: ['Kim Minji'] }),
    ]) {
      reportMcpResult.mockReset()
      const reply = await send(
        handlers({
          context,
          sheets: () => sheets,
          hiding: { state: headerState, prepare: async () => {}, readSheetFeatures: () => '' },
        }),
        'read_sheet',
        {},
      )
      expect(reply.ok).toBe(true)
      expect(JSON.stringify(reply)).not.toContain('Kim Minji')
      expect(reply.result).toMatchObject({ context: { sheetId: 's1' } })
    }
  })

  it('a read without addresses keeps header names the hiding does not touch', async () => {
    const context = () => ({ sheetId: 's1', selectionColumns: ['name'] })
    const reply = await send(handlers({ context }), 'read_sheet', {})
    expect(reply.ok).toBe(true)
    expect(reply.result).toMatchObject({ context: { selectionColumns: ['name'] } })
  })

  it('a read without addresses answers nothing when the marks cannot be resolved', async () => {
    const context = () => ({ sheetId: 's1', selectionColumns: ['Kim Minji'] })
    const reply = await send(
      handlers({
        context,
        hiding: {
          state: () => ({ ok: false, names: ['IeumHide_x'] }),
          prepare: async () => {},
          readSheetFeatures: () => '',
        },
      }),
      'read_sheet',
      {},
    )
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/^hidden_content: /)
    expect(JSON.stringify(reply)).not.toContain('Kim')
  })
})
