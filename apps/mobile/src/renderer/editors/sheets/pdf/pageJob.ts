/**
 * The desktop's "current sheet PDF" pages, produced a few at a time.
 *
 * The desktop lays the whole sheet out as one HTML document
 * (`layoutSheetPrint` + `assemblePrintHtml` in apps/sheets/src/renderer/print-html.ts)
 * and refuses a print area over 50,000 cells. The phone cannot hold that
 * document for a big sheet, so it plans the pages the same way (the desktop's
 * `planPrintPages` and `fitToPageScale` over the same row heights and column
 * widths), lays out each page with the desktop's `layoutSheetPrint` limited to
 * that page's cells at the planned scale, and assembles each batch with the
 * desktop's `assemblePrintHtml` (page numbers count the whole job). Every page's
 * markup is the desktop's; only the slicing is the phone's. The plan step
 * repeats the desktop's arithmetic (lines 288-360 of print-html.ts);
 * `tests/sheets-pdf-pages.test.ts` checks it page for page against the desktop.
 */
import { columnIndex, columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import {
  pcPrintHtml,
  type HeaderFooterPictures,
  type PaperGeometry,
  type PrintWorksheet,
  type SheetPrintDocument,
  type SheetPrintPageRecord,
} from './pcPrintModules'
import {
  bodyColumns,
  bodyRows,
  planPrintPages,
  type IndexSpan,
  type PrintArea,
  type PrintPage,
} from '../../../../../../sheets/src/renderer/print-paginate'
import {
  fitToPageScale,
  MAX_PRINT_SCALE,
  MIN_PRINT_SCALE,
  type PrintAreaHeights,
} from '../../../../../../sheets/src/renderer/print-scale'
import type { EffectivePageSetup } from '../../../../../../sheets/src/renderer/print-settings'
import { t } from '../../../../../../sheets/src/renderer/i18n/locale'

const { assemblePrintHtml, layoutSheetPrint, paperGeometry, PrintError } = pcPrintHtml

/** The row/column heading strip, as the desktop sizes it (print-html.ts). */
const HEADING_ROW_HEIGHT_PT = 14
const HEADING_COLUMN_WIDTH_PT = 24

export interface SheetPagePlan {
  readonly pages: readonly PrintPage[]
  /** Content scale (fit-to-page resolved). */
  readonly scale: number
  readonly paper: PaperGeometry
}

export interface PlanInput {
  readonly worksheet: PrintWorksheet
  readonly setup: EffectivePageSetup
  readonly breaks: { rowBreaks: readonly number[]; colBreaks: readonly number[] } | null
}

/** The desktop's page plan for the sheet, without reading any cell value. */
export function planSheetPages({ worksheet, setup, breaks }: PlanInput): SheetPagePlan {
  const areas =
    setup.printAreas.length > 0 ? setup.printAreas.map(parseArea) : [usedArea(worksheet)]
  for (const area of areas) {
    if (area.endRow < area.startRow || area.endColumn < area.startColumn) {
      throw new PrintError(t('appPrintNothing'))
    }
  }
  const titleRows = setup.printTitles ? parseTitleRows(setup.printTitles) : null
  const titleColumns = setup.printTitleColumns ? parseTitleColumns(setup.printTitleColumns) : null
  const headings = setup.printHeadings
  const sheet = worksheet.getSheet?.()
  const rowHeightPt = (row: number): number =>
    sheet && !sheet.getRowVisible(row) ? 0 : finitePt(worksheet.getRowHeight(row), 20) * 0.75
  const columnWidthPt = (column: number): number =>
    sheet && !sheet.getColVisible(column)
      ? 0
      : finitePt(worksheet.getColumnWidth(column), 64) * 0.75
  const headingWidthPt = headings ? HEADING_COLUMN_WIDTH_PT : 0
  const headingHeightPt = headings ? HEADING_ROW_HEIGHT_PT : 0
  const titleRowsHeightPt = spanTotal(titleRows, rowHeightPt)
  const titleColumnsWidthPt = spanTotal(titleColumns, columnWidthPt)

  const paper = paperGeometry(setup.paperSize, setup.orientation)
  const margins = setup.margins
  const printableWidthPt = Math.max((paper.widthIn - margins.left - margins.right) * 72, 1)
  const printableHeightPt = Math.max((paper.heightIn - margins.top - margins.bottom) * 72, 1)

  const baseInput = {
    areas,
    rowHeightPt,
    columnWidthPt,
    titleRows,
    titleColumns,
    headingWidthPt,
    headingHeightPt,
  }
  let scale: number
  if (setup.fitToPage) {
    const areaHeights: PrintAreaHeights[] = []
    let contentWidthPt = 0
    for (const area of areas) {
      const rows = bodyRows(area, baseInput)
      const columns = bodyColumns(area, baseInput)
      areaHeights.push({
        repeatedHeightPt: headingHeightPt + titleRowsHeightPt,
        rowHeightsPt: rows.map(rowHeightPt),
      })
      contentWidthPt = Math.max(
        contentWidthPt,
        headingWidthPt +
          titleColumnsWidthPt +
          columns.reduce((sum, column) => sum + columnWidthPt(column), 0),
      )
    }
    scale = fitToPageScale({
      printableWidthPt,
      printableHeightPt,
      fitToWidth: setup.fitToWidth,
      fitToHeight: setup.fitToHeight,
      contentWidthPt,
      areas: areaHeights,
    })
  } else {
    scale = Math.min(MAX_PRINT_SCALE, Math.max(MIN_PRINT_SCALE, setup.scale / 100))
  }
  // Excel ignores manual breaks while fit-to-page decides the scale.
  const activeBreaks = setup.fitToPage ? null : breaks
  const pages = planPrintPages({
    ...baseInput,
    rowBreaks: activeBreaks?.rowBreaks ?? [],
    colBreaks: activeBreaks?.colBreaks ?? [],
    pageWidthPt: printableWidthPt / scale,
    pageHeightPt: printableHeightPt / scale,
  })
  return { pages, scale, paper }
}

export interface PageLayoutContext {
  readonly worksheet: PrintWorksheet
  readonly setup: EffectivePageSetup
  readonly fileName: string
  readonly sheetName: string
  readonly pictures: HeaderFooterPictures
  readonly now: Date
  readonly plan: SheetPagePlan
}

/**
 * One planned page laid out by the desktop: the page's cells as a print area of
 * their own, at the planned scale, with no breaks (the plan already applied
 * them). Repeated title rows and columns come from the setup as on every
 * desktop page. Returns the desktop's document for that single page.
 */
export function layoutPlannedPage(context: PageLayoutContext, page: PrintPage): SheetPrintDocument {
  const selection = `${columnLabel(page.colStart)}${page.rowStart + 1}:${columnLabel(page.colEnd)}${page.rowEnd + 1}`
  const attempt = (scale: number): SheetPrintDocument =>
    layoutSheetPrint(
      context.worksheet,
      { ...context.setup, fitToPage: false, scale: scale * 100, printAreas: [] },
      context.fileName,
      context.sheetName,
      context.pictures,
      { visuals: [], css: '' },
      { selection, breaks: null, now: context.now },
    )
  const document = attempt(context.plan.scale)
  if (document.pages.length === 1) return document
  // `scale * 100 / 100` can land one unit in the last place above the plan's
  // scale, and a page filled to the last point then spills. A hair smaller
  // scale gives the page that point back; the markup rounds it away.
  const retried = attempt(context.plan.scale * (1 - 1e-9))
  if (retried.pages.length === 1) return retried
  throw new PrintError(t('appPrintNothing'))
}

/** Pages of a batch, in job order. */
export interface PageBatch {
  /** Index of the first page in the job. */
  readonly first: number
  readonly records: readonly SheetPrintPageRecord[]
  /** The desktop's print HTML for these pages only (numbered within the whole job). */
  readonly html: string
}

/**
 * The job's pages as desktop print HTML, `batchPages` pages at a time. The
 * page records outside the batch are a shared placeholder, so the desktop's
 * `assemblePrintHtml` numbers `&P` / `&N` and picks first/even header variants
 * across the whole job while only the batch is ever in memory.
 */
export function* pageBatches(
  context: PageLayoutContext,
  batchPages: number,
): Generator<PageBatch, void, undefined> {
  const { pages } = context.plan
  if (pages.length === 0) throw new PrintError(t('appPrintNothing'))
  const size = Math.max(1, Math.floor(batchPages))
  const placeholder: SheetPrintPageRecord = { body: '', page: pages[0] as PrintPage }
  for (let first = 0; first < pages.length; first += size) {
    const last = Math.min(pages.length, first + size) - 1
    const records: SheetPrintPageRecord[] = []
    let template: SheetPrintDocument | null = null
    for (let index = first; index <= last; index += 1) {
      const laid = layoutPlannedPage(context, pages[index] as PrintPage)
      template ??= laid
      records.push({
        body: (laid.pages[0] as SheetPrintPageRecord).body,
        page: pages[index] as PrintPage,
      })
    }
    if (!template) continue
    const jobPages = new Array<SheetPrintPageRecord>(pages.length).fill(placeholder)
    records.forEach((record, offset) => {
      jobPages[first + offset] = record
    })
    const document: SheetPrintDocument = { ...template, pages: jobPages }
    const { html } = assemblePrintHtml(
      [document],
      (jobPage) => jobPage - 1 >= first && jobPage - 1 <= last,
    )
    yield { first, records, html }
  }
}

// The helpers below repeat the desktop's private ones in print-html.ts.

function usedArea(worksheet: PrintWorksheet): PrintArea {
  return {
    startRow: 0,
    startColumn: 0,
    endRow: Math.max(worksheet.getLastRow(), 0),
    endColumn: Math.max(worksheet.getLastColumn(), 0),
  }
}

function finitePt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback
  return Math.min(value, 100000)
}

function parseArea(area: string): PrintArea {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7}):\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(area)
  if (!match) throw new PrintError(t('appPrintBadArea', { area }))
  const rows = [Number(match[2]) - 1, Number(match[4]) - 1]
  const columns = [columnIndex(match[1] ?? 'A'), columnIndex(match[3] ?? 'A')]
  return {
    startRow: Math.min(...rows),
    endRow: Math.max(...rows),
    startColumn: Math.min(...columns),
    endColumn: Math.max(...columns),
  }
}

function parseTitleRows(titles: string): IndexSpan {
  const match = /^(\d{1,7}):(\d{1,7})$/.exec(titles)
  if (!match) throw new PrintError(t('appPrintBadTitles', { titles }))
  const start = Number(match[1]) - 1
  const end = Number(match[2]) - 1
  if (end - start > 20) throw new PrintError(t('appPrintTitlesLimit'))
  return { start, end }
}

function parseTitleColumns(titles: string): IndexSpan {
  const match = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(titles)
  if (!match) throw new PrintError(t('appPrintBadTitles', { titles }))
  const start = columnIndex((match[1] ?? 'A').toUpperCase())
  const end = columnIndex((match[2] ?? 'A').toUpperCase())
  if (end - start > 20) throw new PrintError(t('appPrintTitlesLimit'))
  return { start, end }
}

function spanTotal(span: IndexSpan | null, sizeOf: (index: number) => number): number {
  if (!span) return 0
  let total = 0
  for (let index = span.start; index <= span.end; index += 1) total += sizeOf(index)
  return total
}
