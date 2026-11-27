/**
 * Electron IPC and native file-dialog handlers for the app-wide Hangul
 * bibliography library (`hwp:bib-*` channels).
 *
 * Security invariants:
 * - Every handler verifies `host.hasView(e.sender.id)` before reading or mutating.
 * - Import and export file paths are always chosen via main-process native dialogs;
 *   the renderer never supplies arbitrary filesystem paths.
 * - AI candidates always go through `addAiBibliographyCandidates`, which enforces
 *   `verified: false`, `source: 'ai'`, and a valid `http(s)` source URL.
 */
import { join } from 'node:path'
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
  BibAddAiCandidatesResult,
  BibAddResult,
  BibCommitImportOptions,
  BibCommitImportResult,
  BibDeleteResult,
  BibExportFileResult,
  BibExportOptions,
  BibListResult,
  BibPickImportFileResult,
  BibPreviewImportResult,
  BibUpdateResult,
  BibVerifyResult,
  BibliographyFormat,
} from '../shared/ipc'
import {
  BIBLIOGRAPHY_FORMATS,
  addAiBibliographyCandidates,
  addBibliographyEntry,
  commitBibliographyImport,
  deleteBibliographyEntry,
  listBibliographyTags,
  previewBibliographyFileImport,
  previewBibliographyImport,
  readBibliography,
  updateBibliographyEntry,
  verifyBibliographyEntry,
  writeBibliographyExportFile,
} from './bibliography'
import { tm } from './dialog-strings'

export interface HwpBibliographyHost {
  app: PathProvider & SettingsPathProvider
  hasView: (webContentsId: number) => boolean
  getWindow: (sender: WebContents) => BrowserWindow | null
  broadcast: (channel: string, payload: unknown) => void
}

const UNAUTHORIZED = {
  ok: false as const,
  reason: 'unauthorized' as const,
  error: 'hwp: unauthorized sender',
}

function isBibliographyFormat(value: unknown): value is BibliographyFormat {
  return typeof value === 'string' && BIBLIOGRAPHY_FORMATS.includes(value as BibliographyFormat)
}

function exportFormatSpec(format: BibliographyFormat): { ext: string; filterName: string } {
  switch (format) {
    case 'bibtex':
      return { ext: 'bib', filterName: 'BibTeX (.bib)' }
    case 'ris':
      return { ext: 'ris', filterName: 'RIS (.ris)' }
    case 'csl-json':
      return { ext: 'json', filterName: 'CSL JSON (.json)' }
  }
}

function ensureExtension(filePath: string, ext: string): string {
  return filePath.toLowerCase().endsWith(`.${ext}`) ? filePath : `${filePath}.${ext}`
}

function sanitizeCommitOptions(raw: unknown): BibCommitImportOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  return {
    ...(obj.source === 'document' || obj.source === 'import' ? { source: obj.source } : {}),
    ...(typeof obj.skipDuplicates === 'boolean' ? { skipDuplicates: obj.skipDuplicates } : {}),
  }
}

function sanitizeExportOptions(raw: unknown): BibExportOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const ids = Array.isArray(obj.ids)
    ? obj.ids.filter((id): id is string => typeof id === 'string')
    : undefined
  return {
    ...(typeof obj.tag === 'string' ? { tag: obj.tag } : {}),
    ...(ids ? { ids } : {}),
  }
}

/** Register all `hwp:bib-*` IPC handlers for Hangul editor views. */
export function registerHwpBibliographyIpc(host: HwpBibliographyHost): void {
  const resolveParentWindow = (sender: WebContents): BrowserWindow | undefined =>
    host.getWindow(sender) ?? BrowserWindow.getFocusedWindow() ?? undefined

  ipcMain.handle(HWP_CHANNELS.bibList, (e): BibListResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const entries = readBibliography(host.app)
    return { ok: true, entries, tags: listBibliographyTags(entries) }
  })

  ipcMain.handle(HWP_CHANNELS.bibAdd, (e, input: unknown): BibAddResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = addBibliographyEntry(host.app, input, { actor: 'user' })
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.bibChanged, result.entries)
    }
    return result
  })

  ipcMain.handle(HWP_CHANNELS.bibUpdate, (e, id: unknown, patch: unknown): BibUpdateResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = updateBibliographyEntry(host.app, id, patch, { actor: 'user' })
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.bibChanged, result.entries)
      if (result.renamedKey) {
        host.broadcast(HWP_CHANNELS.bibKeyRenamed, result.renamedKey)
      }
    }
    return result
  })

  ipcMain.handle(HWP_CHANNELS.bibDelete, (e, id: unknown): BibDeleteResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = deleteBibliographyEntry(host.app, id)
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.bibChanged, result.entries)
    }
    return result
  })

  ipcMain.handle(HWP_CHANNELS.bibVerify, (e, id: unknown): BibVerifyResult => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const result = verifyBibliographyEntry(host.app, id)
    if (result.ok) {
      host.broadcast(HWP_CHANNELS.bibChanged, result.entries)
    }
    return result
  })

  ipcMain.handle(
    HWP_CHANNELS.bibAddAiCandidates,
    (e, candidates: unknown): BibAddAiCandidatesResult => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      const result = addAiBibliographyCandidates(host.app, candidates)
      if (result.ok && result.added.length > 0) {
        host.broadcast(HWP_CHANNELS.bibChanged, result.entries)
      }
      return result
    },
  )

  ipcMain.handle(HWP_CHANNELS.bibPickImportFile, async (e): Promise<BibPickImportFileResult> => {
    if (!host.hasView(e.sender.id)) return UNAUTHORIZED
    const parent = resolveParentWindow(e.sender)
    const picked = await showOpenDialogWithMemory(dialog, parent, {
      title: tm('dlgBibImportTitle'),
      filters: [
        { name: tm('filterBibSupported'), extensions: ['bib', 'ris', 'json'] },
        { name: 'BibTeX (.bib)', extensions: ['bib'] },
        { name: 'RIS (.ris)', extensions: ['ris'] },
        { name: 'CSL JSON (.json)', extensions: ['json'] },
        { name: tm('filterAll'), extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: true, canceled: true }
    }
    return previewBibliographyFileImport(host.app, picked.filePaths[0])
  })

  ipcMain.handle(
    HWP_CHANNELS.bibPreviewImport,
    (e, candidates: unknown): BibPreviewImportResult => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      return previewBibliographyImport(host.app, candidates)
    },
  )

  ipcMain.handle(
    HWP_CHANNELS.bibCommitImport,
    (e, candidates: unknown, options?: unknown): BibCommitImportResult => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      const result = commitBibliographyImport(host.app, candidates, sanitizeCommitOptions(options))
      if (result.ok && result.added.length > 0) {
        host.broadcast(HWP_CHANNELS.bibChanged, result.entries)
      }
      return result
    },
  )

  ipcMain.handle(
    HWP_CHANNELS.bibExportFile,
    async (e, format: unknown, options?: unknown): Promise<BibExportFileResult> => {
      if (!host.hasView(e.sender.id)) return UNAUTHORIZED
      if (!isBibliographyFormat(format)) {
        return {
          ok: false,
          reason: 'invalid_format',
          error: `Unsupported bibliography export format: ${String(format)}`,
        }
      }
      const spec = exportFormatSpec(format)
      const parent = resolveParentWindow(e.sender)
      const defaultPath = join(
        configuredDefaultSaveDir(host.app),
        `${tm('bibDefaultFileName')}.${spec.ext}`,
      )
      const picked = await showSaveDialogWithMemory(dialog, parent, {
        title: tm('dlgBibExportTitle'),
        defaultPath,
        filters: [
          { name: spec.filterName, extensions: [spec.ext] },
          { name: tm('filterAll'), extensions: ['*'] },
        ],
      })
      if (picked.canceled || !picked.filePath) {
        return { ok: true, canceled: true }
      }
      const targetPath = ensureExtension(picked.filePath, spec.ext)
      return writeBibliographyExportFile(
        targetPath,
        readBibliography(host.app),
        format,
        sanitizeExportOptions(options),
      )
    },
  )
}
