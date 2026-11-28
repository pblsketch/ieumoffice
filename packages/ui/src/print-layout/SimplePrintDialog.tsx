import { useCallback, useEffect, useId, useMemo, useState, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  hasFaceOverlays,
  planSheets,
  validateOptions,
  type ImageExportOptions,
  type PageSize,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import { useModalKeys } from '../modal-keys'
import { printLayoutText } from '../strings-print-layout'
import {
  usePrintJob,
  usePrintLayoutOptions,
  type PrintJobSelection,
  type PrintLayoutPreviewRequest,
  type PrintPrinterInfo,
} from './hooks'
import { LivePrintPreview, type LivePreviewBatchResult } from './LivePrintPreview'
import {
  parsePrintRanges,
  printLayoutIssueText,
  printLayoutProblem,
  takesNewPrintRoute,
  type PrintLayoutCapabilities,
  type PrintPageRange,
} from './model'
import { buildOverlayBundle, type OverlayBundle } from './overlay-render'
import { PrintJobFields } from './PrintJobFields'
import { PrintLayoutPanel, type PrintLabelSpecStore, type PrintLayoutJob } from './PrintLayoutPanel'
import './print-layout.css'

/**
 * Which range choices the editor offers (spec 5): none (one page only),
 * all or a typed range (HTML), all or the current page (diagrams, whiteboard).
 */
export type SimplePrintRangeChoice = 'none' | 'all-custom' | 'all-current'

export type SimplePrintRange =
  { kind: 'all' } | { kind: 'current' } | { kind: 'custom'; text: string; ranges: PrintPageRange[] }

export type SimplePrintPreviewFacesRequest = (
  range: SimplePrintRange,
  options: PrintLayoutOptions,
  faceIndices: number[],
  longSidePx: number,
  overlays: OverlayBundle | undefined,
  signal: AbortSignal,
) => Promise<LivePreviewBatchResult>

export interface SimplePrintDialogProps {
  lang: Lang
  rangeChoice: SimplePrintRangeChoice
  /** the job's page sizes for the chosen range; null while the editor counts them */
  pages: readonly PageSize[] | null
  capabilities: PrintLayoutCapabilities
  /** optional document title for header/footer `title` slots */
  documentTitle?: string | undefined
  /** optional initial destination pre-selected when opened from the Quick Print menu */
  initialDestination?: string | undefined
  /** installed OS printers for the in-app destination selector */
  listPrinters?: (() => Promise<readonly PrintPrinterInfo[]>) | undefined
  /** told when the range changes so the editor can count the pages again */
  onRangeChange?: ((range: SimplePrintRange) => void) | undefined
  /** system dialog and nothing changed in the panel: print exactly as before */
  onPlainPrint: (range: SimplePrintRange) => void
  /** an option is on or an in-app printer is chosen: print down the new route */
  onPrint: (
    range: SimplePrintRange,
    options: PrintLayoutOptions,
    job?: PrintJobSelection,
    overlays?: OverlayBundle,
  ) => void
  onSavePdf: (
    range: SimplePrintRange,
    options: PrintLayoutOptions,
    overlays?: OverlayBundle,
  ) => void
  onSaveImages?: (
    range: SimplePrintRange,
    options: PrintLayoutOptions,
    image: ImageExportOptions,
    overlays?: OverlayBundle,
  ) => void
  onCancel: () => void
  labelSpecStore?: PrintLabelSpecStore | undefined
  /** on-demand live preview fetcher (enables left-side LivePrintPreview) */
  onPreviewFaces?: SimplePrintPreviewFacesRequest | undefined
  /** releases cached live-preview session when the dialog unmounts */
  onClosePreview?: (() => void) | undefined
  /** @deprecated transitional callback kept for backward compatibility */
  onPreviewRequest?: (
    range: SimplePrintRange,
    ...request: Parameters<PrintLayoutPreviewRequest>
  ) => ReturnType<PrintLayoutPreviewRequest>
  job?: PrintLayoutJob | undefined
}

type RangeKind = SimplePrintRange['kind']

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
 * Shared split-pane print dialog for editors without a custom print sheet
 * (HTML, mind map, diagram, whiteboard): live preview on the left, unified
 * destination (printer / Save as PDF / Save as images / System dialog), range,
 * and shared page layout panel on the right. Mount per open so options start
 * fresh from defaults.
 */
export function SimplePrintDialog(props: SimplePrintDialogProps): ReactElement {
  const {
    lang,
    rangeChoice,
    pages,
    capabilities,
    documentTitle,
    initialDestination,
    listPrinters,
    onRangeChange,
    onPlainPrint,
    onPrint,
    onSavePdf,
    onSaveImages,
    onCancel,
    labelSpecStore,
    onPreviewFaces,
    onClosePreview,
    job,
  } = props
  const id = useId()
  const [options, setOptions] = usePrintLayoutOptions(true)
  const effectiveOptions = useMemo<PrintLayoutOptions>(
    () =>
      documentTitle && options.headerFooter.enabled
        ? { ...options, headerFooter: { ...options.headerFooter, documentTitle } }
        : options,
    [options, documentTitle],
  )
  const printJob = usePrintJob(effectiveOptions, listPrinters, {
    allowSaveDestinations: true,
    initialDestination,
  })
  const [kind, setKind] = useState<RangeKind>('all')
  const [text, setText] = useState('')
  const [showInvalid, setShowInvalid] = useState(false)
  const modalKeys = useModalKeys(onCancel, { restoreFocus: true })

  useEffect(() => () => onClosePreview?.(), [onClosePreview])

  const kinds: RangeKind[] =
    rangeChoice === 'all-custom'
      ? ['all', 'custom']
      : rangeChoice === 'all-current'
        ? ['all', 'current']
        : []

  const rangeOf = (k: RangeKind, typed: string): SimplePrintRange | null => {
    if (k !== 'custom') return { kind: k }
    const ranges = parsePrintRanges(typed)
    return ranges ? { kind: 'custom', text: typed.trim(), ranges } : null
  }
  const range = rangeOf(kind, text)

  const changeRange = (k: RangeKind, typed: string) => {
    setKind(k)
    setText(typed)
    setShowInvalid(false)
    const next = rangeOf(k, typed)
    if (next) onRangeChange?.(next)
  }

  const newRoute = takesNewPrintRoute(effectiveOptions)
  const problem = useMemo(
    () => printLayoutProblem(effectiveOptions, pages),
    [effectiveOptions, pages],
  )
  const running = !!job?.progress
  const faceSizes = useMemo(
    () => plannedFaceSizes(pages, effectiveOptions),
    [pages, effectiveOptions],
  )

  const rangeKey = range
    ? range.kind === 'custom'
      ? `custom:${range.text}`
      : range.kind
    : 'invalid'
  const pagesKey = pages ? pages.map((p) => `${p.widthPt}x${p.heightPt}`).join(',') : 'loading'
  const previewCacheKey = `${rangeKey}|${pagesKey}|${JSON.stringify(effectiveOptions)}`

  const fetchFaces = useCallback(
    async (faceIndices: number[], longSidePx: number, signal: AbortSignal) => {
      if (!onPreviewFaces || !range) throw new Error('preview unavailable')
      const overlays = await buildOverlayBundle(effectiveOptions, faceSizes)
      signal.throwIfAborted()
      return onPreviewFaces(range, effectiveOptions, faceIndices, longSidePx, overlays, signal)
    },
    [onPreviewFaces, range, effectiveOptions, faceSizes],
  )

  const dispatchConfirm = (activeRange: SimplePrintRange, overlays: OverlayBundle | undefined) => {
    if (printJob.isSavePdf) {
      if (overlays) onSavePdf(activeRange, effectiveOptions, overlays)
      else onSavePdf(activeRange, effectiveOptions)
      return
    }
    if (printJob.isSaveImages) {
      if (overlays) onSaveImages?.(activeRange, effectiveOptions, printJob.imageOptions, overlays)
      else onSaveImages?.(activeRange, effectiveOptions, printJob.imageOptions)
      return
    }
    if (newRoute || printJob.isSilent) {
      if (overlays) onPrint(activeRange, effectiveOptions, printJob.job, overlays)
      else onPrint(activeRange, effectiveOptions, printJob.job)
    } else {
      onPlainPrint(activeRange)
    }
  }

  const confirm = () => {
    if (!range) {
      setShowInvalid(true)
      return
    }
    if (!hasFaceOverlays(effectiveOptions)) {
      dispatchConfirm(range, undefined)
      return
    }
    void buildOverlayBundle(effectiveOptions, faceSizes).then((overlays) =>
      dispatchConfirm(range, overlays),
    )
  }

  const t = (key: Parameters<typeof printLayoutText>[1]) => printLayoutText(lang, key)
  const showSplitPreview = !!onPreviewFaces
  const problemText = problem
    ? printLayoutIssueText(lang, problem, { pageCount: pages?.length })
    : null

  return (
    <div className="gs-pl-mask" ref={modalKeys.ref} onKeyDown={modalKeys.onKeyDown} tabIndex={-1}>
      <div
        className={`gs-pl-dialog${showSplitPreview ? ' gs-pl-dialog-split' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <div className="gs-pl-dialog-title" id={`${id}-title`}>
          {t('dialogTitle')}
        </div>
        <div className={showSplitPreview ? 'gs-pl-dialog-split-body' : 'gs-pl-dialog-body'}>
          {showSplitPreview && (
            <div className="gs-pl-dialog-preview-pane">
              <LivePrintPreview
                lang={lang}
                pages={pages}
                options={effectiveOptions}
                cacheKey={previewCacheKey}
                fetchFaces={range ? fetchFaces : undefined}
                problemText={problemText}
              />
            </div>
          )}
          <div className={showSplitPreview ? 'gs-pl-dialog-settings-pane' : 'gs-pl-dialog-body'}>
            <PrintJobFields
              lang={lang}
              state={printJob}
              faceCount={faceSizes.length > 0 ? faceSizes.length : undefined}
              grayscale={effectiveOptions.grayscale}
              disabled={running}
            />
            {kinds.length > 0 && (
              <fieldset className="gs-pl-group">
                <legend className="gs-pl-legend">{t('rangeLabel')}</legend>
                {kinds.map((k) => (
                  <label key={k} className="gs-pl-check">
                    <input
                      type="radio"
                      name={`${id}-range`}
                      data-pl="range"
                      value={k}
                      checked={kind === k}
                      disabled={running}
                      onChange={() => changeRange(k, text)}
                    />
                    <span>
                      {k === 'custom'
                        ? t('rangeCustom')
                        : k === 'current'
                          ? t('rangeCurrentPage')
                          : rangeChoice === 'all-current'
                            ? t('rangeAllPages')
                            : t('rangeAll')}
                    </span>
                  </label>
                ))}
                {kind === 'custom' && (
                  <input
                    type="text"
                    className="gs-pl-range-text"
                    data-pl="range-text"
                    value={text}
                    placeholder={t('rangeCustomHint')}
                    aria-label={t('rangeCustom')}
                    aria-invalid={showInvalid && !range ? 'true' : undefined}
                    disabled={running}
                    onChange={(e) => changeRange('custom', e.target.value)}
                  />
                )}
                {showInvalid && !range && (
                  <p className="gs-pl-issue" role="alert" data-pl="range-invalid">
                    {t('rangeInvalid')}
                  </p>
                )}
              </fieldset>
            )}
            <PrintLayoutPanel
              lang={lang}
              value={effectiveOptions}
              onChange={setOptions}
              pages={pages}
              capabilities={capabilities}
              labelSpecStore={labelSpecStore}
              showSchematic={!showSplitPreview}
              job={job}
              disabled={running}
            />
          </div>
        </div>
        <div className="gs-pl-dialog-actions">
          <span className="gs-pl-spacer" />
          <button type="button" className="gs-pl-btn" data-pl="cancel" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="gs-pl-btn primary"
            data-pl="print"
            disabled={
              running ||
              ((newRoute || printJob.isSave) && !!problem) ||
              (printJob.isSaveImages && !onSaveImages)
            }
            onClick={() => void confirm()}
          >
            {printJob.isSave ? t('save') : t('print')}
          </button>
        </div>
      </div>
    </div>
  )
}
