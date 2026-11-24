import type { ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  IMAGE_BUNDLE_MODES,
  IMAGE_EXPORT_FORMATS,
  JPG_QUALITIES,
  type ImageBundleMode,
  type ImageExportFormat,
  type JpgQuality,
} from '@genoffice/print-layout/plan'
import { printLayoutText, type PrintLayoutStringKey } from '../strings-print-layout'
import {
  DEFAULT_PRINTER,
  SAVE_IMAGES_DEST,
  SAVE_PDF_DEST,
  SYSTEM_DIALOG,
  type PrintJobState,
} from './hooks'
import type { PrintLayoutDuplex } from './model'
import './print-layout.css'

const DUPLEX_MODES: readonly PrintLayoutDuplex[] = ['simplex', 'longEdge', 'shortEdge']

const QUALITY_KEY: Record<JpgQuality, PrintLayoutStringKey> = {
  90: 'imageQualityHigh',
  80: 'imageQualityMedium',
  65: 'imageQualitySmall',
}

export interface PrintJobFieldsProps {
  lang: Lang
  state: PrintJobState
  /** number of arranged output faces; hides multi-page bundle toggle when strictly 1 */
  faceCount?: number | undefined
  /** show the grayscale note when Save as PDF is selected */
  grayscale?: boolean | undefined
  disabled?: boolean | undefined
}

/**
 * Shared destination selector (OS printers, Save as PDF, Save as images, or
 * System print dialog) with dynamic fields for printer copies/duplex or image
 * export format/quality/bundle.
 */
export function PrintJobFields(props: PrintJobFieldsProps): ReactElement {
  const { lang, state, faceCount, grayscale = false, disabled = false } = props
  const t = (key: PrintLayoutStringKey) => printLayoutText(lang, key)
  const showMultiPageBundle = faceCount === undefined || faceCount > 1

  return (
    <fieldset className="gs-pl-printer">
      <legend className="gs-pl-legend">{t('destination')}</legend>
      <select
        className="gs-pl-select"
        data-print="printer"
        aria-label={t('destination')}
        value={state.deviceName}
        disabled={disabled}
        onChange={(e) => state.setDeviceName(e.target.value)}
      >
        <option value={DEFAULT_PRINTER}>{t('defaultPrinter')}</option>
        {state.printers.map((pr) => (
          <option key={pr.name} value={pr.name}>
            {pr.displayName}
          </option>
        ))}
        {state.allowSaveDestinations && (
          <>
            <option value={SAVE_PDF_DEST} disabled={state.saveRestricted}>
              {t('destSavePdf')}
            </option>
            <option value={SAVE_IMAGES_DEST} disabled={state.saveRestricted}>
              {t('destSaveImages')}
            </option>
          </>
        )}
        <option value={SYSTEM_DIALOG}>{t('systemDialog')}</option>
      </select>

      {state.allowSaveDestinations && state.saveRestricted && (
        <p className="gs-pl-hint" data-print-save-restricted="">
          {t('saveRestricted')}
        </p>
      )}

      {!state.isSave && (
        <>
          <div className="gs-pl-printer-row">
            <label className="gs-pl-field">
              <span className="gs-pl-field-label">{t('copies')}</span>
              <input
                type="number"
                className="gs-pl-number"
                data-print="copies"
                min={1}
                max={999}
                value={state.copies}
                disabled={disabled || state.systemDialog}
                onChange={(e) => state.setCopies(Number(e.target.value))}
              />
            </label>
            <label className="gs-pl-check">
              <input
                type="checkbox"
                data-print="collate"
                checked={state.collate}
                disabled={disabled || state.systemDialog || state.copies < 2 || state.collateLocked}
                onChange={(e) => state.setCollate(e.target.checked)}
              />
              <span>{t('collate')}</span>
            </label>
          </div>
          <label className="gs-pl-field gs-pl-printer-duplex">
            <span className="gs-pl-field-label">{t('duplex')}</span>
            <select
              className="gs-pl-select"
              data-print="duplex"
              value={state.duplex}
              disabled={disabled || state.systemDialog}
              onChange={(e) => state.setDuplex(e.target.value as PrintLayoutDuplex)}
            >
              {DUPLEX_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(
                    m === 'simplex' ? 'duplexOff' : m === 'longEdge' ? 'duplexLong' : 'duplexShort',
                  )}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {state.destinationKind === 'save-pdf' && grayscale && (
        <p className="gs-pl-hint" data-pl="gray-note">
          {t('savePdfGrayNote')}
        </p>
      )}

      {state.destinationKind === 'save-images' && (
        <div className="gs-pl-save-image-opts" data-print="image-options">
          <div className="gs-pl-printer-row">
            <label className="gs-pl-field">
              <span className="gs-pl-field-label">{t('imageFormat')}</span>
              <select
                className="gs-pl-select"
                data-print="image-format"
                value={state.imageOptions.format}
                disabled={disabled}
                onChange={(e) =>
                  state.setImageOptions({ format: e.target.value as ImageExportFormat })
                }
              >
                {IMAGE_EXPORT_FORMATS.map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {fmt.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            {state.imageOptions.format === 'jpg' && (
              <label className="gs-pl-field">
                <span className="gs-pl-field-label">{t('imageQuality')}</span>
                <select
                  className="gs-pl-select"
                  data-print="image-quality"
                  value={state.imageOptions.quality}
                  disabled={disabled}
                  onChange={(e) =>
                    state.setImageOptions({ quality: Number(e.target.value) as JpgQuality })
                  }
                >
                  {JPG_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {t(QUALITY_KEY[q])}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {showMultiPageBundle && (
            <label className="gs-pl-field gs-pl-printer-duplex">
              <span className="gs-pl-field-label">{t('imageBundle')}</span>
              <select
                className="gs-pl-select"
                data-print="image-bundle"
                value={state.imageOptions.bundle}
                disabled={disabled}
                onChange={(e) =>
                  state.setImageOptions({ bundle: e.target.value as ImageBundleMode })
                }
              >
                {IMAGE_BUNDLE_MODES.map((b) => (
                  <option key={b} value={b}>
                    {t(b === 'zip' ? 'imageBundleZip' : 'imageBundleFiles')}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </fieldset>
  )
}
