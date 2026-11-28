/**
 * The grid area's share of the editor screen (owned by XLS-T8): undo and
 * redo (they go to the app bar) and the view menu with the freeze choices
 * (spec 2.2), reachable from the More sheet in both modes (a floating view
 * tool would sit over the sheet switcher and the cells). The header menu, the sheet switcher and the keyboard bar live with
 * the grid itself (SheetsGridView.tsx), since they follow its gestures.
 */
import { useCallback, useMemo, useState } from 'react'
import { IconFreezeRow } from '../../../components/icons/sheets'
import type { EditorQuickActionItem } from '../../../shell/EditorShell'
import type { SheetsWorkspaceSlot } from '../workspace/slots'
import { ViewMenuSheet } from './ViewMenuSheet'

export const useGridWorkspaceItems: SheetsWorkspaceSlot = ({ grid, canEdit, lang, t }) => {
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const closeViewMenu = useCallback(() => setViewMenuOpen(false), [])
  const quickActions = useMemo(
    (): EditorQuickActionItem[] => [
      { id: 'undo', label: t('undo'), onPress: () => grid.handle?.undo() },
      { id: 'redo', label: t('redo'), onPress: () => grid.handle?.redo() },
    ],
    [grid, t],
  )
  const viewMenuItem = useMemo(
    (): EditorQuickActionItem[] =>
      canEdit
        ? [
            {
              id: 'sheetsViewMenu',
              label: t('sheetsViewMenu'),
              icon: <IconFreezeRow size={19} />,
              onPress: () => setViewMenuOpen(true),
            },
          ]
        : [],
    [canEdit, t],
  )
  return {
    quickActions,
    moreItems: viewMenuItem,
    overlay: (
      <ViewMenuSheet
        key="sheets-view-menu"
        open={viewMenuOpen}
        runtime={grid.grid?.runtime ?? null}
        lang={lang}
        onClose={closeViewMenu}
      />
    ),
  }
}
