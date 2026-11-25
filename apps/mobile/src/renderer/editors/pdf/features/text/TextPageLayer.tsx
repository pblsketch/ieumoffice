// One page of the Text box tool: the pending inserts and edits drawn the PC way
// (text-edit-preview.tsx: cover the old run, draw the new text), the tap catcher of the
// active tool, and the input box of the open draft.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  pdfRectToCss,
  pdfToView,
  viewToPdf,
  type PageGeom,
} from '../../../../../../../pdf/src/renderer/annotations'
import {
  textEditPreviewContent,
  textEditPreviewParts,
  textInsertPreviewContent,
  textInsertPreviewStyle,
  unionCover,
  type LocalTextEdit,
  type LocalTextInsert,
} from '../../../../../../../pdf/src/renderer/text-edit-preview'
import type { PdfFeaturePage } from '../../edit/types'
import { fontCss, type TextDraft } from './textModel'

/** Finger travel (CSS px) under which a press counts as a tap, not a scroll or a drag. */
const TAP_SLOP = 10

export interface TextPageLayerProps {
  readonly page: PdfFeaturePage
  readonly inserts: readonly LocalTextInsert[]
  readonly edits: readonly LocalTextEdit[]
  /** The open draft, when it is on this page. */
  readonly draft: TextDraft | null
  /** The tool is on in edit mode: the layer takes taps. */
  readonly active: boolean
  readonly inputLabel: string
  onTap(pageIndex: number, vx: number, vy: number): void
  onOpenInsert(id: string): void
  onMoveInsert(id: string, origin: [number, number]): void
  onOpenEdit(id: string): void
  onDraftValue(value: string): void
}

const pointIn = (e: { clientX: number; clientY: number }, el: Element, scale: number) => {
  const box = el.getBoundingClientRect()
  return [(e.clientX - box.left) / scale, (e.clientY - box.top) / scale] as const
}

export function TextPageLayer(props: TextPageLayerProps) {
  const { page, inserts, edits, draft, active } = props
  const { geom, scale, pageIndex } = page
  const draftOwned = new Set(
    draft ? [draft.kind === 'insert' ? draft.insertId : draft.editId].filter(Boolean) : [],
  )
  return (
    <div
      className="m-pdf-text-layer"
      data-active={active}
      data-testid={`pdf-text-layer-${pageIndex}`}
    >
      {active && <TapCatcher page={page} onTap={props.onTap} />}
      {edits
        .filter((te) => te.input.pageIndex === pageIndex && !draftOwned.has(te.id) && !te.scanLayer)
        .map((te) => {
          const { style, coverStyle } = textEditPreviewParts(te, geom, scale)
          const css = fontCss(te.input.newFont)
          if (css) style.fontFamily = css
          return (
            <div key={te.id} className="m-pdf-text-edit-group">
              {coverStyle && <div className="m-pdf-text-cover" style={coverStyle} />}
              <div
                className="m-pdf-text-edit-preview"
                style={style}
                data-testid="pdf-text-edit-preview"
                onClick={active ? () => props.onOpenEdit(te.id) : undefined}
              >
                {textEditPreviewContent(te, scale)}
              </div>
            </div>
          )
        })}
      {inserts
        .filter(
          (ins) =>
            ins.input.pageIndex === pageIndex && !ins.input.invisible && !draftOwned.has(ins.id),
        )
        .map((ins) => (
          <InsertPreview
            key={ins.id}
            insert={ins}
            geom={geom}
            scale={scale}
            active={active}
            onOpen={() => props.onOpenInsert(ins.id)}
            onMove={(origin) => props.onMoveInsert(ins.id, origin)}
          />
        ))}
      {draft && draft.pageIndex === pageIndex && (
        <DraftBox draft={draft} page={page} label={props.inputLabel} onValue={props.onDraftValue} />
      )}
    </div>
  )
}

/** Takes taps on the page while letting one finger scroll it (pointercancel on pan). */
function TapCatcher({ page, onTap }: { page: PdfFeaturePage; onTap: TextPageLayerProps['onTap'] }) {
  const downRef = useRef<{ id: number; x: number; y: number } | null>(null)
  return (
    <div
      className="m-pdf-text-catcher"
      data-testid={`pdf-text-catcher-${page.pageIndex}`}
      onPointerDown={(e) => {
        downRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
      }}
      onPointerUp={(e) => {
        const down = downRef.current
        downRef.current = null
        if (!down || down.id !== e.pointerId) return
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) return
        const [vx, vy] = pointIn(e, e.currentTarget, page.scale)
        onTap(page.pageIndex, vx, vy)
      }}
      onPointerCancel={() => {
        downRef.current = null
      }}
    />
  )
}

interface DragState {
  readonly id: number
  readonly from: [number, number]
  readonly to: [number, number]
}

function InsertPreview({
  insert,
  geom,
  scale,
  active,
  onOpen,
  onMove,
}: {
  insert: LocalTextInsert
  geom: PageGeom
  scale: number
  active: boolean
  onOpen: () => void
  onMove: (origin: [number, number]) => void
}) {
  const [drag, setDragState] = useState<DragState | null>(null)
  // The handlers read the live drag: a move and a release can land before a re-render
  const dragRef = useRef<DragState | null>(null)
  const setDrag = (next: DragState | null | ((cur: DragState | null) => DragState | null)) => {
    dragRef.current = typeof next === 'function' ? next(dragRef.current) : next
    setDragState(dragRef.current)
  }
  const style: CSSProperties = textInsertPreviewStyle(insert, geom, scale)
  const css = fontCss(insert.input.font)
  if (css) style.fontFamily = css
  const moved = drag
    ? Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) > TAP_SLOP
    : false
  if (drag && moved) {
    style.transform = `translate(${drag.to[0] - drag.from[0]}px, ${drag.to[1] - drag.from[1]}px)${
      style.transform ? ` ${style.transform}` : ''
    }`
  }
  return (
    <div
      className="m-pdf-text-insert-preview"
      style={style}
      data-testid="pdf-text-insert-preview"
      data-moving={moved || undefined}
      onPointerDown={
        active
          ? (e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setDrag({ id: e.pointerId, from: [e.clientX, e.clientY], to: [e.clientX, e.clientY] })
            }
          : undefined
      }
      onPointerMove={
        active
          ? (e) =>
              setDrag((cur) =>
                cur && cur.id === e.pointerId ? { ...cur, to: [e.clientX, e.clientY] } : cur,
              )
          : undefined
      }
      onPointerUp={
        active
          ? (e) => {
              e.stopPropagation()
              const cur = dragRef.current
              setDrag(null)
              if (!cur || cur.id !== e.pointerId) return
              const dx = e.clientX - cur.from[0]
              const dy = e.clientY - cur.from[1]
              if (Math.hypot(dx, dy) <= TAP_SLOP) {
                onOpen()
                return
              }
              // PC App.tsx: the drag delta in view units, mapped into PDF space
              const [ax, ay] = viewToPdf(geom, 0, 0)
              const [bx, by] = viewToPdf(geom, dx / scale, dy / scale)
              onMove([insert.input.origin[0] + (bx - ax), insert.input.origin[1] + (by - ay)])
            }
          : undefined
      }
      onPointerCancel={active ? () => setDrag(null) : undefined}
    >
      {textInsertPreviewContent(insert, scale)}
    </div>
  )
}

/** The input box of the open draft, where the text sits on the page. */
function DraftBox({
  draft,
  page,
  label,
  onValue,
}: {
  draft: TextDraft
  page: PdfFeaturePage
  label: string
  onValue: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const { geom, scale } = page
  let box: CSSProperties
  let cover: CSSProperties | null = null
  if (draft.kind === 'insert') {
    const [vx, vy] = pdfToView(geom, draft.origin[0], draft.origin[1])
    const left = vx * scale
    const lineH = draft.fontSize * 1.2 * scale
    box = {
      left,
      top: (vy - draft.fontSize) * scale,
      width: Math.max(page.width - left - 2, 40),
      minHeight: lineH,
      fontSize: draft.fontSize * scale * 0.92,
      lineHeight: `${lineH}px`,
      fontFamily: fontCss(draft.font),
      fontWeight: draft.bold ? 700 : 400,
      color: draft.color,
    }
  } else {
    const r = pdfRectToCss(geom, draft.rect, scale)
    const size = draft.size ?? draft.fontSize
    const lineH = draft.block
      ? draft.block.lineHeight * (size / draft.fontSize) * scale
      : size * 1.2 * scale
    box = {
      left: r.left,
      top: r.top,
      width: draft.block ? r.width : Math.max(r.width, page.width - r.left - 2),
      minHeight: Math.max(r.height, lineH),
      fontSize: size * scale * 0.92,
      lineHeight: `${lineH}px`,
      ...(draft.font ? { fontFamily: fontCss(draft.font) } : {}),
      ...(draft.bold ? { fontWeight: 700 } : {}),
      ...(draft.color || draft.seedInk ? { color: draft.color ?? draft.seedInk } : {}),
    }
    cover = pdfRectToCss(geom, unionCover(draft.rect, draft.cover), scale)
  }
  const wraps = draft.kind === 'edit' && !!draft.block
  // Grow with the text: the page shows every line being typed
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
  }, [draft.value, box.fontSize, box.width])
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <>
      {cover && <div className="m-pdf-text-cover m-pdf-text-draft-cover" style={cover} />}
      <textarea
        ref={ref}
        className="m-pdf-text-draft"
        style={box}
        value={draft.value}
        wrap={wraps ? 'soft' : 'off'}
        rows={1}
        aria-label={label}
        data-testid="pdf-text-draft"
        data-kind={draft.kind}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(e) => onValue(e.currentTarget.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      />
    </>
  )
}
