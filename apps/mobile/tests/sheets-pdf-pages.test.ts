import { describe, expect, it } from 'vitest'
import {
  pcPageBreakPreview,
  pcPrintHtml,
  type PrintWorksheet,
} from '../src/renderer/editors/sheets/pdf/pcPrintModules'
import { pageBatches, planSheetPages } from '../src/renderer/editors/sheets/pdf/pageJob'
import {
  resolveEffectivePageSetup,
  type EffectivePageSetup,
} from '../../sheets/src/renderer/print-settings'

interface FakeSheet {
  readonly rows: number
  readonly columns: number
  readonly rowHeight?: (row: number) => number
  readonly columnWidth?: (column: number) => number
  readonly hiddenRows?: ReadonlySet<number>
  readonly merges?: readonly { row: number; column: number; rows: number; columns: number }[]
  readonly style?: (row: number, column: number) => unknown
  readonly value?: (row: number, column: number) => unknown
}

/** A PrintWorksheet over generated data; records the largest block read at once. */
function fakeWorksheet(sheet: FakeSheet): PrintWorksheet & { largestRead: number } {
  const value = sheet.value ?? ((row: number, column: number) => `R${row + 1}C${column + 1}`)
  const worksheet = {
    largestRead: 0,
    getLastRow: () => sheet.rows - 1,
    getLastColumn: () => sheet.columns - 1,
    getRowHeight: (row: number) => sheet.rowHeight?.(row) ?? 20,
    getColumnWidth: (column: number) => sheet.columnWidth?.(column) ?? 64,
    getSheet: () => ({
      getRowVisible: (row: number) => !sheet.hiddenRows?.has(row),
      getColVisible: () => true,
    }),
    getMergedRanges: () =>
      (sheet.merges ?? []).map((merge) => ({
        getRow: () => merge.row,
        getColumn: () => merge.column,
        getWidth: () => merge.columns,
        getHeight: () => merge.rows,
      })),
    getRange(row: number, column: number, numRows?: number, numColumns?: number) {
      if (numRows === undefined || numColumns === undefined) {
        return { getCellStyleData: () => sheet.style?.(row, column) ?? null }
      }
      worksheet.largestRead = Math.max(worksheet.largestRead, numRows * numColumns)
      const grid = (read: (r: number, c: number) => unknown) =>
        Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numColumns }, (_, c) =>
            row + r < sheet.rows && column + c < sheet.columns ? read(row + r, column + c) : '',
          ),
        )
      return {
        getDisplayValues: () => grid((r, c) => String(value(r, c) ?? '')) as string[][],
        getValues: () => grid(value),
      }
    },
  }
  return worksheet as unknown as PrintWorksheet & { largestRead: number }
}

function setupWith(overrides: Partial<EffectivePageSetup>): EffectivePageSetup {
  return { ...resolveEffectivePageSetup({}, null, null), ...overrides }
}

const NOW = new Date('2026-11-25T09:00:00Z')

function pageDivs(html: string): string[] {
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  return body.split(/(?=<div class="page )/).filter(Boolean)
}

/** The desktop's whole-sheet print HTML pages and the phone's batched ones. */
function bothWays(
  worksheet: PrintWorksheet,
  setup: EffectivePageSetup,
  breaks: { rowBreaks: number[]; colBreaks: number[] } | null = null,
  batchPages = 3,
) {
  const desktop = pcPrintHtml.layoutSheetPrint(
    worksheet,
    setup,
    'Book',
    'Sheet1',
    new Map(),
    { visuals: [], css: '' },
    { breaks, now: NOW },
  )
  const desktopHtml = pcPrintHtml.assemblePrintHtml([desktop]).html
  const plan = planSheetPages({ worksheet, setup, breaks })
  const context = {
    worksheet,
    setup,
    fileName: 'Book',
    sheetName: 'Sheet1',
    pictures: new Map(),
    now: NOW,
    plan,
  }
  const phone = [...pageBatches(context, batchPages)]
  return { desktop, desktopHtml, plan, phone }
}

describe('sheet PDF pages on the phone', () => {
  it('plans the same pages and scale as the desktop layout', () => {
    const cases: { name: string; sheet: FakeSheet; setup: Partial<EffectivePageSetup> }[] = [
      { name: 'plain', sheet: { rows: 130, columns: 14 }, setup: {} },
      {
        name: 'fit to one page wide',
        sheet: { rows: 200, columns: 30 },
        setup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      },
      {
        name: 'fit to one page',
        sheet: { rows: 90, columns: 12 },
        setup: { fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
      },
      { name: 'scaled 55%', sheet: { rows: 150, columns: 20 }, setup: { scale: 55 } },
      {
        name: 'titles, headings, landscape',
        sheet: { rows: 160, columns: 16, rowHeight: (row) => (row % 7 === 0 ? 33 : 20) },
        setup: {
          printTitles: '1:2',
          printTitleColumns: 'A:A',
          printHeadings: true,
          orientation: 'landscape',
        },
      },
      {
        name: 'hidden rows and print areas',
        sheet: { rows: 120, columns: 10, hiddenRows: new Set([3, 4, 50, 51, 52]) },
        setup: { printAreas: ['B2:F80', 'A90:J120'] },
      },
    ]
    for (const testCase of cases) {
      const worksheet = fakeWorksheet(testCase.sheet)
      const { desktop, plan } = bothWays(worksheet, setupWith(testCase.setup))
      expect(plan.pages, testCase.name).toEqual(desktop.pages.map((record) => record.page))
      expect(plan.scale, testCase.name).toBe(desktop.scale)
      expect(plan.paper, testCase.name).toEqual(desktop.paper)
    }
  })

  it('writes every page with the desktop markup, numbered across the job', () => {
    const worksheet = fakeWorksheet({
      rows: 140,
      columns: 18,
      merges: [
        // Crosses the first row break and the first column break.
        { row: 40, column: 9, rows: 12, columns: 4 },
        { row: 0, column: 0, rows: 1, columns: 6 },
      ],
      style: (row, column) =>
        row % 9 === 0
          ? { bl: 1, bg: { rgb: '#FFF2CC' }, bd: { b: { s: 2, cl: { rgb: '#000000' } } } }
          : column === 3
            ? { ht: 3, fs: 9 }
            : null,
      value: (row, column) => (column === 3 ? row * 1000 + 0.5 : `가나다 ${row}-${column}`),
    })
    const setup = setupWith({
      printGridlines: true,
      header: { center: '&A' },
      footer: { right: '&P / &N' },
      firstPage: { header: { left: 'first' }, footer: null },
    })
    const breaks = { rowBreaks: [70], colBreaks: [] }
    const { desktopHtml, phone } = bothWays(worksheet, setup, breaks, 4)
    const phonePages = phone.flatMap((batch) => pageDivs(batch.html))
    const desktopPages = pageDivs(desktopHtml)
    expect(desktopPages.length).toBeGreaterThan(4)
    expect(phonePages).toEqual(desktopPages)
    // The head (styles, @page rules) is the desktop's too.
    for (const batch of phone) {
      expect(batch.html.slice(0, batch.html.indexOf('<body>'))).toBe(
        desktopHtml.slice(0, desktopHtml.indexOf('<body>')),
      )
    }
    expect(phonePages.at(-1)).toContain(`${desktopPages.length} / ${desktopPages.length}`)
  })

  it('carries the planned scale into every page', () => {
    const worksheet = fakeWorksheet({ rows: 60, columns: 40 })
    const setup = setupWith({ fitToPage: true, fitToWidth: 1, fitToHeight: 0 })
    const { plan, phone, desktopHtml } = bothWays(worksheet, setup)
    expect(plan.scale).toBeLessThan(1)
    const zoom = `zoom:${Math.round(plan.scale * 10000) / 10000}`
    for (const batch of phone) {
      for (const page of pageDivs(batch.html)) expect(page).toContain(zoom)
    }
    expect(phone.flatMap((batch) => pageDivs(batch.html))).toEqual(pageDivs(desktopHtml))
  })

  it('prints an empty sheet as one blank page, like the desktop', () => {
    const worksheet = fakeWorksheet({ rows: 0, columns: 0, value: () => '' })
    const { desktopHtml, plan, phone } = bothWays(worksheet, setupWith({}))
    expect(plan.pages).toHaveLength(1)
    expect(phone).toHaveLength(1)
    expect(pageDivs(phone[0]?.html ?? '')).toEqual(pageDivs(desktopHtml))
  })

  it('streams a sheet past the desktop print limit page batch by page batch', () => {
    const rows = 60_000
    const columns = 6
    const worksheet = fakeWorksheet({ rows, columns })
    const setup = setupWith({})
    // The desktop refuses this print area (50,000-cell limit)...
    expect(() =>
      pcPrintHtml.layoutSheetPrint(worksheet, setup, 'Book', 'Sheet1', new Map(), undefined, {
        now: NOW,
      }),
    ).toThrow(pcPrintHtml.PrintError)
    // ...the phone prints all of it, never reading more than one page at once.
    const plan = planSheetPages({ worksheet, setup, breaks: null })
    const context = {
      worksheet,
      setup,
      fileName: 'Book',
      sheetName: 'Sheet1',
      pictures: new Map(),
      now: NOW,
      plan,
    }
    let pages = 0
    let nextRow = 0
    let largestBatchHtml = 0
    for (const batch of pageBatches(context, 16)) {
      largestBatchHtml = Math.max(largestBatchHtml, batch.html.length)
      for (const record of batch.records) {
        expect(record.page.rowStart).toBe(nextRow)
        nextRow = record.page.rowEnd + 1
        pages += 1
      }
      expect(pageDivs(batch.html)).toHaveLength(batch.records.length)
    }
    expect(nextRow).toBe(rows)
    expect(pages).toBe(plan.pages.length)
    const rowsPerPage = plan.pages[0] ? plan.pages[0].rowEnd - plan.pages[0].rowStart + 1 : 0
    expect(worksheet.largestRead).toBeLessThanOrEqual(rowsPerPage * columns)
    // One batch of markup, not the sheet's.
    expect(largestBatchHtml).toBeLessThan(2_000_000)
  }, 120_000)

  it('reads the effective manual breaks through the desktop module', () => {
    expect(typeof pcPageBreakPreview.effectivePageBreaks).toBe('function')
  })
})
