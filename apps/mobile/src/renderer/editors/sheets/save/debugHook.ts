/**
 * Prototype driver hook (XLS-T3, no user interface): preview and emulator
 * scripts run a save through the desktop renderer's own save flow
 * (`handleSave`, apps/sheets/src/renderer/save-actions.ts) on the live grid,
 * so the phone's desktop API receives exactly the request the desktop would
 * send. The save screen replaces this with real entry points.
 */
import { sheetsTempSha256 } from '@genoffice/mobile-bridge/sheets'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'
import type {
  WorkbookFile,
  WorkbookSaveRequest,
} from '../../../../../../sheets/src/shared/desktop-api'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import type { MobileGrid } from '../grid/mobileGrid'
import type { MobileSaveOutcome } from './saveWorkbook'

/** The part of the desktop `SaveContext` the phone fills (the rest is optional there). */
interface PhoneSaveContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  setMessage: (message: string) => void
  openLazyWorkbook: (opened: WorkbookFile) => void | Promise<boolean>
  stashViewRestore: (view: unknown) => void
}

interface PcSaveActions {
  handleSave(
    ctx: PhoneSaveContext,
    mode: 'save' | 'ods',
    quiet?: boolean,
  ): Promise<{ ok: boolean; error?: string; request?: WorkbookSaveRequest }>
}

// Lazy glob, like grid/pcGridModules.ts: save-actions.ts reaches
// WorkbookVisuals.tsx through univer-sync.ts, which the phone's type check
// must not follow.
const saveActionModules = import.meta.glob<PcSaveActions>(
  '../../../../../../sheets/src/renderer/save-actions.ts',
)

async function pcSaveActions(): Promise<PcSaveActions> {
  const load = Object.values(saveActionModules)[0]
  if (!load) throw new Error('Desktop save module missing: save-actions.ts')
  return load()
}

function liveGrid(): MobileGrid {
  const grid = (window as unknown as { __ieumSheetsGrid?: MobileGrid }).__ieumSheetsGrid
  if (!grid) throw new Error('No spreadsheet grid is open.')
  return grid
}

function contextFor(grid: MobileGrid, messages: string[]): PhoneSaveContext {
  return {
    univerRef: { current: grid.runtime },
    lazyWorkbookRef: grid.lazyWorkbookRef,
    setMessage: (message) => messages.push(message),
    openLazyWorkbook: (file) => grid.load(file).then(() => true),
    stashViewRestore: () => undefined,
  }
}

let lastOutcome: MobileSaveOutcome | null = null

export function rememberSaveOutcome(outcome: MobileSaveOutcome): void {
  lastOutcome = outcome
}

function heapBytes(): number | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
  return memory?.usedJSHeapSize ?? null
}

export function installSheetsSaveProbeHook(client: MobileClient): void {
  ;(window as unknown as Record<string, unknown>).__ieumSheetsSave = {
    /** Writes a value into a cell of the active sheet the way typing does (a set-range-values mutation). */
    setCell(row: number, column: number, value: string | number) {
      const sheet = liveGrid().runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()
      if (!sheet) throw new Error('No active sheet.')
      sheet.getRange(row, column).setValue(value)
      return liveGrid().lazyWorkbookRef.current?.editJournal.cells.size ?? 0
    },
    /** The desktop save flow on the live grid (`handleSave(ctx, 'save', quiet)`). */
    async save() {
      const messages: string[] = []
      const started = performance.now()
      const result = await (
        await pcSaveActions()
      ).handleSave(contextFor(liveGrid(), messages), 'save', true)
      return {
        ok: result.ok,
        error: result.error ?? null,
        messages,
        ms: Math.round(performance.now() - started),
        outcome: lastOutcome,
        heapAfter: heapBytes(),
      }
    },
    /**
     * A save of the request the desktop flow builds when nothing changed
     * (`handleSave(ctx, 'ods')` assembles it without sending), sent straight
     * to the phone's save. The desktop sends an empty Save only as the
     * write-back of a restored recovery copy (`restoreWriteBack`; the shared
     * schema refuses any other empty save), so it goes that way here.
     */
    async saveUnchanged() {
      const messages: string[] = []
      const built = await (
        await pcSaveActions()
      ).handleSave(contextFor(liveGrid(), messages), 'ods', true)
      if (!built.request) throw new Error('The save request could not be built.')
      const answer = await window.desktopApi.saveWorkbookEdits({
        ...built.request,
        mode: 'save',
        restoreWriteBack: true,
      })
      if (!answer.canceled) await liveGrid().load(answer.file)
      return { canceled: answer.canceled, outcome: lastOutcome }
    },
    last: () => lastOutcome,
    /** Where the open's copy into the work folder spent its time. */
    copyTimings: async () => (await import('../desktop-api/open')).lastWorkingCopy,
    /** Bytes the in-memory file layer holds now and at most (since the last save began). */
    vfsStats: async () => (await import('../node-shims/vfs')).mobileVfs.stats(),
    sha256: (path: string) => sheetsTempSha256(client, path),
  }
}
