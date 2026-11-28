import { BrowserWindow, type IpcMain } from 'electron'
import { join } from 'node:path'
import {
  QUICK_SWITCHER_CHANNELS,
  type QuickSwitcherItem,
  type QuickSwitcherQueryResult,
} from '../shared/quick-switcher-api'

export interface QuickSwitcherCommandSpec {
  readonly id: string
  readonly title: string
  readonly subtitle?: string | undefined
  readonly editorKind?: string | undefined
  readonly aiOnly?: boolean | undefined
  readonly run: () => void | Promise<void>
}

export interface QuickSwitcherSources {
  readonly isAiVisible: () => boolean
  readonly isEditorEnabled: (editorKind: string) => boolean
  readonly getLang: () => string
  readonly getTheme?: () => 'light' | 'dark' | 'system'
  readonly listOpenTabs: () => readonly {
    readonly id: string
    readonly title: string
    readonly path?: string | undefined
    readonly editorKind?: string | undefined
    readonly activate: () => void
  }[]
  readonly listRecentFiles: () => readonly {
    readonly path: string
    readonly title: string
    readonly editorKind?: string | undefined
  }[]
  readonly listProjectFiles: (query: string) => Promise<
    readonly {
      readonly path: string
      readonly relPath: string
      readonly name: string
    }[]
  >
  readonly openFile: (filePath: string) => void | Promise<void>
  readonly listCommands: () => readonly QuickSwitcherCommandSpec[]
}

export interface QuickSwitcherController {
  query(rawQuery: string): Promise<QuickSwitcherQueryResult>
  execute(itemId: string): Promise<boolean>
}

const MAX_PER_GROUP = 12

function matches(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return fields.some((f) => f && f.toLowerCase().includes(q))
}

/**
 * Pure main-side query & ID-whitelisted execution controller for Quick Switcher.
 * Issues opaque IDs on `query` and ONLY executes IDs present in the latest issued map.
 */
export function createQuickSwitcherController(
  sources: QuickSwitcherSources,
): QuickSwitcherController {
  let issued = new Map<string, () => void | Promise<void>>()

  return {
    async query(rawQuery: string): Promise<QuickSwitcherQueryResult> {
      const q = rawQuery.trim()
      const aiVisible = sources.isAiVisible()
      const nextIssued = new Map<string, () => void | Promise<void>>()
      const items: QuickSwitcherItem[] = []
      let seq = 1

      // 1. Open tabs
      let tabCount = 0
      for (const tab of sources.listOpenTabs()) {
        if (tabCount >= MAX_PER_GROUP) break
        if (!matches(q, tab.title, tab.path, tab.editorKind)) continue
        const id = `tab:${seq++}`
        nextIssued.set(id, () => tab.activate())
        items.push({
          id,
          group: 'open-tab',
          title: tab.title,
          subtitle: tab.path,
          editorKind: tab.editorKind,
        })
        tabCount++
      }

      // 2. Recent files
      let recentCount = 0
      for (const rec of sources.listRecentFiles()) {
        if (recentCount >= MAX_PER_GROUP) break
        if (!matches(q, rec.title, rec.path, rec.editorKind)) continue
        const id = `recent:${seq++}`
        nextIssued.set(id, () => sources.openFile(rec.path))
        items.push({
          id,
          group: 'recent-file',
          title: rec.title,
          subtitle: rec.path,
          editorKind: rec.editorKind,
        })
        recentCount++
      }

      // 3. Active project folder files
      const projectFiles = await sources.listProjectFiles(q).catch(() => [])
      let projCount = 0
      for (const pf of projectFiles) {
        if (projCount >= MAX_PER_GROUP) break
        if (!matches(q, pf.name, pf.relPath)) continue
        const id = `proj:${seq++}`
        nextIssued.set(id, () => sources.openFile(pf.path))
        items.push({
          id,
          group: 'project-file',
          title: pf.name,
          subtitle: pf.relPath,
        })
        projCount++
      }

      // 4. App commands (filtered by AI-off and disabled editors)
      let cmdCount = 0
      for (const cmd of sources.listCommands()) {
        if (cmdCount >= MAX_PER_GROUP) break
        if (cmd.aiOnly && !aiVisible) continue
        if (cmd.editorKind && !sources.isEditorEnabled(cmd.editorKind)) continue
        if (!matches(q, cmd.title, cmd.subtitle, cmd.editorKind)) continue
        const id = `cmd:${seq++}`
        nextIssued.set(id, () => cmd.run())
        items.push({
          id,
          group: 'command',
          title: cmd.title,
          subtitle: cmd.subtitle,
          editorKind: cmd.editorKind,
        })
        cmdCount++
      }

      issued = nextIssued
      return { items, aiVisible }
    },

    async execute(itemId: string): Promise<boolean> {
      if (typeof itemId !== 'string') return false
      const action = issued.get(itemId)
      if (!action) return false
      issued = new Map()
      await action()
      return true
    },
  }
}

let popupWin: BrowserWindow | null = null
let activeController: QuickSwitcherController | null = null
let activeLangGetter: (() => string) | null = null
let activeThemeGetter: (() => 'light' | 'dark' | 'system') | null = null

export function registerQuickSwitcherIpc(ipcMain: IpcMain): void {
  for (const ch of Object.values(QUICK_SWITCHER_CHANNELS)) {
    ipcMain.removeHandler(ch)
  }
  ipcMain.handle(QUICK_SWITCHER_CHANNELS.query, async (_event, q: unknown) => {
    if (!activeController) return { items: [], aiVisible: true }
    return activeController.query(typeof q === 'string' ? q : '')
  })
  ipcMain.handle(QUICK_SWITCHER_CHANNELS.execute, async (_event, itemId: unknown) => {
    if (!activeController || typeof itemId !== 'string') return false
    const ok = await activeController.execute(itemId)
    closeQuickSwitcherWindow()
    return ok
  })
  ipcMain.handle(QUICK_SWITCHER_CHANNELS.close, () => {
    closeQuickSwitcherWindow()
  })
  ipcMain.handle(QUICK_SWITCHER_CHANNELS.lang, () => activeLangGetter?.() ?? 'ko')
  ipcMain.handle(QUICK_SWITCHER_CHANNELS.theme, () => activeThemeGetter?.() ?? 'system')
}

export function closeQuickSwitcherWindow(): void {
  const w = popupWin
  popupWin = null
  if (w && !w.isDestroyed()) w.close()
}

/**
 * Opens (or focuses) the single frameless popup `BrowserWindow` above all editor
 * `WebContentsView`s. Automatically closes on `blur` or `Esc`.
 */
export function openQuickSwitcherWindow(
  parent: BrowserWindow | null,
  sources: QuickSwitcherSources,
): void {
  activeController = createQuickSwitcherController(sources)
  activeLangGetter = sources.getLang
  activeThemeGetter = sources.getTheme ?? null
  if (popupWin && !popupWin.isDestroyed()) {
    popupWin.focus()
    return
  }

  const width = 560
  const height = 420
  let x: number | undefined
  let y: number | undefined
  if (parent && !parent.isDestroyed()) {
    const b = parent.getBounds()
    x = Math.round(b.x + (b.width - width) / 2)
    y = Math.round(b.y + Math.max(64, Math.round(b.height * 0.14)))
  }

  const win = new BrowserWindow({
    width,
    height,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    parent: parent ?? undefined,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/quick-switcher.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  popupWin = win
  win.on('blur', () => closeQuickSwitcherWindow())
  win.on('closed', () => {
    if (popupWin === win) popupWin = null
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-switcher.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/quick-switcher.html'))
  }
}
