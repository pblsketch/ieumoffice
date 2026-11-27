/**
 * The file panel beside editor tabs: a folder tree the user can open and
 * close while a document is on screen, so a sibling file opens without going
 * back to Home.
 *
 * Editor tabs are WebContentsViews that paint above every bit of shell DOM, so
 * the panel cannot float over a document. The main process shrinks the views
 * by the panel's width instead and the shell renderer paints the panel in the
 * strip of window that frees up. Both sides derive that width from
 * `filePanelInset`, so the panel and the document edge never disagree.
 *
 * No Electron, Node or DOM imports: the renderer, the main process and the
 * unit tests all read this module.
 */

import type { FolderListing } from './home-api'

/** Width the panel opens at the first time, in unscaled CSS px. */
export const FILE_PANEL_DEFAULT_WIDTH = 264
/** Narrowest width a drag can leave, in unscaled CSS px. */
export const FILE_PANEL_MIN_WIDTH = 200
/** Widest width a drag can leave, in unscaled CSS px. */
export const FILE_PANEL_MAX_WIDTH = 560
/**
 * Window width the document keeps whatever the panel asks for. A narrow window
 * gives the panel less room instead of squeezing the document to nothing.
 */
export const FILE_PANEL_MIN_DOCUMENT_PX = 360

/**
 * Keyboard toggle, on the View-menu item. A menu accelerator only fires when
 * the page leaves the key unhandled, so an editor that ever binds the same
 * keys keeps them (the HWP tab's Ctrl+N, Shift+E endnote chord with Ctrl still
 * held). No editor binds it today; VS Code users know it as the Explorer key.
 */
export const FILE_PANEL_ACCELERATOR = 'CmdOrCtrl+Shift+E'

/** The same keys as the strip button's tooltip shows them. */
export function filePanelShortcutLabel(isMac: boolean): string {
  return isMac ? '⇧⌘E' : 'Ctrl+Shift+E'
}

/** `app-settings.json` key holding `{ open, width }` */
export const FILE_PANEL_SETTINGS_KEY = 'filePanel'

/** What the main process broadcasts: the stored choice plus the interface scale. */
export interface FilePanelState {
  open: boolean
  /** unscaled CSS px; the painted width is `filePanelInset` */
  width: number
  /** interface scale (View menu); the panel chrome is zoomed by it */
  scale: number
}

/** The part of the state the user changes and the settings file keeps. */
export interface FilePanelChoice {
  open: boolean
  width: number
}

export const DEFAULT_FILE_PANEL_CHOICE: FilePanelChoice = {
  open: false,
  width: FILE_PANEL_DEFAULT_WIDTH,
}

/** A finite width inside the drag limits; anything unusable becomes the default. */
export function clampFilePanelWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return FILE_PANEL_DEFAULT_WIDTH
  return Math.round(Math.min(FILE_PANEL_MAX_WIDTH, Math.max(FILE_PANEL_MIN_WIDTH, width)))
}

/** The stored choice, read defensively: a hand-edited or old file never breaks the layout. */
export function readFilePanelChoice(raw: unknown): FilePanelChoice {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_FILE_PANEL_CHOICE }
  const value = raw as Record<string, unknown>
  return {
    open: value.open === true,
    width: clampFilePanelWidth(value.width ?? FILE_PANEL_DEFAULT_WIDTH),
  }
}

/**
 * How many window px (DIP) the panel takes from the left of the document area.
 * Zero while closed. The scaled width is capped so the document keeps
 * FILE_PANEL_MIN_DOCUMENT_PX of a narrow window.
 */
export function filePanelInset(
  state: Pick<FilePanelState, 'open' | 'width' | 'scale'>,
  windowWidth: number,
): number {
  if (!state.open) return 0
  const scale = Number.isFinite(state.scale) && state.scale > 0 ? state.scale : 1
  const wanted = Math.round(clampFilePanelWidth(state.width) * scale)
  const room = Math.max(0, Math.floor(windowWidth) - FILE_PANEL_MIN_DOCUMENT_PX)
  return Math.max(0, Math.min(wanted, room))
}

/** What a right click on a panel row asked for; null = the menu was dismissed. */
export type FilePanelItemAction = 'open' | 'quickLook' | 'reveal' | 'copyPath' | 'addRoot'

/** Navigation metadata sent alongside a file-panel Quick Look open/step request. */
export interface FilePanelQuickLookNav {
  canPrev: boolean
  canNext: boolean
  direction: 'up' | 'down' | 'none'
  /** 0-based index in the visible file list, for the "3 / 12" position indicator */
  index?: number
  /** total visible files in the panel list */
  total?: number
}

/** Main-process broadcast telling the file panel which file (if any) is previewed. */
export interface FilePanelQuickLookState {
  open: boolean
  path: string | null
}

export interface FilePanelApi {
  get(): Promise<FilePanelState>
  /** open or close; the width stays what it was */
  setOpen(open: boolean): void
  /** live width during a drag (unscaled CSS px); `commit` stores it */
  setWidth(width: number, commit: boolean): void
  onChanged(handler: (state: FilePanelState) => void): () => void
  /**
   * One level of a folder that holds an open document (or sits under one).
   * The tree roots keep using the home listing; this covers a document opened
   * from anywhere else, which the home tree cannot list.
   */
  listDocumentFolder(dir: string): Promise<FolderListing>
  /**
   * The native row menu at (x, y) in window CSS px. Native because a DOM menu
   * would be cut off where the document view begins. "Show in folder" runs in
   * the main process, which checks the path; the other picks come back.
   */
  showItemMenu(
    kind: 'file' | 'folder',
    path: string,
    x: number,
    y: number,
    canAddRoot: boolean,
  ): Promise<FilePanelItemAction | null>
  /** Open or update the floating Quick Look window beside the file panel. */
  quickLookOpen(path: string, nav: FilePanelQuickLookNav): Promise<boolean>
  /** Close the Quick Look window if it was opened from the file panel. */
  quickLookClose(): void
  /** Subscribe to preview open/update/close transitions driven by main or the preview window. */
  onQuickLookChanged(handler: (state: FilePanelQuickLookState) => void): () => void
  /** Subscribe to Up/Down navigation requests coming from the preview window itself. */
  onQuickLookStep(handler: (delta: -1 | 1) => void): () => void
}

export const FILE_PANEL_CHANNELS = {
  /** invoke: FilePanelState */
  get: 'file-panel:get',
  /** send: boolean */
  setOpen: 'file-panel:set-open',
  /** send: number, boolean */
  setWidth: 'file-panel:set-width',
  /** push: FilePanelState */
  changed: 'file-panel:changed',
  /** invoke: dir → FolderListing */
  listDocumentFolder: 'file-panel:list-document-folder',
  /** invoke: kind, path, x, y, canAddRoot → FilePanelItemAction | null */
  itemMenu: 'file-panel:item-menu',
  /** invoke: path, nav → boolean */
  quickLookOpen: 'file-panel:quick-look-open',
  /** send: void */
  quickLookClose: 'file-panel:quick-look-close',
  /** push: FilePanelQuickLookState */
  quickLookChanged: 'file-panel:quick-look-changed',
  /** push: -1 | 1 */
  quickLookStep: 'file-panel:quick-look-step',
} as const
