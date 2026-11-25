import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { IconClose, IconMore } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import { usePdfToolsLink } from '../pdfToolsLink'
import { PDF_TOOLS_ID, useHomePrefs } from '../prefsStore'
import { actionIcon, actionLabelKey } from './actionLabels'
import { selectionBarActions } from './items'
import type { HomeBulkAction, HomeFileItem, HomeListKind } from './types'
import './homeActions.css'

export interface HomeSelectionHeaderProps {
  readonly count: number
  /** [close]; Back does the same through useHomeSelection's layer. */
  readonly onClose: () => void
}

/** Top of selection mode: "n selected" and [close] (spec 3.7). Takes the app bar's place. */
export function HomeSelectionHeader({ count, onClose }: HomeSelectionHeaderProps) {
  const { t } = useMobileLocale()
  return (
    <div className="home-act-selection-header" data-testid="home-act-selection-header">
      <button
        type="button"
        className="mobile-icon-btn"
        data-testid="home-act-selection-close"
        aria-label={t('homeActCloseSelection')}
        title={t('homeActCloseSelection')}
        onClick={onClose}
      >
        <IconClose size={20} />
      </button>
      <span className="home-act-selection-count" role="status" aria-live="polite">
        {t('homeActSelectedCount', { count })}
      </span>
    </div>
  )
}

export interface HomeSelectionBarProps {
  readonly listKind: HomeListKind
  /** Picked rows in pick order. */
  readonly items: readonly HomeFileItem[]
  readonly onAction: (action: HomeBulkAction) => void
}

/**
 * Bottom bar of selection mode (spec 3.7). [merge] / [make PDF] appear only while PDF tools are on
 * and T3 has linked its tools screen.
 */
export function HomeSelectionBar({ listKind, items, onAction }: HomeSelectionBarProps) {
  const { t } = useMobileLocale()
  const { isEditorOn } = useHomePrefs()
  const link = usePdfToolsLink()
  const [moreOpen, setMoreOpen] = useState(false)
  const layout = selectionBarActions(items, {
    listKind,
    pdfToolsReady: link !== null && isEditorOn(PDF_TOOLS_ID),
  })

  return (
    <>
      <div
        className="home-act-bar"
        role="toolbar"
        aria-label={t('homeActBarLabel')}
        data-testid="home-act-bar"
      >
        {layout.bar.map((action) => (
          <button
            key={action}
            type="button"
            className="home-act-bar-btn"
            data-testid={`home-act-bar-${action}`}
            disabled={items.length === 0}
            onClick={() => onAction(action)}
          >
            {actionIcon(action, 20)}
            <span>{t(actionLabelKey(action, true))}</span>
          </button>
        ))}
        {layout.more.length > 0 && (
          <button
            type="button"
            className="home-act-bar-btn"
            data-testid="home-act-bar-more"
            aria-haspopup="dialog"
            disabled={items.length === 0}
            onClick={() => setMoreOpen(true)}
          >
            <IconMore size={20} />
            <span>{t('homeActMore')}</span>
          </button>
        )}
      </div>
      <Sheet
        open={moreOpen}
        title={t('homeActSelectedCount', { count: items.length })}
        closeLabel={t('homeActCancel')}
        onClose={() => setMoreOpen(false)}
        testId="home-act-bar-more-sheet"
      >
        <div className="mobile-menu-stack">
          {layout.more.map((action) => (
            <button
              key={action}
              type="button"
              className={
                action === 'delete'
                  ? 'mobile-menu-row-btn mobile-btn-danger-text'
                  : 'mobile-menu-row-btn'
              }
              data-testid={`home-act-more-${action}`}
              onClick={() => {
                setMoreOpen(false)
                onAction(action)
              }}
            >
              {actionIcon(action, 19)}
              <span>{t(actionLabelKey(action))}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}
