// The link feature (spec 3.10): [⋯] Insert link enters a placing mode, a finger drags
// a box on a page, the sheet asks for the target, and the PC `addDrawing` op with
// kind 'link' joins the pending edits. A pending link box opens the same sheet to
// change its target or delete it. Leaving edit mode, picking a bar tool or Back ends
// the placing mode; nothing changes outside edit mode.
import './link.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBackLayer } from '../../../../shell/backStack'
import type { Op, PdfFeatureChrome, PdfFeatureContext, PdfFeaturePage } from '../../edit/types'
import {
  addLinkOps,
  pageFieldOf,
  pendingLinksOn,
  removeLinkOps,
  retargetLinkOps,
  visiblePageOrder,
  type PdfLinkTarget,
  type PdfPendingLink,
} from './linkTarget'
import { PdfLinkOverlay } from './PdfLinkOverlay'
import { PdfLinkSheet } from './PdfLinkSheet'

type Rect = [number, number, number, number]

type LinkSheetState =
  | { readonly kind: 'new'; readonly seq: number; readonly pageIndex: number; readonly rect: Rect }
  | { readonly kind: 'edit'; readonly seq: number; readonly link: PdfPendingLink }

export function useLinkFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
  const { editing, activeTool, edits, model, services, t } = ctx
  const [placing, setPlacing] = useState(false)
  const [sheet, setSheet] = useState<LinkSheetState | null>(null)

  useEffect(() => {
    if (!editing) {
      setPlacing(false)
      setSheet(null)
    }
  }, [editing])
  // a bar tool takes the pages over
  useEffect(() => {
    if (activeTool !== null) setPlacing(false)
  }, [activeTool])
  // the link being edited went away (undo, page deleted)
  useEffect(() => {
    if (sheet?.kind === 'edit' && !edits.drawings.some((d) => d.id === sheet.link.id)) {
      setSheet(null)
    }
  }, [sheet, edits.drawings])

  const cancelPlacing = useCallback(() => setPlacing(false), [])
  useBackLayer(placing && editing, cancelPlacing)

  const visible = useMemo(() => visiblePageOrder(edits, model.pages.length), [edits, model.pages])

  const run = (ops: Op[]) => {
    const plan = services.dispatch(ops)
    if (plan.failures.length > 0) {
      services.showToast({ message: t('pdfLinkFailed'), tone: 'error' })
    }
  }

  const apply = (target: PdfLinkTarget) => {
    const current = sheet
    setSheet(null)
    if (!current || !editing) return
    if (current.kind === 'new') run(addLinkOps(current.pageIndex, current.rect, target))
    else run(retargetLinkOps(current.link, target))
  }

  const remove = () => {
    const current = sheet
    setSheet(null)
    if (current?.kind !== 'edit' || !editing) return
    run(removeLinkOps(current.link))
  }

  const labelOf = (link: PdfPendingLink) => {
    const { url, destPage } = link.input
    const target = url
      ? url
      : t('pdfLinkToPage', { page: pageFieldOf(destPage, visible) || String(destPage) })
    return t('pdfLinkPending', { target })
  }

  const nextSeq = () => (sheet?.seq ?? 0) + 1
  const onPlaced = (pageIndex: number, rect: Rect) => {
    if (!editing) return
    setPlacing(false)
    setSheet({ kind: 'new', seq: nextSeq(), pageIndex, rect })
  }
  const onOpenLink = (link: PdfPendingLink) => {
    if (!editing || placing) return
    setSheet({ kind: 'edit', seq: nextSeq(), link })
  }

  const renderPageOverlay = (page: PdfFeaturePage) => (
    <PdfLinkOverlay
      page={page}
      links={pendingLinksOn(edits, page.pageIndex)}
      placing={placing && editing}
      interactive={editing && !placing && sheet === null}
      labelOf={labelOf}
      onPlaced={onPlaced}
      onOpenLink={onOpenLink}
    />
  )

  const editInitial =
    sheet?.kind === 'edit'
      ? {
          url: sheet.link.input.url ?? '',
          page: pageFieldOf(sheet.link.input.destPage, visible),
        }
      : null

  return {
    onMorePress: () => {
      if (!editing) return
      ctx.setActiveTool(null)
      setSheet(null)
      setPlacing(true)
    },
    renderPageOverlay,
    stageExtras: (
      <>
        {placing && editing && (
          <div className="m-pdf-link-bar" role="status" data-testid="pdf-link-placing">
            <span className="m-pdf-link-bar-text">{t('pdfLinkPlaceHint')}</span>
            <button
              type="button"
              className="mobile-touch-btn"
              onClick={cancelPlacing}
              data-testid="pdf-link-placing-cancel"
            >
              {t('cancel')}
            </button>
          </div>
        )}
        {sheet && editing && (
          <PdfLinkSheet
            key={sheet.seq}
            title={sheet.kind === 'new' ? t('pdfEditLink') : t('pdfLinkEditTitle')}
            visiblePages={visible}
            initialUrl={editInitial?.url}
            initialPage={editInitial?.page}
            t={t}
            onApply={apply}
            onDelete={sheet.kind === 'edit' ? remove : undefined}
            onClose={() => setSheet(null)}
          />
        )}
      </>
    ),
  }
}
