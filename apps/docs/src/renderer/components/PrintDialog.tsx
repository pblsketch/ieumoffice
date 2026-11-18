/**
 * Print dialog modeled on Word's print sheet (same pattern as the slides app):
 * live page preview on the left (a scaled clone of the pagination-preview page
 * that will actually print, or PDFium LivePrintPreview when layout/overlay/gray
 * options alter the output faces), unified destination (printer / Save as PDF /
 * Save as images / System dialog), range, and the shared page layout panel on
 * the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import {
  effectiveCollate,
  isCollateLocked,
  LivePrintPreview,
  PrintLayoutPanel,
  PrintLayoutSchematic,
  SAVE_IMAGES_DEST,
  SAVE_PDF_DEST,
  buildOverlayBundle,
  printLayoutIssueText,
  printLayoutProblem,
  printLayoutText,
  showsLivePrintPreview,
  takesNewPrintRoute,
  useDuplexCoupling,
  usePrintLayoutOptions,
  type LivePreviewBatchResult,
  type OverlayBundle,
  type PrintLabelSpecStore,
  type PrintLayoutProgress,
} from '@genoffice/ui'
import {
  createDefaultImageExportOptions,
  JPG_QUALITIES,
  hasFaceOverlays,
  planSheets,
  validateOptions,
  type ImageBundleMode,
  type ImageExportFormat,
  type ImageExportOptions,
  type JpgQuality,
  type PageSize,
  type PrintLayoutErrorCode,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import type { DocsPrintJobRequest, PrintDuplex, PrintPaper, PrinterInfo } from '../../shared/ipc'
import { useI18n } from '../i18n/locale'
import { blockIdAtSelection, initialPrintPageIndex, pageBlockIds } from '../print-page-of-selection'
import { parsePrintRange } from '../print-range'
import { previewPageSize, type PrintPageJob, type PrintSelectionJob } from '../print-job'
import { clearPrintZoom, setPrintZoom } from '../print-zoom'

type RangeMode = 'all' | 'current' | 'custom' | 'selection'

/// Printer option values that are not device names (Electron: '' = OS default).
const DEFAULT_PRINTER = ''
const SYSTEM_DIALOG = '\u0000system-dialog'
// macOS's print sheet already carries copies/duplex/paper, so it stays the
// default there; Windows 11's dialog buries them under "More settings".
const IS_MAC = navigator.platform.toLowerCase().includes('mac')
const DUPLEX_MODES: PrintDuplex[] = ['simplex', 'longEdge', 'shortEdge']
const CAPABILITIES = { showPaperAndFit: true }

const pvPages = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('.pagination-preview .pv-page'),
]

function paperOfPreview(): PrintPaper | undefined {
  const page = pvPages()[0]
  if (!page) return undefined
  const w = page.offsetWidth
  const h = page.offsetHeight
  if (!(w > 0) || !(h > 0)) return undefined
  return { widthTwips: Math.round(w * 15), heightTwips: Math.round(h * 15) }
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

type SelectionState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; parts: string[]; pages: PageSize[] }
  | { status: 'failed'; error: string }

export function PrintDialog({
  onClose,
  setStatus,
  buildPageJob,
  prepareSelection,
  docName,
  initialDestination,
  editor,
}: {
  onClose: () => void
  setStatus: (s: string) => void
  /** prints the chosen 0-based preview pages to the job PDF (new route only) */
  buildPageJob?: (pages: number[]) => Promise<PrintPageJob>
  /** set while the editor holds a non-empty selection: lays it out on its own pages */
  prepareSelection?: () => Promise<PrintSelectionJob>
  /** the document's file name, for the save dialog and header/footer title */
  docName?: string
  /** optional initial destination pre-selected when opened from the Quick Print menu */
  initialDestination?: string
  editor: Editor | null
}) {
  const { t, lang } = useI18n()
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(0)
  /** The initial preview page is resolved once the sheets exist; later navigation wins. */
  const initialPageRef = useRef(false)
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [customRange, setCustomRange] = useState('')
  const [printing, setPrinting] = useState(false)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [deviceName, setDeviceName] = useState(
    () => initialDestination ?? (IS_MAC ? SYSTEM_DIALOG : DEFAULT_PRINTER),
  )
  const [copies, setCopies] = useState(1)
  const [collate, setCollate] = useState(true)
  const [imageOptions, setImageOptions] = useState<ImageExportOptions>(() =>
    createDefaultImageExportOptions(),
  )
  // the dialog mounts per print, so the options start from the defaults each time
  const [options, setOptions] = usePrintLayoutOptions(true)
  const cleanTitle = docName?.replace(/\.[^./\\]+$/, '')
  const effectiveOptions = useMemo<PrintLayoutOptions>(
    () =>
      cleanTitle && options.headerFooter.enabled
        ? { ...options, headerFooter: { ...options.headerFooter, documentTitle: cleanTitle } }
        : options,
    [options, cleanTitle],
  )
  const { duplex, setDuplex } = useDuplexCoupling(effectiveOptions, 'simplex')
  const [selection, setSelection] = useState<SelectionState>({ status: 'idle' })
  const [jobProgress, setJobProgress] = useState<PrintLayoutProgress | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const systemDialog = deviceName === SYSTEM_DIALOG
  const isSavePdf = deviceName === SAVE_PDF_DEST
  const isSaveImages = deviceName === SAVE_IMAGES_DEST
  const isSave = isSavePdf || isSaveImages
  const paneRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** the job PDF of the last page set printed, so preview, print and save share one build */
  const pageJobCache = useRef<{ key: string; parts: string[] } | null>(null)
  /** bumps on cancel: a job finishing after it is dropped */
  const jobToken = useRef(0)

  // The pagination preview measures and slices asynchronously; poll until the
  // .pv-page count is stable (and keep tracking it, e.g. re-slices on resize).
  // Once the sheets exist, open the preview on the page holding the caret.
  useEffect(() => {
    let last = -1
    const timer = window.setInterval(() => {
      const sheets = pvPages()
      const n = sheets.length
      if (n > 0 && n === last) {
        setPageCount(n)
        if (!initialPageRef.current) {
          initialPageRef.current = true
          // Functional update: navigation the reader already did wins.
          const initialPage = initialPrintPageIndex(
            pageBlockIds(sheets),
            blockIdAtSelection(editor),
          )
          setPage((shown) => (shown === 0 ? initialPage : shown))
        }
      }
      last = n
    }, 250)
    return () => window.clearInterval(timer)
  }, [editor])

  useEffect(() => {
    let alive = true
    window.desktop
      .listPrinters()
      .then((list) => {
        if (alive) setPrinters(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
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

  // progress of a print or save on the arranged route (pictures of the faces);
  // a result preview reports its own
  const jobActive = useRef(false)
  useEffect(
    () =>
      window.desktop.printLayout?.onProgress((p) => {
        if (jobActive.current) setJobProgress(p)
      }),
    [],
  )

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      void window.desktop.printLayout?.closePreview?.()
    }
  }, [])

  // the selection is laid out once per dialog, the first time it is chosen
  const prepareRef = useRef(prepareSelection)
  prepareRef.current = prepareSelection
  const prepareStarted = useRef(false)
  useEffect(() => {
    if (rangeMode !== 'selection' || prepareStarted.current) return
    const prepare = prepareRef.current
    if (!prepare) return
    prepareStarted.current = true
    setSelection({ status: 'running' })
    void prepare()
      .catch((err: unknown) => ({ ok: false as const, error: String(err) }))
      .then((r) => {
        if (!alive.current) return
        setSelection(
          r.ok
            ? { status: 'done', parts: r.parts, pages: r.pages }
            : { status: 'failed', error: r.error ?? '' },
        )
      })
  }, [rangeMode])

  const current = Math.min(page, Math.max(0, pageCount - 1))
  const ready = pageCount > 0
  const selectionMode = rangeMode === 'selection'

  /** 0-based page indices selected by the range options (null = invalid custom range) */
  const selected = useMemo<number[] | null>(
    () =>
      rangeMode === 'all'
        ? Array.from({ length: pageCount }, (_x, i) => i)
        : rangeMode === 'current'
          ? [current]
          : rangeMode === 'custom'
            ? parsePrintRange(customRange, pageCount)
            : null,
    [rangeMode, pageCount, current, customRange],
  )
  const rangeInvalid = rangeMode === 'custom' && selected === null
  const selectedKey = selected ? selected.join(',') : ''
  /** the job PDF depends on the chosen sheets and on how the preview sliced them */
  const pageJobKey = `${pageCount}:${selectedKey}`

  /** the print job's pages in points: the chosen preview sheets, or the laid-out selection */
  const jobPages: PageSize[] | null = useMemo(() => {
    if (selectionMode) return selection.status === 'done' ? selection.pages : null
    // the key names the sheet count too: the sheets re-slice when the preview changes
    const [, chosen] = pageJobKey.split(':')
    if (!chosen) return null
    const sheets = pvPages()
    return chosen.split(',').map((i) => {
      const el = sheets[Number(i)]
      return previewPageSize(
        parseFloat(el?.style.width ?? '') || 0,
        parseFloat(el?.style.height ?? '') || 0,
      )
    })
  }, [selectionMode, selection, pageJobKey])

  const newRoute = selectionMode || takesNewPrintRoute(effectiveOptions)
  const collateLocked = selectionMode || isCollateLocked(effectiveOptions)
  const collateValue = selectionMode ? true : effectiveCollate(effectiveOptions, collate)
  const layoutProblem = newRoute || isSave ? printLayoutProblem(effectiveOptions, jobPages) : null
  const showArrangedPreview = selectionMode || showsLivePrintPreview(effectiveOptions)
  const faceSizes = useMemo(
    () => plannedFaceSizes(jobPages, effectiveOptions),
    [jobPages, effectiveOptions],
  )
  const jobPageCount = selectionMode ? (jobPages?.length ?? 0) : (selected?.length ?? 0)
  const canPrint =
    ready &&
    !printing &&
    (selectionMode ? selection.status === 'done' : !!selected && selected.length > 0) &&
    layoutProblem === null &&
    (!isSaveImages || !!window.desktop.printLayout?.saveImages)

  /** Scale the cloned page so the whole sheet fits the preview pane (Word-style single-page fit) */
  const applyZoom = useCallback(() => {
    const pane = paneRef.current
    const host = hostRef.current
    const pageEl = host?.firstElementChild as HTMLElement | null
    if (!pane || !host || !pageEl) return
    host.style.zoom = '1'
    const w = pageEl.offsetWidth
    const h = pageEl.offsetHeight
    if (w > 0 && h > 0) {
      host.style.zoom = String(Math.min((pane.clientWidth - 36) / w, (pane.clientHeight - 36) / h))
    }
  }, [])

  // Show one printed sheet at a time: clone the selected .pv-page (styles apply
  // in-document, so the clone renders identically) and fit it to the pane.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.replaceChildren()
    const src = pvPages()[current]
    if (!src) return
    const clone = src.cloneNode(true) as HTMLElement
    clone.classList.remove('pv-print-skip')
    clone.querySelector('.pv-pageno')?.remove()
    host.appendChild(clone)
    applyZoom()
  }, [pageCount, current, applyZoom, showArrangedPreview])

  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const ro = new ResizeObserver(applyZoom)
    ro.observe(pane)
    return () => ro.disconnect()
  }, [applyZoom, ready, showArrangedPreview])

  const doPrint = async () => {
    const els = pvPages()
    if (!selected || selected.length === 0 || printing) return
    const sel = new Set(selected)
    setPrinting(true)
    els.forEach((el, i) => el.classList.toggle('pv-print-skip', !sel.has(i)))
    const scale = setPrintZoom('printer')
    try {
      const r = await window.desktop.print(
        scale,
        systemDialog ? { deviceName: null } : { deviceName, copies, collate, duplex },
        paperOfPreview(),
      )
      if (r.ok) {
        onClose()
        return
      }
      if (r.error) setStatus(t('appPrintFailed', { error: r.error }))
    } finally {
      clearPrintZoom()
      els.forEach((el) => el.classList.remove('pv-print-skip'))
      setPrinting(false)
    }
  }

  /** The new route's request for this job, or null with the reason shown. */
  const jobRequest = useCallback(async (): Promise<DocsPrintJobRequest | null> => {
    if (selectionMode) {
      return selection.status === 'done' ? { parts: selection.parts, name: docName } : null
    }
    if (!selected || selected.length === 0 || !buildPageJob) return null
    const cached = pageJobCache.current
    if (cached && cached.key === pageJobKey) return { parts: cached.parts, name: docName }
    const built = await buildPageJob(selected).catch((err: unknown) => ({
      ok: false as const,
      error: String(err),
    }))
    if (!built.ok) {
      setJobError(t('appPrintFailed', { error: built.error ?? t('appPrintGroupFailed') }))
      return null
    }
    pageJobCache.current = { key: pageJobKey, parts: built.parts }
    return { parts: built.parts, name: docName }
  }, [selectionMode, selection, docName, selected, buildPageJob, pageJobKey, t])

  const failureText = (r: { error?: string; code?: PrintLayoutErrorCode }): string =>
    r.code
      ? printLayoutIssueText(lang, { code: r.code, message: r.error ?? '' })
      : t('appPrintFailed', { error: r.error ?? '' })

  /** Runs one print or save on the new route with progress, cancel and errors. */
  const runJob = async (
    work: (
      editor: DocsPrintJobRequest,
    ) => Promise<
      | { ok: true; canceled?: true; path?: string; paths?: string[] }
      | { ok: false; aborted?: true; error?: string; code?: PrintLayoutErrorCode }
    >,
    onDone: (r: { canceled?: true; path?: string; paths?: string[] }) => void,
  ) => {
    if (printing) return
    const token = ++jobToken.current
    jobActive.current = true
    setPrinting(true)
    setJobError(null)
    setJobProgress({ done: 0, total: Math.max(1, jobPageCount) })
    try {
      const editor = await jobRequest()
      if (!editor || token !== jobToken.current) return
      const r = await work(editor)
      if (token !== jobToken.current) return
      if (r.ok) onDone(r)
      else if (!('aborted' in r && r.aborted)) {
        const text = failureText(r)
        setJobError(text)
        setStatus(text)
      }
    } finally {
      if (token === jobToken.current && alive.current) {
        jobActive.current = false
        setJobProgress(null)
        setPrinting(false)
      }
    }
  }

  const cancelJob = () => {
    jobToken.current += 1
    jobActive.current = false
    void window.desktop.printLayout.cancel()
    setJobProgress(null)
    setPrinting(false)
  }

  const printArranged = (overlays?: OverlayBundle) =>
    runJob(
      (editor) =>
        window.desktop.printLayout.print({
          options: effectiveOptions,
          editor,
          ...(overlays ? { overlays } : {}),
          job: systemDialog ? { deviceName: null } : { deviceName, copies, collate: true, duplex },
        }),
      (r) => {
        if (!r.canceled) onClose()
      },
    )

  const saveArranged = (opts: PrintLayoutOptions, overlays?: OverlayBundle) =>
    runJob(
      (editor) =>
        window.desktop.printLayout.savePdf({
          options: opts,
          editor,
          ...(overlays ? { overlays } : {}),
        }),
      (r) => {
        if (r.path) setStatus(t('appExportedPdf', { path: r.path }))
      },
    )

  const saveArrangedImages = (
    opts: PrintLayoutOptions,
    image: ImageExportOptions,
    overlays?: OverlayBundle,
  ) =>
    runJob(
      (editor) =>
        window.desktop.printLayout.saveImages!({
          options: opts,
          editor,
          image,
          ...(overlays ? { overlays } : {}),
        }),
      (r) => {
        if (r.paths) setStatus(printLayoutText(lang, 'imagesSaved', { count: r.paths.length }))
      },
    )

  const fetchPreviewFaces = useCallback(
    async (
      faceIndices: number[],
      longSidePx: number,
      signal: AbortSignal,
    ): Promise<LivePreviewBatchResult> => {
      const editor = await jobRequest()
      if (!editor) throw new Error('no print job')
      signal.throwIfAborted()
      const overlays = await buildOverlayBundle(effectiveOptions, faceSizes)
      signal.throwIfAborted()
      const editorKey = selectionMode ? 'selection' : pageJobKey
      const optionsKey = `${JSON.stringify(effectiveOptions)}:${overlays ? overlays.stamps.length : 0}`
      const r = await window.desktop.printLayout.previewFaces!({
        options: effectiveOptions,
        editor,
        editorKey,
        optionsKey,
        faceIndices,
        longSidePx,
        ...(overlays ? { overlays } : {}),
      })
      if (!r.ok) throw new Error('aborted' in r ? 'canceled' : r.error)
      return { totalFaces: r.totalFaces, faceSizes: r.faceSizes, faces: r.faces }
    },
    [jobRequest, effectiveOptions, faceSizes, selectionMode, pageJobKey],
  )

  const labelSpecStore: PrintLabelSpecStore = useMemo(
    () => ({
      load: () => window.desktop.printLayout.getLabelSpec(),
      save: async (spec) => {
        await window.desktop.printLayout.setLabelSpec(spec)
      },
    }),
    [],
  )

  const onPrintClick = () => {
    const dispatch = (overlays?: OverlayBundle) => {
      if (isSavePdf) void saveArranged(effectiveOptions, overlays)
      else if (isSaveImages) void saveArrangedImages(effectiveOptions, imageOptions, overlays)
      else if (newRoute) void printArranged(overlays)
      else void doPrint()
    }
    if (!hasFaceOverlays(effectiveOptions)) {
      dispatch(undefined)
      return
    }
    void buildOverlayBundle(effectiveOptions, faceSizes).then((overlays) => dispatch(overlays))
  }

  const pageCountText = selectionMode
    ? jobPages && jobPages.length > 0
      ? t('appPrintPageCount', { n: jobPages.length })
      : ''
    : ready && selected && selected.length > 0
      ? t('appPrintPageCount', { n: selected.length })
      : ''

  const previewCacheKey = `${selectionMode ? 'sel' : pageJobKey}|${JSON.stringify(effectiveOptions)}`
  const layoutProblemText = layoutProblem
    ? printLayoutIssueText(lang, layoutProblem, { pageCount: jobPages?.length })
    : null

  const previewPane = () => {
    if (selectionMode && selection.status !== 'done') {
      return (
        <div className="print-preview-empty" data-print="selection-state">
          {selection.status === 'failed'
            ? t('appPrintSelectionFailed', { error: selection.error })
            : t('appPrintSelectionPreparing')}
        </div>
      )
    }
    if (showArrangedPreview) {
      if (window.desktop.printLayout?.previewFaces) {
        return (
          <div className="print-preview-schematic">
            <LivePrintPreview
              lang={lang}
              pages={jobPages}
              options={effectiveOptions}
              cacheKey={previewCacheKey}
              fetchFaces={fetchPreviewFaces}
              problemText={layoutProblemText}
            />
          </div>
        )
      }
      return (
        <div className="print-preview-schematic">
          <PrintLayoutSchematic lang={lang} pages={jobPages} options={effectiveOptions} />
        </div>
      )
    }
    if (!ready) return <div className="print-preview-empty">{t('appPrintRendering')}</div>
    return (
      <>
        <div className="print-preview-page" ref={paneRef}>
          <div className="print-preview-zoom" ref={hostRef} />
        </div>
        <div className="print-preview-nav">
          <button
            aria-label={t('appPrintPrevPage')}
            title={t('appPrintPrevPage')}
            disabled={current <= 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          <span>
            {current + 1} / {pageCount}
          </span>
          <button
            aria-label={t('appPrintNextPage')}
            title={t('appPrintNextPage')}
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal print-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t('appPrintTitle')}</h2>
        <div className="print-dialog-body">
          <div className="print-preview-pane">{previewPane()}</div>
          <div className="print-options">
            <fieldset>
              <legend>{t('appPrintPrinter')}</legend>
              <select
                className="print-select"
                data-print="printer"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              >
                <option value={DEFAULT_PRINTER}>{t('appPrintDefaultPrinter')}</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName}
                  </option>
                ))}
                <option value={SAVE_PDF_DEST}>{printLayoutText(lang, 'destSavePdf')}</option>
                <option value={SAVE_IMAGES_DEST}>{printLayoutText(lang, 'destSaveImages')}</option>
                <option value={SYSTEM_DIALOG}>{t('appPrintSystemDialog')}</option>
              </select>
              {!isSave && (
                <>
                  <label className="print-field">
                    <span>{t('appPrintCopies')}</span>
                    <input
                      type="number"
                      className="print-copies"
                      min={1}
                      max={999}
                      value={copies}
                      disabled={systemDialog}
                      onChange={(e) =>
                        setCopies(
                          Math.min(999, Math.max(1, Math.round(Number(e.target.value)) || 1)),
                        )
                      }
                    />
                  </label>
                  <label className="print-radio">
                    <input
                      type="checkbox"
                      data-print="collate"
                      checked={collateValue}
                      disabled={systemDialog || copies < 2 || collateLocked}
                      onChange={(e) => setCollate(e.target.checked)}
                    />
                    {t('appPrintCollate')}
                  </label>
                  <label className="print-field">
                    <span>{t('appPrintDuplex')}</span>
                    <select
                      className="print-select"
                      data-print="duplex"
                      value={duplex}
                      disabled={systemDialog}
                      onChange={(e) => setDuplex(e.target.value as PrintDuplex)}
                    >
                      {DUPLEX_MODES.map((m) => (
                        <option key={m} value={m}>
                          {t(
                            m === 'simplex'
                              ? 'appPrintDuplexOff'
                              : m === 'longEdge'
                                ? 'appPrintDuplexLong'
                                : 'appPrintDuplexShort',
                          )}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {isSavePdf && effectiveOptions.grayscale && (
                <p className="gs-pl-note">{printLayoutText(lang, 'savePdfGrayNote')}</p>
              )}
              {isSaveImages && (
                <>
                  <label className="print-field">
                    <span>{printLayoutText(lang, 'imageFormat')}</span>
                    <select
                      className="print-select"
                      data-print="image-format"
                      value={imageOptions.format}
                      disabled={printing}
                      onChange={(e) =>
                        setImageOptions((cur) => ({
                          ...cur,
                          format: e.target.value as ImageExportFormat,
                        }))
                      }
                    >
                      <option value="png">PNG</option>
                      <option value="jpg">JPG</option>
                    </select>
                  </label>
                  {imageOptions.format === 'jpg' && (
                    <label className="print-field">
                      <span>{printLayoutText(lang, 'imageQuality')}</span>
                      <select
                        className="print-select"
                        data-print="image-quality"
                        value={String(imageOptions.quality)}
                        disabled={printing}
                        onChange={(e) =>
                          setImageOptions((cur) => ({
                            ...cur,
                            quality: Number(e.target.value) as JpgQuality,
                          }))
                        }
                      >
                        {JPG_QUALITIES.map((q) => (
                          <option key={q} value={String(q)}>
                            {printLayoutText(
                              lang,
                              q === 90
                                ? 'imageQualityHigh'
                                : q === 80
                                  ? 'imageQualityMedium'
                                  : 'imageQualitySmall',
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {faceSizes.length >= 2 && (
                    <label className="print-field">
                      <span>{printLayoutText(lang, 'imageBundle')}</span>
                      <select
                        className="print-select"
                        data-print="image-bundle"
                        value={imageOptions.bundle}
                        disabled={printing}
                        onChange={(e) =>
                          setImageOptions((cur) => ({
                            ...cur,
                            bundle: e.target.value as ImageBundleMode,
                          }))
                        }
                      >
                        <option value="files">{printLayoutText(lang, 'imageBundleFiles')}</option>
                        <option value="zip">{printLayoutText(lang, 'imageBundleZip')}</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            </fieldset>
            <fieldset>
              <legend>{t('appPrintRange')}</legend>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-all"
                  checked={rangeMode === 'all'}
                  onChange={() => setRangeMode('all')}
                />
                {t('appPrintRangeAll')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-current"
                  checked={rangeMode === 'current'}
                  onChange={() => setRangeMode('current')}
                />
                {t('appPrintRangeCurrent')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-selection"
                  checked={selectionMode}
                  disabled={!prepareSelection}
                  onChange={() => setRangeMode('selection')}
                />
                {t('appPrintRangeSelection')}
              </label>
              <label className="print-radio">
                <input
                  type="radio"
                  name="print-range"
                  data-print="range-custom"
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
            <div className="print-page-count">{pageCountText}</div>
            <PrintLayoutPanel
              lang={lang}
              value={effectiveOptions}
              onChange={setOptions}
              pages={jobPages}
              capabilities={CAPABILITIES}
              labelSpecStore={labelSpecStore}
              showSchematic={false}
              job={{ progress: jobProgress, onCancel: cancelJob, error: jobError }}
              disabled={printing}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t('appCancel')}</button>
          <button className="primary" disabled={!canPrint} onClick={onPrintClick}>
            {printing
              ? t('appPrintProgress')
              : isSave
                ? printLayoutText(lang, 'save')
                : t('appPrintTitle')}
          </button>
        </div>
      </div>
    </div>
  )
}
