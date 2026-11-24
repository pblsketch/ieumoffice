/**
 * The mind map's print dialog (decision 0141): the shared split-pane print
 * dialog with live preview, unified destination (printer / Save as PDF / Save
 * as images / System dialog), no range (Print prints one page), and the page
 * layout panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  paperSizePt,
  type ImageExportOptions,
  type PageSize,
  type PrintLayoutErrorCode,
  type PrintLayoutOptions,
} from '@genoffice/print-layout/plan'
import {
  SimplePrintDialog,
  printLayoutIssueText,
  type OverlayBundle,
  type PrintJobSelection,
  type PrintLabelSpecStore,
  type PrintLayoutProgress,
  type SimplePrintDialogProps,
} from '@genoffice/ui'
import { translateIn } from '../i18n/locale'
import type { MindmapExportApi, MindmapPrintJob } from '../../shared/ipc'

const A4 = paperSizePt('A4')

/** The print job is one landscape A4 page, known without making it. */
export const MAP_PRINT_PAGES: readonly PageSize[] = [{ widthPt: A4.heightPt, heightPt: A4.widthPt }]

type LayoutBridge = MindmapExportApi['printLayout']

interface Failure {
  kind: 'print' | 'save' | 'save-images'
  code?: PrintLayoutErrorCode
  detail: string
}

export interface MapPrintDialogProps {
  lang: Lang
  /** the page Print prints, and the name an arranged PDF is offered under */
  job: MindmapPrintJob
  printLayout: LayoutBridge
  /** nothing changed in the panel: the print as it was, with this page */
  onPlainPrint: (html: string) => void
  /** the arranged PDF or images were written */
  onSaved: () => void
  onClose: () => void
  /** optional initial destination pre-selected when opened from the Quick Print menu */
  initialDestination?: string
}

export function MapPrintDialog(props: MapPrintDialogProps): ReactElement {
  const { lang, job, printLayout, onPlainPrint, onSaved, onClose, initialDestination } = props
  const [progress, setProgress] = useState<PrintLayoutProgress | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const running = useRef(false)
  const mounted = useRef(true)

  // a job still running when the dialog goes away is stopped: nothing is sent
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (running.current) void printLayout.cancel()
    }
  }, [printLayout])

  const run = useCallback(
    async (
      kind: 'print' | 'save' | 'save-images',
      options: PrintLayoutOptions,
      opts?: {
        printJob?: PrintJobSelection
        image?: ImageExportOptions
        overlays?: OverlayBundle
      },
    ): Promise<void> => {
      if (running.current) return
      running.current = true
      setFailure(null)
      setProgress({ done: 0, total: 0 })
      const off = printLayout.onProgress((next) => {
        if (mounted.current) setProgress(next)
      })
      try {
        const base = {
          options,
          editor: job,
          ...(opts?.overlays ? { overlays: opts.overlays } : {}),
        }
        const result =
          kind === 'print'
            ? await printLayout.print({
                ...base,
                ...(opts?.printJob ? { job: opts.printJob } : {}),
              })
            : kind === 'save'
              ? await printLayout.savePdf(base)
              : await printLayout.saveImages!({ ...base, image: opts!.image! })
        if (!mounted.current) return
        if (!result.ok) {
          // a cancel is the user's own: nothing to tell
          if ('aborted' in result) return
          console.error('[mindmap] arranged print failed:', result.error)
          setFailure({ kind, detail: result.error, ...(result.code ? { code: result.code } : {}) })
        } else if (kind === 'print') {
          if (!('canceled' in result)) onClose()
        } else if ('path' in result || 'paths' in result) {
          onSaved()
          onClose()
        }
      } catch (error) {
        console.error('[mindmap] arranged print failed:', error)
        if (mounted.current) setFailure({ kind, detail: String(error) })
      } finally {
        off()
        running.current = false
        if (mounted.current) setProgress(null)
      }
    },
    [job, printLayout, onClose, onSaved],
  )

  const preview = useCallback<NonNullable<SimplePrintDialogProps['onPreviewRequest']>>(
    async (_range, options, { signal, onProgress }) => {
      signal.throwIfAborted()
      const off = printLayout.onProgress(onProgress)
      const stop = (): void => void printLayout.cancel()
      signal.addEventListener('abort', stop, { once: true })
      try {
        const result = await printLayout.preview({ options, editor: job })
        if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
        return result.faces.map((face) => face.png)
      } finally {
        off()
        signal.removeEventListener('abort', stop)
      }
    },
    [job, printLayout],
  )

  const previewFaces = useCallback<NonNullable<SimplePrintDialogProps['onPreviewFaces']>>(
    async (_range, options, faceIndices, longSidePx, overlays, signal) => {
      signal.throwIfAborted()
      const optionsKey = `${JSON.stringify(options)}:${overlays ? overlays.stamps.length : 0}`
      const result = await printLayout.previewFaces!({
        options,
        editor: job,
        editorKey: 'map',
        optionsKey,
        faceIndices,
        longSidePx,
        ...(overlays ? { overlays } : {}),
      })
      if (!result.ok) throw new Error('aborted' in result ? 'canceled' : result.error)
      return { totalFaces: result.totalFaces, faceSizes: result.faceSizes, faces: result.faces }
    },
    [job, printLayout],
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
          { pageCount: MAP_PRINT_PAGES.length },
        )
      : translateIn(lang, failure.kind === 'print' ? 'printFailed' : 'exportFailed')
    : null

  return (
    <SimplePrintDialog
      lang={lang}
      rangeChoice="none"
      pages={MAP_PRINT_PAGES}
      capabilities={{ showPaperAndFit: true }}
      documentTitle={job.suggestedName}
      initialDestination={initialDestination}
      listPrinters={printLayout.listPrinters}
      onPlainPrint={() => onPlainPrint(job.html)}
      onPrint={(_range, options, printJob, overlays) =>
        void run('print', options, { printJob, overlays })
      }
      onSavePdf={(_range, options, overlays) => void run('save', options, { overlays })}
      onSaveImages={
        printLayout.saveImages
          ? (_range, options, image, overlays) =>
              void run('save-images', options, { image, overlays })
          : undefined
      }
      onCancel={() => {
        if (running.current) void printLayout.cancel()
        onClose()
      }}
      labelSpecStore={labelSpecStore}
      onPreviewFaces={printLayout.previewFaces ? previewFaces : undefined}
      onClosePreview={printLayout.closePreview ? closePreview : undefined}
      onPreviewRequest={preview}
      job={{ progress, onCancel: () => void printLayout.cancel(), error }}
    />
  )
}
