import { HomeFramePlusIcon, HomeFrameSampleIcon } from '../../components/icons/home'
import { IconFileText, IconFolderOpen } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import './homeFrame.css'

export interface HomeEmptyProps {
  /** [Open the sample document]; left out when there is no app to open it with. */
  readonly onOpenSample?: () => void
  readonly onOpenFile: () => void
  /** [Create new]: opens the create sheet. */
  readonly onCreate: () => void
}

/** The recent tab with nothing opened yet (spec 3.3): one line and three ways to start. */
export function HomeEmpty({ onOpenSample, onOpenFile, onCreate }: HomeEmptyProps) {
  const { t } = useMobileLocale()
  return (
    <div className="mobile-empty-state home-frame-empty" data-testid="home-empty">
      <span className="mobile-empty-icon" aria-hidden="true">
        <IconFileText size={26} />
      </span>
      <p className="mobile-muted">{t('homeEmptyText')}</p>
      <div className="home-frame-empty-actions">
        {onOpenSample && (
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary"
            data-testid="home-empty-sample"
            onClick={onOpenSample}
          >
            <HomeFrameSampleIcon size={18} />
            <span>{t('homeEmptySample')}</span>
          </button>
        )}
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary"
          data-testid="home-empty-open"
          onClick={onOpenFile}
        >
          <IconFolderOpen size={18} />
          <span>{t('openFile')}</span>
        </button>
        <button
          type="button"
          className="mobile-touch-btn mobile-btn-secondary"
          data-testid="home-empty-create"
          aria-haspopup="dialog"
          onClick={onCreate}
        >
          <HomeFramePlusIcon size={18} />
          <span>{t('homeEmptyCreate')}</span>
        </button>
      </div>
    </div>
  )
}
