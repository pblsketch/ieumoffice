/** Type surface for studio-plugin/workpane-menu.mjs (plain JS, bundled by Vite). */

export declare const WORKPANE_COMMAND_EVENT: 'ieum:workpane-command'
export declare const BIBLIOGRAPHY_COMMAND_EVENT: 'ieum:bib-command'

export interface WorkpaneMenuItem {
  readonly tab: 'outline' | 'find' | 'bibliography'
  readonly id: string
  readonly shortcut?: string
}

export declare const WORKPANE_MENU_ITEMS: readonly WorkpaneMenuItem[]
export declare const WORKPANE_BIBLIOGRAPHY_MENU_ITEM: WorkpaneMenuItem

export interface WorkpaneMenuLabels {
  outline: string
  find: string
  bibliography?: string
}

export interface WorkpaneCommandDetail {
  action: 'open' | 'close' | 'toggle'
  tab?: string
  focus?: boolean
}

export type BibliographyCommandAction =
  'insert-citation' | 'insert-bibliography' | 'refresh-bibliography' | 'open-tab'

export interface BibliographyMenuItem {
  readonly key: keyof BibliographyMenuLabels
  readonly id: string
  readonly action: BibliographyCommandAction
}

export declare const BIBLIOGRAPHY_MENU_ITEMS: readonly BibliographyMenuItem[]

export interface BibliographyMenuLabels {
  insertCitation: string
  insertBibliography: string
  refreshBibliography: string
  openTab: string
}

export interface BibliographyCommandDetail {
  action: BibliographyCommandAction
}

export interface WorkpaneMenuHost {
  automation?: {
    registerCommand?: (def: {
      id: string
      label: string
      shortcutLabel?: string
      canExecute?: (ctx: { hasDocument?: boolean }) => boolean
      execute: () => void
    }) => void
    unregisterCommand?: (id: string) => void
    addMenuItem?: (item: { menuId: string; commandId: string; position?: string }) => void
  }
}

export declare function installWorkpaneMenu(
  host: WorkpaneMenuHost,
  labels: WorkpaneMenuLabels,
): { ok: boolean }

export declare function installBibliographyMenu(
  host: WorkpaneMenuHost,
  labels: BibliographyMenuLabels,
): { ok: boolean }
