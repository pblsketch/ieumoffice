// One page of the form layer (PC FormLayer.tsx rules on touch): every widget drawn over
// its rectangle showing its value, tappable in edit mode; pending check/cross marks,
// which a tap selects and a drag moves; and, while a mark is being placed, a catcher
// over the whole page that takes the next tap (a scroll is not a tap).
import './form.css'
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pdfRectToCss, type PageGeom } from '../../../../../../../pdf/src/renderer/annotations'
import type { FormValueInput } from '../../../../../../../pdf/src/shared/ipc'
import {
  choiceLabel,
  movedMarkRect,
  widgetState,
  type FormMarkKind,
  type FormWidget,
  type PendingFormMark,
} from './formModel'
import { IconFormCheck } from './icons'

export interface FormOverlayLabels {
  readonly signField: string
  readonly mark: (kind: FormMarkKind) => string
}

export interface FormOverlayProps {
  readonly pageIndex: number
  readonly geom: PageGeom
  readonly scale: number
  /** Edit mode on an editable document with no bar tool on: taps change things. */
  readonly interactive: boolean
  readonly widgets: readonly FormWidget[]
  readonly formEdits: ReadonlyMap<string, FormValueInput>
  readonly isSigned: (widget: FormWidget) => boolean
  readonly marks: readonly PendingFormMark[]
  readonly selectedMarkId: string | null
  readonly placing: FormMarkKind | null
  readonly labels: FormOverlayLabels
  readonly onWidget: (widget: FormWidget) => void
  readonly onSelectMark: (id: string) => void
  readonly onMoveMark: (id: string, rect: [number, number, number, number]) => void
  /** Tap point in display coordinates at scale 1. */
  readonly onPlace: (pageIndex: number, vx: number, vy: number) => void
}

const fieldFontSize = (height: number) => Math.max(6, Math.min(16, height * 0.6))

export function FormOverlay(props: FormOverlayProps) {
  const { pageIndex, geom, scale, interactive, widgets, marks, placing } = props
  if (widgets.length === 0 && marks.length === 0 && !placing) return null
  return (
    <div
      className="m-pdf-form-layer"
      data-interactive={interactive}
      data-testid={`pdf-form-layer-${pageIndex}`}
    >
      {widgets.map((w) => (
        <FieldControl key={w.id} {...props} widget={w} />
      ))}
      {marks.map((mark) => (
        <MarkView
          key={mark.id}
          mark={mark}
          geom={geom}
          scale={scale}
          interactive={interactive}
          selected={props.selectedMarkId === mark.id}
          label={props.labels.mark(mark.kind)}
          onSelect={props.onSelectMark}
          onMove={props.onMoveMark}
        />
      ))}
      {placing && interactive && (
        <div
          className="m-pdf-form-place"
          data-testid={`pdf-form-place-${pageIndex}`}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            props.onPlace(pageIndex, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
          }}
        />
      )}
    </div>
  )
}

function FieldControl(props: FormOverlayProps & { readonly widget: FormWidget }) {
  const { widget: w, geom, scale, interactive, formEdits } = props
  const box = pdfRectToCss(geom, w.rect, scale)
  const disabled = !interactive || w.readOnly
  const { value, checked } = widgetState(w, formEdits)
  const style = { ...box, fontSize: fieldFontSize(box.height) }
  const common = {
    type: 'button' as const,
    style,
    disabled,
    title: w.fieldName,
    'data-field': w.fieldName,
    'data-kind': w.kind,
    'aria-required': w.required || undefined,
    onClick: () => props.onWidget(w),
  }
  if (w.kind === 'signature') {
    const signed = w.signed || props.isSigned(w)
    return (
      <button
        {...common}
        className={`m-pdf-form-field m-pdf-form-signature${signed ? ' is-signed' : ''}`}
        aria-label={signed ? w.fieldName : props.labels.signField}
        aria-disabled={signed || undefined}
      >
        {signed ? null : props.labels.signField}
      </button>
    )
  }
  if (w.kind === 'checkbox' || w.kind === 'radio') {
    const missing = w.required && (w.kind === 'checkbox' ? !checked : !value)
    return (
      <button
        {...common}
        className={`m-pdf-form-field m-pdf-form-${w.kind}${missing ? ' is-required-empty' : ''}`}
        role={w.kind}
        aria-checked={checked}
        aria-label={w.kind === 'radio' ? `${w.fieldName} ${w.buttonValue}` : w.fieldName}
        data-button-value={w.kind === 'radio' ? w.buttonValue : undefined}
      >
        {checked && (w.kind === 'checkbox' ? <IconFormCheck size={box.height * 0.9} /> : <span />)}
      </button>
    )
  }
  const missing = w.required && !value
  const shown =
    w.kind === 'choice' ? choiceLabel(w, value) : w.password ? '•'.repeat(value.length) : value
  return (
    <button
      {...common}
      className={`m-pdf-form-field m-pdf-form-${w.kind}${w.multiLine ? ' is-multiline' : ''}${missing ? ' is-required-empty' : ''}`}
      style={{ ...style, textAlign: w.textAlignment }}
      aria-label={w.fieldName}
      aria-haspopup="dialog"
    >
      <span className="m-pdf-form-value">{shown}</span>
    </button>
  )
}

function MarkView({
  mark,
  geom,
  scale,
  interactive,
  selected,
  label,
  onSelect,
  onMove,
}: {
  readonly mark: PendingFormMark
  readonly geom: PageGeom
  readonly scale: number
  readonly interactive: boolean
  readonly selected: boolean
  readonly label: string
  readonly onSelect: (id: string) => void
  readonly onMove: (id: string, rect: [number, number, number, number]) => void
}) {
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [offset, setOffset] = useState<[number, number] | null>(null)
  const box = pdfRectToCss(geom, mark.rect, scale)

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current
    drag.current = null
    setOffset(null)
    if (!start) return
    const dx = (e.clientX - start.x) / scale
    const dy = (e.clientY - start.y) / scale
    if (dx !== 0 || dy !== 0) onMove(mark.id, movedMarkRect(geom, mark.rect, dx, dy))
  }

  return (
    <button
      type="button"
      className={`m-pdf-form-mark${selected ? ' is-selected' : ''}`}
      style={{
        ...box,
        transform: offset ? `translate(${offset[0]}px, ${offset[1]}px)` : undefined,
      }}
      disabled={!interactive}
      aria-label={label}
      aria-pressed={interactive ? selected : undefined}
      data-testid="pdf-form-mark"
      data-mark={mark.id}
      onClick={() => onSelect(mark.id)}
      onPointerDown={(e) => {
        if (!interactive || !selected) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (start) setOffset([e.clientX - start.x, e.clientY - start.y])
      }}
      onPointerUp={end}
      onPointerCancel={() => {
        drag.current = null
        setOffset(null)
      }}
    >
      {/* the very PNG the save writes, so the mark looks as it will in the file */}
      <img src={`data:image/png;base64,${mark.image}`} alt="" draggable={false} />
    </button>
  )
}
