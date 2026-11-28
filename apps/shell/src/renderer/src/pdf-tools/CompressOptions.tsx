import type { Lang, Params } from '@genoffice/i18n'
import type { PdfCompressMode, PdfSpaceAudit, PdfToolOptions } from '../../../shared/pdf-tools-api'
import { formatBytes } from '../generate/format'
import type { PdfToolsStringKey } from '../i18n/strings-pdf-tools'

export interface TargetMissedState {
  pendingId: string
  achievedBytes: number
  targetBytes: number
  originalBytes: number
}

interface CompressOptionsProps {
  lang: Lang
  t: (key: PdfToolsStringKey, params?: Params) => string
  options: PdfToolOptions
  audit: PdfSpaceAudit | null
  targetMissed: TargetMissedState | null
  busy: boolean
  onChange(patch: PdfToolOptions): void
  onConfirmPartial(save: boolean): void
}

const MODES: { id: PdfCompressMode; labelKey: PdfToolsStringKey }[] = [
  { id: 'lossless', labelKey: 'modeLossless' },
  { id: 'light', labelKey: 'levelLight' },
  { id: 'medium', labelKey: 'levelMedium' },
  { id: 'strong', labelKey: 'levelStrong' },
  { id: 'target', labelKey: 'modeTarget' },
]

const TARGET_PRESETS_MB = [2, 5, 10] as const

export function CompressOptions({
  lang,
  t,
  options,
  audit,
  targetMissed,
  busy,
  onChange,
  onConfirmPartial,
}: CompressOptionsProps) {
  const mode: PdfCompressMode = options.compressMode ?? options.compressLevel ?? 'medium'
  const isLossless = mode === 'lossless'

  const pct = (part: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(100, Math.round((part / total) * 100))) : 0

  return (
    <div className="pt-fields">
      {audit && audit.totalBytes > 0 && (
        <div className="pt-audit">
          <div className="pt-field-label">{t('spaceAuditTitle')}</div>
          <div className="pt-audit-bar" aria-hidden>
            <span
              className="pt-audit-seg pt-audit-images"
              style={{ width: `${pct(audit.imagesBytes, audit.totalBytes)}%` }}
            />
            <span
              className="pt-audit-seg pt-audit-fonts"
              style={{ width: `${pct(audit.fontsBytes, audit.totalBytes)}%` }}
            />
            <span
              className="pt-audit-seg pt-audit-content"
              style={{ width: `${pct(audit.contentBytes, audit.totalBytes)}%` }}
            />
            <span
              className="pt-audit-seg pt-audit-other"
              style={{ width: `${pct(audit.otherBytes, audit.totalBytes)}%` }}
            />
          </div>
          <div className="pt-audit-legend">
            <span>
              <i className="pt-dot pt-audit-images" />
              {t('spaceAuditImages')} {formatBytes(audit.imagesBytes, lang)}
            </span>
            <span>
              <i className="pt-dot pt-audit-fonts" />
              {t('spaceAuditFonts')} {formatBytes(audit.fontsBytes, lang)}
            </span>
            <span>
              <i className="pt-dot pt-audit-content" />
              {t('spaceAuditContent')} {formatBytes(audit.contentBytes, lang)}
            </span>
            <span>
              <i className="pt-dot pt-audit-other" />
              {t('spaceAuditOther')} {formatBytes(audit.otherBytes, lang)}
            </span>
          </div>
          {audit.duplicateImageCount > 0 && (
            <p className="pt-hint">
              {t('spaceAuditDupes', {
                n: audit.duplicateImageCount,
                bytes: formatBytes(audit.duplicateImageSavableBytes, lang),
              })}
            </p>
          )}
        </div>
      )}

      <fieldset className="pt-field pt-choices">
        <legend className="pt-field-label">{t('optLevel')}</legend>
        {MODES.map((m) => (
          <label className="pt-choice" key={m.id}>
            <input
              type="radio"
              name="compressMode"
              checked={mode === m.id}
              onChange={() =>
                onChange({
                  compressMode: m.id,
                  ...(m.id === 'light' || m.id === 'medium' || m.id === 'strong'
                    ? { compressLevel: m.id }
                    : {}),
                  ...(m.id === 'lossless' ? { grayscaleImages: false } : {}),
                  ...(m.id === 'target' && !options.targetSizeMb ? { targetSizeMb: 5 } : {}),
                })
              }
            />
            {t(m.labelKey)}
          </label>
        ))}
      </fieldset>

      {mode === 'target' && (
        <div className="pt-target-row">
          <label className="pt-field">
            <span className="pt-field-label">{t('optTargetMb')}</span>
            <input
              type="number"
              className="pt-input pt-input-short"
              min={0.1}
              step={0.5}
              value={options.targetSizeMb ?? 5}
              onChange={(e) => onChange({ targetSizeMb: Number(e.target.value) })}
            />
          </label>
          <div className="pt-preset-btns">
            {TARGET_PRESETS_MB.map((mb) => (
              <button
                key={mb}
                type="button"
                className={`pt-btn pt-btn-sm${options.targetSizeMb === mb ? ' is-active' : ''}`}
                onClick={() => onChange({ targetSizeMb: mb })}
              >
                {mb} MB
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pt-checks-col">
        <label className="pt-check">
          <input
            type="checkbox"
            disabled={isLossless}
            checked={!isLossless && options.grayscaleImages === true}
            onChange={(e) => onChange({ grayscaleImages: e.target.checked })}
          />
          {t('optGrayscaleImages')}
        </label>
        <label className="pt-check">
          <input
            type="checkbox"
            checked={options.linearize === true}
            onChange={(e) => onChange({ linearize: e.target.checked })}
          />
          {t('optLinearize')}
        </label>
        <label className="pt-check">
          <input
            type="checkbox"
            checked={options.stripMetadata === true}
            onChange={(e) => onChange({ stripMetadata: e.target.checked })}
          />
          {t('optStripMetadata')}
        </label>
      </div>

      {targetMissed && (
        <div className="pt-note pt-note-warn" role="alert">
          <p className="pt-warn-text">
            {t('targetMissedPrompt', {
              target: formatBytes(targetMissed.targetBytes, lang),
              achieved: formatBytes(targetMissed.achievedBytes, lang),
              original: formatBytes(targetMissed.originalBytes, lang),
            })}
          </p>
          <div className="pt-actions pt-actions-start">
            <button
              type="button"
              className="pt-btn pt-btn-primary"
              disabled={busy}
              onClick={() => onConfirmPartial(true)}
            >
              {t('saveSmallest')}
            </button>
            <button
              type="button"
              className="pt-btn"
              disabled={busy}
              onClick={() => onConfirmPartial(false)}
            >
              {t('discardResult')}
            </button>
          </div>
        </div>
      )}

      <p className="pt-hint">{t('noteCompress')}</p>
    </div>
  )
}
