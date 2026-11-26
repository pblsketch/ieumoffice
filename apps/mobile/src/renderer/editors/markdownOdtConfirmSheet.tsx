import type { ReportFeature, ReportItem } from '@genoffice/odt-engine'
import { Sheet } from '../components/Sheet'
import { useMobileLocale, type MobileStringKey } from '../i18n'

/** Feature names of the ODT conversion report, worded as in the PC ODT export. */
const FEATURE_KEY: Record<ReportFeature, MobileStringKey> = {
  toc: 'webOdtFeatToc',
  chart: 'webOdtFeatChart',
  equation: 'webOdtFeatEquation',
  shape: 'webOdtFeatShape',
  textbox: 'webOdtFeatTextbox',
  columns: 'webOdtFeatColumns',
  citation: 'webOdtFeatCitation',
  cross_reference: 'webOdtFeatCrossReference',
  page_color: 'webOdtFeatPageColor',
  mirror_margins: 'webOdtFeatMirrorMargins',
  theme: 'webOdtFeatTheme',
  comment: 'webOdtFeatComment',
  revision: 'webOdtFeatRevision',
  ink: 'webOdtFeatInk',
  watermark: 'webOdtFeatWatermark',
  password: 'webOdtFeatPassword',
  protection: 'webOdtFeatProtection',
  form_field: 'webOdtFeatFormField',
  object: 'webOdtFeatObject',
}

export interface OdtConfirmSheetProps {
  readonly open: boolean
  /** The conversion report (`docxToOdt`): what the ODT changes and what it leaves out. */
  readonly items: readonly ReportItem[]
  /** [Save]: go on to the save dialog. */
  readonly onConfirm: () => void
  /** [Cancel], Back or the close button: nothing is written. */
  readonly onCancel: () => void
}

/**
 * Asks before an ODT export that changes or leaves something out, as the PC ODT
 * export's message box does. Shared by the Markdown and HTML editors.
 */
export function OdtConfirmSheet({ open, items, onConfirm, onCancel }: OdtConfirmSheetProps) {
  const { t } = useMobileLocale()
  const section = (kind: ReportItem['kind'], heading: MobileStringKey) => {
    const rows = items.filter((item) => item.kind === kind)
    if (rows.length === 0) return null
    return (
      <section data-testid={`web-odt-confirm-${kind}`}>
        <h3 className="mobile-format-group-title">{t(heading)}</h3>
        <ul className="mobile-memo-list">
          {rows.map((item) => {
            const name = t(FEATURE_KEY[item.feature])
            return (
              <li key={item.feature} className="mobile-memo-text">
                {`• ${item.count > 1 ? `${name} (${item.count})` : name}`}
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <Sheet
      open={open}
      title={t('webOdtExportTitle')}
      closeLabel={t('webOdtCancel')}
      onClose={onCancel}
      testId="web-odt-confirm-sheet"
    >
      <div className="mobile-memo-sheet">
        <p className="mobile-memo-empty">{t('webOdtConfirmMessage')}</p>
        {section('converted', 'webOdtChanges')}
        {section('dropped', 'webOdtLeftOut')}
        <div className="mobile-memo-actions">
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-ghost"
            data-testid="web-odt-confirm-cancel"
            onClick={onCancel}
          >
            {t('webOdtCancel')}
          </button>
          <button
            type="button"
            className="mobile-pill-btn mobile-btn-primary"
            data-testid="web-odt-confirm-save"
            onClick={onConfirm}
          >
            {t('webOdtSave')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
