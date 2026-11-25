// The home's bottom tabs (design system 5.10). T6 owns this list and turns the tabs on; T3 owns ToolsTab.
import type { ComponentType } from 'react'
import { FoldersTab } from './FoldersTab'
import type { HomeHost } from './homeHost'
import { PDF_TOOLS_ID } from './prefsStore'
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

/** The home draws the tab bar (bottom tabs on compact, a rail from medium up). */
export const HOME_TABS_ENABLED = true

/** The tabs shown now: [Tools] goes away (rail included) while the PDF tools are turned off. */
export function visibleHomeTabs(isEditorOn: (id: string) => boolean): readonly HomeTabDef[] {
  return HOME_TABS.filter((tab) => tab.id !== 'tools' || isEditorOn(PDF_TOOLS_ID))
}
