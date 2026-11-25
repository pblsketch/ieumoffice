// The sign feature (spec 3.6, 3.8): bar button [Sign] opens the signature sheet; the
// confirmed signature waits for a tap on a page and lands there as a PC image stamp
// (`addDrawing` kind 'image'); pending stamps move, resize and delete through the PC
// ops. A signature field (form feature → `requestSignature`) opens the same sheet and
// the signature is fitted into the field like the PC. Nothing changes outside editing.
import './sign.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Op,
  PdfFeatureChrome,
  PdfFeatureContext,
  PdfFeaturePage,
  PdfSignatureTarget,
} from '../../edit/types'
import {
  fieldSignatureDrawing,
  placedSignatureDrawing,
  signatureAsImage,
  type ImageSignature,
  type Rgb,
} from './place'
import { SignatureSheet } from './SignatureSheet'
import { SignOverlay, type PlacedSignature } from './SignOverlay'
import { loadSignColor, saveSignColor, type SignatureData } from './store'

interface SheetRequest {
  /** The signature field that asked, or null for a free signature from the bar. */
  readonly target: PdfSignatureTarget | null
}

/** The form feature may hand over the PC FormWidget itself; its id marks the field signed. */
function widgetIdOf(target: PdfSignatureTarget): string | undefined {
  const id = (target as { readonly id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

export function useSignFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
  const { editing, services, t, toolActive, activeTool, setActiveTool, edits } = ctx
  const [sheet, setSheet] = useState<SheetRequest | null>(null)
  const [pending, setPending] = useState<ImageSignature | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [color, setColor] = useState<Rgb>(() => loadSignColor())
  const editingRef = useRef(editing)
  const fieldDoneRef = useRef<(() => void) | null>(null)

  /** Settles the field request in progress (placed or cancelled). */
  const finishField = useCallback(() => {
    const done = fieldDoneRef.current
    fieldDoneRef.current = null
    done?.()
  }, [])

  useEffect(() => {
    editingRef.current = editing
    if (editing) return
    setSheet(null)
    setPending(null)
    setSelected(null)
    finishField()
  }, [editing, finishField])

  // another bar tool (or the same button again) ends a waiting placement
  useEffect(() => {
    if (!toolActive) setPending(null)
  }, [toolActive])

  // signature fields ask through the frame (spec 3.8)
  useEffect(() => {
    const unregister = services.registerSignatureHandler((target) => {
      if (!editingRef.current) return
      return new Promise<void>((resolve) => {
        finishField()
        fieldDoneRef.current = resolve
        setPending(null)
        setSelected(null)
        setSheet({ target })
      })
    })
    return () => {
      unregister()
      finishField()
    }
  }, [services, finishField])

  // a tap outside the selected stamp lets go of it
  useEffect(() => {
    if (!selected || typeof document === 'undefined') return
    const onDown = (e: Event) => {
      const el = e.target as Element | null
      if (!el?.closest?.('[data-pdf-sign-box]')) setSelected(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [selected])

  const fail = () => services.showToast({ message: t('pdfSignFailed'), tone: 'error' })

  /** One batch through the PC registry; the created id, or null when refused. */
  const run = (ops: Op[]): string | null => {
    if (!editingRef.current) return null
    const plan = services.dispatch(ops)
    if (plan.failures.length > 0) {
      fail()
      return null
    }
    return (plan.ops[0]?.id as string | undefined) ?? ''
  }

  const cancelSheet = () => {
    const fromBar = sheet !== null && sheet.target === null
    setSheet(null)
    finishField()
    if (fromBar && toolActive) setActiveTool(null)
  }

  const confirm = (sig: SignatureData) => {
    const target = sheet?.target ?? null
    if (!editingRef.current) {
      cancelSheet()
      return
    }
    const image = signatureAsImage(sig, color)
    if (!image) {
      fail()
      return
    }
    setSheet(null)
    if (target) {
      const widgetId = widgetIdOf(target)
      run([
        {
          op: 'addDrawing',
          drawing: fieldSignatureDrawing(image, target),
          ...(widgetId ? { formWidgetId: widgetId } : {}),
        },
      ])
      finishField()
      return
    }
    setPending(image)
  }

  const place = (page: PdfFeaturePage, vx: number, vy: number) => {
    if (!pending) return
    const drawing = placedSignatureDrawing(pending, page.pageIndex, page.geom, vx, vy)
    const id = run([{ op: 'addDrawing', drawing }])
    if (id === null) return
    setPending(null)
    setActiveTool(null)
    setSelected(id || null)
  }

  const changeColor = (next: Rgb) => {
    setColor(next)
    saveSignColor(next)
  }

  const signatures: PlacedSignature[] = edits.drawings.flatMap((d) =>
    d.input.kind === 'image' && !edits.deleted.has(d.input.pageIndex)
      ? [{ id: d.id, image: d.input.image, rect: d.input.rect, pageIndex: d.input.pageIndex }]
      : [],
  )
  const placing = editing && pending !== null
  const interactive = editing && !placing && (activeTool === null || toolActive)
  const labels = {
    placed: t('pdfSignPlaced'),
    remove: t('pdfSignDelete'),
    resize: t('pdfSignResize'),
    place: t('pdfSignPlaceHint'),
  }

  return {
    onToolPress: (active) => {
      if (!editingRef.current) return
      setSelected(null)
      setPending(null)
      if (active) setSheet({ target: null })
      else if (sheet?.target === null) setSheet(null)
    },
    stageExtras: (
      <>
        <SignatureSheet
          open={editing && sheet !== null}
          t={t}
          color={color}
          fieldName={sheet?.target?.fieldName ?? null}
          onColorChange={changeColor}
          onCancel={cancelSheet}
          onConfirm={confirm}
        />
        {placing && (
          <div className="m-pdf-sign-hint-bar" role="status" data-testid="pdf-sign-place-hint">
            <span>{t('pdfSignPlaceHint')}</span>
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-ghost"
              onClick={() => {
                setPending(null)
                setActiveTool(null)
              }}
            >
              {t('cancel')}
            </button>
          </div>
        )}
      </>
    ),
    renderPageOverlay:
      signatures.length > 0 || placing
        ? (page) => {
            if (edits.deleted.has(page.pageIndex)) return null
            const onPage = signatures.filter((s) => s.pageIndex === page.pageIndex)
            if (onPage.length === 0 && !placing) return null
            return (
              <SignOverlay
                page={page}
                signatures={onPage}
                interactive={interactive}
                placing={placing}
                selectedId={selected}
                labels={labels}
                onPlace={(vx, vy) => place(page, vx, vy)}
                onSelect={(id) => setSelected(id)}
                onMove={(id, dx, dy) => void run([{ op: 'moveDrawing', id, dx, dy }])}
                onResize={(id, rect) => void run([{ op: 'setDrawingRect', id, rect }])}
                onRemove={(id) => {
                  setSelected(null)
                  run([{ op: 'removeDrawing', id }])
                }}
              />
            )
          }
        : undefined,
  }
}
