/**
 * Editor View-menu entries for the left workpane (Outline and Find tabs).
 *
 * Runs inside the rhwp-studio iframe realm, registered by the app's studio plugin.
 * Clicking an entry dispatches WORKPANE_COMMAND_EVENT on the editor window; the
 * host renderer listens for it and opens/focuses the matching workpane tab.
 */

/** Event fired on the editor frame window when a View-menu item or Ctrl+F asks for the workpane. */
export const WORKPANE_COMMAND_EVENT = 'ieum:workpane-command'

/** View-menu items installed for the workpane, in display order. */
export const WORKPANE_MENU_ITEMS = Object.freeze([
  { tab: 'outline', id: 'ext:ieum-workpane-outline' },
  { tab: 'find', id: 'ext:ieum-workpane-find', shortcut: 'Ctrl+F' },
])

/**
 * Register the workpane commands and append them to the editor's View menu.
 * Follows the same defensive pattern as installFileMenu in agent-plugin.mjs:
 * repeated calls are idempotent and an editor without automation hooks returns `{ ok: false }`.
 */
export function installWorkpaneMenu(host, labels) {
  for (const item of WORKPANE_MENU_ITEMS) {
    if (typeof labels?.[item.tab] !== 'string' || !labels[item.tab]) {
      throw new Error(`labels.${item.tab} must be a non-empty string`)
    }
  }
  const automation = host?.automation
  if (!automation?.registerCommand || !automation?.addMenuItem) {
    return { ok: false }
  }
  for (const item of WORKPANE_MENU_ITEMS) {
    try {
      automation.registerCommand({
        id: item.id,
        label: labels[item.tab],
        ...(item.shortcut ? { shortcutLabel: item.shortcut } : {}),
        execute: () => {
          globalThis.dispatchEvent?.(
            new CustomEvent(WORKPANE_COMMAND_EVENT, {
              detail: { action: 'open', tab: item.tab, focus: true },
            }),
          )
        },
      })
    } catch {
      // registered by an earlier call
    }
  }
  try {
    for (const item of WORKPANE_MENU_ITEMS) {
      automation.addMenuItem({
        menuId: 'view',
        commandId: item.id,
        position: 'bottom',
      })
    }
  } catch {
    // an editor without a View menu
    return { ok: false }
  }
  return { ok: true }
}
