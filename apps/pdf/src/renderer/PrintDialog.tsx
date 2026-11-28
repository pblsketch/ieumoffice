import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  hasFaceOverlays,
  planSheets,
  validateOptions,
  type ImageExportOptions,
  type PageSize,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  LivePrintPreview,
  PrintJobFields,
  PrintLayoutPanel,
  buildOverlayBundle,
  printLayoutIssueText,
  printLayoutProblem,
  printLayoutText,
  takesNewPrintRoute,
  usePrintJob,
  usePrintLayoutOptions,
  type LivePreviewBatchResult,
  type OverlayBundle,
  type PrintLabelSpecStore,
  type PrintLayoutJob,
  type PrintLayoutPreviewRequest,
} from '@genoffice/ui'
import type { PrintJobOptions, PrinterInfo } from '../shared/ipc'
import type { TFunc } from './i18n/locale'
import { formatPageRanges } from './page-selection'
import { canPrintPicked, printTargets, type PrintRangeMode } from './print-route'

const CAPABILITIES = { showPaperAndFit: true } as const

export type PdfPreviewFacesRequest = (
  pages: number[] | undefined,
  options: PrintLayoutOptions,
  faceIndices: number[],
  longSidePx: number,
  overlays: OverlayBundle | undefined,
  signal: AbortSignal,
) => Promise<LivePreviewBatchResult>

export interface PrintDialogProps {
  lang: Lang
  t: TFunc
  /** visible pages */
  pageCount: number
  /** 1-based visible page the reader is on */
  currentPage: number
  /** 1-based visible pages picked in the thumbnails */
  pickedPages: readonly number[]
  includeAnnotations: boolean
  onIncludeAnnotationsChange: (include: boolean) => void
  /** optional document title for header/footer `title` slots */
  documentTitle?: string
  /** optional initial destination pre-selected when opened from the Quick Print menu */
  initialDestination?: string
  /** installed OS printers; when absent the list offers Default printer and System print dialog */
  listPrinters?: () => Promise<PrinterInfo[]>
  /** the job's page sizes for these pages (undefined: all), null when unknown */
  pageSizes: (pages: number[] | undefined) => PageSize[] | null
  /** Print pressed with a valid range; `pages` undefined is the whole document */
  onPrint: (
    pages: number[] | undefined,
    options: PrintLayoutOptions,
    job: PrintJobOptions,
    overlays?: OverlayBundle,
  ) => void
  onSavePdf?: (
    pages: number[] | undefined,
    options: PrintLayoutOptions,
    overlays?: OverlayBundle,
  ) => void
  onSaveImages?: (
    pages: number[] | undefined,
    options: PrintLayoutOptions,
    image: ImageExportOptions,
    overlays?: OverlayBundle,
  ) => void
  /** the document has permission restrictions: its arranged result is not
      saved as a PDF or images (that copy would carry none of them); printing still is */
  saveRestricted?: boolean
  /** on-demand live preview fetcher (enables left-side LivePrintPreview) */
  onPreviewFaces?: PdfPreviewFacesRequest
  /** releases cached live-preview session when the dialog unmounts */
  onClosePreview?: () => void
  onPreviewRequest?: (
    pages: number[] | undefined,
    ...request: Parameters<PrintLayoutPreviewRequest>
  ) => ReturnType<PrintLayoutPreviewRequest>
  onCancel: () => void
  /** an arranged print or save in progress, or its failure */
  job?: PrintLayoutJob
  labelSpecStore?: PrintLabelSpecStore
}

function plannedFaceSizes(
  pages: readonly PageSize[] | null,
  options: PrintLayoutOptions,
): PageSize[] {
  if (!pages || pages.length === 0) return []
  const checked = validateOptions(options, pages.length)
  if (!checked.ok) return []
  try {
    return planSheets(pages, checked.options).output.map((f) => ({
      widthPt: f.width,
      heightPt: f.height,
    }))
  } catch {
    return []
  }
}

/**
 * The PDF print dialog: live preview on the left, unified destination
 * (printer / Save as PDF / Save as images / System dialog), page range,
 * "include annotations", and the shared page layout panel on the right.
 * Mounted per open, so every open starts from defaults. A document with
 * permission restrictions disables both Save as PDF and Save as images with
 * an explanation line.
 */
export function PrintDialog(props: PrintDialogProps) {
  const {
    lang,
    t,
    pageCount,
    currentPage,
    pickedPages,
    pageSizes,
    job,
    listPrinters,
    documentTitle,
    initialDestination,
    onPreviewFaces,
    onClosePreview,
  } = props
  const [mode, setMode] = useState<PrintRangeMode>('all')
  const [customText, setCustomText] = useState(String(currentPage))
  const [invalid, setInvalid] = useState(false)
  const [options, setOptions] = usePrintLayoutOptions(true)
  const saveRestricted = props.saveRestricted === true

  const effectiveOptions = useMemo<PrintLayoutOptions>(
    () =>
      documentTitle && options.headerFooter.enabled
        ? { ...options, headerFooter: { ...options.headerFooter, documentTitle } }
        : options,
    [options, documentTitle],
  )
  const printJob = usePrintJob(effectiveOptions, listPrinters, {
    allowSaveDestinations: true,
    saveRestricted,
    initialDestination,
  })

  useEffect(() => () => onClosePreview?.(), [onClosePreview])

  const targets = printTargets({ mode, customText, pageCount, currentPage, pickedPages })
  const targetKey = targets.ok ? (targets.pages?.join(',') ?? 'all') : null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed per range, not per render
  const pages = useMemo(() => (targets.ok ? pageSizes(targets.pages) : null), [targetKey])
  const running = !!job?.progress
  const newRoute = takesNewPrintRoute(effectiveOptions)
  const problem = useMemo(
    () => printLayoutProblem(effectiveOptions, pages),
    [effectiveOptions, pages],
  )
  const faceSizes = useMemo(
    () => plannedFaceSizes(pages, effectiveOptions),
    [pages, effectiveOptions],
  )
  const blocked =
    running ||
    ((newRoute || printJob.isSave) && problem !== null) ||
    (printJob.isSave && saveRestricted) ||
    (printJob.isSaveImages && !props.onSaveImages)
  const pickable = canPrintPicked(pickedPages)

  const targetPages = targets.ok ? targets.pages : undefined
  const previewCacheKey = `${targetKey ?? 'invalid'}|ann:${props.includeAnnotations ? 1 : 0}|${JSON.stringify(effectiveOptions)}`
  const fetchFaces = useCallback(
    async (faceIndices: number[], longSidePx: number, signal: AbortSignal) => {
      if (!onPreviewFaces || !targets.ok) throw new Error('preview unavailable')
      const overlays = await buildOverlayBundle(effectiveOptions, faceSizes)
      signal.throwIfAborted()
      return onPreviewFaces(
        targetPages,
        effectiveOptions,
        faceIndices,
        longSidePx,
        overlays,
        signal,
      )
    },
    [onPreviewFaces, targets.ok, targetPages, effectiveOptions, faceSizes],
  )

  const dispatchConfirm = (
    activePages: number[] | undefined,
    overlays: OverlayBundle | undefined,
  ) => {
    if (printJob.isSavePdf) {
      if (overlays) props.onSavePdf?.(activePages, effectiveOptions, overlays)
      else props.onSavePdf?.(activePages, effectiveOptions)
      return
    }
    if (printJob.isSaveImages) {
      if (overlays) {
        props.onSaveImages?.(activePages, effectiveOptions, printJob.imageOptions, overlays)
      } else {
        props.onSaveImages?.(activePages, effectiveOptions, printJob.imageOptions)
      }
      return
    }
    if (overlays) props.onPrint(activePages, effectiveOptions, printJob.job, overlays)
    else props.onPrint(activePages, effectiveOptions, printJob.job)
  }

  const confirm = () => {
    if (blocked) return
    if (!targets.ok) {
      if (mode === 'custom') setInvalid(true)
      return
    }
    if (!hasFaceOverlays(effectiveOptions)) {
      dispatchConfirm(targets.pages, undefined)
      return
    }
    void buildOverlayBundle(effectiveOptions, faceSizes).then((overlays) =>
      dispatchConfirm(targets.pages, overlays),
    )
  }

  const rangeRow = (value: PrintRangeMode, label: string, disabled = false) => (
    <label className="pdf-modal-row">
      <input
        type="radio"
        name="print-range"
        data-print-range={value}
        checked={mode === value}
        disabled={disabled || running}
        onChange={() => setMode(value)}
      />
      <span>{label}</span>
    </label>
  )

  const showSplitPreview = !!onPreviewFaces
  const problemText = problem
    ? printLayoutIssueText(lang, problem, { pageCount: pages?.length })
    : null

  return (
    <div className="pdf-modal-mask" onClick={props.onCancel}>
      <div
        className={`pdf-modal pdf-print-dialog${showSplitPreview ? ' pdf-print-dialog-split' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-modal-title">{t('print')}</div>
        <div className={showSplitPreview ? 'gs-pl-dialog-split-body' : 'pdf-print-dialog-stack'}>
          {showSplitPreview && (
            <div className="gs-pl-dialog-preview-pane">
              <LivePrintPreview
                lang={lang}
                pages={pages}
                options={effectiveOptions}
                cacheKey={previewCacheKey}
                fetchFaces={targets.ok ? fetchFaces : undefined}
                problemText={problemText}
              />
            </div>
          )}
          <div
            className={showSplitPreview ? 'gs-pl-dialog-settings-pane' : 'pdf-print-dialog-stack'}
          >
            <PrintJobFields
              lang={lang}
              state={printJob}
              faceCount={faceSizes.length > 0 ? faceSizes.length : undefined}
              grayscale={effectiveOptions.grayscale}
              disabled={running}
            />
            {rangeRow('all', t('printRangeAll'))}
            {rangeRow('current', `${t('printRangeCurrent')} (${currentPage})`)}
            {rangeRow(
              'picked',
              pickable
                ? `${t('printRangePicked')} (${formatPageRanges(pickedPages).replace(/,/g, ', ')})`
                : t('printRangePicked'),
              !pickable,
            )}
            {rangeRow('custom', t('printRangeCustom'))}
            {mode === 'custom' && (
              <input
                className={`pdf-modal-input${invalid ? ' invalid' : ''}`}
                data-print="range-custom"
                value={customText}
                placeholder={t('printRangeHint')}
                autoFocus
                disabled={running}
                onChange={(e) => {
                  setCustomText(e.target.value)
                  setInvalid(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirm()
                  else if (e.key === 'Escape') props.onCancel()
                }}
              />
            )}
            <label className="pdf-modal-row">
              <input
                type="checkbox"
                checked={props.includeAnnotations}
                disabled={running}
                onChange={(e) => props.onIncludeAnnotationsChange(e.target.checked)}
              />
              <span>{t('printIncludeAnnots')}</span>
            </label>
            <PrintLayoutPanel
              lang={lang}
              value={effectiveOptions}
              onChange={setOptions}
              pages={pages}
              capabilities={CAPABILITIES}
              labelSpecStore={props.labelSpecStore}
              showSchematic={!showSplitPreview}
              job={job}
              disabled={running}
            />
          </div>
        </div>
        <div className="pdf-modal-actions">
          <button className="pdf-modal-btn" onClick={props.onCancel}>
            {t('cancel')}
          </button>
          <button
            className="pdf-modal-btn primary"
            data-print-confirm=""
            disabled={blocked}
            onClick={confirm}
          >
            {printJob.isSave ? printLayoutText(lang, 'save') : t('print')}
          </button>
        </div>
      </div>
    </div>
  )
}
