/**
 * Electron IPC and native file-dialog handlers for the app-wide Hangul macro
 * store (`hwp:macros-*` channels).
 *
 * Security invariants:
 * - Every handler verifies `host.hasView(e.sender.id)` before reading or mutating.
 * - Import and export file paths are always chosen via main-process native dialogs;
 *   the renderer never supplies arbitrary filesystem paths.
 * - Import picking returns a read-only preview and never writes to disk until
 *   `hwp:macros-commit-import` is explicitly invoked after user review.
 * - Export guards against silent overwrite when appending `.ieummacro` resolves
 *   to an existing file different from the raw dialog path.
 */
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import {
  configuredDefaultSaveDir,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
} from '@genoffice/electron-utils'
import type { PathProvider, SettingsPathProvider } from '@genoffice/electron-utils'
import { HWP_CHANNELS } from '../shared/ipc'
import type {
  MacroAddResult,
  MacroAssignSlotResult,
  MacroCommitImportResult,
  MacroDeleteResult,
  MacroExportFileResult,
  MacroPickImportFileResult,
  MacroSyntaxChecker,
  MacroUpdateResult,
  MacrosReadStateResult,
} from '../shared/ipc'
import { tm } from './dialog-strings'
import {
  MACRO_FILE_EXT,
  addMacro,
  assignMacroSlot,
  commitMacroImport,
  deleteMacro,
  previewMacroFileImport,
  readMacrosState,
  updateMacro,
  writeMacroExportFile,
} from './macros'

export interface HwpMacrosHost {
  app: PathProvider & SettingsPathProvider
  hasView: (webContentsId: number) => boolean
  getWindow: (sender: WebContents) => BrowserWindow | null
  broadcast: (channel: string, payload: unknown) => void
  /** Optional syntax checker used to annotate imported macro previews with line/column errors. */
  syntaxChecker?: MacroSyntaxChecker
  /** Optional overwrite prompt override used when appending `.ieummacro` collides with an existing file. */
  confirmOverwrite?: (targetPath: string) => Promise<boolean>
}

const UNAUTHORIZED = {
  ok: false as const,
  reason: 'unauthorized' as const,
  error: 'hwp: unauthorized sender',
}

const MACRO_EXT_NO_DOT = MACRO_FILE_EXT.replace(/^\./, '')
const INVALID_FILENAME_CHARS_RE = /[<>:"/\\|?*]/g

function ensureExtension(filePath: string, ext: string): string {
  return filePath.toLowerCase().endsWith(`.${ext}`) ? filePath : `${filePath}.${ext}`
}

function sanitizeExportFileStem(name: string, fallback: string): string {
  let noControls = ''
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    noControls += code < 0x20 || code === 0x7f ? ' ' : name[i]
  }
  const cleaned = noControls
    .replace(INVALID_FILENAME_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim()
  return cleaned || fallback
}

async function defaultConfirmOverwrite(
  targetPath: string,
  parent: BrowserWindow | undefined,
): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    title: tm('dlgBibOverwriteTitle'),
    message: tm('dlgBibOverwriteMsg', { name: basename(targetPath) }),
    detail: tm('dlgBibOverwriteDetail'),
    buttons: [tm('btnOverwrite'), tm('btnCancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
  return response === 0
}

/** Register all `hwp:macros-*` IPC handlers for Hangul editor views. */
export function registerHwpMacrosIpc(host: HwpMacrosHost): void {
  const resolveParentWindow = (sender: WebContents): BrowserWindow | undefined =>
    host.getWindow(sender) ?? BrowserWindow.getFocusedWindow() ?? undefined

  ipcMain.handle(HWP_CHANNELS.macrosReadState, (e): MacrosReadStateResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    return readMacrosState(host.app)
  })

  ipcMain.handle(HWP_CHANNELS.macrosAdd, (e, input: unknown): MacroAddResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = addMacro(host.app, input)
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.macrosChanged, result.macros)
    }
    return result
  })

  ipcMain.handle(HWP_CHANNELS.macrosUpdate, (e, id: unknown, patch: unknown): MacroUpdateResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = updateMacro(host.app, id, patch)
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.macrosChanged, result.macros)
    }
    return result
  })

  ipcMain.handle(HWP_CHANNELS.macrosDelete, (e, id: unknown): MacroDeleteResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = deleteMacro(host.app, id)
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.macrosChanged, result.macros)
    }
    return result
  })

  ipcMain.handle(
    HWP_CHANNELS.macrosAssignSlot,
    (e, id: unknown, slot: unknown): MacroAssignSlotResult => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      const result = assignMacroSlot(host.app, id, slot)
      if (result.ok) {
        host.broadcast(HWP_CHANNELS.macrosChanged, result.macros)
      }
      return result
    },
  )

  ipcMain.handle(
    HWP_CHANNELS.macrosPickImportFile,
    async (e): Promise<MacroPickImportFileResult> => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      const state = readMacrosState(host.app)
      if (!state.ok) return state
      const parent = resolveParentWindow(e.sender)
      const picked = await showOpenDialogWithMemory(dialog, parent, {
        title: tm('dlgMacroImportTitle'),
        filters: [
          { name: tm('filterMacroFile'), extensions: [MACRO_EXT_NO_DOT] },
          { name: tm('filterAll'), extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: true, canceled: true }
      }
      return previewMacroFileImport(picked.filePaths[0], {
        syntaxChecker: host.syntaxChecker,
      })
    },
  )

  ipcMain.handle(HWP_CHANNELS.macrosCommitImport, (e, input: unknown): MacroCommitImportResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = commitMacroImport(host.app, input)
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.macrosChanged, result.macros)
    }
    return result
  })

  ipcMain.handle(
    HWP_CHANNELS.macrosExportFile,
    async (e, id: unknown): Promise<MacroExportFileResult> => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      if (typeof id !== 'string' || !id.trim()) {
        return { ok: false, reason: 'invalid_input', error: 'Macro id is required' }
      }
      const state = readMacrosState(host.app)
      if (!state.ok) return state
      const targetId = id.trim()
      const macro = state.macros.find((item) => item.id === targetId)
      if (!macro) {
        return { ok: false, reason: 'not_found', error: `Macro not found: ${targetId}` }
      }

      const parent = resolveParentWindow(e.sender)
      const stem = sanitizeExportFileStem(macro.name, tm('macroDefaultFileName'))
      const defaultPath = join(configuredDefaultSaveDir(host.app), `${stem}${MACRO_FILE_EXT}`)
      const picked = await showSaveDialogWithMemory(dialog, parent, {
        title: tm('dlgMacroExportTitle'),
        defaultPath,
        filters: [
          { name: tm('filterMacroFile'), extensions: [MACRO_EXT_NO_DOT] },
          { name: tm('filterAll'), extensions: ['*'] },
        ],
      })
      if (picked.canceled || !picked.filePath) {
        return { ok: true, canceled: true }
      }

      const targetPath = ensureExtension(picked.filePath, MACRO_EXT_NO_DOT)
      // The OS save dialog only checked overwrite for `picked.filePath`; if appending the
      // extension resolves to a different existing file, explicitly confirm before writing.
      if (targetPath !== picked.filePath && existsSync(targetPath)) {
        if (host.confirmOverwrite) {
          const confirmed = await host.confirmOverwrite(targetPath)
          if (!confirmed) {
            return { ok: true, canceled: true }
          }
        } else if (typeof dialog?.showMessageBox !== 'function') {
          return {
            ok: false,
            reason: 'file_exists',
            error: `Export target already exists: ${targetPath}`,
          }
        } else {
          try {
            const confirmed = await defaultConfirmOverwrite(targetPath, parent)
            if (!confirmed) {
              return { ok: true, canceled: true }
            }
          } catch {
            return {
              ok: false,
              reason: 'file_exists',
              error: `Export target already exists: ${targetPath}`,
            }
          }
        }
      }

      return writeMacroExportFile(targetPath, macro)
    },
  )
}
