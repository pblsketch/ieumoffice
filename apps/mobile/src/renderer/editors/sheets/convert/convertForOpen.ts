/**
 * Opening `.xls` and `.csv` on the phone the way the desktop main process
 * does (`prepareWorkbookForOpen` in apps/sheets/src/main/sheets-main.ts):
 * the document is converted into a fresh `.xlsx` in the work folder, and the
 * session edits that copy.
 *
 * - `.xls`: the desktop's own `convertLegacyWorkbook` (imported as it is; its
 *   `node:fs/promises` calls reach the work folder through the phone's
 *   stand-in). A real container goes to the engine's `convert_workbook`; an
 *   HTML table a web system named `.xls` goes through the gateway's HTML import.
 * - `.csv`: the gateway's `decodeCsvBuffer` and `csvToXlsxBufferForOpen`, the
 *   calls the desktop makes, with the same size limit.
 */
import {
  sheetsTempReadRaw,
  sheetsTempStat,
  sheetsTempWriteBytes,
} from '@genoffice/mobile-bridge/sheets'
import { csvToXlsxBufferForOpen, decodeCsvBuffer } from '@genoffice/xlsx-gateway/gateway/csv-import'
import { convertLegacyWorkbook } from '../../../../../../sheets/src/main/legacy-import'
import { callSheetsEngine, type SheetsEngineClient } from '../desktop-api/engine'
import { bytesToBase64 } from '../node-shims/buffer'
import { ensureWorkFolder } from '../save/workFolder'

/** Same as the desktop's `MAX_DELIMITED_IMPORT_BYTES` (sheets-main.ts). */
export const MAX_DELIMITED_IMPORT_BYTES = 32 * 1024 * 1024

/** The desktop's `legacyCsvCharset` (sheets-main.ts): the legacy charset an Excel CSV most likely uses. */
export function legacyCsvCharset(locale: string): string | undefined {
  const byLang: Partial<Record<string, string>> = {
    zh: 'gb18030',
    'zh-TW': 'big5',
    ja: 'shift_jis',
    ko: 'euc-kr',
  }
  return byLang[locale]
}

/** The desktop's messages for these refusals are its main-process strings; the phone's come with the save screen. */
export class SheetsOpenConversionError extends Error {
  readonly reason: 'too-large' | 'html-no-table'

  constructor(reason: 'too-large' | 'html-no-table') {
    super(
      reason === 'too-large'
        ? 'The file is too large to open.'
        : 'The file is a web page without a table.',
    )
    this.name = 'SheetsOpenConversionError'
    this.reason = reason
  }
}

export interface ConvertForOpenInput {
  readonly ext: string
  /** The working copy of the document (inside the work folder). */
  readonly sourcePath: string
  /** Where the `.xlsx` goes (inside the work folder, not yet existing). */
  readonly targetPath: string
  readonly locale: string
}

export async function convertToXlsxForOpen(
  client: SheetsEngineClient,
  input: ConvertForOpenInput,
): Promise<void> {
  if (input.ext === 'csv') {
    const found = await sheetsTempStat(client, input.sourcePath)
    if (found && found.size > MAX_DELIMITED_IMPORT_BYTES) {
      throw new SheetsOpenConversionError('too-large')
    }
    const converted = await csvToXlsxBufferForOpen(
      decodeCsvBuffer(
        await sheetsTempReadRaw(client, input.sourcePath),
        legacyCsvCharset(input.locale),
      ),
      'Sheet1',
    )
    await sheetsTempWriteBytes(client, input.targetPath, bytesToBase64(converted.buffer))
    return
  }
  await ensureWorkFolder(client)
  const conversion = await convertLegacyWorkbook(
    {
      convertWorkbook: (request) =>
        callSheetsEngine(client, 'convert_workbook', {
          path: request.path,
          targetPath: request.targetPath,
        }),
    },
    input.sourcePath,
    input.targetPath,
    legacyCsvCharset(input.locale),
  )
  if (conversion.kind === 'html-too-large') throw new SheetsOpenConversionError('too-large')
  if (conversion.kind === 'html-no-table') throw new SheetsOpenConversionError('html-no-table')
}
