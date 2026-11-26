// The phone's spreadsheet AI on a real Univer grid, driven by a scripted
// model (a mocked transport; no provider, no API key): the run's edits go
// through the desktop plan/apply path into the edit journal and the save
// request, undo in one step, refuse after an outside edit, and their marks
// stay on screen only.
import { LocaleType, LogLevel, Univer } from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter'
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt'
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort'
import sheetsEnUS from '@univerjs/sheets/locale/en-US'
import { FWorkbook } from '@univerjs/sheets/facade'
import '@univerjs/sheets-ui/facade'
import '@univerjs/sheets-filter/facade'
import '@univerjs/sheets-numfmt/facade'
import '@univerjs/sheets-sort/facade'
import {
  AgentLoop,
  type AgentStreamCallbacks,
  type AgentStreamRequest,
  type AgentToolCall,
  type AgentTransport,
} from '@genoffice/agent-core'
import { describe, expect, it, vi } from 'vitest'
import type { WorkbookFile, WorkbookSaveRequest } from '../../sheets/src/shared/desktop-api'
import type { LazyWorkbookState, UniverRuntime } from '../../sheets/src/renderer/univer-state'
import { currentMarkRanges } from '../../sheets/src/renderer/ai-change-marks'
import { fileSheetProtection } from '../../sheets/src/renderer/sheet-protection'
import { installEditJournal } from '../src/renderer/editors/sheets/journal/editJournal'
import { createLazyWorkbookState } from '../src/renderer/editors/sheets/grid/lazyWorkbook'
import { pcUniverSync } from '../src/renderer/editors/sheets/grid/pcGridModules'
import { pcSaveActions } from '../src/renderer/editors/sheets/save/documentSlot'
import { createSheetsAiRun } from '../src/renderer/editors/sheets/ai/documentSlot'
import type { MobileGrid } from '../src/renderer/editors/sheets/grid/mobileGrid'
import type { SheetsDocumentContext } from '../src/renderer/editors/sheets/workspace/slots'
import type { OpenedSheetsWorkbook } from '../src/renderer/editors/sheets/session'
import type { EditorAiContext, EditorHost } from '../src/renderer/editors/editorKind'

// no cell editor in this headless grid (the sheets-ui plugin is not registered)
vi.spyOn(
  FWorkbook.prototype as unknown as { isCellEditing(): boolean },
  'isCellEditing',
).mockReturnValue(false)

const SHEET = {
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
  valueCellCount: 0,
  storedCellCount: 0,
}

const FILE = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  path: '/w/book.xlsx',
  name: 'book.xlsx',
  sha256: 'abc123',
  fileBytes: 4096,
  entryCount: 5,
  visuals: [],
  styles: [],
  dxfStyles: [],
  definedNames: [],
  sheets: [SHEET],
} as unknown as WorkbookFile

function boot() {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: sheetsEnUS },
  })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverFormulaEnginePlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  univer.registerPlugin(UniverSheetsNumfmtPlugin)
  univer.registerPlugin(UniverSheetsFilterPlugin)
  univer.registerPlugin(UniverSheetsSortPlugin)
  const univerAPI = FUniver.newAPI(univer)
  const runtime = { univer, univerAPI } as unknown as UniverRuntime
  const file = structuredClone(FILE)
  pcUniverSync.loadWorkbookSkeleton(runtime, file)
  const state = createLazyWorkbookState(file)
  state.flags.preloadComplete = true
  // a small workbook loads whole (the desktop's formula mode)
  ;(state as { formulaMode: boolean }).formulaMode = true
  state.loadedRanges.set('sheet-1', { startRow: 0, endRow: 19, startColumn: 0, endColumn: 7 })
  // the sheet finished indexing (the desktop reads its protection from the engine first)
  state.sheetProtections.set('sheet-1', fileSheetProtection(null))
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: state }
  const recorded: number[] = []
  installEditJournal(runtime, lazyWorkbookRef, { onRecorded: (pending) => recorded.push(pending) })
  const workbook = univerAPI.getActiveWorkbook()!
  const sheet = workbook.getActiveSheet()
  const grid = { runtime, lazyWorkbookRef } as unknown as MobileGrid
  return { univer, runtime, state, lazyWorkbookRef, recorded, sheet, grid }
}

async function saveRequest(
  runtime: UniverRuntime,
  lazyWorkbookRef: { current: LazyWorkbookState | null },
): Promise<WorkbookSaveRequest> {
  const built = (await (
    await pcSaveActions()
  ).handleSave(
    {
      univerRef: { current: runtime },
      lazyWorkbookRef,
      setMessage: () => undefined,
      openLazyWorkbook: async () => true,
      stashViewRestore: () => undefined,
    },
    'ods',
    true,
  )) as { ok: boolean; request?: WorkbookSaveRequest }
  if (!built.request) throw new Error('no save request')
  return built.request
}

/** A model scripted turn by turn: each turn emits tool calls or a final text. */
function scriptedModel(turns: Array<AgentToolCall[] | string>) {
  const requests: AgentStreamRequest[] = []
  let turn = 0
  const transport: AgentTransport = {
    stream(request: AgentStreamRequest, cb: AgentStreamCallbacks) {
      requests.push(structuredClone(request))
      const step = turns[turn++] ?? 'done'
      queueMicrotask(() => {
        if (typeof step === 'string') cb.onDelta(step)
        else for (const call of step) cb.onToolCall(call)
        cb.onDone()
      })
      return { cancel: () => queueMicrotask(() => cb.onDone()) }
    },
  }
  return { transport, requests }
}

function fakeHost() {
  const toasts: unknown[] = []
  const host = {
    markDirty: vi.fn(),
    contentChanged: vi.fn(),
    showToast: (input: unknown) => toasts.push(input),
  } as unknown as EditorHost
  return { host, toasts }
}

function aiContext(options: { mode?: 'view' | 'edit'; writable?: boolean } = {}) {
  let mode = options.mode ?? 'edit'
  let undo: { summary: string; undo: () => void } | null = null
  const ctx: EditorAiContext = {
    getMode: () => mode,
    getCapabilities: () => ({
      writable: options.writable ?? true,
      encrypted: false,
      distribution: false,
      isUntitled: false,
    }),
    switchToEdit: () => {
      mode = 'edit'
    },
    setUndo: (entry) => {
      undo = entry
    },
    getLang: () => 'en',
  }
  return { ctx, mode: () => mode, undo: () => undo }
}

function documentContext(
  grid: MobileGrid,
  host: EditorHost,
  unlocked = false,
): SheetsDocumentContext {
  return {
    host,
    opened: { unlocked } as unknown as OpenedSheetsWorkbook,
    grid: { grid, handle: null },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function runScript(
  context: SheetsDocumentContext,
  ai: EditorAiContext,
  turns: Array<AgentToolCall[] | string>,
) {
  const model = scriptedModel(turns)
  const run = await createSheetsAiRun!(context, ai)
  await new Promise<void>((resolve) => {
    const loop = new AgentLoop({
      transport: model.transport,
      skill: run.skill,
      events: { onDone: () => resolve(), onError: () => resolve() },
    })
    loop.run('Put 42 in A1 and double it in B1')
  })
  run.finish?.()
  // finish waits for the run's applies before it offers the undo
  for (let i = 0; i < 20; i += 1) await flush()
  return model
}

const WRITE: AgentToolCall[] = [
  {
    id: 'call-2',
    name: 'propose_operations',
    input: {
      summary: 'Fill A1 and B1',
      operations: [
        { op: 'set_cell', sheetId: 'sheet-1', address: 'A1', value: 42 },
        { op: 'set_formula', sheetId: 'sheet-1', address: 'B1', formula: '=A1*2' },
      ],
    },
  },
]
const READ: AgentToolCall[] = [{ id: 'call-1', name: 'get_workbook_context', input: {} }]

describe('the phone spreadsheet AI run', () => {
  it('edits cells through the desktop plan path into the journal and the save request', async () => {
    const { runtime, lazyWorkbookRef, sheet, grid, recorded } = boot()
    const { host } = fakeHost()
    const ai = aiContext()
    const model = await runScript(documentContext(grid, host), ai.ctx, [READ, WRITE, 'Done.'])

    expect(sheet.getRange('A1').getValue()).toBe(42)
    expect(sheet.getRange('B1').getFormula()).toBe('=A1*2')
    expect(recorded.length).toBeGreaterThan(0)
    expect(host.markDirty).toHaveBeenCalledWith(true)
    expect(ai.undo()?.summary).toBe('AI changed 2 places.')

    const request = await saveRequest(runtime, lazyWorkbookRef)
    const at = (row: number, column: number) =>
      request.edits.filter((edit) => edit.row === row && edit.column === column)
    expect(at(0, 0).some((edit) => (edit as { value?: unknown }).value === 42)).toBe(true)
    expect(at(0, 1).some((edit) => (edit as { formula?: string }).formula === '=A1*2')).toBe(true)

    // the model was told the result of its write and never saw create_document
    const toolNames = model.requests[0]!.tools.map((tool) => tool.name)
    expect(toolNames).toContain('propose_operations')
    expect(toolNames).not.toContain('create_document')
    const lastMessages = JSON.stringify(model.requests.at(-1)!.messages)
    expect(lastMessages).toContain('Auto-applied 2 change(s)')
  }, 180_000)

  it('marks the changed cells on screen only, never in the save request', async () => {
    const { runtime, lazyWorkbookRef, grid } = boot()
    const { host } = fakeHost()
    const ai = aiContext()
    await runScript(documentContext(grid, host), ai.ctx, [WRITE, 'Done.'])
    const marked = currentMarkRanges().get('sheet-1') ?? []
    expect(marked.length).toBeGreaterThan(0)

    const withMarks = await saveRequest(runtime, lazyWorkbookRef)
    // nothing about the marks is in the request: no style edits for the written cells
    expect(withMarks.edits.some((edit) => (edit as { style?: unknown }).style !== undefined)).toBe(
      false,
    )
    expect(JSON.stringify(withMarks)).not.toMatch(/ai-changed|ffc107|255 193 7/i)
  }, 180_000)

  it('takes the whole run back with one undo', async () => {
    const { sheet, grid } = boot()
    const { host, toasts } = fakeHost()
    const ai = aiContext()
    await runScript(documentContext(grid, host), ai.ctx, [WRITE, 'Done.'])
    expect(sheet.getRange('A1').getValue()).toBe(42)

    ai.undo()!.undo()
    for (let i = 0; i < 20; i += 1) await flush()
    expect(sheet.getRange('A1').getValue() ?? null).toBeNull()
    expect(sheet.getRange('B1').getFormula() || null).toBeNull()
    expect(ai.undo()).toBeNull()
    expect(toasts).toEqual([])
    expect(currentMarkRanges().size).toBe(0)
  }, 180_000)

  it('refuses to undo and says so when the sheet changed after the run', async () => {
    const { sheet, grid } = boot()
    const { host, toasts } = fakeHost()
    const ai = aiContext()
    await runScript(documentContext(grid, host), ai.ctx, [WRITE, 'Done.'])
    // the person edits another cell afterwards
    sheet.getRange('C3').setValue('mine')

    ai.undo()!.undo()
    for (let i = 0; i < 20; i += 1) await flush()
    expect(sheet.getRange('A1').getValue()).toBe(42)
    expect(sheet.getRange('C3').getValue()).toBe('mine')
    expect(toasts).toEqual([
      {
        message: "The sheet was edited after the AI's changes, so they were not undone.",
        tone: 'error',
      },
    ])
  }, 180_000)

  it('switches a viewed workbook to edit through the gate before the AI writes', async () => {
    const { sheet, grid } = boot()
    const { host } = fakeHost()
    const ai = aiContext({ mode: 'view' })
    await runScript(documentContext(grid, host), ai.ctx, [READ, 'Here it is.'])
    // reading leaves the view as it is
    expect(ai.mode()).toBe('view')
    await runScript(documentContext(grid, host), ai.ctx, [WRITE, 'Done.'])
    expect(ai.mode()).toBe('edit')
    expect(sheet.getRange('A1').getValue()).toBe(42)
  }, 180_000)

  it('does not offer or run edits on a document that cannot be changed', async () => {
    const { sheet, grid } = boot()
    const { host } = fakeHost()
    const ai = aiContext({ writable: false })
    const model = await runScript(documentContext(grid, host), ai.ctx, [WRITE, 'Done.'])
    expect(model.requests[0]!.tools.map((tool) => tool.name)).not.toContain('propose_operations')
    expect(model.requests[0]!.system).toContain('read-only or protected')
    expect(sheet.getRange('A1').getValue() ?? null).toBeNull()
    expect(ai.undo()).toBeNull()
  }, 180_000)

  it('works on a workbook opened with a password like on any other', async () => {
    const { sheet, grid, runtime, lazyWorkbookRef } = boot()
    const { host } = fakeHost()
    const ai = aiContext()
    const model = await runScript(documentContext(grid, host, true), ai.ctx, [WRITE, 'Done.'])
    expect(model.requests[0]!.tools.map((tool) => tool.name)).toContain('propose_operations')
    expect(sheet.getRange('A1').getValue()).toBe(42)
    const request = await saveRequest(runtime, lazyWorkbookRef)
    expect(request.edits.some((edit) => (edit as { value?: unknown }).value === 42)).toBe(true)
  }, 180_000)

  it('refuses the operations a phone cannot do before anything is applied', async () => {
    const { sheet, grid } = boot()
    const { host } = fakeHost()
    const ai = aiContext()
    const model = await runScript(documentContext(grid, host), ai.ctx, [
      [
        {
          id: 'call-3',
          name: 'propose_operations',
          input: {
            summary: 'Value and a picture',
            operations: [
              { op: 'set_cell', sheetId: 'sheet-1', address: 'A1', value: 1 },
              {
                op: 'add_image',
                sheetId: 'sheet-1',
                path: 'https://example.com/a.png',
                anchorCell: 'C3',
              },
            ],
          },
        },
      ],
      'Done.',
    ])
    expect(sheet.getRange('A1').getValue() ?? null).toBeNull()
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain(
      'Not available in the phone app: add_image',
    )
    expect(ai.undo()).toBeNull()
  }, 180_000)

  it('clears the marks when the workbook goes away', async () => {
    const { univer, grid } = boot()
    const { host } = fakeHost()
    await runScript(documentContext(grid, host), aiContext().ctx, [WRITE, 'Done.'])
    expect(currentMarkRanges().size).toBe(1)
    univer.dispose()
    expect(currentMarkRanges().size).toBe(0)
  }, 180_000)
})
