/** Type surface for studio-plugin/workpane-menu.mjs (plain JS, bundled by Vite). */

export declare const WORKPANE_COMMAND_EVENT: 'ieum:workpane-command'

export interface WorkpaneMenuItem {
  readonly tab: 'outline' | 'find'
  readonly id: string
  readonly shortcut?: string
}

export declare const WORKPANE_MENU_ITEMS: readonly WorkpaneMenuItem[]

export interface WorkpaneMenuLabels {
  outline: string
  find: string
}

export interface WorkpaneCommandDetail {
  action: 'open' | 'close' | 'toggle'
  tab?: string
  focus?: boolean
}

export interface WorkpaneMenuHost {
  automation?: {
    registerCommand?: (def: {
      id: string
      label: string
      shortcutLabel?: string
      execute: () => void
    }) => void
    addMenuItem?: (item: { menuId: string; commandId: string; position?: string }) => void
  }
}

export declare function installWorkpaneMenu(
  host: WorkpaneMenuHost,
  labels: WorkpaneMenuLabels,
): { ok: boolean }
