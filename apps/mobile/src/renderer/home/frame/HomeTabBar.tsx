import type { ReactNode } from 'react'
import { HomeFrameToolsIcon } from '../../components/icons/home'
import { IconFolderOpen, IconHistory, IconSettings } from '../../components/MobileIcons'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import type { HomeTabDef, HomeTabId } from '../homeTabs'
import './homeFrame.css'

const TAB_LABELS: Readonly<Record<HomeTabId, MobileStringKey>> = {
  recent: 'homeTabRecent',
  folders: 'homeTabFolders',
  tools: 'homeTabTools',
  settings: 'homeTabSettings',
}

function tabIcon(id: HomeTabId): ReactNode {
  switch (id) {
    case 'recent':
      return <IconHistory size={22} />
    case 'folders':
      return <IconFolderOpen size={22} />
    case 'tools':
      return <HomeFrameToolsIcon size={22} />
    case 'settings':
      return <IconSettings size={22} />
  }
}

export interface HomeTabBarProps {
  readonly tabs: readonly HomeTabDef[]
  readonly current: HomeTabId
  /** 'bottom': tabs under the content (compact); 'rail': a column on the left (medium and up). */
  readonly variant: 'bottom' | 'rail'
  readonly onSelect: (id: HomeTabId) => void
}

/**
 * The home's four destinations (spec 3.1, design system 5.10). A navigation landmark whose current
 * item carries aria-current; [Settings] leaves the home, so it never shows as current.
 */
export function HomeTabBar({ tabs, current, variant, onSelect }: HomeTabBarProps) {
  const { t } = useMobileLocale()
  return (
    <nav
      className={`home-frame-tabs home-frame-tabs-${variant}`}
      aria-label={t('homeTabNav')}
      data-testid={variant === 'rail' ? 'home-tab-rail' : 'home-tab-bar'}
    >
      {tabs.map((tab) => {
        const active = tab.id === current
        return (
          <button
            key={tab.id}
            type="button"
            className="home-frame-tab"
            data-testid={`home-tab-${tab.id}`}
            data-active={active ? 'true' : undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
          >
            <span className="home-frame-tab-icon" aria-hidden="true">
              {tabIcon(tab.id)}
            </span>
            <span className="home-frame-tab-label">{t(TAB_LABELS[tab.id])}</span>
          </button>
        )
      })}
    </nav>
  )
}
