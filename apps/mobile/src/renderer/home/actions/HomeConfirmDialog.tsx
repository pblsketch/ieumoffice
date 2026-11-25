import { useEffect, useRef } from 'react'
import type { AppPlatform } from '@genoffice/mobile-bridge/home'
import { useMobileLocale } from '../../i18n'
import { useBackLayer } from '../../shell/backStack'
import './homeActions.css'

export interface HomeConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly message: string
  /** The action's name ("Delete"), never "Yes". */
  readonly confirmLabel: string
  /** Defaults to "Cancel". */
  readonly cancelLabel?: string
  /** Irreversible actions draw the confirm button in the danger color. */
  readonly danger?: boolean
  /** Button placement (design system 7): iOS cancel left / action right; Android right-aligned. */
  readonly platform: AppPlatform
  readonly onConfirm: () => void
  readonly onCancel: () => void
  /** Root test id; the buttons get `-ok` and `-cancel`. */
  readonly testId?: string
}

/**
 * Confirm dialog for an irreversible home action (design system 5.8). Back and Escape cancel; focus
 * moves to [cancel] on open and back to the opener on close.
 */
export function HomeConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  platform,
  onConfirm,
  onCancel,
  testId = 'home-act-confirm',
}: HomeConfirmDialogProps) {
  const { t } = useMobileLocale()
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useBackLayer(open, onCancel)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="mobile-modal-backdrop" onClick={onCancel}>
      <section
        className="mobile-modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mobile-section-title">{title}</h2>
        <p className="mobile-muted">{message}</p>
        <div className="home-act-confirm-actions" data-platform={platform}>
          <button
            ref={cancelRef}
            type="button"
            className="mobile-touch-btn mobile-btn-ghost"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel ?? t('homeActCancel')}
          </button>
          <button
            type="button"
            className={
              danger
                ? 'mobile-touch-btn home-act-btn-danger'
                : 'mobile-touch-btn mobile-btn-primary'
            }
            data-testid={`${testId}-ok`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export interface HomeDeleteConfirmProps {
  readonly open: boolean
  /** How many files one confirm covers. */
  readonly count: number
  /** Shown for a single file. */
  readonly name?: string
  readonly platform: AppPlatform
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * "Delete files?" once for n files (spec 3.6). Android cannot undo it; iOS moves the files to the
 * trash. Other platforms (preview) use the Android wording.
 */
export function HomeDeleteConfirm({
  open,
  count,
  name,
  platform,
  onConfirm,
  onCancel,
}: HomeDeleteConfirmProps) {
  const { t } = useMobileLocale()
  const title = count === 1 ? t('homeActDeleteTitleOne') : t('homeActDeleteTitleMany', { count })
  const consequence = platform === 'ios' ? t('homeActDeleteIos') : t('homeActDeleteAndroid')
  const message = count === 1 && name ? `${name} — ${consequence}` : consequence
  return (
    <HomeConfirmDialog
      open={open}
      title={title}
      message={message}
      confirmLabel={t('homeActDelete')}
      danger
      platform={platform}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
