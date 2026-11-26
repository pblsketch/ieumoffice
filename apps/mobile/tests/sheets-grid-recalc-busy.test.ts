// Spec 6: the engine's `recalc_busy` is not a failure. The desktop's own
// recalculation queue (univer-sync `queueFormulaRecalc`, reused as it is)
// recognises "busy with another recalculation" in the error and retries
// later without counting it toward its give-up limit; the phone's read API
// must hand the engine's sentence through so that check still matches.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileTransport } from '@genoffice/mobile-bridge/transport'
import type { WorkbookFile } from '../../sheets/src/shared/desktop-api'
import type { LazyWorkbookState, UniverRuntime } from '../../sheets/src/renderer/univer-state'
import {
  MobileWorkbookSessions,
  SheetsEngineError,
  createMobileDesktopApi,
  installMobileDesktopApi,
} from '../src/renderer/editors/sheets/desktop-api'
import { createLazyWorkbookState } from '../src/renderer/editors/sheets/grid/lazyWorkbook'
import { pcUniverSync } from '../src/renderer/editors/sheets/grid/pcGridModules'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'

const FILE = {
  sessionId: SESSION_ID,
  path: '/w/book.xlsx',
  name: 'book.xlsx',
  sha256: 'abc123',
  fileBytes: 4096,
  entryCount: 5,
  visuals: [],
  styles: [],
  dxfStyles: [],
  definedNames: [],
  sheets: [
    {
      id: 'sheet-1',
      name: 'Sheet1',
      rowCount: 20,
      columnCount: 8,
      hidden: false,
      showGridLines: true,
      tabColor: null,
      defaultRowHeight: null,
      defaultColumnWidth: null,
      freeze: null,
      columnWidths: [],
      cells: {},
      tables: [],
      protections: [],
      merges: [],
      notes: [],
      pivotTables: [],
      pivotRanges: [],
      sparklines: [],
      showFormulas: false,
      valueCellCount: 1,
      storedCellCount: 1,
    },
  ],
} as unknown as WorkbookFile

type QueueFormulaRecalc = (
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
  setMessage: (message: string) => void,
) => void

/** The desktop queue, reached through the same module boundary the grid uses. */
const queueFormulaRecalc = (pcUniverSync as unknown as { queueFormulaRecalc: QueueFormulaRecalc })
  .queueFormulaRecalc

function setup(recalcAnswer: { ok: boolean; result?: unknown; error?: unknown }) {
  const commands: string[] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (command !== 'mobile_sheets_request') return { ok: true } as T
      const request = JSON.parse(String(args.line)) as Record<string, unknown>
      commands.push(String(request.command))
      const answer =
        request.command === 'read_formula_cells'
          ? {
              ok: true,
              result: {
                cells: [{ row: 0, column: 1, value: 2, formula: '=1+1' }],
                sharedGroups: [],
                indexingComplete: true,
                truncated: false,
              },
            }
          : recalcAnswer
      return { version: 1, requestId: request.requestId, ...answer } as T
    },
    async listen() {
      return () => {}
    },
  }
  const sessions = new MobileWorkbookSessions()
  sessions.add({
    sessionId: SESSION_ID,
    snapshotPath: '/work/copy.xlsx',
    sheetNames: new Map([['sheet-1', 'Sheet1']]),
  })
  installMobileDesktopApi(createMobileDesktopApi({ transport }, sessions))

  const state = createLazyWorkbookState(FILE)
  // The closure gave up: the engine fallback recalculates (desktop rule).
  state.closure.status = 'unavailable'
  // A workbook too large for formula mode (value mode streams cached values;
  // this small stand-in would otherwise open in formula mode).
  ;(state as { formulaMode: boolean }).formulaMode = false
  state.recalc.engineOverBudget = false
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: state }
  const runtime = {
    univerAPI: {
      getActiveWorkbook: () => ({ getActiveSheet: () => ({ getSheetId: () => 'sheet-1' }) }),
    },
  } as unknown as UniverRuntime
  return { state, lazyWorkbookRef, runtime, commands }
}

async function runQueuedRecalc(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
  messages: string[],
) {
  queueFormulaRecalc(runtime, lazyWorkbookRef, (message) => messages.push(message))
  await vi.advanceTimersByTimeAsync(700)
}

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'desktopApi')
})

describe('recalc_busy is not a failure', () => {
  it('the read API passes the engine sentence and code through', async () => {
    const { commands } = setup({
      ok: false,
      error: { code: 'recalc_busy', message: 'Formula engine is busy with another recalculation.' },
    })
    const error = await window.desktopApi
      .recalcWorkbook({ sessionId: SESSION_ID, edits: [], reads: [] })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SheetsEngineError)
    expect((error as SheetsEngineError).code).toBe('recalc_busy')
    expect((error as Error).message).toContain('busy with another recalculation')
    expect(commands).toEqual(['recalc_cells'])
  })

  it('a busy engine leaves the failure count alone and retries later', async () => {
    vi.useFakeTimers()
    const { state, lazyWorkbookRef, runtime, commands } = setup({
      ok: false,
      error: { code: 'recalc_busy', message: 'Formula engine is busy with another recalculation.' },
    })
    const messages: string[] = []
    await runQueuedRecalc(runtime, lazyWorkbookRef, messages)
    expect(commands).toContain('recalc_cells')
    expect(state.recalc.failures).toBe(0)
    // The desktop re-queues a busy pass after its retry wait.
    const before = commands.filter((command) => command === 'recalc_cells').length
    await vi.advanceTimersByTimeAsync(5000 + 700)
    expect(commands.filter((command) => command === 'recalc_cells').length).toBeGreaterThan(before)
    expect(state.recalc.failures).toBe(0)
  })

  it('any other engine error counts as a failure (for comparison)', async () => {
    vi.useFakeTimers()
    const { state, lazyWorkbookRef, runtime } = setup({
      ok: false,
      error: { code: 'workbook_error', message: 'The workbook could not be read.' },
    })
    await runQueuedRecalc(runtime, lazyWorkbookRef, [])
    expect(state.recalc.failures).toBe(1)
  })
})
