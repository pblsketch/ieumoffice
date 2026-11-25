// The home's bottom tabs (design system 5.10). T6 owns this list and turns the tabs on; T3 owns ToolsTab.
import type { ComponentType } from 'react'
import { FoldersTab } from './FoldersTab'
import type { HomeHost } from './homeHost'
import { ToolsTab } from './ToolsTab'

export type HomeTabId = 'recent' | 'folders' | 'tools' | 'settings'

export interface HomeTabProps {
  readonly host: HomeHost
}

export interface HomeTabDef {
  readonly id: HomeTabId
  /** null: the tab's content is drawn by the home screen itself (recent list, settings entry). */
  readonly Component: ComponentType<HomeTabProps> | null
}

export const HOME_TABS: readonly HomeTabDef[] = [
  { id: 'recent', Component: null },
  { id: 'folders', Component: FoldersTab },
  { id: 'tools', Component: ToolsTab },
  { id: 'settings', Component: null },
]

/** Off until T6 draws the tab bar; the home screen looks as before. */
export const HOME_TABS_ENABLED = false
