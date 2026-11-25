// The "draw" feature (spec 3.5): [Pen] turns the drawing tool on and opens its sheet;
// pages get a drawing layer; strokes become PC `addDrawing` ops and the eraser
// `removeDrawing` ops, written only through the frame's dispatch in edit mode.
//
// The eraser removes drawings that are not saved yet. Strokes and shapes already in
// the file stay: the PC save code can delete saved markups, notes and polygons only
// (`AnnotDeleteInput.subtype`), not saved Ink/Square/Circle/Line annotations.
import './draw.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  cssRgb,
  DRAW_COLORS,
  type LocalDrawing,
} from '../../../../../../../pdf/src/renderer/DrawLayer'
import { STROKE_WIDTH } from '../../../../../../../pdf/src/renderer/view-config'
import type { DrawingInput } from '../../../../../../../pdf/src/shared/ipc'
import type { PdfFeatureChrome, PdfFeatureContext, PdfFeaturePage } from '../../edit/types'
import { DrawPageLayer } from './DrawPageLayer'
import { DRAW_TOOL_ENTRIES, DrawSheet } from './DrawSheet'
import { isStrokeDrawing, type DrawToolChoice, type Rgb } from './drawGeometry'
import {
  createPenInputRouter,
  fingerDrawsWith,
  loadPenPrefs,
  savePenPrefs,
  type PenInputRouter,
  type PenPrefs,
} from './penInput'

const NO_DRAWINGS: readonly LocalDrawing[] = []

export function useDrawFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
  const { editing, toolActive, edits, t } = ctx
  const active = editing && toolActive

  const [tool, setTool] = useState<DrawToolChoice>('ink')
  const [color, setColor] = useState<Rgb>(DRAW_COLORS[0]!.rgb)
  const [width, setWidth] = useState(STROKE_WIDTH)
  const [prefs, setPrefs] = useState<PenPrefs>(() => loadPenPrefs())
  // one pen/finger state machine for every page layer of this document
  const [router] = useState<PenInputRouter>(() =>
    createPenInputRouter({
      initial: prefs,
      onChange: (next) => {
        savePenPrefs(next)
        setPrefs(next)
      },
    }),
  )

  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetShownRef = useRef(false)
  useEffect(() => {
    if (!active) setSheetOpen(false)
  }, [active])

  // a pointer released or cancelled off every page layer must not stay "down"
  useEffect(() => {
    const release = (e: PointerEvent) => router.up(e.pointerId)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    return () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
    }
  }, [router])

  // the latest context for pointer handlers that outlive a render
  const ctxRef = useRef(ctx)
  useLayoutEffect(() => {
    ctxRef.current = ctx
  })

  const onCommit = useCallback((pageIndex: number, input: DrawingInput) => {
    const current = ctxRef.current
    if (!current.editing || !current.toolActive) return
    // PC App `commitDrawing`: the layer's drawing with its page
    const plan = current.services.dispatch([{ op: 'addDrawing', drawing: { ...input, pageIndex } }])
    if (plan.failures.length > 0) current.services.showToast(current.t('pdfDrawRefused'))
  }, [])

  const onErase = useCallback((ids: string[], gestureKey: string) => {
    const current = ctxRef.current
    if (!current.editing || !current.toolActive) return
    const pending = new Set(current.services.getEdits().drawings.map((d) => d.id))
    const ops = ids.filter((id) => pending.has(id)).map((id) => ({ op: 'removeDrawing', id }))
    if (ops.length === 0) return
    const plan = current.services.dispatch(ops, { coalesceKey: gestureKey })
    if (plan.failures.length > 0) current.services.showToast(current.t('pdfDrawRefused'))
  }, [])

  const byPage = useMemo(() => {
    const map = new Map<number, LocalDrawing[]>()
    for (const d of edits.drawings) {
      if (!isStrokeDrawing(d)) continue
      const list = map.get(d.input.pageIndex)
      if (list) list.push(d)
      else map.set(d.input.pageIndex, [d])
    }
    return map
  }, [edits.drawings])

  const fingerDraws = fingerDrawsWith(prefs)
  const style = useMemo(() => ({ color, width }), [color, width])
  const ToolIcon = DRAW_TOOL_ENTRIES[tool].Icon

  return {
    onToolPress: (on) => {
      if (!on) {
        setSheetOpen(false)
        return
      }
      // the sheet opens by itself the first time; the floating button reopens it
      if (!sheetShownRef.current) {
        sheetShownRef.current = true
        setSheetOpen(true)
      }
    },
    stageExtras: active ? (
      <>
        <button
          type="button"
          className="m-pdf-draw-chip"
          onClick={() => setSheetOpen(true)}
          aria-label={t('pdfDrawSettings')}
          title={t('pdfDrawSettings')}
          data-testid="pdf-draw-settings"
        >
          <ToolIcon size={20} />
          {tool !== 'eraser' && (
            <span
              className="m-pdf-draw-swatch-dot"
              // document color, shown as it will be drawn
              style={{ background: cssRgb(color) }}
            />
          )}
        </button>
        <DrawSheet
          open={sheetOpen}
          t={t}
          tool={tool}
          color={color}
          width={width}
          fingerDraws={prefs.fingerDraws}
          onTool={setTool}
          onColor={setColor}
          onWidth={setWidth}
          onFingerDraws={(on) => router.setFingerDraws(on)}
          onClose={() => setSheetOpen(false)}
        />
      </>
    ) : undefined,
    renderPageOverlay: (page: PdfFeaturePage) => {
      const drawings = byPage.get(page.pageIndex) ?? NO_DRAWINGS
      // a page marked for deletion takes no new drawings (the PC op would refuse them)
      const pageActive = active && !edits.deleted.has(page.pageIndex)
      if (!pageActive && drawings.length === 0) return null
      return (
        <DrawPageLayer
          page={page}
          drawings={drawings}
          active={pageActive}
          tool={tool}
          style={style}
          fingerDraws={fingerDraws}
          router={router}
          onCommit={onCommit}
          onErase={onErase}
        />
      )
    },
  }
}
