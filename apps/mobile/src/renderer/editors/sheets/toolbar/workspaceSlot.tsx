/**
 * The toolbar area's share of the editor screen (XLS-T9): the edit toolbar
 * groups [셀 서식][행·열][정렬·필터][삽입] (edit mode, keyboard down; design
 * system 5.6) and the non-modal sheet each group opens, plus Find in the
 * More sheet (also in view mode: finding changes nothing).
 *
 * There is no [AI] item here: EditorShell draws [AI] at the bar's right end
 * only while AI is on, so with AI off the group buttons are the whole bar.
 *
 * The sheets themselves are a lazy chunk (ToolbarSheets.tsx): the desktop
 * ribbon modules load the first time a group opens.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import {
  IconCellFormat,
  IconFindCells,
  IconInsertCells,
  IconRowsColumns,
  IconSortFilter,
} from '../../../components/icons/sheets'
import type { MobileStringKey } from '../../../i18n'
import type { EditorQuickActionItem } from '../../../shell/EditorShell'
import { useViewportLayout } from '../../../shell/useViewportLayout'
import type { SheetsWorkspaceSlot } from '../workspace/slots'
import type { ToolbarPanel } from './panels'
import './toolbar.css'

const ToolbarSheets = lazy(() => import('./ToolbarSheets'))

const GROUP_BUTTONS: readonly {
  readonly panel: Exclude<ToolbarPanel, 'find'>
  readonly label: MobileStringKey
  readonly Icon: typeof IconCellFormat
}[] = [
  { panel: 'format', label: 'sheetsToolbarFormat', Icon: IconCellFormat },
  { panel: 'rows', label: 'sheetsToolbarRows', Icon: IconRowsColumns },
  { panel: 'sort', label: 'sheetsToolbarSort', Icon: IconSortFilter },
  { panel: 'insert', label: 'sheetsToolbarInsert', Icon: IconInsertCells },
]

export const useToolbarWorkspaceItems: SheetsWorkspaceSlot = ({ host, grid, mode, lang, t }) => {
  const [panel, setPanel] = useState<ToolbarPanel | null>(null)
  const { keyboardInsetPx } = useViewportLayout()
  const editing = mode === 'edit'
  const keyboardUp = keyboardInsetPx > 0

  // Leaving edit mode closes the edit sheets; Find stays (it reads only).
  useEffect(() => {
    if (!editing) setPanel((open) => (open === 'find' ? open : null))
  }, [editing])

  const quickActions = useMemo((): EditorQuickActionItem[] => {
    // The formula bar takes the keyboard's bar while a cell is typed in (XLS-T8).
    if (!editing || keyboardUp) return []
    return GROUP_BUTTONS.map(({ panel: id, label, Icon }) => ({
      id: `sheetsGroup-${id}`,
      label: t(label),
      icon: (
        <span className="m-sheets-tb-group" data-testid={`sheets-toolbar-${id}`}>
          <Icon size={20} />
          <span className="m-sheets-tb-group-label">{t(label)}</span>
        </span>
      ),
      onPress: () => setPanel((open) => (open === id ? null : id)),
    }))
  }, [editing, keyboardUp, t])

  const moreItems = useMemo(
    (): EditorQuickActionItem[] => [
      {
        id: 'sheetsFind',
        label: t('sheetsToolbarFind'),
        icon: <IconFindCells size={19} />,
        onPress: () => setPanel('find'),
      },
    ],
    [t],
  )

  const overlay =
    panel === null ? undefined : (
      <Suspense fallback={null}>
        <ToolbarSheets
          panel={panel}
          host={host}
          grid={grid}
          lang={lang}
          editing={editing}
          t={t}
          onOpen={setPanel}
          onClose={() => setPanel(null)}
        />
      </Suspense>
    )

  return { quickActions, moreItems, ...(overlay ? { overlay } : {}) }
}
