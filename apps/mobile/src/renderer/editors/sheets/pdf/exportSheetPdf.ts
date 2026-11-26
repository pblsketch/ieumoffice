/**
 * The active sheet as a PDF (the XLS-T5 method), with the content the
 * desktop's "current sheet PDF" has (apps/sheets/src/renderer/page-layout-actions.ts
 * `activeSheetPrintPayload` → `handleExportPdf`).
 *
 * Same steps as the desktop: load the whole workbook when it is still
 * streaming (the desktop's full-load rule and budget), settle formulas,
 * capture the sheet's file page setup, resolve the effective setup (journal
 * over file), read the `&G` header/footer pictures, then lay the pages out with
 * the desktop's print layout. What differs is the last step: pages are laid
 * out and drawn a batch at a time (pageJob.ts) and the web view's own layout
 * becomes vector PDF pages (domToPdf.ts) instead of Chromium's `printToPDF`.
 * The result is a byte copy; nothing here touches the session, the unsaved
 * edits or the recovery copy.
 *
 * The phone's grid draws no floating pictures, charts or shapes, so the
 * print layout gets none: the result counts the sheet's ones it left out
 * (`skippedVisuals`), and characters no bundled font has (`stats.missingGlyphs`),
 * for the one notice after the PDF is made.
 */
import { PDFDocument, type PDFFont, type PDFImage } from 'pdf-lib'
import type { FWorksheet } from '@univerjs/sheets/facade'
import { settleFormulas } from '../../../../../../sheets/src/renderer/formula-settle'
import {
  resolveEffectivePageSetup,
  type HeaderFooterPictureSlot,
} from '../../../../../../sheets/src/renderer/print-settings'
import { t } from '../../../../../../sheets/src/renderer/i18n/locale'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { pcFullLoad, pcLoadBudget, pcUniverSync } from '../grid/pcGridModules'
import { drawPrintPage, PrintFrame, type PdfSink, type RenderStats } from './domToPdf'
import { defaultFaceSpecs, FaceResolver, loadFace, pdfLibFontkit, type LoadedFace } from './fonts'
import { pageBatches, planSheetPages } from './pageJob'
import {
  pcPageBreakPreview,
  pcPrintHtml,
  type HeaderFooterPictureImage,
  type PrintWorksheet,
} from './pcPrintModules'

/** Desktop exports grid/pcGridModules.ts does not type (same modules, read through its handles). */
interface PcSheetFileState {
  ensureSheetFileState(
    state: LazyWorkbookState,
    sheetId: string,
    lazyWorkbookRef: { current: LazyWorkbookState | null },
  ): Promise<boolean>
}
interface PcFullLoadBudget {
  fitsFullLoad(counts: ReturnType<typeof pcLoadBudget.workbookCellCounts>): boolean
}
const { PrintError } = pcPrintHtml
const { effectivePageBreaks } = pcPageBreakPreview
const { ensureSheetFileState } = pcUniverSync as unknown as PcSheetFileState
const { fitsFullLoad } = pcLoadBudget as unknown as PcFullLoadBudget

/** Pages laid out and drawn together; the next batch replaces them in the print frame. */
const DEFAULT_BATCH_PAGES = 8

export interface SheetPdfGrid {
  readonly runtime: UniverRuntime
  readonly lazyWorkbookRef: { current: LazyWorkbookState | null }
}

export interface SheetPdfOptions {
  readonly batchPages?: number
  readonly onProgress?: (progress: { readonly done: number; readonly total: number }) => void
  readonly onMessage?: (message: string) => void
  /**
   * The document's name as the user sees it (`&F`, the PDF's name). The phone's
   * workbook file is the engine's working copy, whose name is not the document's.
   */
  readonly documentName?: string
  /** Overrides the bundled fonts (tests). */
  readonly faces?: readonly LoadedFace[]
}

export interface SheetPdfTimings {
  /** Full load and formula settling (desktop rule). */
  loadMs: number
  planMs: number
  /** Desktop page layout (cell reads and markup). */
  layoutMs: number
  /** Web view layout and drawing into the PDF. */
  drawMs: number
  saveMs: number
  totalMs: number
}

export interface SheetPdfResult {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly sheetName: string
  readonly pageCount: number
  readonly scale: number
  readonly stats: RenderStats
  /** The sheet's pictures, charts and shapes the PDF does not hold. */
  readonly skippedVisuals: number
  readonly timings: SheetPdfTimings
  /** Largest JS heap seen between batches (MB), where the engine reports it. */
  readonly peakHeapMb: number | null
}

/** The sheet ready to lay out, prepared the way the desktop prepares it. */
interface PreparedSheet {
  readonly worksheet: PrintWorksheet
  /** Floating objects of this sheet in the file (the phone prints none of them). */
  readonly visualCount: number
  readonly setup: ReturnType<typeof resolveEffectivePageSetup>
  readonly breaks: { rowBreaks: number[]; colBreaks: number[] } | null
  readonly fileName: string
  readonly sheetName: string
  readonly pictures: Map<string, HeaderFooterPictureImage>
  /** Full load and formula settling took this long (ms). */
  readonly loadMs: number
}

/**
 * The desktop's `activeSheetPrintPayload` steps up to the layout: full load
 * under the desktop's budget (else the desktop's refusal), formulas settled,
 * the file page setup captured, journal over file, header/footer pictures.
 */
async function prepareActiveSheet(
  grid: SheetPdfGrid,
  say: (message: string) => void,
  documentName: string | undefined,
): Promise<PreparedSheet> {
  const started = performance.now()
  const { runtime, lazyWorkbookRef } = grid
  const activeSheet = (): FWorksheet | null =>
    runtime.univerAPI.getActiveWorkbook()?.getActiveSheet() ?? null
  if (!activeSheet()) throw new PrintError(t('appActiveSheetUnavailable'))
  const state = lazyWorkbookRef.current
  if (state && !state.flags.preloadComplete) {
    if (!fitsFullLoad(pcLoadBudget.workbookCellCounts(state.file.sheets))) {
      throw new PrintError(t('appPrintWorkbookTooLarge'))
    }
    say(t('appPdfNeedsFullLoad'))
    await pcFullLoad.startFullLoad(runtime, lazyWorkbookRef, say)
    if (lazyWorkbookRef.current !== state || !state.flags.preloadComplete) {
      throw new PrintError(t('appPdfExportFailed'))
    }
  }
  await settleFormulas(runtime)
  const worksheet = activeSheet()
  if (!worksheet) throw new PrintError(t('appActiveSheetUnavailable'))
  const loadMs = performance.now() - started

  say(t('appPdfRendering'))
  const sheetId = worksheet.getSheetId()
  if (state) await ensureSheetFileState(state, sheetId, lazyWorkbookRef)
  const journal = state?.editJournal.pageSetup.get(sheetId) ?? {}
  const fileSetup = state?.sheetFilePageSetups.get(sheetId) ?? null
  const fileSheet = state?.file.sheets.find((sheet) => sheet.id === sheetId)
  const setup = resolveEffectivePageSetup(
    journal,
    fileSetup,
    {
      ...(fileSheet?.printArea === undefined ? {} : { printArea: fileSheet.printArea }),
      ...(fileSheet?.printTitles === undefined ? {} : { printTitles: fileSheet.printTitles }),
    },
    state?.editJournal.structuralOps.get(sheetId) ?? [],
  )
  const fileName = (documentName ?? state?.file.name ?? 'Book1').replace(/\.[^.]+$/, '')
  const pictures = state
    ? await loadHeaderFooterPictures(state.file.sessionId, setup.headerFooterPictures)
    : new Map<string, HeaderFooterPictureImage>()
  return {
    worksheet: worksheet as unknown as PrintWorksheet,
    visualCount: state?.file.visuals.filter((visual) => visual.sheetId === sheetId).length ?? 0,
    setup,
    breaks: state ? effectivePageBreaks(state, sheetId) : null,
    fileName,
    sheetName: worksheet.getSheetName(),
    pictures,
    loadMs,
  }
}

/**
 * Reference for the prototype comparison: the desktop's whole-job print HTML
 * for the active sheet (what `handleExportPdf` hands to `printToPDF`), within
 * the desktop's own print limits.
 */
export async function desktopPrintHtml(grid: SheetPdfGrid, documentName?: string): Promise<string> {
  const sheet = await prepareActiveSheet(grid, () => undefined, documentName)
  const document = pcPrintHtml.layoutSheetPrint(
    sheet.worksheet,
    sheet.setup,
    sheet.fileName,
    sheet.sheetName,
    sheet.pictures,
    { visuals: [], css: '' },
    { breaks: sheet.breaks, selection: null, now: new Date() },
  )
  return pcPrintHtml.assemblePrintHtml([document]).html
}

export async function exportActiveSheetPdf(
  grid: SheetPdfGrid,
  options: SheetPdfOptions = {},
): Promise<SheetPdfResult> {
  const started = performance.now()
  const timings: SheetPdfTimings = {
    loadMs: 0,
    planMs: 0,
    layoutMs: 0,
    drawMs: 0,
    saveMs: 0,
    totalMs: 0,
  }
  const say = options.onMessage ?? (() => undefined)
  const sheet = await prepareActiveSheet(grid, say, options.documentName)
  timings.loadMs = sheet.loadMs
  const planStarted = performance.now()
  const { worksheet: printWorksheet, setup, fileName, pictures } = sheet
  const plan = planSheetPages({ worksheet: printWorksheet, setup, breaks: sheet.breaks })
  timings.planMs = performance.now() - planStarted

  const faces = options.faces ?? (await loadBundledFaces())
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(pdfLibFontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0])
  pdf.setTitle(`${fileName} - ${sheet.sheetName}`)
  const sink = createSink(pdf, faces)
  const frame = new PrintFrame(faces)
  let peakHeapMb: number | null = null
  const sampleHeap = () => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    if (!memory) return
    const mb = memory.usedJSHeapSize / 1048576
    peakHeapMb = Math.max(peakHeapMb ?? 0, Math.round(mb))
  }
  try {
    const context = {
      worksheet: printWorksheet,
      setup,
      fileName,
      sheetName: sheet.sheetName,
      pictures,
      now: new Date(),
      plan,
    }
    const batches = pageBatches(context, options.batchPages ?? DEFAULT_BATCH_PAGES)
    let done = 0
    for (;;) {
      const layoutStarted = performance.now()
      const next = batches.next()
      timings.layoutMs += performance.now() - layoutStarted
      if (next.done) break
      const drawStarted = performance.now()
      const pages = await frame.load(next.value.html)
      for (const pageElement of pages) {
        await drawPrintPage(frame, pageElement, plan.paper, sink)
      }
      frame.clear()
      timings.drawMs += performance.now() - drawStarted
      done += next.value.records.length
      sampleHeap()
      options.onProgress?.({ done, total: plan.pages.length })
      // Let the screen and the collector breathe between batches.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    frame.dispose()
  }
  const saveStarted = performance.now()
  const bytes = await pdf.save()
  timings.saveMs = performance.now() - saveStarted
  sampleHeap()
  timings.totalMs = performance.now() - started
  return {
    bytes,
    fileName: `${fileName}.pdf`,
    sheetName: sheet.sheetName,
    pageCount: plan.pages.length,
    scale: plan.scale,
    stats: sink.stats,
    skippedVisuals: sheet.visualCount + sink.stats.skippedVisuals,
    timings,
    peakHeapMb,
  }
}

async function loadBundledFaces(): Promise<LoadedFace[]> {
  const specs = await defaultFaceSpecs()
  return Promise.all(
    specs.map(async (spec) => {
      const response = await fetch(spec.url)
      if (!response.ok) throw new Error(`Font ${spec.id} unavailable (${response.status}).`)
      return loadFace(spec, new Uint8Array(await response.arrayBuffer()))
    }),
  )
}

function createSink(pdf: PDFDocument, faces: readonly LoadedFace[]): PdfSink {
  const fonts = new Map<LoadedFace, Promise<PDFFont>>()
  const images = new Map<string, Promise<PDFImage | null>>()
  return {
    pdf,
    resolver: new FaceResolver(faces),
    stats: {
      pages: 0,
      cells: 0,
      textRuns: 0,
      missingGlyphs: 0,
      pictures: 0,
      skippedVisuals: 0,
    },
    font(face) {
      let font = fonts.get(face)
      if (!font) {
        font = pdf.embedFont(face.bytes, { subset: true })
        fonts.set(face, font)
      }
      return font
    },
    image(src) {
      let image = images.get(src)
      if (!image) {
        image = embedDataUrl(pdf, src)
        images.set(src, image)
      }
      return image
    },
  }
}

async function embedDataUrl(pdf: PDFDocument, src: string): Promise<PDFImage | null> {
  const match = /^data:(image\/(?:png|jpe?g));base64,(.*)$/i.exec(src)
  if (!match) return null
  const bytes = Uint8Array.from(atob(match[2] as string), (char) => char.charCodeAt(0))
  try {
    return /png$/i.test(match[1] as string) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  } catch {
    return null
  }
}

/**
 * The desktop's `loadHeaderFooterPictures` (page-layout-actions.ts) without
 * the metafile step: EMF/WMF pictures need the desktop's metafile renderer,
 * so on the phone such a slot prints nothing for now (PNG and JPEG print).
 */
async function loadHeaderFooterPictures(
  sessionId: string,
  slots: readonly HeaderFooterPictureSlot[],
): Promise<Map<string, HeaderFooterPictureImage>> {
  const pictures = new Map<string, HeaderFooterPictureImage>()
  await Promise.all(
    slots.map(async (slot) => {
      try {
        const media = await window.desktopApi.readWorkbookMedia({ sessionId, visualId: slot.id })
        if (!/^image\/(png|jpe?g)$/i.test(media.mediaType)) return
        pictures.set(slot.position, {
          dataUrl: `data:${media.mediaType};base64,${media.base64}`,
          widthPt: slot.widthPt,
          heightPt: slot.heightPt,
        })
      } catch (reason: unknown) {
        console.warn(`header/footer picture unavailable (${slot.position})`, reason)
      }
    }),
  )
  return pictures
}
