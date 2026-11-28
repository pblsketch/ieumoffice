import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  SimplePrintDialog,
  printLayoutIssueText,
  printLayoutText,
  type OverlayBundle,
  type PrintJobSelection,
  type PrintLabelSpecStore,
  type PrintLayoutProgress,
  type SimplePrintDialogProps,
  type SimplePrintRange,
} from '@genoffice/ui'
import type {
  ImageExportOptions,
  PageSize,
  PrintLayoutErrorCode,
  PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import type { PrintPage, WhiteboardApi, WhiteboardPrintJob } from '../shared/ipc'
import { useI18n } from './i18n/locale'

type Failure = {
  kind: 'print' | 'save' | 'save-images'
  detail: string
  code?: PrintLayoutErrorCode | undefined
}

const GATHERING: PrintLayoutProgress = { done: 0, total: 0 }
const PX_TO_PT = 72 / 96

const scopeOf = (range: SimplePrintRange): 'all' | 'current' =>
  range.kind === 'current' ? 'current' : 'all'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface WhiteboardPrintDialogProps {
  api: Pick<WhiteboardApi, 'exporting'>
  title: string
  buildPages: (scope: 'all' | 'current') => PrintPage[]
  onClose: () => void
  onMessage: (text: string) => void
  /** optional initial destination pre-selected when opened from the Quick Print menu */
  initialDestination?: string
}

/**
 * The whiteboard's print dialog: live preview, unified destination (printer /
 * Save as PDF / Save as images / System dialog), all pages or current page,
 * and the shared page layout panel.
 */
export function WhiteboardPrintDialog(props: WhiteboardPrintDialogProps): ReactElement {
  const { api, title, buildPages, onClose, onMessage, initialDestination } = props
  const { lang, t } = useI18n()
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [progress, setProgress] = useState<PrintLayoutProgress | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  const { printLayout } = api.exporting

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (runningRef.current) void printLayout.cancel()
    }
  }, [printLayout])

  const pages = useMemo<PageSize[]>(
    () =>
      buildPages(scope).map((p) => ({
        widthPt: (p.pageWidth ?? p.width) * PX_TO_PT,
        heightPt: (p.pageHeight ?? p.height) * PX_TO_PT,
      })),
    [buildPages, scope],
  )

  const jobOf = useCallback(
    (range: SimplePrintRange): WhiteboardPrintJob => ({
      pages: buildPages(scopeOf(range)),
      title,
    }),
    [buildPages, title],
  )

  const onPlainPrint = (range: SimplePrintRange): void => {
    onClose()
    api.exporting
      .print(jobOf(range))
      .then((res) => {
        if (!res.ok && !res.canceled) {
          onMessage(t('printFailed', { error: res.error ?? 'unknown error' }))
        }
      })
      .catch((err: unknown) => onMessage(t('printFailed', { error: messageOf(err) })))
  }

  const runLayout = async (
    kind: 'print' | 'save' | 'save-images',
    range: SimplePrintRange,
    options: PrintLayoutOptions,
    opts?: {
      printJob?: PrintJobSelection
      image?: ImageExportOptions
      overlays?: OverlayBundle
    },
  ): Promise<void> => {
    if (runningRef.current) return
    runningRef.current = true
    setFailure(null)
    setProgress(GATHERING)
    const off = printLayout.onProgress((next) => {
      if (mountedRef.current) setProgress(next)
    })
    try {
      const base = {
        options,
        editor: jobOf(range),
        ...(opts?.overlays ? { overlays: opts.overlays } : {}),
      }
      const result =
        kind === 'print'
          ? await printLayout.print({ ...base, ...(opts?.printJob ? { job: opts.printJob } : {}) })
          : kind === 'save'
            ? await printLayout.savePdf(base)
            : await printLayout.saveImages!({ ...base, image: opts!.image! })
      if (!mountedRef.current) return
      if (!result.ok) {
        if (!('aborted' in result)) {
          setFailure({ kind, detail: result.error, code: result.code })
        }
        return
      }
      if (kind === 'print') {
        if (!('canceled' in result)) onClose()
      } else if (kind === 'save') {
        if ('path' in result) onClose()
      } else if ('paths' in result) {
        onClose()
        onMessage(printLayoutText(lang, 'imagesSaved', { count: result.paths.length }))
      }
    } catch (err) {
      if (mountedRef.current) setFailure({ kind, detail: messageOf(err) })
    } finally {
      off()
      runningRef.current = false
      if (mountedRef.current) setProgress(null)
    }
  }

  const onPreviewRequest: SimplePrintDialogProps['onPreviewRequest'] = async (
    range,
    options,
    { signal, onProgress },
  ) => {
    const editor = jobOf(range)
    signal.throwIfAborted()
    const off = printLayout.onProgress(onProgress)
    const stop = (): void => void printLayout.cancel()
    signal.addEventListener('abort', stop, { once: true })
    try {
      const result = await printLayout.preview({ options, editor })
      if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
      return result.faces.map((face) => face.png)
    } finally {
      off()
      signal.removeEventListener('abort', stop)
    }
  }

  const previewFaces = useCallback<NonNullable<SimplePrintDialogProps['onPreviewFaces']>>(
    async (range, options, faceIndices, longSidePx, overlays, signal) => {
      const editor = jobOf(range)
      signal.throwIfAborted()
      const editorKey = scopeOf(range)
      const optionsKey = `${JSON.stringify(options)}:${overlays ? overlays.stamps.length : 0}`
      const result = await printLayout.previewFaces!({
        options,
        editor,
        editorKey,
        optionsKey,
        faceIndices,
        longSidePx,
        ...(overlays ? { overlays } : {}),
      })
      if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
      return { totalFaces: result.totalFaces, faceSizes: result.faceSizes, faces: result.faces }
    },
    [jobOf, printLayout],
  )

  const closePreview = useCallback(() => {
    void printLayout.closePreview?.()
  }, [printLayout])

  const labelSpecStore = useMemo<PrintLabelSpecStore>(
    () => ({
      load: () => printLayout.getLabelSpec(),
      save: async (spec) => {
        const result = await printLayout.setLabelSpec(spec)
        if (!result.ok) throw new Error(result.error)
      },
    }),
    [printLayout],
  )

  const error = failure
    ? failure.code
      ? printLayoutIssueText(
          lang,
          { code: failure.code, message: failure.detail },
          { pageCount: pages.length },
        )
      : t(failure.kind === 'print' ? 'printFailed' : 'exportFailed', { error: failure.detail })
    : null

  return (
    <SimplePrintDialog
      lang={lang}
      rangeChoice="all-current"
      pages={pages}
      capabilities={{ showPaperAndFit: true }}
      documentTitle={title}
      initialDestination={initialDestination}
      listPrinters={printLayout.listPrinters}
      onRangeChange={(range) => setScope(scopeOf(range))}
      onPlainPrint={onPlainPrint}
      onPrint={(range, options, printJob, overlays) =>
        void runLayout('print', range, options, { printJob, overlays })
      }
      onSavePdf={(range, options, overlays) => void runLayout('save', range, options, { overlays })}
      onSaveImages={
        printLayout.saveImages
          ? (range, options, image, overlays) =>
              void runLayout('save-images', range, options, { image, overlays })
          : undefined
      }
      onCancel={() => {
        if (runningRef.current) void printLayout.cancel()
        onClose()
      }}
      labelSpecStore={labelSpecStore}
      onPreviewFaces={printLayout.previewFaces ? previewFaces : undefined}
      onClosePreview={printLayout.closePreview ? closePreview : undefined}
      onPreviewRequest={onPreviewRequest}
      job={{ progress, onCancel: () => void printLayout.cancel(), error }}
    />
  )
}
