// One page's annotation layer: pending markups drawn like the PC MarkupOverlay
// (PdfPage.tsx), saved markups pending deletion outlined, the live text selection,
// note pins (pending notes drawn, saved ones as touch targets over the icon PDF.js
// paints), and — only while the highlighter tool is on — the gesture surface.
//
// Gestures keep the viewer's scrolling: the surface allows vertical panning
// (`touch-action: pan-y`), so a vertical swipe still scrolls. A finger selects text by
// a sideways drag that starts on text, or by a long press (a word) and then a drag in
// any direction; once a selection gesture has started, its touch moves stop scrolling.
// A mouse or pen drag from text selects in any direction. A tap opens the markup under it.
import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react'
import {
  pdfRectToCss,
  quadToRect,
  viewToPdf,
  type LocalMarkup,
} from '../../../../../../../pdf/src/renderer/annotations'
import type { PageSavedAnnots } from '../../../../../../../pdf/src/renderer/annotation-catalog'
import { NOTE_FALLBACK_COLOR } from '../../../../../../../pdf/src/renderer/DrawLayer'
import type { EditSnapshot, PdfFeaturePage } from '../../edit/types'
import { noteRect, pageThreads } from './noteOps'
import { caretAt, selectionQuads, type TextCaret, type TextRun } from './textRuns'

/** Long press that starts a word selection. */
export const ANNOT_LONG_PRESS_MS = 450
/** Finger travel (CSS px) that turns a press into a drag. */
const SLOP_PX = 8
/** How far from text (CSS px) a selection may start. */
const START_REACH_PX = 14

export type AnnotSurfaceMode = 'off' | 'select' | 'note'

export interface AnnotPageLayerProps {
  readonly page: PdfFeaturePage
  readonly edits: EditSnapshot
  readonly saved: PageSavedAnnots | undefined
  readonly runs: readonly TextRun[] | undefined
  readonly surface: AnnotSurfaceMode
  readonly showPins: boolean
  /** The selection on this page (PDF quads), if any. */
  readonly selection: readonly number[][] | null
  readonly ensureSaved: (pageIndex: number) => void
  readonly ensureRuns: (pageIndex: number) => void
  readonly onSelect: (pageIndex: number, quads: number[][] | null, dragging: boolean) => void
  readonly onTap: (pageIndex: number, at: [number, number], slack: number) => void
  readonly onNoteAt: (pageIndex: number, at: [number, number]) => void
  readonly onOpenThread: (pageIndex: number, rootKey: string) => void
  readonly openNoteLabel: string
}

const rgb = (c: readonly number[], alpha?: number): string => {
  const [r, g, b] = c.map((v) => Math.round(v * 255))
  return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const SQUIGGLE_POINTS = Array.from({ length: 21 }, (_, k) => {
  const y = k % 2 === 0 ? 3 : k % 4 === 1 ? 0.7 : 5.3
  return `${k * 5},${y}`
}).join(' ')

function PendingMarkups({ markups, page }: { markups: LocalMarkup[]; page: PdfFeaturePage }) {
  return (
    <>
      {markups.flatMap((m) =>
        m.quads.map((q, i) => {
          const style: CSSProperties = pdfRectToCss(page.geom, quadToRect(q), page.scale)
          const bar = rgb(m.color)
          if (m.type === 'highlight') style.background = rgb(m.color, 0.4)
          else if (m.type === 'underline') style.borderBottom = `2px solid ${bar}`
          else if (m.type === 'strikeout') style.backgroundImage = `linear-gradient(${bar}, ${bar})`
          return (
            <div
              key={`${m.id}-${i}`}
              className={`m-pdf-annot-markup m-pdf-annot-${m.type}`}
              style={style}
              data-testid="pdf-annot-pending-markup"
              data-type={m.type}
            >
              {m.type === 'squiggly' && (
                <svg
                  className="m-pdf-annot-squiggle"
                  width="100%"
                  height="6"
                  viewBox="0 0 100 6"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polyline
                    points={SQUIGGLE_POINTS}
                    fill="none"
                    stroke={bar}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
            </div>
          )
        }),
      )}
    </>
  )
}

interface Gesture {
  pointerId: number
  touch: boolean
  startX: number
  startY: number
  moved: boolean
  selecting: boolean
  /** Caret under the press (null: the press was not on text). */
  press: TextCaret | null
  /** The fixed end of the selection; for a long press, the word around the press. */
  word: { from: TextCaret; to: TextCaret } | null
  timer: ReturnType<typeof setTimeout> | null
}

/** The word around a caret inside its run (whitespace-separated; a CJK run is one word). */
function wordAround(
  runs: readonly TextRun[],
  caret: TextCaret,
): { from: TextCaret; to: TextCaret } {
  const str = runs[caret.run]?.str ?? ''
  let start = Math.min(caret.offset, Math.max(0, str.length - 1))
  let end = start
  if (/\s/.test(str[start] ?? '')) return { from: { ...caret }, to: { ...caret } }
  while (start > 0 && !/\s/.test(str[start - 1]!)) start--
  while (end < str.length && !/\s/.test(str[end]!)) end++
  return { from: { run: caret.run, offset: start }, to: { run: caret.run, offset: end } }
}

const caretBefore = (a: TextCaret, b: TextCaret): boolean =>
  a.run < b.run || (a.run === b.run && a.offset < b.offset)

export function AnnotPageLayer(props: AnnotPageLayerProps) {
  const { page, edits, saved, surface, selection, ensureSaved, ensureRuns } = props
  const { pageIndex, geom, scale, rendered } = page
  const surfaceRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    if (rendered) ensureSaved(pageIndex)
  }, [rendered, pageIndex, ensureSaved])
  useEffect(() => {
    if (rendered && surface === 'select') ensureRuns(pageIndex)
  }, [rendered, surface, pageIndex, ensureRuns])

  // a selecting touch must not scroll: only a non-passive listener can stop it
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (gestureRef.current?.selecting && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [surface])

  useEffect(
    () => () => {
      const timer = gestureRef.current?.timer
      if (timer) clearTimeout(timer)
    },
    [],
  )

  const toPdf = (e: PointerEvent<HTMLElement>): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect()
    return viewToPdf(geom, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
  }

  const emit = (g: Gesture, focus: TextCaret, dragging: boolean) => {
    const list = latest.current.runs
    if (!list || !g.press) return
    let anchor = g.press
    let end = focus
    if (g.word) {
      // a long-press selection always keeps its whole word
      if (caretBefore(focus, g.word.from)) anchor = g.word.to
      else if (caretBefore(g.word.to, focus)) anchor = g.word.from
      else [anchor, end] = [g.word.from, g.word.to]
    }
    const quads = selectionQuads(list, anchor, end)
    latest.current.onSelect(pageIndex, quads.length > 0 ? quads : null, dragging)
  }

  const beginSelecting = (g: Gesture, word: boolean) => {
    const list = latest.current.runs
    if (!list || !g.press) return
    g.selecting = true
    if (word) {
      g.word = wordAround(list, g.press)
      emit(g, g.word.to, true)
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current) return
    const touch = e.pointerType === 'touch'
    const [x, y] = toPdf(e)
    const list = latest.current.runs
    const press = surface === 'select' && list ? caretAt(list, x, y, START_REACH_PX / scale) : null
    const g: Gesture = {
      pointerId: e.pointerId,
      touch,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      selecting: false,
      press,
      word: null,
      timer: null,
    }
    gestureRef.current = g
    if (!press) return
    if (!touch) {
      // a mouse or pen keeps the drag even when it leaves the page
      e.currentTarget.setPointerCapture?.(e.pointerId)
      return
    }
    g.timer = setTimeout(() => {
      g.timer = null
      if (gestureRef.current === g && !g.moved) beginSelecting(g, true)
    }, ANNOT_LONG_PRESS_MS)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    if (!g || g.pointerId !== e.pointerId) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.moved && Math.hypot(dx, dy) > SLOP_PX) {
      g.moved = true
      if (g.timer) {
        clearTimeout(g.timer)
        g.timer = null
      }
      // a mouse or pen drag from text selects; for a finger only a sideways one does,
      // anything else is left to the scroller
      if (!g.selecting && g.press && (!g.touch || Math.abs(dx) > Math.abs(dy))) {
        beginSelecting(g, false)
      }
    }
    if (!g.selecting) return
    const list = latest.current.runs
    if (!list) return
    const [x, y] = toPdf(e)
    const focus = caretAt(list, x, y)
    if (focus) emit(g, focus, true)
  }

  const finish = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gestureRef.current
    if (!g || g.pointerId !== e.pointerId) return
    gestureRef.current = null
    if (g.timer) clearTimeout(g.timer)
    const current = latest.current
    if (g.selecting) {
      const list = current.runs
      const [x, y] = toPdf(e)
      const focus = list ? caretAt(list, x, y) : null
      if (focus && !cancelled) emit(g, focus, false)
      else current.onSelect(pageIndex, current.selection ? [...current.selection] : null, false)
      return
    }
    if (cancelled || g.moved) return
    const at = toPdf(e)
    if (surface === 'note') current.onNoteAt(pageIndex, at)
    else current.onTap(pageIndex, at, START_REACH_PX / scale)
  }

  const removedSaved = edits.annotDeletes.filter(
    (d) => d.annot.pageIndex === pageIndex && 'quads' in d.annot,
  )
  const roots = props.showPins ? pageThreads(edits, pageIndex, saved?.notes ?? []) : []

  return (
    <div className="m-pdf-annot-layer" data-testid={`pdf-annot-layer-${pageIndex}`}>
      <PendingMarkups
        markups={edits.markups.filter((m) => m.pageIndex === pageIndex)}
        page={page}
      />
      {removedSaved.flatMap((d) =>
        'quads' in d.annot
          ? d.annot.quads.map((q, i) => (
              <div
                key={`${d.id}-${i}`}
                className="m-pdf-annot-removed"
                style={pdfRectToCss(geom, quadToRect(q), scale)}
                data-testid="pdf-annot-removed"
              />
            ))
          : [],
      )}
      {selection?.map((q, i) => (
        <div
          key={`s${i}`}
          className="m-pdf-annot-selection"
          style={pdfRectToCss(geom, quadToRect(q), scale)}
          data-testid="pdf-annot-selection"
        />
      ))}
      {surface !== 'off' && (
        <div
          ref={surfaceRef}
          className="m-pdf-annot-surface"
          data-mode={surface}
          data-testid={`pdf-annot-surface-${pageIndex}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
        />
      )}
      {roots.map((root) => {
        const box = pdfRectToCss(geom, noteRect(root.at), scale)
        const pending = root.saved === null
        return (
          <button
            key={root.key}
            type="button"
            className="m-pdf-annot-pin"
            style={{ left: box.left + box.width / 2, top: box.top + box.height / 2 }}
            aria-label={props.openNoteLabel}
            data-testid={`pdf-annot-pin-${root.key}`}
            onClick={() => props.onOpenThread(pageIndex, root.key)}
          >
            {pending && (
              <span
                className="m-pdf-annot-pin-face"
                style={{
                  width: box.width,
                  height: box.height,
                  background: rgb(root.color ?? NOTE_FALLBACK_COLOR),
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
