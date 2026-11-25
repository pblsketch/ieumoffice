// The "pages" feature slot (spec 3.9): [⋯] Organize pages opens the organizer sheet;
// rotate, delete, reorder and blank pages are pending edits through the PC ops; pages
// from another PDF are written into the file at once after the edits are saved.
//
// The viewer still draws the pages in file order, pending deletions included: each
// page pending deletion gets a cover saying so, and a moved page says where it goes.
import './pages.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Params } from '@genoffice/i18n'
import type { MobileStringKey } from '../../../../i18n/strings'
import type { Op, PdfFeatureChrome, PdfFeatureContext, PdfFeaturePage } from '../../edit/types'
import { ImportSheet, type ImportDraft } from './ImportSheet'
import {
  allPageCount,
  blankPageOp,
  checkPickedPdf,
  deleteOps,
  fileWriterOf,
  importBlockReason,
  inVisibleOrder,
  moveOps,
  rotateOps,
  runPdfImport,
  visiblePages,
  type ImportPlace,
} from './pageOps'
import { PagesSheet } from './PagesSheet'

export function usePagesFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
  const { model, edits, editing, t, services, pageGeom } = ctx
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [busy, setBusy] = useState(false)
  // async steps (picker, save) check the mode they finish in, not the one they began in
  const editingRef = useRef(editing)
  editingRef.current = editing

  const documentPages = model.pages.length
  const visible = useMemo(() => visiblePages(edits, documentPages), [edits, documentPages])
  const selected = useMemo(() => inVisibleOrder(visible, picked), [visible, picked])
  const writer = fileWriterOf(services)

  useEffect(() => {
    if (editing) return
    setOpen(false)
    setDraft(null)
  }, [editing])
  // another document model (after a save or an import): the old picks mean nothing
  useEffect(() => setPicked(new Set()), [model])

  const say = useCallback(
    (key: MobileStringKey, params?: Params, tone: 'info' | 'error' = 'info') =>
      services.showToast({ message: t(key, params), tone }),
    [services, t],
  )

  /** Applies ops as one undo step; false when nothing changed. */
  const apply = (ops: Op[]): boolean => {
    if (!editingRef.current || ops.length === 0) return false
    const plan = services.dispatch(ops)
    if (plan.failures.length > 0) {
      say('pdfPagesActionFailed', undefined, 'error')
      return false
    }
    return true
  }

  const onRotate = () => void apply(rotateOps(selected))

  const onDelete = () => {
    const ops = deleteOps(visible, selected)
    if (ops === null) {
      say('pdfPagesKeepOne', undefined, 'error')
      return
    }
    if (apply(ops)) setPicked(new Set())
  }

  const onMove = (moving: ReadonlySet<number>, gap: number) => {
    const ops = moveOps(visible, moving, gap, allPageCount(edits, documentPages))
    if (ops) apply(ops)
  }

  const onMoveEarlier = () => {
    if (selected.length === 0) return
    onMove(new Set(selected), Math.max(0, visible.indexOf(selected[0]!) - 1))
  }

  const onMoveLater = () => {
    if (selected.length === 0) return
    onMove(new Set(selected), visible.indexOf(selected[selected.length - 1]!) + 2)
  }

  const onBlank = (side: 'before' | 'after') => {
    const anchor =
      side === 'after'
        ? (selected[selected.length - 1] ?? visible[visible.length - 1])
        : (selected[0] ?? visible[0])
    if (anchor === undefined) return
    const { op, pageIndex } = blankPageOp(edits, documentPages, pageGeom, anchor, side)
    if (apply([op])) setPicked(new Set([pageIndex]))
  }

  const startImport = async () => {
    if (!editingRef.current || !writer || busy) return
    const reason = importBlockReason(services.getModel(), services.getSession())
    if (reason) {
      say(reason, undefined, 'error')
      return
    }
    const other = await services.pickPdfFile()
    if (!other || !editingRef.current) return
    const check = await checkPickedPdf(other)
    if (!check.ok) {
      say(
        check.reason === 'encrypted'
          ? 'pdfPagesImportPickEncrypted'
          : 'pdfPagesImportPickUnreadable',
        undefined,
        'error',
      )
      return
    }
    const last = selected[selected.length - 1]
    const anchor = last === undefined ? null : { page: last, number: visible.indexOf(last) + 1 }
    setOpen(false)
    setDraft({
      other,
      pageCount: check.pageCount,
      place: anchor ? { kind: 'after', page: anchor.page } : { kind: 'end' },
      anchor,
    })
  }

  const confirmImport = async () => {
    const current = draft
    setDraft(null)
    if (!current || !writer || !editingRef.current) return
    setBusy(true)
    try {
      const { outcome, count } = await runPdfImport({
        services,
        write: writer,
        other: current.other,
        place: current.place,
      })
      if (outcome === 'done') {
        say('pdfPagesImportDone', { n: count })
        setOpen(true)
      } else if (outcome === 'blocked') {
        const reason = importBlockReason(services.getModel(), services.getSession())
        if (reason) say(reason, undefined, 'error')
      } else if (outcome === 'insertFailed') {
        say('pdfPagesImportFailed', undefined, 'error')
      }
      // a failed save or write already told the person why
    } finally {
      setBusy(false)
    }
  }

  const renderPageOverlay = (page: PdfFeaturePage) => {
    if (edits.deleted.has(page.pageIndex)) {
      return (
        <div
          className="m-pdf-pages-deleted"
          role="note"
          data-testid={`pdf-pages-deleted-${page.pageIndex}`}
        >
          <strong>{t('pdfPagesDeletedLabel')}</strong>
          <span>{t('pdfPagesDeletedHint')}</span>
        </div>
      )
    }
    if (edits.order === null) return null
    const pos = visible.indexOf(page.pageIndex)
    if (pos < 0 || pos === page.pageIndex) return null
    return (
      <div className="m-pdf-pages-moved" data-testid={`pdf-pages-moved-${page.pageIndex}`}>
        {t('pdfPagesMovedLabel', { n: pos + 1 })}
      </div>
    )
  }

  const pendingMarks = edits.deleted.size > 0 || edits.order !== null

  return {
    onMorePress: () => {
      if (editingRef.current) setOpen(true)
    },
    renderPageOverlay: pendingMarks ? renderPageOverlay : undefined,
    stageExtras: (
      <>
        <PagesSheet
          open={open && editing}
          t={t}
          model={model}
          edits={edits}
          pageGeom={pageGeom}
          visible={visible}
          selected={selected}
          busy={busy}
          onClose={() => setOpen(false)}
          onToggle={(page) =>
            setPicked((prev) => {
              const next = new Set(prev)
              if (next.has(page)) next.delete(page)
              else next.add(page)
              return next
            })
          }
          onSelectAll={() => setPicked(new Set(visible))}
          onClearSelection={() => setPicked(new Set())}
          onRotate={onRotate}
          onDelete={onDelete}
          onMoveEarlier={onMoveEarlier}
          onMoveLater={onMoveLater}
          onMove={onMove}
          onBlank={onBlank}
          onImport={writer ? () => void startImport() : null}
        />
        <ImportSheet
          draft={editing ? draft : null}
          t={t}
          onPlace={(place: ImportPlace) => setDraft((prev) => (prev ? { ...prev, place } : prev))}
          onConfirm={() => void confirmImport()}
          onCancel={() => setDraft(null)}
        />
      </>
    ),
  }
}
