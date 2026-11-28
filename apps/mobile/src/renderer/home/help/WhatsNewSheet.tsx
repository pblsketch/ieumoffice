// The "What's new" sheet (track T6, spec 3.12): Help opens it with the latest entry, and the app
// layer opens it once on the home after an update with the entries `whatsNewToShow` picks.
import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import type { WhatsNewEntry } from './whatsNew'
import './help.css'

export interface WhatsNewSheetProps {
  readonly open: boolean
  /** Newest first, as `whatsNewToShow` returns them. */
  readonly entries: readonly WhatsNewEntry[]
  readonly onClose: () => void
}

export function WhatsNewSheet({ open, entries, onClose }: WhatsNewSheetProps) {
  const { t } = useMobileLocale()
  return (
    <Sheet
      open={open}
      title={t('homeHelpWhatsNew')}
      onClose={onClose}
      closeLabel={t('homeHelpClose')}
      testId="home-help-whats-new-sheet"
    >
      {entries.length === 0 ? (
        <p className="mobile-muted">{t('homeHelpWhatsNewEmpty')}</p>
      ) : (
        <div className="home-help-whats-new">
          {entries.map((entry) => (
            <section key={entry.version} className="home-help-whats-new-entry">
              <h3 className="home-help-whats-new-version">
                {t('homeHelpWhatsNewVersion', { version: entry.version })}
              </h3>
              <ul className="home-help-whats-new-list">
                {entry.itemKeys.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  )
}
