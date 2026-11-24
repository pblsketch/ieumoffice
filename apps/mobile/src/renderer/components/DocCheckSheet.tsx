import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ADMINISTRATION_RULES,
  audit,
  type AuditResult,
  type DocumentProfile,
  type Finding,
  type Place,
  type RuleId,
} from '@genoffice/doc-rules'
import { useMobileLocale } from '../i18n'
import { Sheet } from './Sheet'

/**
 * The checks that are off by default, as in the PC panel (apps/hwp DocCheckPanel): they
 * fire on most documents written before the guideline.
 */
const EXTRA_RULES: Partial<Record<RuleId, boolean>> = {
  'font.outside-recommended': true,
  'numbering.mixed': true,
  'numbering.order': true,
  'blank.run': true,
}

/** Places listed under one finding; the count says how many there really are. */
const MAX_SHOWN_PLACES = 6

/** The font the guideline names first: what a Korean-word-processor-only font becomes. */
export const REPLACEMENT_FONT = '함초롬바탕'

export interface DocCheckSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly format: 'hwp' | 'hwpx'
  /** Reads what the document is made of (the page editor plugin's documentProfile). */
  readonly readProfile: () => Promise<DocumentProfile>
  /** Shows a place in the document. */
  readonly onReveal: (place: Place) => void
  /** Replaces a font everywhere; absent when the document cannot be changed (view mode). */
  readonly onReplaceFont?: (from: string, to: string) => Promise<void>
}

/**
 * The format check of `@genoffice/doc-rules` over the open HWP document, as on the PC:
 * read once through the page editor's plugin, judged here, no model and no network.
 */
export function DocCheckSheet({
  open,
  onClose,
  format,
  readProfile,
  onReveal,
  onReplaceFont,
}: DocCheckSheetProps) {
  const { t } = useMobileLocale()
  const [profile, setProfile] = useState<DocumentProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [extra, setExtra] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      setProfile(await readProfile())
    } catch {
      setProfile(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [readProfile])

  useEffect(() => {
    if (open) void run()
  }, [open, run])

  const result: AuditResult | null = useMemo(
    () =>
      profile
        ? audit({ ...profile, format }, ADMINISTRATION_RULES, extra ? { rules: EXTRA_RULES } : {})
        : null,
    [profile, format, extra],
  )

  const severityLabel = (severity: Finding['severity']) =>
    severity === 'violation'
      ? t('checkViolation')
      : severity === 'check'
        ? t('checkReview')
        : t('checkSuggestion')

  const replaceFont = async (from: string) => {
    if (!onReplaceFont) return
    setFixing(from)
    try {
      await onReplaceFont(from, REPLACEMENT_FONT)
      await run()
    } catch {
      setFailed(true)
    } finally {
      setFixing(null)
    }
  }

  const reveal = (place: Place) => {
    onReveal(place)
    onClose()
  }

  return (
    <Sheet
      open={open}
      title={t('checkTitle')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="hwp-doc-check-sheet"
    >
      <div className="mobile-check-sheet">
        {busy && <p className="mobile-memo-empty">{t('checkRunning')}</p>}
        {!busy && failed && (
          <p className="mobile-memo-error" role="alert">
            {t('checkFailed')}
          </p>
        )}
        {!busy && !failed && result && (
          <>
            <div className="mobile-check-summary">
              {(['violation', 'check', 'suggestion'] as const).map((severity) =>
                result.counts[severity] > 0 ? (
                  <span key={severity} className="mobile-check-badge" data-severity={severity}>
                    {severityLabel(severity)} {result.counts[severity]}
                  </span>
                ) : null,
              )}
            </div>
            {result.findings.length === 0 && <p className="mobile-memo-empty">{t('checkEmpty')}</p>}
            <ul className="mobile-memo-list">
              {result.findings.map((finding) => (
                <li key={finding.id} className="mobile-memo mobile-check-finding">
                  <div className="mobile-check-head">
                    <span className="mobile-check-badge" data-severity={finding.severity}>
                      {severityLabel(finding.severity)}
                    </span>
                    <strong>{finding.title}</strong>
                    <span className="mobile-memo-meta">{finding.count}</span>
                  </div>
                  <p className="mobile-memo-text">{finding.why}</p>
                  {finding.detail && <p className="mobile-memo-meta">{finding.detail}</p>}
                  <div className="mobile-check-places">
                    {finding.places.slice(0, MAX_SHOWN_PLACES).map((place, index) => (
                      <span key={`${finding.id}-${index}`} className="mobile-check-place-row">
                        <button
                          type="button"
                          className="mobile-pill-btn mobile-btn-secondary"
                          onClick={() => reveal(place)}
                        >
                          {place.label || `${place.anchor.para + 1}`}
                        </button>
                        {finding.id === 'font.hangul-only' && onReplaceFont && (
                          <button
                            type="button"
                            className="mobile-pill-btn mobile-btn-ghost"
                            disabled={fixing !== null}
                            onClick={() => void replaceFont(place.label)}
                          >
                            {t('checkReplaceWith', { font: REPLACEMENT_FONT })}
                          </button>
                        )}
                      </span>
                    ))}
                    {finding.places.length > MAX_SHOWN_PLACES && (
                      <span className="mobile-memo-meta">
                        {t('checkMorePlaces', { count: finding.places.length - MAX_SHOWN_PLACES })}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {result.truncated && <p className="mobile-memo-meta">{t('checkTruncated')}</p>}
            <p className="mobile-memo-meta">{t('checkSource')}</p>
          </>
        )}
        <label className="mobile-set-row">
          <span className="mobile-set-label">{t('checkShowAll')}</span>
          <input
            type="checkbox"
            className="mobile-switch"
            checked={extra}
            onChange={(event) => setExtra(event.target.checked)}
          />
        </label>
        <div className="mobile-memo-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-secondary"
            disabled={busy}
            onClick={() => void run()}
          >
            {t('checkAgain')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
