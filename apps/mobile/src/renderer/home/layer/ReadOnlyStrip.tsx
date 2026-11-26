// The read-only notice over the editor (track T6, spec 3.9): what kind of document this is, and
// [Edit a copy]. The editor screen is not ours, so the strip is fixed just below its header (and
// below its own notice banner when that shows), re-measured as the page changes.
import { useLayoutEffect, useState } from 'react'
import { IconClose } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import type { SessionOrigin } from '../homeRuntime'
import { useDomTick } from './useDomTick'
import './layer.css'

/** Bottom edge of the editor header and of its notice banner, or null without a header. */
function measureTop(): number | null {
  if (typeof document === 'undefined') return null
  const header = document.querySelector('[data-testid="editor-header"]')
  if (!header) return null
  let bottom = header.getBoundingClientRect().bottom
  const banner = document.querySelector('[data-testid="editor-notice-banner"]')
  if (banner) bottom = Math.max(bottom, banner.getBoundingClientRect().bottom)
  return bottom
}

export interface ReadOnlyStripProps {
  readonly origin: SessionOrigin | null
  readonly busy: boolean
  readonly onEditCopy: () => void
  readonly onClose: () => void
}

export function ReadOnlyStrip({ origin, busy, onEditCopy, onClose }: ReadOnlyStripProps) {
  const { t } = useMobileLocale()
  const tick = useDomTick(true)
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    setTop(measureTop())
  }, [tick])

  if (top === null) return null
  const label =
    origin === 'sample'
      ? t('homeRunStripSample')
      : origin === 'received'
        ? t('homeRunStripReceived')
        : t('homeRunStripReadOnly')
  return (
    <div
      className="home-run-strip"
      role="status"
      data-testid="home-run-readonly-strip"
      style={{ top }}
    >
      <span className="home-run-strip-text">{label}</span>
      <button
        type="button"
        className="mobile-touch-btn mobile-btn-primary home-run-strip-copy"
        data-testid="home-run-strip-copy"
        disabled={busy}
        onClick={onEditCopy}
      >
        {t('homeRunStripCopy')}
      </button>
      <button
        type="button"
        className="mobile-icon-btn"
        data-testid="home-run-strip-close"
        aria-label={t('homeRunStripClose')}
        title={t('homeRunStripClose')}
        onClick={onClose}
      >
        <IconClose size={18} />
      </button>
    </div>
  )
}
