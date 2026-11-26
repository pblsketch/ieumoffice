import type { Lang } from '@genoffice/i18n'
import type { WorkbookFile } from '../../../../../../sheets/src/shared/desktop-api'
import { setModuleLang } from '../../../../../../sheets/src/renderer/i18n/locale'
import { applyUniverLocale } from '../../../../../../sheets/src/renderer/univer-locales'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { createMobileUniver, installDesktopFormulaBar } from './createMobileUniver'
import { installExcelCompat } from './excelCompat'
import { installPinchZoom } from './pinchZoom'
import { installViewportStreaming, openLazyWorkbookOnPhone } from './lazyWorkbook'
import { pcUniverSync } from './pcGridModules'
import { installValueJournal } from '../save/journalRecorder'

export interface MobileGridOptions {
  readonly lang: Lang
  readonly darkMode: boolean
  /** Engine and load messages (the desktop shows them in its status bar). */
  readonly onMessage: (message: string) => void
  /** A cell edit was asked for while the document is in view mode. */
  readonly onEditRequestInView: () => void
  /** The cell editor opened or closed (the keyboard bar follows it). */
  readonly onCellEditing: (editing: boolean) => void
}

/**
 * One workbook's grid. The element Univer renders into outlives the React
 * view: the view attaches it while it is mounted and detaches it after
 * (the settings screen), so the grid is not rebuilt.
 */
export interface MobileGrid {
  readonly element: HTMLElement
  readonly runtime: UniverRuntime
  readonly lazyWorkbookRef: { current: LazyWorkbookState | null }
  load(file: WorkbookFile): Promise<void>
  setViewMode(view: boolean): void
  /** Re-measure after the element moved or the viewport changed size. */
  relayout(): void
  dispose(): void
}

let liveGrid: MobileGrid | null = null

/**
 * The app keeps one document open; a new grid replaces the previous one
 * (EditorDocument has no close hook yet, so the replaced grid is torn down here).
 */
export function createMobileGrid(options: MobileGridOptions): MobileGrid {
  liveGrid?.dispose()
  setModuleLang(options.lang)
  const element = document.createElement('div')
  element.className = 'm-sheets-grid-host'
  element.dataset.testid = 'sheets-grid'
  // Univer measures its container at start; it is parked in the page until the view adopts it.
  element.style.position = 'fixed'
  element.style.inset = '0'
  element.style.visibility = 'hidden'
  document.body.appendChild(element)
  const runtime = createMobileUniver({ container: element, darkMode: options.darkMode })
  // Sheet plugins start with the first workbook unit, and the installers below
  // resolve their services; the desktop boots on a blank workbook the same way
  // (loadWorkbookSkeleton disposes it when the file arrives).
  runtime.univerAPI.createWorkbook({})
  const formulaBar = installDesktopFormulaBar(runtime)
  const lazyWorkbookRef: { current: LazyWorkbookState | null } = { current: null }
  const disposeCompat = installExcelCompat(runtime, lazyWorkbookRef)
  void applyUniverLocale(runtime, options.lang)
  const disposeStreaming = installViewportStreaming(runtime, lazyWorkbookRef, options.onMessage)
  const disposePinch = installPinchZoom(element, runtime)
  const disposeJournal = installValueJournal(runtime, lazyWorkbookRef)

  let viewMode = true
  const api = runtime.univerAPI
  const beforeEdit = api.addEvent(api.Event.BeforeSheetEditStart, (params) => {
    if (!viewMode) return
    params.cancel = true
    options.onEditRequestInView()
  })
  const editStarted = api.addEvent(api.Event.SheetEditStarted, () => options.onCellEditing(true))
  const editEnded = api.addEvent(api.Event.SheetEditEnded, () => options.onCellEditing(false))

  let disposed = false
  const grid: MobileGrid = {
    element,
    runtime,
    lazyWorkbookRef,
    load: (file) => openLazyWorkbookOnPhone(runtime, lazyWorkbookRef, file, options.onMessage),
    setViewMode(view) {
      viewMode = view
      if (view) void api.getActiveWorkbook()?.endEditingAsync(true)
    },
    relayout() {
      window.dispatchEvent(new Event('resize'))
    },
    dispose() {
      if (disposed) return
      disposed = true
      beforeEdit.dispose()
      editStarted.dispose()
      editEnded.dispose()
      disposePinch()
      disposeJournal()
      formulaBar.dispose()
      disposeStreaming()
      disposeCompat()
      pcUniverSync.clearLazyState(lazyWorkbookRef.current)
      lazyWorkbookRef.current = null
      runtime.univer.dispose()
      element.remove()
      if (liveGrid === grid) liveGrid = null
    },
  }
  liveGrid = grid
  return grid
}
