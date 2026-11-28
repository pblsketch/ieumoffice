import { useEffect, type ReactNode } from 'react'
import { IconClose } from './MobileIcons'

export interface BottomSheetProps {
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
  readonly closeLabel: string
  readonly children: ReactNode
}

export function BottomSheet({ open, title, onClose, closeLabel, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose} data-testid="mobile-bottom-sheet">
      <section
        className="mobile-sheet-surface"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-sheet-handle" aria-hidden="true" />
        <header className="mobile-sheet-header">
          <h2 className="mobile-sheet-title">{title}</h2>
          <button
            type="button"
            className="mobile-icon-btn"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <IconClose size={20} />
          </button>
        </header>
        <div className="mobile-sheet-body">{children}</div>
      </section>
    </div>
  )
}
