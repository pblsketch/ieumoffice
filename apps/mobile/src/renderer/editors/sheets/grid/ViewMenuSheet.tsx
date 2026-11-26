/**
 * The spreadsheet's view menu (spec 2.2: "맨 위 행·첫 열 틀 고정은 보기
 * 메뉴에 둔다"): freeze the top row, freeze the first column, or unfreeze,
 * with the current state marked. Freezing is saved in the file (the edit
 * journal records it as a page setup change, as on the desktop), so the
 * menu is offered only on a document that can be edited (grid/workspaceSlot.tsx).
 */
import type { ReactNode } from 'react'
import type { Lang } from '@genoffice/i18n'
import { Sheet } from '../../../components/Sheet'
import { IconFreezeColumn, IconFreezeRow, IconUnfreeze } from '../../../components/icons/sheets'
import { translateMobile, type MobileStringKey } from '../../../i18n'
import type { UniverRuntime } from '../../../../../../sheets/src/renderer/univer-state'

export type FreezeChoice = 'row' | 'column' | 'none'

/** The active sheet's frozen rows and columns (0 when none). */
export function readFreeze(runtime: UniverRuntime | null): { rows: number; columns: number } {
  const sheet = runtime?.univerAPI.getActiveWorkbook()?.getActiveSheet()
  if (!sheet) return { rows: 0, columns: 0 }
  return { rows: sheet.getFrozenRows(), columns: sheet.getFrozenColumns() }
}

/**
 * Applies one choice the way the menu promises: the top row alone, the first
 * column alone, or nothing frozen. (Univer's setFrozenRows keeps the columns,
 * so the other side is cleared explicitly.)
 */
export function applyFreeze(runtime: UniverRuntime, choice: FreezeChoice): void {
  const sheet = runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
  if (!sheet) return
  if (choice === 'none') {
    sheet.cancelFreeze()
    return
  }
  sheet.setFreeze({
    startRow: choice === 'row' ? 1 : -1,
    startColumn: choice === 'column' ? 1 : -1,
    ySplit: choice === 'row' ? 1 : 0,
    xSplit: choice === 'column' ? 1 : 0,
  })
}

export interface ViewMenuSheetProps {
  readonly open: boolean
  readonly runtime: UniverRuntime | null
  readonly lang: Lang
  readonly onClose: () => void
}

export function ViewMenuSheet({ open, runtime, lang, onClose }: ViewMenuSheetProps) {
  const t = (key: MobileStringKey) => translateMobile(lang, key)
  const { rows, columns } = readFreeze(open ? runtime : null)
  const entries: readonly {
    id: FreezeChoice
    key: MobileStringKey
    icon: ReactNode
    on: boolean
  }[] = [
    {
      id: 'row',
      key: 'sheetsFreezeTopRow',
      icon: <IconFreezeRow size={19} />,
      on: rows === 1 && columns === 0,
    },
    {
      id: 'column',
      key: 'sheetsFreezeFirstColumn',
      icon: <IconFreezeColumn size={19} />,
      on: columns === 1 && rows === 0,
    },
    {
      id: 'none',
      key: 'sheetsUnfreeze',
      icon: <IconUnfreeze size={19} />,
      on: rows === 0 && columns === 0,
    },
  ]
  return (
    <Sheet
      open={open}
      title={t('sheetsViewMenu')}
      closeLabel={t('cancel')}
      onClose={onClose}
      testId="sheets-view-menu"
    >
      <div className="mobile-menu-stack" role="menu" aria-label={t('sheetsViewMenu')}>
        {runtime &&
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.on}
              className="mobile-menu-row-btn m-sheets-view-row"
              onClick={() => {
                onClose()
                applyFreeze(runtime, entry.id)
              }}
              data-testid={`sheets-view-freeze-${entry.id}`}
            >
              {entry.icon}
              <span>{t(entry.key)}</span>
            </button>
          ))}
      </div>
    </Sheet>
  )
}
