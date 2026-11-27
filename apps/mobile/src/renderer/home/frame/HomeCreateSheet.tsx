import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import {
  HomeFrameFolderPlusIcon,
  HomeFramePlusIcon,
  HomeFrameToolsIcon,
} from '../../components/icons/home'
import { DocTypeIcon, IconFolderOpen } from '../../components/MobileIcons'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import type { HomeCardItem } from '../../settings/sections/homeSettingsModel'
import { homeCardTitle } from './HomeCards'
import { cardFormat } from './frameModel'
import './homeFrame.css'

export interface HomeFabProps {
  readonly onPress: () => void
}

/** The floating [+] of the recent and folders tabs (design system 5.10). */
export function HomeFab({ onPress }: HomeFabProps) {
  const { t } = useMobileLocale()
  return (
    <button
      type="button"
      className="home-frame-fab"
      data-testid="home-fab"
      aria-haspopup="dialog"
      aria-label={t('homeCreateFab')}
      title={t('homeCreateFab')}
      onClick={onPress}
    >
      <HomeFramePlusIcon size={26} />
    </button>
  )
}

export interface HomeCreateSheetProps {
  readonly open: boolean
  readonly cards: readonly HomeCardItem[]
  readonly hwpFormat: 'hwp' | 'hwpx'
  /** Shows the "PDF tools" action: the tools are on and T3 linked its screen. */
  readonly pdfToolsReady: boolean
  /** Current folder path when opened from inside a linked folder browser. */
  readonly locationLabel?: string | null
  readonly onClose: () => void
  readonly onCreate: (format: MobileDocFormat) => void
  readonly onOpenFile: () => void
  readonly onOpenPdfTools: () => void
  /** Links a new folder via the system folder picker; omitted when no bridge client is present. */
  readonly onAddFolder?: () => void
}

/**
 * The create sheet behind [+] (spec 3.1): optional folder context line, a 2-column grid of
 * new-document format tiles, and a 2-column secondary action grid (Open file, PDF tools, Add folder).
 * Every choice closes the sheet first.
 */
export function HomeCreateSheet({
  open,
  cards,
  hwpFormat,
  pdfToolsReady,
  locationLabel,
  onClose,
  onCreate,
  onOpenFile,
  onOpenPdfTools,
  onAddFolder,
}: HomeCreateSheetProps) {
  const { t } = useMobileLocale()
  return (
    <Sheet
      open={open}
      title={t('homeCreateTitle')}
      closeLabel={t('homeCreateClose')}
      onClose={onClose}
      testId="home-create-sheet"
    >
      {locationLabel && (
        <div className="home-frame-create-location" data-testid="home-create-location">
          <IconFolderOpen size={16} />
          <span className="home-frame-create-location-text">
            {t('homeCreateLocation', { name: locationLabel })}
          </span>
        </div>
      )}
      {cards.length > 0 && (
        <div className="home-frame-create-grid">
          {cards.map((item) => {
            const format = cardFormat(item, hwpFormat)
            return (
              <button
                key={item.id}
                type="button"
                className="home-frame-create-tile"
                data-testid={`home-create-${item.id}`}
                onClick={() => {
                  onClose()
                  onCreate(format)
                }}
              >
                <DocTypeIcon format={format} size={34} />
                <span className="home-frame-create-tile-title">
                  {homeCardTitle(item, format, t)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className="home-frame-create-secondary">
        <button
          type="button"
          className="home-frame-create-action"
          data-testid="home-create-open-file"
          onClick={() => {
            onClose()
            onOpenFile()
          }}
        >
          <IconFolderOpen size={20} />
          <span className="home-frame-create-action-title">{t('openFile')}</span>
        </button>
        {pdfToolsReady && (
          <button
            type="button"
            className="home-frame-create-action"
            data-testid="home-create-pdf-tools"
            onClick={() => {
              onClose()
              onOpenPdfTools()
            }}
          >
            <HomeFrameToolsIcon size={20} />
            <span className="home-frame-create-action-title">{t('homeCreatePdfTools')}</span>
          </button>
        )}
        {onAddFolder && (
          <button
            type="button"
            className="home-frame-create-action"
            data-testid="home-create-add-folder"
            onClick={() => {
              onClose()
              onAddFolder()
            }}
          >
            <HomeFrameFolderPlusIcon size={20} />
            <span className="home-frame-create-action-title">{t('homeCreateAddFolder')}</span>
          </button>
        )}
      </div>
    </Sheet>
  )
}
