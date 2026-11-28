/**
 * An ODS copy of the whole workbook, in the desktop's order
 * (apps/sheets/src/main/ods-export.ts `exportWorkbookAsOds`, which needs
 * Node and is therefore followed here, not imported): the engine writes a
 * new ODS package from an `.xlsx` of the workbook as it stands into the work
 * folder, the feature-loss question is asked only when something is left
 * out, the finished package is opened again through the engine's ODS reader,
 * and only then is it handed on (a new document, or the share sheet). The
 * workbook session keeps its file, its unsaved edits and its recovery copy.
 */
import { sheetsTempDelete, sheetsTempNewPath } from '@genoffice/mobile-bridge/sheets'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { callSheetsEngine, type SheetsEngineClient } from '../desktop-api/engine'

/** The engine's `convert_to_ods` answer (xlsx-sidecar-client.ts `OdsConversionResult`). */
export interface OdsConversion {
  readonly sheets: number
  readonly cells: number
  readonly formulasDropped: number
  readonly dropped: {
    readonly charts: number
    readonly images: number
    readonly conditionalFormats: number
    readonly validations: number
    readonly pivots: number
    readonly comments: number
    readonly macros: number
    readonly shapes: number
    readonly slicers: number
    readonly sparklines: number
  }
}

const DROPPED_KINDS = [
  'macros',
  'charts',
  'images',
  'shapes',
  'conditionalFormats',
  'validations',
  'pivots',
  'slicers',
  'sparklines',
  'comments',
] as const

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

/** Same defaults as the desktop client for fields an engine does not report. */
export function parseOdsConversion(raw: unknown): OdsConversion {
  const result = (raw ?? {}) as Record<string, unknown>
  const dropped = (result.dropped ?? {}) as Record<string, unknown>
  return {
    sheets: count(result.sheets),
    cells: count(result.cells),
    formulasDropped: count(result.formulasDropped),
    dropped: {
      charts: count(dropped.charts),
      images: count(dropped.images),
      conditionalFormats: count(dropped.conditionalFormats),
      validations: count(dropped.validations),
      pivots: count(dropped.pivots),
      comments: count(dropped.comments),
      macros: count(dropped.macros),
      shapes: count(dropped.shapes),
      slicers: count(dropped.slicers),
      sparklines: count(dropped.sparklines),
    },
  }
}

/** How many things the ODS leaves out: the sum of the desktop's `odsLosses`. */
export function odsLossCount(result: OdsConversion): number {
  return DROPPED_KINDS.reduce((sum, kind) => sum + result.dropped[kind], result.formulasDropped)
}

export type OdsCopyOutcome =
  | { readonly status: 'exported'; readonly name: string; readonly result: OdsConversion }
  | { readonly status: 'canceled' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'failed'; readonly message: string }

/**
 * `sourcePath`: an `.xlsx` of the workbook as it stands (the session's
 * snapshot, or a private copy with the pending edits). `deliver` receives
 * the verified `.ods` file and answers with the name it got; a cancel there
 * (the save dialog closed) is a cancel, any other failure is thrown on.
 */
export async function exportOdsCopy(
  client: SheetsEngineClient,
  input: {
    readonly sourcePath: string
    readonly confirmLoss: (count: number) => Promise<boolean>
    readonly deliver: (odsPath: string) => Promise<string>
  },
): Promise<OdsCopyOutcome> {
  const { path: tempOds } = await sheetsTempNewPath(client, 'ods')
  const { path: verifyXlsx } = await sheetsTempNewPath(client, 'xlsx')
  try {
    let result: OdsConversion
    try {
      result = parseOdsConversion(
        await callSheetsEngine(client, 'convert_to_ods', {
          path: input.sourcePath,
          targetPath: tempOds,
        }),
      )
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    const losses = odsLossCount(result)
    if (losses > 0 && !(await input.confirmLoss(losses))) return { status: 'canceled' }
    // The same ODS reader the desktop's import path uses opens the package.
    try {
      const reopened = (await callSheetsEngine(client, 'convert_workbook', {
        path: tempOds,
        targetPath: verifyXlsx,
      })) as { sheets?: unknown }
      if (count(reopened?.sheets) <= 0) return { status: 'unreadable' }
    } catch {
      return { status: 'unreadable' }
    }
    try {
      return { status: 'exported', name: await input.deliver(tempOds), result }
    } catch (error) {
      if (isMobileCommandError(error) && error.code === 'USER_CANCELLED') {
        return { status: 'canceled' }
      }
      throw error
    }
  } finally {
    await sheetsTempDelete(client, tempOds).catch(() => undefined)
    await sheetsTempDelete(client, verifyXlsx).catch(() => undefined)
  }
}
