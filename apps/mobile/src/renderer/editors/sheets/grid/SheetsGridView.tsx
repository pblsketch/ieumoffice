/**
 * The grid screen of the provisional spreadsheet kind (lazy chunk: Univer and
 * the reused PC grid modules load only when a workbook opens).
 */
import { useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileTheme } from '@genoffice/mobile-bridge/transport'
import type { EditorHost } from '../../editorKind'
import type { OpenedSheetsWorkbook } from '../session'
import { FormulaKeyboardBar } from './FormulaKeyboardBar'
import { createMobileGrid, type MobileGrid } from './mobileGrid'
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
  readonly handleRef: { current: SheetsGridHandle | null }
}

function prefersDark(theme: MobileTheme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** One grid per opened workbook, kept while the workbook stays open (also off screen). */
const grids = new WeakMap<OpenedSheetsWorkbook, MobileGrid>()

export default function SheetsGridView({
  opened,
  host,
  mode,
  lang,
  theme,
  onEnterEdit,
  handleRef,
}: SheetsGridViewProps) {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)
  const onEnterEditRef = useRef(onEnterEdit)
  onEnterEditRef.current = onEnterEdit

  useEffect(() => {
    let grid = grids.get(opened)
    if (!grid) {
      grid = createMobileGrid({
        lang,
        darkMode: prefersDark(theme),
        onMessage: (message) => console.info('[sheets]', message),
        onEditRequestInView: () => onEnterEditRef.current(),
        onCellEditing: (next) => setEditing(next),
      })
      grids.set(opened, grid)
      const started = performance.now()
      void grid.load(opened.file).then(() => {
        ;(window as unknown as Record<string, unknown>).__ieumSheetsFirstWindowMs =
          performance.now() - started
      })
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
    handleRef.current = {
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
    // Diagnostics hook for the prototype drivers (preview and emulator).
    ;(window as unknown as Record<string, unknown>).__ieumSheetsGrid = live
    return () => {
      handleRef.current = null
      // Detach only: the grid lives as long as the workbook (back from settings re-attaches it).
      live.element.remove()
    }
  }, [opened, handleRef, lang, theme])

  useEffect(() => {
    grids.get(opened)?.setViewMode(mode === 'view')
  }, [opened, mode])

  // The provisional kind does not save: the grid's edits stay on screen only.
  void host

  const grid = grids.get(opened)
  return (
    <div className="m-sheets-stage" data-testid="sheets-stage">
      <div ref={slotRef} className="m-sheets-slot" />
      {editing && grid && mode === 'edit' && <FormulaKeyboardBar grid={grid} lang={lang} />}
    </div>
  )
}
