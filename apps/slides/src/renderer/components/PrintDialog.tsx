/**
 * Print dialog modeled on PowerPoint's print sheet: live page preview on the left
 * (exact slide HTML preview, switching to PDFium LivePrintPreview when layout,
 * grayscale, watermark, or header/footer changes the output faces), unified
 * destination (printer / Save as PDF / Save as images / System dialog), range /
 * layout / orientation / framing options, and the shared page layout panel.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildOverlayBundle,
  LivePrintPreview,
  normalizePanelOptions,
  printLayoutIssueText,
  printLayoutProblem,
  printLayoutText,
  PrintJobFields,
  PrintLayoutPanel,
  PrintLayoutSchematic,
  showsLayoutSchematic,
  showsLivePrintPreview,
  takesNewPrintRoute,
  usePrintJob,
  usePrintLayoutOptions,
  type LivePreviewBatchResult,
  type OverlayBundle,
  type PrintLabelSpecStore,
  type PrintLayoutCapabilities,
  type PrintLayoutProgress,
} from '@genoffice/ui'
import {
  hasFaceOverlays,
  planSheets,
  validateOptions,
  type ImageExportOptions,
  type PageSize,
  type PrintLayoutIssue,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import { useEscOverlay } from '../esc-overlay'
import type { RenderSlide } from '@genoffice/pptx-render'
import { useI18n } from '../i18n/locale'
import type { PrintSlidesOp } from '../../shared/ipc'
import {
  buildPrintDocumentHtml,
  currentRangeIndices,
  parsePrintRange,
  printJobPageSizes,
  printPageCount,
  type PrintLayout,
  type PrintOrientation,
} from '../../shared/print-html'
import { renderSlidesToPngBase64 } from '../export-render'

type RangeMode = 'all' | 'current' | 'selected' | 'custom'

/** A print or save on the shared print layout route, as the panel shows it. */
interface LayoutJob {
  progress: PrintLayoutProgress | null
  error: string | null
}

const IDLE_JOB: LayoutJob = { progress: null, error: null }

/** A shared-route answer that finished: printed, saved, or canceled in a system dialog. */
interface LayoutDone {
  ok: true
  canceled?: true
  path?: string
  paths?: string[]
}

/** A shared-route answer that did not finish. */
interface LayoutFailure {
  ok: false
  aborted?: true
  error?: string
  code?: PrintLayoutIssue['code']
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

export function PrintDialog({
  slides,
  images,
  current,
  selectedSlides = [],
  onClose,
  setStatus,
  initialDestination,
}: {
  /** The whole deck, hidden pages included (the hidden toggle filters at print time) */
  slides: RenderSlide[]
  images: Map<string, HTMLImageElement>
  /** Current page index, for the "current slide" range */
  current: number
  /** Slides chosen in the rail (ascending); two or more offer the "selected slides" range */
  selectedSlides?: number[]
  onClose: () => void
  setStatus: (s: string) => void
  /** Optional initial destination pre-selected when opened from the Quick Print menu */
  initialDestination?: string
}) {
  useEscOverlay(true)
  const { t, lang } = useI18n()
  const [pngs, setPngs] = useState<string[] | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [layout, setLayout] = useState<PrintLayout>('full')
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customRange, setCustomRange] = useState('')
  const [orientation, setOrientation] = useState<PrintOrientation>('portrait')
  const [frame, setFrame] = useState(false)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [printing, setPrinting] = useState(false)
  // Shared page layout options: fresh defaults on every open (the dialog mounts per open)
  const [layoutOptions, setLayoutOptions] = usePrintLayoutOptions(true)
  const [layoutJob, setLayoutJob] = useState<LayoutJob>(IDLE_JOB)
  const blobUrlsRef = useRef<string[]>([])
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const paneRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Focus the first field on mount; return focus to the opener on unmount
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const root = dialogRef.current
    if (root && !root.contains(document.activeElement)) {
      root.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    }
    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [])

  // One offscreen render of the whole deck on open (print quality, 2x); the same
  // bitmaps feed the preview (as blob URLs) and the print job (as base64).
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rendered = await renderSlidesToPngBase64(slides, images)
        const noteTexts = await Promise.all(slides.map((_s, i) => window.slidesApi.getNotes(i)))
        if (!alive) return
        blobUrlsRef.current = rendered.map((b64) =>
          URL.createObjectURL(
            new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }),
          ),
        )
        setNotes(noteTexts)
        setPngs(rendered)
      } catch (err) {
        if (alive) setStatus(t('appPrintFailed', { error: String(err) }))
      }
    })()
    return () => {
      alive = false
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url)
      blobUrlsRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /** Rail selection still inside the deck; the range is offered from two slides on */
  const railSelection = useMemo(
    () =>
      [...new Set(selectedSlides)]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < slides.length)
        .sort((a, b) => a - b),
    [selectedSlides, slides.length],
  )
  const canPrintSelection = railSelection.length >= 2

  /** 0-based deck indices selected by the range options (before the hidden filter) */
  const rangeIndices = useMemo<number[] | null>(() => {
    if (rangeMode === 'all') return slides.map((_s, i) => i)
    if (rangeMode === 'current') return currentRangeIndices(current, slides.length)
    if (rangeMode === 'selected') return railSelection
    return parsePrintRange(customRange, slides.length)
  }, [rangeMode, customRange, slides, current, railSelection])

  const selected = useMemo(
    () => (rangeIndices ?? []).filter((i) => includeHidden || !slides[i].hidden),
    [rangeIndices, includeHidden, slides],
  )
  const rangeInvalid = rangeMode === 'custom' && rangeIndices === null
  const pageCount = printPageCount(selected.length, layout)

  // Handouts and notes pages already place slides on the page: layout modes
  // only apply to full-page slides (spec 4.5); sides, order, gray and dpi do.
  const blockedReason = layout === 'full' ? undefined : t('appPrintLayoutBlocked')
  const capabilities = useMemo<PrintLayoutCapabilities>(
    () =>
      blockedReason
        ? { showPaperAndFit: true, layoutBlockedReason: blockedReason }
        : { showPaperAndFit: true },
    [blockedReason],
  )
  /** The options as they print: the panel's, kept within this layout's capabilities */
  const effectiveOptions = useMemo(
    () => normalizePanelOptions(layoutOptions, capabilities),
    [layoutOptions, capabilities],
  )
  const newRoute = takesNewPrintRoute(effectiveOptions)
  const ratio = selected.length > 0 ? slides[selected[0]].widthPx / slides[selected[0]].heightPx : 0
  /** The print document's pages (its @page box), for the layout diagram and its checks */
  const jobPages = useMemo(
    () =>
      selected.length > 0
        ? printJobPageSizes(
            selected.length,
            ratio,
            layout,
            layout !== 'full' ? orientation : undefined,
          )
        : null,
    [selected.length, ratio, layout, orientation],
  )
  const faceSizes = useMemo(
    () => plannedFaceSizes(jobPages, effectiveOptions),
    [jobPages, effectiveOptions],
  )
  const listPrinters = useCallback(
    () => window.slidesApi.printLayout.listPrinters?.() ?? Promise.resolve([]),
    [],
  )
  const printJob = usePrintJob(effectiveOptions, listPrinters, {
    allowSaveDestinations: true,
    initialDestination,
  })
  const layoutProblem = useMemo(
    () => (newRoute || printJob.isSave ? printLayoutProblem(effectiveOptions, jobPages) : null),
    [newRoute, printJob.isSave, effectiveOptions, jobPages],
  )
  const useLivePreview =
    !!window.slidesApi.printLayout.previewFaces && showsLivePrintPreview(effectiveOptions)
  const showSchematic = useLivePreview || showsLayoutSchematic(effectiveOptions)
  const layoutRunning = layoutJob.progress !== null

  const previewHtml = useMemo(() => {
    if (!pngs || selected.length === 0) return null
    const first = slides[selected[0]]
    return buildPrintDocumentHtml({
      srcs: selected.map((i) => blobUrlsRef.current[i]),
      ratio: first.widthPx / first.heightPx,
      layout,
      notes: selected.map((i) => notes[i] ?? ''),
      orientation,
      frame,
      preview: true,
    })
  }, [pngs, selected, slides, layout, notes, orientation, frame])

  /** Scale the preview document so one page fits the pane width (iframe body zoom) */
  const applyZoom = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    const pane = paneRef.current
    const page = doc?.querySelector('.page') as HTMLElement | null
    if (!doc || !pane || !page) return
    doc.body.style.zoom = ''
    const pageW = page.getBoundingClientRect().width
    if (pageW > 0) doc.body.style.zoom = String(Math.min((pane.clientWidth - 44) / pageW, 1))
  }, [])

  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const ro = new ResizeObserver(applyZoom)
    ro.observe(pane)
    return () => ro.disconnect()
  }, [applyZoom])

  /** The print op: what slides:print prints, and the job of the shared layout route */
  const printOp = useCallback((): PrintSlidesOp | null => {
    if (!pngs || selected.length === 0) return null
    const first = slides[selected[0]]
    return {
      pngsBase64: selected.map((i) => pngs[i]),
      widthPx: first.widthPx,
      heightPx: first.heightPx,
      layout,
      ...(layout === 'notes' ? { notes: selected.map((i) => notes[i] ?? '') } : {}),
      ...(layout !== 'full' ? { orientation } : {}),
      ...(frame && layout === 'full' ? { frame: true } : {}),
    }
  }, [pngs, selected, slides, layout, notes, orientation, frame])

  // A job still running when the dialog closes sends nothing
  const layoutRunningRef = useRef(false)
  layoutRunningRef.current = layoutRunning
  useEffect(
    () => () => {
      if (layoutRunningRef.current) void window.slidesApi.printLayout.cancel()
      void window.slidesApi.printLayout.closePreview?.()
    },
    [],
  )

  /** Why a shared-route job failed, in the user's language */
  const layoutFailureText = (r: LayoutFailure): string => {
    const error = r.error ?? ''
    return r.code
      ? printLayoutIssueText(lang, { code: r.code, message: error })
      : t('appPrintFailed', { error })
  }

  /** Runs a print or save on the shared route with progress; null when it did not finish */
  const runLayoutJob = async (
    run: () => Promise<LayoutDone | LayoutFailure>,
  ): Promise<LayoutDone | null> => {
    const api = window.slidesApi.printLayout
    setLayoutJob({ progress: { done: 0, total: 0 }, error: null })
    const off = api.onProgress((progress) =>
      setLayoutJob((j) => (j.progress ? { ...j, progress } : j)),
    )
    try {
      const r = await run()
      if (r.ok) {
        setLayoutJob(IDLE_JOB)
        return r
      }
      setLayoutJob(r.aborted ? IDLE_JOB : { progress: null, error: layoutFailureText(r) })
      return null
    } finally {
      off()
    }
  }

  const doSaveArrangedPdf = async (options: PrintLayoutOptions, overlays?: OverlayBundle) => {
    const op = printOp()
    if (!op || printing || layoutRunning) return
    const r = await runLayoutJob(() =>
      window.slidesApi.printLayout.savePdf({
        options: normalizePanelOptions(options, capabilities),
        editor: op,
        ...(overlays ? { overlays } : {}),
      }),
    )
    if (r?.path) setStatus(t('appExportPdfDone', { path: r.path }))
  }

  const doSaveArrangedImages = async (
    options: PrintLayoutOptions,
    image: ImageExportOptions,
    overlays?: OverlayBundle,
  ) => {
    const op = printOp()
    if (!op || printing || layoutRunning || !window.slidesApi.printLayout.saveImages) return
    const r = await runLayoutJob(() =>
      window.slidesApi.printLayout.saveImages!({
        options: normalizePanelOptions(options, capabilities),
        editor: op,
        image,
        ...(overlays ? { overlays } : {}),
      }),
    )
    if (r?.paths) setStatus(printLayoutText(lang, 'imagesSaved', { count: r.paths.length }))
  }

  const doPrint = async () => {
    const op = printOp()
    if (!op || printing || layoutRunning) return
    const overlays = hasFaceOverlays(effectiveOptions)
      ? await buildOverlayBundle(effectiveOptions, faceSizes)
      : undefined
    if (printJob.isSavePdf) {
      if (layoutProblem) return
      await doSaveArrangedPdf(effectiveOptions, overlays)
      return
    }
    if (printJob.isSaveImages) {
      if (layoutProblem) return
      await doSaveArrangedImages(effectiveOptions, printJob.imageOptions, overlays)
      return
    }
    if (newRoute || printJob.isSilent) {
      if (newRoute && layoutProblem) return
      const r = await runLayoutJob(() =>
        window.slidesApi.printLayout.print({
          options: effectiveOptions,
          editor: op,
          ...(overlays ? { overlays } : {}),
          job: printJob.job,
        }),
      )
      // canceled in the system dialog: keep the print dialog open
      if (r && !r.canceled) onClose()
      return
    }
    setPrinting(true)
    try {
      const r = await window.slidesApi.printSlides(op)
      if (r.ok) onClose()
      else if (r.error) setStatus(t('appPrintFailed', { error: r.error }))
      // ok=false without an error = canceled in the system dialog: keep the dialog open
    } finally {
      setPrinting(false)
    }
  }

  const editorKey = `${selected.join(',')}|${layout}|${orientation}|${frame ? 1 : 0}`
  const previewCacheKey = `${editorKey}|${JSON.stringify(effectiveOptions)}`
  const fetchFaces = useCallback(
    async (
      faceIndices: number[],
      longSidePx: number,
      signal: AbortSignal,
    ): Promise<LivePreviewBatchResult> => {
      const op = printOp()
      if (!op || !window.slidesApi.printLayout.previewFaces) {
        throw new Error('no slides to print')
      }
      const overlays = await buildOverlayBundle(effectiveOptions, faceSizes)
      signal.throwIfAborted()
      const optionsKey = `${JSON.stringify(effectiveOptions)}:${overlays ? overlays.stamps.length : 0}`
      const r = await window.slidesApi.printLayout.previewFaces({
        options: effectiveOptions,
        editor: op,
        editorKey,
        optionsKey,
        faceIndices,
        longSidePx,
        ...(overlays ? { overlays } : {}),
      })
      if (!r.ok) throw new Error('aborted' in r ? 'canceled' : r.error)
      return { totalFaces: r.totalFaces, faceSizes: r.faceSizes, faces: r.faces }
    },
    [printOp, effectiveOptions, faceSizes, editorKey],
  )

  const labelSpecStore = useMemo<PrintLabelSpecStore>(
    () => ({
      load: () => window.slidesApi.printLayout.getLabelSpec(),
      save: async (spec) => {
        const r = await window.slidesApi.printLayout.setLabelSpec(spec)
        if (!r.ok) throw new Error(r.error)
      },
    }),
    [],
  )

  const layouts: Array<[PrintLayout, string]> = [
    ['full', t('appPrintLayoutFull')],
    ['handout2', t('appPrintLayoutHandout2')],
    ['handout3', t('appPrintLayoutHandout3')],
    ['handout6', t('appPrintLayoutHandout6')],
    ['notes', t('appPrintLayoutNotes')],
  ]
  const problemText = layoutProblem
    ? printLayoutIssueText(lang, layoutProblem, { pageCount: jobPages?.length })
    : null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal print-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('appPrintTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t('appPrintTitle')}</h2>
        <div className="print-dialog-body">
          <div className="print-preview-pane" ref={paneRef}>
            {showSchematic ? (
              <div className="print-schematic-pane">
                {useLivePreview ? (
                  <LivePrintPreview
                    lang={lang}
                    pages={jobPages}
                    options={effectiveOptions}
                    cacheKey={previewCacheKey}
                    fetchFaces={pngs && selected.length > 0 ? fetchFaces : undefined}
                    problemText={problemText}
                  />
                ) : (
                  <PrintLayoutSchematic lang={lang} pages={jobPages} options={effectiveOptions} />
                )}
              </div>
            ) : previewHtml ? (
              <iframe
                ref={frameRef}
                title={t('appPrintTitle')}
                sandbox="allow-same-origin"
                srcDoc={previewHtml}
                onLoad={applyZoom}
              />
            ) : (
              <div className="print-preview-empty">
                {pngs ? t('appPrintNoPages') : t('appPrintRendering')}
              </div>
            )}
          </div>
          <div className="print-options">
            <PrintJobFields
              lang={lang}
              state={printJob}
              faceCount={faceSizes.length > 0 ? faceSizes.length : undefined}
              grayscale={effectiveOptions.grayscale}
              disabled={!pngs || selected.length === 0 || printing || layoutRunning}
            />
            <fieldset>
              <legend>{t('appPrintRange')}</legend>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-range="all"
                  checked={rangeMode === 'all'}
                  onChange={() => setRangeMode('all')}
                />
                {t('appPrintRangeAll')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-range="current"
                  checked={rangeMode === 'current'}
                  onChange={() => setRangeMode('current')}
                />
                {t('appPrintRangeCurrent')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-range="selected"
                  disabled={!canPrintSelection}
                  checked={rangeMode === 'selected'}
                  onChange={() => setRangeMode('selected')}
                />
                {t('appPrintRangeSelected')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-range="custom"
                  checked={rangeMode === 'custom'}
                  onChange={() => setRangeMode('custom')}
                />
                {t('appPrintRangeCustom')}
              </label>
              <input
                type="text"
                className={`print-range-input ${rangeInvalid ? 'invalid' : ''}`}
                placeholder={t('appPrintRangeHint')}
                value={customRange}
                disabled={rangeMode !== 'custom'}
                onFocus={() => setRangeMode('custom')}
                onChange={(e) => setCustomRange(e.target.value)}
              />
            </fieldset>
            <fieldset>
              <legend>{t('appPrintLayoutGroup')}</legend>
              {layouts.map(([k, label]) => (
                <label key={k} className="print-radio">
                  <input
                    type="radio"
                    name="print-layout"
                    data-layout={k}
                    checked={layout === k}
                    onChange={() => setLayout(k)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{t('appPrintOrientation')}</legend>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-orientation"
                  value="portrait"
                  disabled={layout === 'full'}
                  checked={orientation === 'portrait'}
                  onChange={() => setOrientation('portrait')}
                />
                {t('appPrintPortrait')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-orientation"
                  value="landscape"
                  disabled={layout === 'full'}
                  checked={orientation === 'landscape'}
                  onChange={() => setOrientation('landscape')}
                />
                {t('appPrintLandscape')}
              </label>
            </fieldset>
            <fieldset>
              <label className="print-radio">
                <input
                  type="checkbox"
                  name="print-frame"
                  disabled={layout !== 'full'}
                  checked={frame}
                  onChange={(e) => setFrame(e.target.checked)}
                />
                {t('appPrintFrame')}
              </label>
              <label className="print-radio">
                <input
                  type="checkbox"
                  checked={includeHidden}
                  onChange={(e) => setIncludeHidden(e.target.checked)}
                />
                {t('appPrintHidden')}
              </label>
            </fieldset>
            <PrintLayoutPanel
              lang={lang}
              value={layoutOptions}
              onChange={setLayoutOptions}
              pages={jobPages}
              capabilities={capabilities}
              labelSpecStore={labelSpecStore}
              showSchematic={false}
              job={{
                progress: layoutJob.progress,
                onCancel: () => void window.slidesApi.printLayout.cancel(),
                error: layoutJob.error,
              }}
              disabled={!pngs || selected.length === 0 || printing}
            />
            <div className="print-page-count">
              {selected.length > 0 ? t('appPrintPageCount', { n: pageCount }) : ''}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t('appSettingsCancel')}</button>
          <button
            className="primary"
            disabled={
              !pngs ||
              selected.length === 0 ||
              printing ||
              layoutRunning ||
              !!layoutProblem ||
              (printJob.isSaveImages && !window.slidesApi.printLayout.saveImages)
            }
            onClick={() => void doPrint()}
          >
            {printing || layoutRunning
              ? t('appPrintProgress')
              : printJob.isSave
                ? printLayoutText(lang, 'save')
                : t('appPrintTitle')}
          </button>
        </div>
      </div>
    </div>
  )
}
