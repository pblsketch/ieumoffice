/**
 * PROTOTYPE driver hook (XLS-T5), no user interface: the preview and emulator
 * scripts call `window.__ieumSheetsPdf.run()` to make the active sheet's PDF
 * and then pull the bytes in base64 chunks. The real "Save as" / share entry
 * comes with the full spreadsheet kind.
 */
import {
  desktopPrintHtml,
  exportActiveSheetPdf,
  type SheetPdfGrid,
  type SheetPdfResult,
} from './exportSheetPdf'

let last: SheetPdfResult | null = null

export interface SheetsPdfProbeSummary {
  readonly fileName: string
  readonly sheetName: string
  readonly bytes: number
  readonly pageCount: number
  readonly scale: number
  readonly stats: SheetPdfResult['stats']
  readonly timings: SheetPdfResult['timings']
  readonly peakHeapMb: number | null
}

function openGrid(): SheetPdfGrid {
  const grid = (window as unknown as { __ieumSheetsGrid?: SheetPdfGrid }).__ieumSheetsGrid
  if (!grid) throw new Error('No spreadsheet is open.')
  return grid
}

/** The desktop's print HTML for the active sheet (the comparison renders it with printToPDF). */
export function readDesktopPrintHtml(documentName?: string): Promise<string> {
  return desktopPrintHtml(openGrid(), documentName)
}

export async function runSheetsPdfProbe(options?: {
  readonly batchPages?: number
  readonly documentName?: string
}): Promise<SheetsPdfProbeSummary> {
  const grid = openGrid()
  last = null
  const result = await exportActiveSheetPdf(grid, {
    ...(options?.batchPages === undefined ? {} : { batchPages: options.batchPages }),
    ...(options?.documentName === undefined ? {} : { documentName: options.documentName }),
    onMessage: (message) => console.info('[sheets-pdf]', message),
  })
  last = result
  return {
    fileName: result.fileName,
    sheetName: result.sheetName,
    bytes: result.bytes.length,
    pageCount: result.pageCount,
    scale: result.scale,
    stats: result.stats,
    timings: result.timings,
    peakHeapMb: result.peakHeapMb,
  }
}

/** `length` bytes of the last PDF from `offset`, base64. */
export function readSheetsPdfProbeChunk(offset: number, length: number): string {
  if (!last) return ''
  const slice = last.bytes.subarray(offset, offset + length)
  let binary = ''
  for (let index = 0; index < slice.length; index += 0x8000) {
    binary += String.fromCharCode(...slice.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export function dropSheetsPdfProbe(): void {
  last = null
}
