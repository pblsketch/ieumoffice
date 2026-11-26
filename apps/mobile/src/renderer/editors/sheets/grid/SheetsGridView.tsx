/**
 * The spreadsheet grid screen (lazy chunk: Univer and the reused PC grid
 * modules load only when a workbook opens). The grid itself belongs to the
 * document (`SheetsGridAccess.grid`): this view builds it on first mount,
 * attaches it while mounted and detaches it after (the settings screen), and
 * the document's `dispose()` tears it down.
 */
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileTheme } from '@genoffice/mobile-bridge/transport'
import type { EditorHost } from '../../editorKind'
import type { OpenedSheetsWorkbook } from '../session'
import type { SheetsGridAccess } from '../workspace/slots'
import { FormulaKeyboardBar } from './FormulaKeyboardBar'
import { createMobileGrid } from './mobileGrid'
import '../sheets.css'

export interface SheetsGridHandle {
  freeze(kind: 'row' | 'column' | 'none'): void
  undo(): void
  redo(): void
  resetZoom(): void
}

export interface SheetsGridViewProps {
  readonly opened: OpenedSheetsWorkbook
  readonly host: EditorHost
  readonly mode: DocumentMode
  readonly lang: Lang
  readonly theme: MobileTheme
  readonly onEnterEdit: () => void
  readonly access: SheetsGridAccess
}

function prefersDark(theme: MobileTheme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function SheetsGridView({
  opened,
  host,
  mode,
  lang,
  theme,
  onEnterEdit,
  access,
}: SheetsGridViewProps) {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)
  const onEnterEditRef = useRef(onEnterEdit)
  onEnterEditRef.current = onEnterEdit

  useEffect(() => {
    let grid = access.grid
    if (!grid) {
      grid = createMobileGrid({
        lang,
        darkMode: prefersDark(theme),
        onMessage: (message) => console.info('[sheets]', message),
        onEditRequestInView: () => onEnterEditRef.current(),
        onCellEditing: (next) => setEditing(next),
        onEdited: () => {
          host.markDirty(true)
          host.contentChanged()
        },
        onNotice: (message) => host.showToast(message),
      })
      access.grid = grid
      void grid.load(opened.file)
    }
    const slot = slotRef.current
    if (slot) {
      grid.element.style.position = ''
      grid.element.style.inset = ''
      grid.element.style.visibility = ''
      slot.appendChild(grid.element)
      grid.relayout()
    }
    const live = grid
    access.handle = {
      freeze(kind) {
        const sheet = live.runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
        if (!sheet) return
        if (kind === 'none') sheet.cancelFreeze()
        else if (kind === 'row') sheet.setFrozenRows(1)
        else sheet.setFrozenColumns(1)
      },
      undo: () => void live.runtime.univerAPI.undo(),
      redo: () => void live.runtime.univerAPI.redo(),
      resetZoom: () => live.runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()?.zoom(1),
    }
    return () => {
      access.handle = null
      // Detach only: the grid lives as long as the document (back from settings re-attaches it).
      live.element.remove()
    }
  }, [opened, host, access, lang, theme])

  useEffect(() => {
    access.grid?.setViewMode(mode === 'view')
  }, [access, mode])

  const grid = access.grid
  return (
    <div className="m-sheets-stage" data-testid="sheets-stage">
      <div ref={slotRef} className="m-sheets-slot" />
      {editing && grid && mode === 'edit' && <FormulaKeyboardBar grid={grid} lang={lang} />}
    </div>
  )
}
