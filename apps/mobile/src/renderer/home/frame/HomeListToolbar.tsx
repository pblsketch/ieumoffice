import {
  HomeFrameGridViewIcon,
  HomeFrameListViewIcon,
  HomeFrameSortAscIcon,
  HomeFrameSortDescIcon,
} from '../../components/icons/home'
import { useMobileLocale } from '../../i18n'
import {
  updateHomeListPrefs,
  useHomeListPrefs,
  type HomeSortDir,
  type HomeSortField,
  type HomeViewMode,
} from './frameModel'
import './homeFrame.css'

export interface HomeListToolbarProps {
  readonly sortField?: HomeSortField
  readonly sortDir?: HomeSortDir
  readonly viewMode?: HomeViewMode
  readonly onChangeSortField?: (next: HomeSortField) => void
  readonly onChangeSortDir?: (next: HomeSortDir) => void
  readonly onChangeViewMode?: (next: HomeViewMode) => void
}

/**
 * Slim single-row bar above home document lists and folder contents:
 * sort key toggle (modified / name), sort direction arrow, and list/card grid toggle.
 */
export function HomeListToolbar(props: HomeListToolbarProps) {
  const { t } = useMobileLocale()
  const shared = useHomeListPrefs()
  const sortField = props.sortField ?? shared.sortField
  const sortDir = props.sortDir ?? shared.sortDir
  const viewMode = props.viewMode ?? shared.viewMode

  const toggleField = () => {
    const next: HomeSortField = sortField === 'date' ? 'name' : 'date'
    if (props.onChangeSortField) props.onChangeSortField(next)
    else updateHomeListPrefs({ sortField: next, sortDir: next === 'name' ? 'asc' : 'desc' })
  }

  const toggleDir = () => {
    const next: HomeSortDir = sortDir === 'desc' ? 'asc' : 'desc'
    if (props.onChangeSortDir) props.onChangeSortDir(next)
    else updateHomeListPrefs({ sortDir: next })
  }

  const toggleView = () => {
    const next: HomeViewMode = viewMode === 'list' ? 'grid' : 'list'
    if (props.onChangeViewMode) props.onChangeViewMode(next)
    else updateHomeListPrefs({ viewMode: next })
  }

  const fieldLabel = sortField === 'date' ? t('homeListSortDate') : t('homeListSortName')
  const dirLabel = sortDir === 'desc' ? t('homeListSortDesc') : t('homeListSortAsc')
  const nextViewLabel = viewMode === 'list' ? t('homeListViewGrid') : t('homeListViewList')

  return (
    <div
      className="home-frame-list-bar"
      role="toolbar"
      aria-label={t('homeListSortLabel')}
      data-testid="home-list-toolbar"
    >
      <div className="home-frame-list-bar-sort">
        <button
          type="button"
          className="home-frame-sort-btn"
          data-testid="home-sort-field-btn"
          aria-label={`${t('homeListSortLabel')}: ${fieldLabel}`}
          onClick={toggleField}
        >
          <span>{fieldLabel}</span>
        </button>
        <button
          type="button"
          className="home-frame-sort-dir-btn"
          data-testid="home-sort-dir-btn"
          aria-label={dirLabel}
          title={dirLabel}
          aria-pressed={sortDir === 'asc'}
          onClick={toggleDir}
        >
          {sortDir === 'desc' ? (
            <HomeFrameSortDescIcon size={16} />
          ) : (
            <HomeFrameSortAscIcon size={16} />
          )}
        </button>
      </div>
      <button
        type="button"
        className="home-frame-view-btn"
        data-testid="home-view-mode-btn"
        aria-label={nextViewLabel}
        title={nextViewLabel}
        aria-pressed={viewMode === 'grid'}
        onClick={toggleView}
      >
        {viewMode === 'list' ? (
          <HomeFrameGridViewIcon size={20} />
        ) : (
          <HomeFrameListViewIcon size={20} />
        )}
      </button>
    </div>
  )
}
