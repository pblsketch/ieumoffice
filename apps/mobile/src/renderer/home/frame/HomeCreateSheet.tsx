import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { HomeFramePlusIcon, HomeFrameToolsIcon } from '../../components/icons/home'
import { DocTypeIcon, IconFolderOpen } from '../../components/MobileIcons'
import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import type { HomeCardItem } from '../../settings/sections/homeSettingsModel'
import { homeCardTitle, openableExtensionsLine } from './HomeCards'
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
  /** Shows the "PDF tools" row: the tools are on and T3 linked its screen. */
  readonly pdfToolsReady: boolean
  readonly onClose: () => void
  readonly onCreate: (format: MobileDocFormat) => void
  readonly onOpenFile: () => void
  readonly onOpenPdfTools: () => void
}

/**
 * The create sheet behind [+] (spec 3.1): tiles for the same cards the recent tab shows, then
 * "Open file" and, when allowed, "PDF tools". Every choice closes the sheet first.
 */
export function HomeCreateSheet({
  open,
  cards,
  hwpFormat,
  pdfToolsReady,
  onClose,
  onCreate,
  onOpenFile,
  onOpenPdfTools,
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
      <div className="mobile-menu-stack home-frame-create-rows">
        <button
          type="button"
          className="mobile-menu-row-btn"
          data-testid="home-create-open-file"
          onClick={() => {
            onClose()
            onOpenFile()
          }}
        >
          <IconFolderOpen size={19} />
          <span className="home-frame-create-row-text">
            <span>{t('openFile')}</span>
            <span className="home-frame-create-row-sub">{openableExtensionsLine()}</span>
          </span>
        </button>
        {pdfToolsReady && (
          <button
            type="button"
            className="mobile-menu-row-btn"
            data-testid="home-create-pdf-tools"
            onClick={() => {
              onClose()
              onOpenPdfTools()
            }}
          >
            <HomeFrameToolsIcon size={19} />
            <span>{t('homeCreatePdfTools')}</span>
          </button>
        )}
      </div>
    </Sheet>
  )
}
