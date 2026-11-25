import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import { actionIcon, actionLabelKey } from './actionLabels'
import { rowMenuActions } from './items'
import type { HomeFileItem, HomeListKind, HomeRowAction } from './types'
import './homeActions.css'

export interface HomeRowMenuProps {
  /** The row whose [⋯] was pressed; null keeps the menu closed. */
  readonly item: HomeFileItem | null
  readonly listKind: HomeListKind
  readonly onClose: () => void
  /** Runs after the menu closed. */
  readonly onAction: (action: HomeRowAction, item: HomeFileItem) => void
}

/** A row's [⋯] menu as a modal sheet list (design system 5.8), items per spec 3.6. */
export function HomeRowMenu({ item, listKind, onClose, onAction }: HomeRowMenuProps) {
  const { t } = useMobileLocale()
  const actions = item ? rowMenuActions(item, listKind) : []
  return (
    <Sheet
      open={item !== null}
      title={item?.name ?? ''}
      closeLabel={t('homeActCancel')}
      onClose={onClose}
      testId="home-act-menu"
    >
      <div className="mobile-menu-stack">
        {item &&
          actions.map((action) => (
            <button
              key={action}
              type="button"
              className={
                action === 'delete'
                  ? 'mobile-menu-row-btn mobile-btn-danger-text'
                  : 'mobile-menu-row-btn'
              }
              data-testid={`home-act-menu-${action}`}
              onClick={() => {
                onClose()
                onAction(action, item)
              }}
            >
              {actionIcon(action, 19)}
              <span>{t(actionLabelKey(action))}</span>
            </button>
          ))}
      </div>
    </Sheet>
  )
}
