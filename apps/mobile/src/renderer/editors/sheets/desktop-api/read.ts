import { z } from 'zod'
import { sheetsTempDelete } from '@genoffice/mobile-bridge/sheets'
import {
  workbookFindCellsRequestSchema,
  workbookFindCellsResultSchema,
  workbookFormulaCellsRequestSchema,
  workbookFormulaCellsResultSchema,
  workbookMediaRequestSchema,
  workbookMediaResultSchema,
  workbookRangeRequestSchema,
  workbookRangeResultSchema,
  workbookRecalcRequestSchema,
  workbookRecalcResultSchema,
  workbookRowOutlineResultSchema,
  type DesktopApi,
} from '../../../../../../sheets/src/shared/desktop-api'
import { callSheetsEngine, type SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

/** The read side of the desktop API the PC grid modules call (univer-sync, lazy find, outline). */
export type MobileDesktopReadApi = Pick<
  DesktopApi,
  | 'readWorkbookRange'
  | 'readWorkbookFormulas'
  | 'findWorkbookCells'
  | 'readWorkbookRowOutline'
  | 'recalcWorkbook'
  | 'readWorkbookMedia'
  | 'closeWorkbook'
>

/** `recalc_cells` answers with file sheet names; the desktop main process checks this shape. */
const engineRecalcResultSchema = z
  .object({
    cells: z.array(
      z
        .object({
          sheet: z.string(),
          row: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
          formatted: z.string(),
          number: z.number().optional(),
          isError: z.boolean().optional(),
          isFormula: z.boolean(),
        })
        .strict(),
    ),
    cached: z.boolean().optional(),
  })
  .strict()

/**
 * The read methods over the in-process engine. Each one does what the desktop
 * main process's IPC handler of the same channel does: parse the request with
 * the shared schema, refuse an unknown session, send the same engine command,
 * and parse the answer with the shared schema.
 */
export function createMobileReadApi(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
): MobileDesktopReadApi {
  return {
    async readWorkbookRange(input) {
      const request = workbookRangeRequestSchema.parse(input)
      sessions.get(request.sessionId)
      const result = await callSheetsEngine(client, 'read_range', request)
      return workbookRangeResultSchema.parse(result)
    },

    async readWorkbookFormulas(input) {
      const request = workbookFormulaCellsRequestSchema.parse(input)
      sessions.get(request.sessionId)
      const result = await callSheetsEngine(client, 'read_formula_cells', request)
      return workbookFormulaCellsResultSchema.parse(result)
    },

    async findWorkbookCells(input) {
      const request = workbookFindCellsRequestSchema.parse(input)
      sessions.get(request.sessionId)
      const result = await callSheetsEngine(client, 'find_cells', request)
      return workbookFindCellsResultSchema.parse(result)
    },

    async readWorkbookRowOutline(input) {
      const request = workbookFormulaCellsRequestSchema.parse(input)
      sessions.get(request.sessionId)
      const result = await callSheetsEngine(client, 'read_row_outline', request)
      return workbookRowOutlineResultSchema.parse(result)
    },

    async recalcWorkbook(input) {
      const request = workbookRecalcRequestSchema.parse(input)
      const session = sessions.get(request.sessionId)
      const fileSheetName = (sheetId: string): string => {
        const name = session.sheetNames.get(sheetId)
        if (name === undefined) throw new Error(`Unknown sheet for recalculation: ${sheetId}`)
        return name
      }
      // The working copy, not the user's file: the painted values come from
      // the bytes the session streams, as on the desktop.
      const result = engineRecalcResultSchema.parse(
        await callSheetsEngine(client, 'recalc_cells', {
          path: session.snapshotPath,
          edits: request.edits.map((edit) => ({
            sheet: fileSheetName(edit.sheetId),
            row: edit.row,
            column: edit.column,
            input: edit.input,
          })),
          reads: request.reads.map((read) => ({
            sheet: fileSheetName(read.sheetId),
            range: read.range,
          })),
        }),
      )
      const idsByName = new Map([...session.sheetNames].map(([id, name]) => [name, id]))
      return workbookRecalcResultSchema.parse({
        cells: result.cells.flatMap((cell) => {
          const sheetId = idsByName.get(cell.sheet)
          if (sheetId === undefined) return []
          return [
            {
              sheetId,
              row: cell.row,
              column: cell.column,
              formatted: cell.formatted,
              ...(cell.number === undefined ? {} : { number: cell.number }),
              ...(cell.isError ? { isError: true } : {}),
              isFormula: cell.isFormula,
            },
          ]
        }),
      })
    },

    async readWorkbookMedia(input) {
      const request = workbookMediaRequestSchema.parse(input)
      sessions.get(request.sessionId)
      const result = await callSheetsEngine(client, 'read_media', request)
      return workbookMediaResultSchema.parse(result)
    },

    async closeWorkbook(sessionId) {
      const validated = z.string().uuid().parse(sessionId)
      const session = sessions.delete(validated)
      if (!session) return
      await callSheetsEngine(client, 'close', { sessionId: validated }).catch(() => undefined)
      await sheetsTempDelete(client, session.snapshotPath).catch(() => undefined)
    },
  }
}
