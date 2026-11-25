import { afterEach, describe, expect, it } from 'vitest'
import type { MobileDocSession, MobileTransport } from '@genoffice/mobile-bridge/transport'
import {
  MobileWorkbookSessions,
  SheetsEngineError,
  callSheetsEngine,
  createMobileDesktopApi,
  installMobileDesktopApi,
  missingDesktopApiMethods,
  openMobileWorkbook,
} from '../src/renderer/editors/sheets/desktop-api'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'

interface Sent {
  readonly command: string
  readonly args: Record<string, unknown>
}

/** A transport that records every Tauri command and answers engine lines from `engine`. */
function fakeClient(
  engine: (request: Record<string, unknown>) => { ok: boolean; result?: unknown; error?: unknown },
  files: Record<string, unknown> = {},
) {
  const sent: Sent[] = []
  const engineRequests: Record<string, unknown>[] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      sent.push({ command, args })
      if (command === 'mobile_sheets_request') {
        const request = JSON.parse(String(args.line)) as Record<string, unknown>
        engineRequests.push(request)
        const answer = engine(request)
        return { version: 1, requestId: request.requestId, ...answer } as T
      }
      if (command in files) return files[command] as T
      return { ok: true } as T
    },
    async listen() {
      return () => {}
    },
  }
  return { client: { transport }, sent, engineRequests }
}

/** The shape of a real engine `read_range` answer. */
const rangeResult = {
  autoFilter: null,
  autoFilterColumns: [],
  cells: [{ row: 0, column: 0, value: 'a', styleIndex: 0 }],
  colBreaks: [],
  conditionalRules: [],
  dataValidations: [],
  hyperlinks: [],
  indexedThroughRow: 10,
  indexingComplete: true,
  merges: [],
  pageSetup: null,
  protectedRanges: [],
  rowBreaks: [],
  rows: [],
  sheetProtection: null,
}

describe('the engine call', () => {
  it('sends the protocol version, a fresh request id and the command with its fields', async () => {
    const { client, engineRequests } = fakeClient(() => ({ ok: true, result: { done: 1 } }))
    await expect(callSheetsEngine(client, 'close', { sessionId: SESSION_ID })).resolves.toEqual({
      done: 1,
    })
    await callSheetsEngine(client, 'close', { sessionId: SESSION_ID })
    expect(engineRequests[0]).toMatchObject({ version: 1, command: 'close', sessionId: SESSION_ID })
    expect(engineRequests[0]?.requestId).not.toBe(engineRequests[1]?.requestId)
  })

  it('rejects an ok: false answer with the engine message, like the desktop client', async () => {
    const { client } = fakeClient(() => ({
      ok: false,
      error: { code: 'invalid_request', message: 'Unknown workbook session.' },
    }))
    const failure = callSheetsEngine(client, 'read_range', {})
    await expect(failure).rejects.toBeInstanceOf(SheetsEngineError)
    await expect(failure).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'Unknown workbook session.',
    })
  })
})

describe('the read side of the phone desktop API', () => {
  function apiWithSession(
    engine: Parameters<typeof fakeClient>[0],
  ): ReturnType<typeof fakeClient> & { api: ReturnType<typeof createMobileDesktopApi> } {
    const fake = fakeClient(engine)
    const sessions = new MobileWorkbookSessions()
    sessions.add({
      sessionId: SESSION_ID,
      snapshotPath: '/work/copy.xlsx',
      sheetNames: new Map([
        ['sheet-1', '대장'],
        ['sheet-2', '코드표'],
      ]),
    })
    return { ...fake, api: createMobileDesktopApi(fake.client, sessions) }
  }

  it('readWorkbookRange sends read_range with the request and parses the answer', async () => {
    const { api, engineRequests } = apiWithSession(() => ({ ok: true, result: rangeResult }))
    const range = { startRow: 0, endRow: 9, startColumn: 0, endColumn: 4 }
    const result = await api.readWorkbookRange({ sessionId: SESSION_ID, sheetId: 'sheet-1', range })
    expect(engineRequests[0]).toMatchObject({
      command: 'read_range',
      sessionId: SESSION_ID,
      sheetId: 'sheet-1',
      range,
    })
    expect(result.cells).toEqual([{ row: 0, column: 0, value: 'a', styleIndex: 0 }])
    expect(result.indexingComplete).toBe(true)
  })

  it('refuses a session it does not hold before asking the engine', async () => {
    const { api, engineRequests } = apiWithSession(() => ({ ok: true, result: rangeResult }))
    await expect(
      api.readWorkbookRange({
        sessionId: '99999999-2222-4333-8444-555555555555',
        sheetId: 'sheet-1',
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      }),
    ).rejects.toThrow('Unknown workbook session.')
    expect(engineRequests).toHaveLength(0)
  })

  it('refuses a reversed range with the shared request schema', async () => {
    const { api } = apiWithSession(() => ({ ok: true, result: rangeResult }))
    await expect(
      api.readWorkbookRange({
        sessionId: SESSION_ID,
        sheetId: 'sheet-1',
        range: { startRow: 5, endRow: 1, startColumn: 0, endColumn: 0 },
      }),
    ).rejects.toThrow('Range boundaries are reversed.')
  })

  it('maps the other reads to their engine commands', async () => {
    const answers: Record<string, unknown> = {
      read_formula_cells: { cells: [], truncated: false },
      read_row_outline: { rows: [], indexingComplete: true },
      find_cells: { matches: [], indexingComplete: true },
      read_media: { mediaType: 'image/png', base64: 'AA==' },
    }
    const { api, engineRequests } = apiWithSession((request) => ({
      ok: true,
      result: answers[String(request.command)],
    }))
    await api.readWorkbookFormulas({ sessionId: SESSION_ID, sheetId: 'sheet-1' }).catch(() => {})
    await api.readWorkbookRowOutline({ sessionId: SESSION_ID, sheetId: 'sheet-1' }).catch(() => {})
    await api
      .findWorkbookCells({
        sessionId: SESSION_ID,
        query: '김',
        matchCase: false,
        matchEntireCell: false,
        lookIn: 'values',
        wildcards: false,
        limit: 10,
      })
      .catch(() => {})
    await api.readWorkbookMedia({ sessionId: SESSION_ID, visualId: 'v1' }).catch(() => {})
    expect(engineRequests.map((request) => request.command)).toEqual([
      'read_formula_cells',
      'read_row_outline',
      'find_cells',
      'read_media',
    ])
  })

  it('recalculates on the working copy and maps sheet ids to names and back', async () => {
    const { api, engineRequests } = apiWithSession(() => ({
      ok: true,
      result: {
        cells: [
          { sheet: '코드표', row: 1, column: 2, formatted: '10', number: 10, isFormula: true },
          { sheet: 'Gone', row: 0, column: 0, formatted: 'x', isFormula: false },
        ],
      },
    }))
    const result = await api.recalcWorkbook({
      sessionId: SESSION_ID,
      edits: [{ sheetId: 'sheet-1', row: 0, column: 0, input: '5' }],
      reads: [
        { sheetId: 'sheet-2', range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 } },
      ],
    })
    expect(engineRequests[0]).toMatchObject({
      command: 'recalc_cells',
      path: '/work/copy.xlsx',
      edits: [{ sheet: '대장', row: 0, column: 0, input: '5' }],
      reads: [{ sheet: '코드표' }],
    })
    expect(result.cells).toEqual([
      { sheetId: 'sheet-2', row: 1, column: 2, formatted: '10', number: 10, isFormula: true },
    ])
  })

  it('closeWorkbook closes the engine session, deletes the working copy and forgets the session', async () => {
    const { api, sent, engineRequests } = apiWithSession(() => ({ ok: true, result: {} }))
    await api.closeWorkbook(SESSION_ID)
    expect(engineRequests[0]).toMatchObject({ command: 'close', sessionId: SESSION_ID })
    expect(sent.some((call) => call.command === 'mobile_sheets_temp_delete')).toBe(true)
    await expect(
      api.readWorkbookRange({
        sessionId: SESSION_ID,
        sheetId: 'sheet-1',
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      }),
    ).rejects.toThrow('Unknown workbook session.')
  })
})

const openResult = {
  sessionId: SESSION_ID,
  name: 'ledger.xlsx',
  entryCount: 12,
  sheets: [],
  styles: [],
  dxfStyles: [],
  visuals: [],
  definedNames: [],
}

function session(ext: string): MobileDocSession {
  return {
    sessionId: 's1',
    docKey: 'k1',
    name: `ledger.${ext}`,
    ext,
    format: ext as MobileDocSession['format'],
    writable: true,
    ephemeral: false,
  }
}

describe('opening a workbook on the phone', () => {
  it('copies the document to the work folder and opens the copy in the engine', async () => {
    const files = { mobile_sheets_copy_session_to_temp: { path: '/work/a.xlsx', size: 4096 } }
    const { client, engineRequests } = fakeClient(
      () => ({ ok: true, result: { ...openResult, sheets: [sheetMeta()] } }),
      files,
    )
    const sessions = new MobileWorkbookSessions()
    const file = await openMobileWorkbook(client, sessions, {
      session: session('xlsx'),
      locale: 'ko',
    })
    expect(engineRequests[0]).toMatchObject({ command: 'open', path: '/work/a.xlsx', locale: 'ko' })
    expect(file.sessionId).toBe(SESSION_ID)
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(file.fileBytes).toBe(4096)
    expect(file.needsSaveAs).toBe(false)
    expect(sessions.get(SESSION_ID).snapshotPath).toBe('/work/a.xlsx')
  })

  it('converts an .xls copy to .xlsx first and opens the converted copy', async () => {
    const files = {
      mobile_sheets_copy_session_to_temp: { path: '/work/a.xls', size: 100 },
      mobile_sheets_temp_new_path: { path: '/work/b.xlsx' },
    }
    const { client, engineRequests, sent } = fakeClient(
      (request) =>
        request.command === 'convert_workbook'
          ? { ok: true, result: { sheets: 1, cells: 3, formulasDropped: 0 } }
          : { ok: true, result: { ...openResult, sheets: [sheetMeta()] } },
      files,
    )
    const file = await openMobileWorkbook(client, new MobileWorkbookSessions(), {
      session: session('xls'),
      locale: 'en',
    })
    expect(engineRequests.map((request) => request.command)).toEqual(['convert_workbook', 'open'])
    expect(engineRequests[0]).toMatchObject({ path: '/work/a.xls', targetPath: '/work/b.xlsx' })
    expect(engineRequests[1]).toMatchObject({ path: '/work/b.xlsx' })
    expect(file.needsSaveAs).toBe(true)
    expect(sent.find((call) => call.command === 'mobile_sheets_temp_delete')?.args.path).toBe(
      '/work/a.xls',
    )
  })

  it('drops the working copy when the engine cannot open it', async () => {
    const files = { mobile_sheets_copy_session_to_temp: { path: '/work/a.xlsx', size: 1 } }
    const { client, sent } = fakeClient(
      () => ({ ok: false, error: { code: 'workbook_error', message: 'Broken.' } }),
      files,
    )
    await expect(
      openMobileWorkbook(client, new MobileWorkbookSessions(), {
        session: session('xlsx'),
        locale: 'en',
      }),
    ).rejects.toThrow('Broken.')
    expect(sent.at(-1)).toEqual({
      command: 'mobile_sheets_temp_delete',
      args: { path: '/work/a.xlsx' },
    })
  })
})

describe('installing the phone desktop API', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'desktopApi')
  })

  it('exposes the implemented methods and remembers the ones PC code asked for in vain', () => {
    const { client } = fakeClient(() => ({ ok: true, result: {} }))
    installMobileDesktopApi(createMobileDesktopApi(client, new MobileWorkbookSessions()))
    const api = window.desktopApi as unknown as Record<string, unknown>
    expect(typeof api.readWorkbookRange).toBe('function')
    expect(api.saveWorkbookEdits).toBeUndefined()
    expect(missingDesktopApiMethods()).toContain('saveWorkbookEdits')
  })
})

/** The shape of one sheet in a real engine `open` answer (lists emptied). */
function sheetMeta() {
  return {
    baseColumnWidth: null,
    columnCount: 2,
    columnWidths: [],
    comments: [],
    defaultColumnWidth: null,
    defaultRowHeight: null,
    defaultRowHeightFixed: false,
    freeze: null,
    hasScopedDefinedNames: false,
    hidden: false,
    id: 'sheet-1',
    name: '코드표',
    pivotRanges: [],
    pivotTables: [],
    rightToLeft: false,
    rowCount: 8,
    showFormulas: false,
    showGridLines: true,
    showRowColHeaders: true,
    sourceXmlBytes: 752,
    storedCellCount: 16,
    tabColor: null,
    tables: [],
    valueCellCount: 16,
    valueColumnCount: 2,
    valueRowCount: 8,
  }
}
