import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { useBackLayer } from '../shell/backStack'
import { IconClose } from './MobileIcons'

export type SheetDetent = 'medium' | 'large'

export interface SheetProps {
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
  readonly closeLabel: string
  /** Modal sheets dim and block the page behind; non-modal ones let the document stay usable. */
  readonly modal?: boolean
  readonly initialDetent?: SheetDetent
  readonly testId?: string
  readonly children: ReactNode
}

/** Drag distance (px) that changes the stop or closes the sheet. */
const DRAG_STEP_PX = 72

/**
 * Bottom sheet of the design system (5.5): two stops (medium, large), drag the
 * handle to resize, drag down to close, Back closes it, focus moves in on open
 * and back to the opener on close. It rides above the on-screen keyboard.
 */
export function Sheet({
  open,
  title,
  onClose,
  closeLabel,
  modal = true,
  initialDetent = 'medium',
  testId = 'mobile-bottom-sheet',
  children,
}: SheetProps) {
  const [detent, setDetent] = useState<SheetDetent>(initialDetent)
  const [dragY, setDragY] = useState(0)
  const dragStartRef = useRef<number | null>(null)
  const surfaceRef = useRef<HTMLElement | null>(null)

  useBackLayer(open, onClose)

  useEffect(() => {
    if (open) setDetent(initialDetent)
  }, [open, initialDetent])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    // Modal sheets take focus; a non-modal sheet (format panel) leaves it in the
    // document so the keyboard and the caret stay where they are.
    const opener =
      modal && document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (modal) surfaceRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [open, onClose, modal])

  if (!open) return null

  const onHandleDown = (e: PointerEvent<HTMLElement>) => {
    dragStartRef.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onHandleMove = (e: PointerEvent<HTMLElement>) => {
    if (dragStartRef.current === null) return
    setDragY(e.clientY - dragStartRef.current)
  }
  const onHandleUp = () => {
    if (dragStartRef.current === null) return
    dragStartRef.current = null
    const moved = dragY
    setDragY(0)
    if (moved > DRAG_STEP_PX) {
      if (detent === 'large') setDetent('medium')
      else onClose()
    } else if (moved < -DRAG_STEP_PX && detent === 'medium') {
      setDetent('large')
    }
  }

  const surface = (
    <section
      ref={surfaceRef}
      className="mobile-sheet-surface"
      role="dialog"
      aria-modal={modal}
      aria-label={title}
      tabIndex={-1}
      data-detent={detent}
      data-dragging={dragY !== 0 ? 'true' : undefined}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="mobile-sheet-grip"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        <div className="mobile-sheet-handle" aria-hidden="true" />
        <header className="mobile-sheet-header">
          <h2 className="mobile-sheet-title">{title}</h2>
          <button
            type="button"
            className="mobile-icon-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <IconClose size={20} />
          </button>
        </header>
      </div>
      <div className="mobile-sheet-body">{children}</div>
    </section>
  )

  if (!modal) {
    return (
      <div className="mobile-sheet-layer mobile-sheet-layer-nonmodal" data-testid={testId}>
        {surface}
      </div>
    )
  }
  return (
    <div
      className="mobile-sheet-backdrop mobile-sheet-layer"
      onClick={onClose}
      data-testid={testId}
    >
      {surface}
    </div>
  )
}
