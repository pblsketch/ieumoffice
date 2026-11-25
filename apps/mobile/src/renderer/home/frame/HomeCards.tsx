import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { DocTypeIcon, IconChevronRight, IconFolderOpen } from '../../components/MobileIcons'
import { openableExtensions } from '../../editors/registry'
import { useMobileLocale } from '../../i18n'
import { cardLabel, type HomeCardItem } from '../../settings/sections/homeSettingsModel'
import { cardFormat } from './frameModel'
import './homeFrame.css'

type Translate = ReturnType<typeof useMobileLocale>['t']

/** The card title: the familiar "New HWP (.hwpx)" / "New Markdown" names, else the kind's name. */
export function homeCardTitle(item: HomeCardItem, format: MobileDocFormat, t: Translate): string {
  if (item.id === 'hwp') return format === 'hwpx' ? t('newHwpx') : t('newHwp')
  if (item.id === 'md') return t('newMarkdown')
  return cardLabel(item, t)
}

/** The ".hwp · .hwpx · .md …" line of the "Open file" card, from the registry. */
export function openableExtensionsLine(): string {
  return openableExtensions()
    .map((ext) => `.${ext}`)
    .join(' · ')
}

export interface HomeCardsProps {
  readonly cards: readonly HomeCardItem[]
  readonly hwpFormat: 'hwp' | 'hwpx'
  readonly onCreate: (format: MobileDocFormat) => void
  readonly onOpenFile: () => void
}

/**
 * The top of the recent tab (spec 3.1, 3.2): one card per visible new-document item, then the
 * "Open file" card. Test ids: home-new-<card id>-btn (hwp, md, …) and home-open-file-btn.
 */
export function HomeCards({ cards, hwpFormat, onCreate, onOpenFile }: HomeCardsProps) {
  const { t } = useMobileLocale()
  return (
    <section className="mobile-home-cta-group" aria-label={t('newDoc')}>
      {cards.length > 0 && (
        <div className="home-frame-card-row" data-testid="home-card-row">
          {cards.map((item) => {
            const format = cardFormat(item, hwpFormat)
            return (
              <button
                key={item.id}
                type="button"
                className="mobile-quick-card home-frame-card"
                onClick={() => onCreate(format)}
                data-testid={`home-new-${item.id}-btn`}
              >
                <DocTypeIcon format={format} size={38} />
                <span className="mobile-quick-card-text">
                  <span className="mobile-quick-card-title">{homeCardTitle(item, format, t)}</span>
                  <span className="mobile-quick-card-sub">.{format}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        className="mobile-open-card"
        onClick={onOpenFile}
        data-testid="home-open-file-btn"
      >
        <span className="mobile-quick-folder" aria-hidden="true">
          <IconFolderOpen size={19} />
        </span>
        <span className="mobile-open-card-text">
          <span className="mobile-quick-card-title">{t('openFile')}</span>
          <span className="mobile-quick-card-sub">{openableExtensionsLine()}</span>
        </span>
        <IconChevronRight size={18} className="mobile-chevron" />
      </button>
    </section>
  )
}
