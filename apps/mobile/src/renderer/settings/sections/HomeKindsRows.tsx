// Owner: track T6. "New documents on the home screen" rows: show switch and up/down per card (spec 3.11).
import { useId } from 'react'
import type { EditorKind } from '../../editors/editorKind'
import { EDITOR_KINDS } from '../../editors/registry'
import { IconChevronDown } from '../../components/MobileIcons'
import { useHomeRuntime } from '../../home/homeRuntime'
import { updateHomePrefs } from '../../home/prefsStore'
import { useMobileLocale } from '../../i18n'
import {
  cardLabel,
  homeCardItemsOf,
  moveCardItem,
  setCardHidden,
  visibleCardOrder,
} from './homeSettingsModel'
import { useSettingsPrefs } from './settingsHooks'
import './homeSettings.css'

export interface HomeKindsRowsProps {
  /** The registry's kinds; tests may pass their own. */
  readonly kinds?: readonly EditorKind[]
}

export function HomeKindsRows({ kinds = EDITOR_KINDS }: HomeKindsRowsProps) {
  const { t } = useMobileLocale()
  const runtime = useHomeRuntime()
  const { prefs, isEditorOn } = useSettingsPrefs()
  const titleId = useId()

  const items = homeCardItemsOf(kinds)
  const allIds = items.map((item) => item.id)
  // Cards of turned-off editors are left out here; their stored values stay untouched.
  const shownIds = items.filter((item) => isEditorOn(item.kind.id)).map((item) => item.id)
  const order = visibleCardOrder(allIds, prefs.homeKindsOrder, shownIds)
  if (order.length === 0) return null

  const fail = () => runtime?.showToast({ message: t('homeSetFailed'), tone: 'error' })
  const move = (id: string, delta: -1 | 1) => {
    const next = moveCardItem(allIds, prefs.homeKindsOrder, shownIds, id, delta)
    if (next) updateHomePrefs({ homeKindsOrder: next }).catch(fail)
  }
  const show = (id: string, visible: boolean) => {
    updateHomePrefs({ homeKindsHidden: setCardHidden(prefs.homeKindsHidden, id, !visible) }).catch(
      fail,
    )
  }

  return (
    <div className="home-set-group" role="group" aria-labelledby={titleId}>
      <div className="home-set-group-head">
        <span id={titleId} className="mobile-set-label">
          {t('homeSetCardsTitle')}
        </span>
      </div>
      {order.map((id, index) => {
        const item = items.find((entry) => entry.id === id)
        if (!item) return null
        const name = cardLabel(item, t)
        return (
          <div
            key={id}
            className="mobile-set-row home-set-subrow"
            data-testid={`home-set-card-row-${id}`}
          >
            <span className="home-set-name">{name}</span>
            <span className="home-set-row-controls">
              <button
                type="button"
                className="mobile-icon-btn"
                aria-label={t('homeSetCardUp', { name })}
                title={t('homeSetCardUp', { name })}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                <IconChevronDown size={18} className="home-set-icon-up" />
              </button>
              <button
                type="button"
                className="mobile-icon-btn"
                aria-label={t('homeSetCardDown', { name })}
                title={t('homeSetCardDown', { name })}
                disabled={index === order.length - 1}
                onClick={() => move(id, 1)}
              >
                <IconChevronDown size={18} />
              </button>
              <input
                type="checkbox"
                role="switch"
                className="mobile-switch"
                aria-label={t('homeSetCardShow', { name })}
                checked={!prefs.homeKindsHidden.includes(id)}
                onChange={(e) => show(id, e.target.checked)}
                data-testid={`home-set-card-show-${id}`}
              />
            </span>
          </div>
        )
      })}
    </div>
  )
}
