/**
 * The grid area's share of the editor screen (owned by XLS-T8): undo and
 * redo (they go to the app bar) and the freeze items of the More sheet.
 */
import { useMemo } from 'react'
import { IconFreezeColumn, IconFreezeRow, IconUnfreeze } from '../../../components/icons/sheets'
import type { EditorQuickActionItem } from '../../../shell/EditorShell'
import type { SheetsWorkspaceSlot } from '../workspace/slots'

export const useGridWorkspaceItems: SheetsWorkspaceSlot = ({ grid, t }) => {
  const quickActions = useMemo(
    (): EditorQuickActionItem[] => [
      { id: 'undo', label: t('undo'), onPress: () => grid.handle?.undo() },
      { id: 'redo', label: t('redo'), onPress: () => grid.handle?.redo() },
    ],
    [grid, t],
  )
  const moreItems = useMemo(
    (): EditorQuickActionItem[] => [
      {
        id: 'freezeTopRow',
        label: t('sheetsFreezeTopRow'),
        icon: <IconFreezeRow size={19} />,
        onPress: () => grid.handle?.freeze('row'),
      },
      {
        id: 'freezeFirstColumn',
        label: t('sheetsFreezeFirstColumn'),
        icon: <IconFreezeColumn size={19} />,
        onPress: () => grid.handle?.freeze('column'),
      },
      {
        id: 'unfreeze',
        label: t('sheetsUnfreeze'),
        icon: <IconUnfreeze size={19} />,
        onPress: () => grid.handle?.freeze('none'),
      },
    ],
    [grid, t],
  )
  return { quickActions, moreItems }
}
