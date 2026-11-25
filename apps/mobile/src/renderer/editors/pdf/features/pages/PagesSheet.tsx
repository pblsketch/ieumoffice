// The page organizer sheet (spec 3.9): thumbnails in the pending order, tap to pick
// pages (several at once), drag a page by its grip to move it (the picked pages move
// together when it is one of them), and the actions on the picked pages.
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Params } from '@genoffice/i18n'
import { Sheet } from '../../../../components/Sheet'
import type { MobileStringKey } from '../../../../i18n/strings'
import type { EditSnapshot } from '../../edit/types'
import type { PageGeom, PdfOpenedDocument } from '../../view'
import {
  IconPagesBlankAfter,
  IconPagesBlankBefore,
  IconPagesCheck,
  IconPagesDelete,
  IconPagesEarlier,
  IconPagesGrip,
  IconPagesImport,
  IconPagesLater,
  IconPagesRotate,
} from './icons'
import { pageDisplaySize } from './pageOps'
import { PageThumb } from './PageThumb'

/** Distance from the sheet's top or bottom edge that scrolls the grid while dragging. */
const EDGE_SCROLL_PX = 48
const EDGE_SCROLL_STEP = 16

export interface PagesSheetProps {
  readonly open: boolean
  readonly t: (key: MobileStringKey, params?: Params) => string
  readonly model: PdfOpenedDocument
  readonly edits: EditSnapshot
  readonly pageGeom: (pageIndex: number) => PageGeom
  /** Visible pages in pending order (original indices). */
  readonly visible: readonly number[]
  /** Picked pages in visible order. */
  readonly selected: readonly number[]
  readonly busy: boolean
  readonly onClose: () => void
  readonly onToggle: (page: number) => void
  readonly onSelectAll: () => void
  readonly onClearSelection: () => void
  readonly onRotate: () => void
  readonly onDelete: () => void
  readonly onMoveEarlier: () => void
  readonly onMoveLater: () => void
  /** Move `moving` as one block into gap `gap` of `visible`. */
  readonly onMove: (moving: ReadonlySet<number>, gap: number) => void
  readonly onBlank: (side: 'before' | 'after') => void
  /** Null when the frame cannot write pages into the file (the entry is left out). */
  readonly onImport: (() => void) | null
}

interface DragState {
  readonly page: number
  readonly moving: ReadonlySet<number>
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly dx: number
  readonly dy: number
  readonly gap: number | null
}

export function PagesSheet(props: PagesSheetProps) {
  const { open, t, model, edits, pageGeom, visible, selected, busy } = props
  const tiles = useRef(new Map<number, HTMLElement>())
  const [drag, setDrag] = useState<DragState | null>(null)
  const picked = new Set(selected)
  const documentPages = model.pages.length
  const none = selected.length === 0
  const firstPos = none ? -1 : visible.indexOf(selected[0]!)
  const lastPos = none ? -1 : visible.indexOf(selected[selected.length - 1]!)
  const block = selected.length > 0 && lastPos - firstPos + 1 === selected.length

  const gapAt = (x: number, y: number): number | null => {
    for (let pos = 0; pos < visible.length; pos++) {
      const el = tiles.current.get(visible[pos]!)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return x > r.left + r.width / 2 ? pos + 1 : pos
      }
    }
    return null
  }

  const onGripDown = (page: number, e: ReactPointerEvent<HTMLElement>) => {
    if (busy) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const moving = picked.has(page) && picked.size > 1 ? new Set(picked) : new Set([page])
    setDrag({
      page,
      moving,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      gap: null,
    })
  }

  const onGripMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const scroller = e.currentTarget.closest('.mobile-sheet-body')
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      if (e.clientY < r.top + EDGE_SCROLL_PX) scroller.scrollTop -= EDGE_SCROLL_STEP
      else if (e.clientY > r.bottom - EDGE_SCROLL_PX) scroller.scrollTop += EDGE_SCROLL_STEP
    }
    setDrag({
      ...drag,
      dx: e.clientX - drag.startX,
      dy: e.clientY - drag.startY,
      gap: gapAt(e.clientX, e.clientY) ?? drag.gap,
    })
  }

  const onGripUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    setDrag(null)
    if (drag.gap !== null) props.onMove(drag.moving, drag.gap)
  }

  const dropBefore = drag?.gap ?? null

  return (
    <Sheet
      open={open}
      title={t('pdfEditPages')}
      closeLabel={t('cancel')}
      onClose={props.onClose}
      initialDetent="large"
      testId="pdf-pages-sheet"
    >
      <div className="m-pdf-pages" data-busy={busy}>
        <div className="m-pdf-pages-status">
          <span className="m-pdf-pages-count" data-testid="pdf-pages-count">
            {none ? t('pdfPagesNoneSelected') : t('pdfPagesSelected', { n: selected.length })}
          </span>
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-ghost"
            onClick={none ? props.onSelectAll : props.onClearSelection}
            data-testid="pdf-pages-select-all"
          >
            {none ? t('pdfPagesSelectAll') : t('pdfPagesClearSelection')}
          </button>
        </div>

        <ol className="m-pdf-pages-grid" data-testid="pdf-pages-grid">
          {visible.map((page, pos) => {
            const isBlank = page >= documentPages
            const size = pageDisplaySize(edits, documentPages, pageGeom, page)
            const wide = size.width / size.height >= 0.75
            const on = picked.has(page)
            const dragging = drag?.moving.has(page) ?? false
            const label = isBlank
              ? `${t('pdfPagesPageLabel', { n: pos + 1 })} · ${t('pdfPagesBlankLabel')}`
              : t('pdfPagesPageLabel', { n: pos + 1 })
            return (
              <li
                key={page}
                ref={(el) => {
                  if (el) tiles.current.set(page, el)
                  else tiles.current.delete(page)
                }}
                className="m-pdf-pages-tile"
                data-selected={on}
                data-dragging={dragging}
                data-drop={
                  dropBefore === pos
                    ? 'before'
                    : dropBefore === visible.length && pos === visible.length - 1
                      ? 'after'
                      : undefined
                }
                data-testid={`pdf-pages-tile-${page}`}
                style={
                  dragging && drag?.page === page
                    ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` }
                    : undefined
                }
              >
                <button
                  type="button"
                  className="m-pdf-pages-pick"
                  aria-pressed={on}
                  aria-label={label}
                  onClick={() => props.onToggle(page)}
                  data-testid={`pdf-pages-pick-${page}`}
                >
                  <span className="m-pdf-pages-frame">
                    <span
                      className="m-pdf-pages-paper"
                      style={{
                        aspectRatio: `${size.width} / ${size.height}`,
                        ...(wide ? { width: '100%' } : { height: '100%' }),
                      }}
                    >
                      <PageThumb
                        doc={model.proxy}
                        pageNo={isBlank || model.failedPages.has(page + 1) ? null : page + 1}
                        rotationDelta={isBlank ? 0 : (edits.rotations.get(page) ?? 0)}
                      />
                    </span>
                    {on ? (
                      <span className="m-pdf-pages-check" aria-hidden="true">
                        <IconPagesCheck size={16} />
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="m-pdf-pages-foot">
                  <span className="m-pdf-pages-no" aria-hidden="true">
                    {pos + 1}
                    {isBlank ? ` · ${t('pdfPagesBlankLabel')}` : ''}
                  </span>
                  <span
                    className="m-pdf-pages-grip"
                    aria-hidden="true"
                    title={t('pdfPagesDragHandle')}
                    onPointerDown={(e) => onGripDown(page, e)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={() => setDrag(null)}
                    data-testid={`pdf-pages-grip-${page}`}
                  >
                    <IconPagesGrip size={18} />
                  </span>
                </span>
              </li>
            )
          })}
        </ol>

        <div className="m-pdf-pages-actions" role="toolbar" aria-label={t('pdfEditPages')}>
          <Action
            label={t('pdfPagesRotate')}
            icon={<IconPagesRotate size={20} />}
            disabled={busy || none}
            onPress={props.onRotate}
            testId="pdf-pages-rotate"
          />
          <Action
            label={t('pdfPagesDelete')}
            icon={<IconPagesDelete size={20} />}
            disabled={busy || none}
            onPress={props.onDelete}
            testId="pdf-pages-delete"
            danger
          />
          <Action
            label={t('pdfPagesMoveEarlier')}
            icon={<IconPagesEarlier size={20} />}
            disabled={busy || none || (block && firstPos === 0)}
            onPress={props.onMoveEarlier}
            testId="pdf-pages-earlier"
          />
          <Action
            label={t('pdfPagesMoveLater')}
            icon={<IconPagesLater size={20} />}
            disabled={busy || none || (block && lastPos === visible.length - 1)}
            onPress={props.onMoveLater}
            testId="pdf-pages-later"
          />
          <Action
            label={t('pdfPagesBlankBefore')}
            icon={<IconPagesBlankBefore size={20} />}
            disabled={busy}
            onPress={() => props.onBlank('before')}
            testId="pdf-pages-blank-before"
          />
          <Action
            label={t('pdfPagesBlankAfter')}
            icon={<IconPagesBlankAfter size={20} />}
            disabled={busy}
            onPress={() => props.onBlank('after')}
            testId="pdf-pages-blank-after"
          />
          {props.onImport ? (
            <Action
              label={t('pdfPagesImport')}
              icon={<IconPagesImport size={20} />}
              disabled={busy}
              onPress={props.onImport}
              testId="pdf-pages-import"
            />
          ) : null}
        </div>
      </div>
    </Sheet>
  )
}

function Action({
  label,
  icon,
  disabled,
  onPress,
  testId,
  danger = false,
}: {
  readonly label: string
  readonly icon: ReactNode
  readonly disabled: boolean
  readonly onPress: () => void
  readonly testId: string
  readonly danger?: boolean
}) {
  return (
    <button
      type="button"
      className="m-pdf-pages-action"
      data-danger={danger}
      disabled={disabled}
      onClick={onPress}
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
