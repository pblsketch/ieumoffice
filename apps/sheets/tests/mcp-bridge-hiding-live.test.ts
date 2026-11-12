/**
 * The bridge the editor installs for the in-app and session MCP servers
 * (installLiveSheetsMcpBridge) carries the AI skill's hiding hooks, so the live
 * grid is read the way the in-app AI reads it: a cell under an `IeumHide_` name
 * answers its label, and a batch that would write one is refused with
 * `hidden_content` before it runs. These run the real Univer name table and
 * the real hooks (sheetSkillHiding), not a stand-in view.
 */
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import sheetsEn from '@univerjs/sheets/locale/en-US'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { InMemoryWorkbookAdapter } from '@genoffice/xlsx-gateway/domain/in-memory-workbook'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { readCells, type WorkbookReadContext } from '../src/renderer/ai/workbook-readers'
import { sheetSkillHiding } from '../src/renderer/hiding/app-hooks'
import { installLiveSheetsMcpBridge, type McpSheetHandlers } from '../src/renderer/mcp-bridge'
import type { UniverRuntime } from '../src/renderer/univer-state'

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

describe('the MCP bridge the sheets editor installs', () => {
  let univer: Univer
  let ctx: WorkbookReadContext
  const applyOps = vi.fn()

  beforeAll(async () => {
    univer = new Univer({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: sheetsEn },
      logLevel: LogLevel.SILENT,
    })
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin)
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'wb',
      sheetOrder: ['s1'],
      sheets: { s1: { id: 's1', name: 'Roster', rowCount: 20, columnCount: 10 } },
    })
    const api = FUniver.newAPI(univer)
    const workbook = api.getActiveWorkbook() as unknown as {
      insertDefinedName(name: string, ref: string): void
    }
    workbook.insertDefinedName('IeumHide_이름', "'Roster'!$B$2:$B$9")
    await new Promise((resolve) => setTimeout(resolve, 50))
    const adapter = new InMemoryWorkbookAdapter({
      revision: 0,
      sheets: [
        {
          id: 's1',
          name: 'Roster',
          cells: {
            A1: { value: 'No' },
            B1: { value: 'Name' },
            A2: { value: 1 },
            B2: { value: 'Kim Minji' },
          },
        },
      ],
    })
    ctx = {
      univerRef: { current: { univer, univerAPI: api } as unknown as UniverRuntime },
      lazyWorkbookRef: { current: null },
      adapterRef: { current: adapter },
    }
  })

  afterAll(() => {
    univer.dispose()
  })

  /** the App's live handlers, kept in a ref the way App.tsx keeps them */
  function live(): { current: McpSheetHandlers } {
    return {
      current: {
        hasWorkbook: () => true,
        context: () => ({ sheetId: 's1' }),
        readCells: (addresses, sheetId) => readCells(ctx, addresses, sheetId),
        sheets: () => [{ id: 's1', name: 'Roster' }],
        focusSheet: () => {},
        applyOps,
        saveTo: vi.fn().mockResolvedValue({ ok: true }),
      },
    }
  }

  async function send(command: string, payload: Record<string, unknown>) {
    const uninstall = installLiveSheetsMcpBridge(
      live(),
      sheetSkillHiding(() => ctx),
    )
    commandListener!({ requestId: 1, command, payload })
    uninstall()
    await vi.waitFor(() => expect(reportMcpResult).toHaveBeenCalledTimes(1))
    return reportMcpResult.mock.calls[0]![0] as {
      ok: boolean
      result?: { cells?: Record<string, { value: unknown }> }
      error?: string
    }
  }

  it('reads a hidden cell of the live grid as its label', async () => {
    const reply = await send('read_sheet', { sheet: 'Roster', addresses: ['A2', 'B1', 'B2'] })
    expect(reply.ok).toBe(true)
    expect(JSON.stringify(reply)).not.toContain('Kim Minji')
    expect(reply.result!.cells!.A2!.value).toBe(1)
    expect(reply.result!.cells!.B1!.value).toBe('Name')
    expect(reply.result!.cells!.B2!.value).toMatch(/^\{\{이름-\d+\}\}$/)
  })

  it('refuses a write to a hidden cell before it reaches the grid', async () => {
    applyOps.mockReset()
    const reply = await send('apply_ops', {
      ops: [{ op: 'set_cell', sheet: 'Roster', address: 'B3', value: 'Lee Jun' }],
    })
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/^hidden_content: /)
    expect(applyOps).not.toHaveBeenCalled()
  })

  it('lets a write outside the marks through', async () => {
    applyOps.mockReset()
    applyOps.mockResolvedValue({ ok: true })
    const reply = await send('apply_ops', {
      ops: [{ op: 'set_cell', sheet: 'Roster', address: 'D3', value: 'x' }],
    })
    expect(reply.ok).toBe(true)
    expect(applyOps).toHaveBeenCalledTimes(1)
  })
})
