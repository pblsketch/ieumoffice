/**
 * The desktop's print layout modules, loaded as they are through Vite's
 * `import.meta.glob` and typed here, for the reason grid/pcGridModules.ts
 * gives: `print-html.ts` reaches `WorkbookVisuals.tsx` through a type import
 * (print-visuals.ts), and `page-break-preview.tsx` calls the drawing facade's
 * `addFloatDomToRange`; both fail the phone's type check while the desktop's
 * passes. The signatures below repeat the desktop exports the phone calls;
 * `tests/sheets-pdf-pages.test.ts` runs them.
 */
import type { PrintPage } from '../../../../../../sheets/src/renderer/print-paginate'
import type {
  EffectivePageSetup,
  HeaderFooterPair,
  PrintMargins,
} from '../../../../../../sheets/src/renderer/print-settings'
import type { LazyWorkbookState } from '../../../../../../sheets/src/renderer/univer-state'
import type { WorkbookExportPdfRequest } from '../../../../../../sheets/src/shared/desktop-api'

/** print-html.ts `PrintWorksheet`: the slice of the Univer facade the layout reads. */
export interface PrintWorksheet {
  getLastRow(): number
  getLastColumn(): number
  getRowHeight(row: number): number
  getColumnWidth(column: number): number
  getSheet?(): { getRowVisible(row: number): boolean; getColVisible(column: number): boolean }
  getMergedRanges(): {
    getRow(): number
    getColumn(): number
    getWidth(): number
    getHeight(): number
  }[]
  getRange(
    row: number,
    column: number,
    numRows: number,
    numColumns: number,
  ): {
    getDisplayValues(): string[][]
    getValues(): unknown[][]
  }
  getRange(row: number, column: number): { getCellStyleData(): unknown }
}

export interface HeaderFooterPictureImage {
  readonly dataUrl: string
  readonly widthPt: number
  readonly heightPt: number
}

export type HeaderFooterPictures = ReadonlyMap<string, HeaderFooterPictureImage>

export interface PaperGeometry {
  readonly pageSize: WorkbookExportPdfRequest['pageSize']
  readonly landscape: boolean
  readonly widthIn: number
  readonly heightIn: number
}

export interface SheetPrintPageRecord {
  readonly body: string
  readonly page: PrintPage
}

export interface SheetPrintDocument {
  readonly sheetName: string
  readonly fileName: string
  readonly paper: PaperGeometry
  readonly margins: PrintMargins
  readonly scale: number
  readonly headerFooterScale: number
  readonly pictures: HeaderFooterPictures
  readonly headerFooter: {
    readonly odd: HeaderFooterPair
    readonly first: HeaderFooterPair | null
    readonly even: HeaderFooterPair | null
  }
  readonly css: string
  readonly pages: readonly SheetPrintPageRecord[]
  readonly now: Date
}

export interface PcPrintHtml {
  PrintError: new (message?: string) => Error
  layoutSheetPrint(
    worksheet: PrintWorksheet,
    setup: EffectivePageSetup,
    fileName: string,
    sheetName: string,
    pictures?: HeaderFooterPictures,
    visuals?: { visuals: readonly unknown[]; css: string },
    options?: {
      breaks?: { rowBreaks: readonly number[]; colBreaks: readonly number[] } | null
      selection?: string | null
      now?: Date
    },
  ): SheetPrintDocument
  assemblePrintHtml(
    documents: readonly SheetPrintDocument[],
    include?: (jobPage: number) => boolean,
  ): { readonly html: string; readonly pages: readonly { document: number; page: number }[] }
  paperGeometry(paperSize: number, orientation: 'portrait' | 'landscape'): PaperGeometry
}

export interface PcPageBreakPreview {
  effectivePageBreaks(
    state: LazyWorkbookState,
    sheetId: string,
  ): { rowBreaks: number[]; colBreaks: number[] } | null
}

function single<T>(modules: Record<string, T>, name: string): T {
  const module = Object.values(modules)[0]
  if (!module) throw new Error(`Desktop print module missing: ${name}`)
  return module
}

export const pcPrintHtml = single(
  import.meta.glob<PcPrintHtml>('../../../../../../sheets/src/renderer/print-html.ts', {
    eager: true,
  }),
  'print-html.ts',
)

export const pcPageBreakPreview = single(
  import.meta.glob<PcPageBreakPreview>(
    '../../../../../../sheets/src/renderer/page-break-preview.tsx',
    { eager: true },
  ),
  'page-break-preview.tsx',
)
