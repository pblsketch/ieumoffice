/**
 * The spreadsheet editor screen: EditorShell with what the four areas
 * contribute (grid, toolbar, save, AI; see slots.ts) and the grid, a lazy
 * chunk with its own Suspense (App does not wrap editors in one).
 * Later tasks change their area's slot file, not this one.
 */
import { Suspense, lazy, useCallback, type ComponentType } from 'react'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import { EditorShell } from '../../../shell/EditorShell'
import type { EditorHost, EditorWorkspaceProps } from '../../editorKind'
import { useAiWorkspaceItems } from '../ai/workspaceSlot'
import { useGridWorkspaceItems } from '../grid/workspaceSlot'
import { useSaveWorkspaceItems } from '../save/workspaceSlot'
import type { OpenedSheetsWorkbook } from '../session'
import { useToolbarWorkspaceItems } from '../toolbar/workspaceSlot'
import { joinWorkspaceItems, type SheetsGridAccess } from './slots'

const SheetsGridView = lazy(() => import('../grid/SheetsGridView'))

export function createSheetsWorkspace(
  host: EditorHost,
  opened: OpenedSheetsWorkbook,
  grid: SheetsGridAccess,
): ComponentType<EditorWorkspaceProps> {
  return function SheetsWorkspace({ frame, mode, canEdit, lang, theme }: EditorWorkspaceProps) {
    const t = useCallback((key: MobileStringKey) => translateMobile(lang, key), [lang])
    const context = { host, opened, grid, mode, canEdit, lang, theme, t }
    // The areas in the order their items appear (each slot is a hook).
    const items = joinWorkspaceItems([
      useGridWorkspaceItems(context),
      useToolbarWorkspaceItems(context),
      useSaveWorkspaceItems(context),
      useAiWorkspaceItems(context),
    ])
    return (
      <EditorShell
        {...frame}
        quickActions={items.quickActions}
        formatGroups={items.formatGroups.length > 0 ? items.formatGroups : undefined}
        moreItems={items.moreItems}
        viewTools={items.viewTools}
        onFitToWidth={() => grid.handle?.resetZoom()}
      >
        <Suspense
          fallback={
            <div className="m-sheets-loading" role="status">
              {t('sheetsLoading')}
            </div>
          }
        >
          <SheetsGridView
            opened={opened}
            host={host}
            mode={mode}
            lang={lang}
            theme={theme}
            onEnterEdit={frame.onEnterEdit}
            access={grid}
          />
        </Suspense>
        {items.overlays}
      </EditorShell>
    )
  }
}
