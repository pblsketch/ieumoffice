import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCheck } from './MobileIcons'

export interface ToastAction {
  readonly label: string
  readonly onPress: () => void
}

export interface ToastRequest {
  readonly message: string
  readonly action?: ToastAction
  readonly tone?: 'info' | 'error'
}

interface ToastState extends ToastRequest {
  readonly key: number
}

/** Plain toasts stay 4s; toasts with an action (undo) stay 8s and pause while touched or focused. */
export const TOAST_MS = 4000
export const TOAST_ACTION_MS = 8000

export function useToast(): {
  readonly toast: ToastState | null
  readonly showToast: (request: ToastRequest | string) => void
  readonly dismissToast: () => void
} {
  const [toast, setToast] = useState<ToastState | null>(null)
  const seqRef = useRef(0)
  const showToast = useCallback((request: ToastRequest | string) => {
    seqRef.current += 1
    const next = typeof request === 'string' ? { message: request } : request
    setToast({ ...next, key: seqRef.current })
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])
  return { toast, showToast, dismissToast }
}

export interface ToastHostProps {
  readonly toast: ToastState | null
  readonly onDismiss: () => void
}

/**
 * One toast at a time (design system 5.9), drawn above the bottom bar and the
 * keyboard. Status toasts use role="status"; errors use role="alert".
 */
export function ToastHost({ toast, onDismiss }: ToastHostProps) {
  const [held, setHeld] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    if (!toast || held) return
    timerRef.current = setTimeout(onDismiss, toast.action ? TOAST_ACTION_MS : TOAST_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast, held, onDismiss])

  if (!toast) return null
  const isError = toast.tone === 'error'
  return (
    <div
      key={toast.key}
      className="mobile-toast"
      data-tone={toast.tone ?? 'info'}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      data-testid="mobile-toast"
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {!isError && <IconCheck size={15} />}
      <span className="mobile-toast-text">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="mobile-toast-action"
          onClick={() => {
            toast.action?.onPress()
            onDismiss()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
