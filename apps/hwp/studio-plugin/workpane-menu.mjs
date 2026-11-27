/**
 * Editor View-menu entries for the left workpane (Outline, Find, and optional Bibliography tabs)
 * and Tool-menu entries for citation & bibliography actions.
 *
 * Runs inside the rhwp-studio iframe realm, registered by the app's studio plugin.
 * Clicking an entry dispatches WORKPANE_COMMAND_EVENT or BIBLIOGRAPHY_COMMAND_EVENT
 * on the editor window; the host renderer listens for it and runs the matching action.
 */

/** Event fired on the editor frame window when a View-menu item or Ctrl+F asks for the workpane. */
export const WORKPANE_COMMAND_EVENT = 'ieum:workpane-command'

/** Event fired on the editor frame window when a Tool-menu bibliography item is clicked. */
export const BIBLIOGRAPHY_COMMAND_EVENT = 'ieum:bib-command'

/** Core View-menu items installed for the workpane, in display order. */
export const WORKPANE_MENU_ITEMS = Object.freeze([
  { tab: 'outline', id: 'ext:ieum-workpane-outline' },
  { tab: 'find', id: 'ext:ieum-workpane-find', shortcut: 'Ctrl+F' },
])

/** Optional View-menu item installed for the workpane Bibliography tab when labeled. */
export const WORKPANE_BIBLIOGRAPHY_MENU_ITEM = Object.freeze({
  tab: 'bibliography',
  id: 'ext:ieum-workpane-bibliography',
})

/** Tool-menu items installed for citation & bibliography actions, in display order. */
export const BIBLIOGRAPHY_MENU_ITEMS = Object.freeze([
  { key: 'insertCitation', id: 'ext:ieum-bib-insert-citation', action: 'insert-citation' },
  { key: 'insertBibliography', id: 'ext:ieum-bib-insert-list', action: 'insert-bibliography' },
  { key: 'refreshBibliography', id: 'ext:ieum-bib-refresh-list', action: 'refresh-bibliography' },
  { key: 'openTab', id: 'ext:ieum-bib-open-tab', action: 'open-tab' },
])

/**
 * Register the workpane commands and append them to the editor's View menu.
 * Follows the same defensive pattern as installFileMenu in agent-plugin.mjs:
 * repeated calls are idempotent and an editor without automation hooks returns `{ ok: false }`.
 * When `labels.bibliography` is a non-empty string, also registers the Bibliography tab entry.
 */
export function installWorkpaneMenu(host, labels) {
  for (const item of WORKPANE_MENU_ITEMS) {
    if (typeof labels?.[item.tab] !== 'string' || !labels[item.tab]) {
      throw new Error(`labels.${item.tab} must be a non-empty string`)
    }
  }
  const items = [...WORKPANE_MENU_ITEMS]
  if (typeof labels?.bibliography === 'string' && labels.bibliography.length > 0) {
    items.push(WORKPANE_BIBLIOGRAPHY_MENU_ITEM)
  }
  const automation = host?.automation
  if (!automation?.registerCommand || !automation?.addMenuItem) {
    return { ok: false }
  }
  for (const item of items) {
    try {
      automation.unregisterCommand?.(item.id)
    } catch {
      // not previously registered
    }
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
    for (const item of items) {
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

/**
 * Register the 4 citation & bibliography commands in the editor's Tool menu (`menuId: 'tool'`).
 * Repeated calls are idempotent and an editor without automation hooks returns `{ ok: false }`.
 */
export function installBibliographyMenu(host, labels) {
  for (const item of BIBLIOGRAPHY_MENU_ITEMS) {
    if (typeof labels?.[item.key] !== 'string' || !labels[item.key]) {
      throw new Error(`labels.${item.key} must be a non-empty string`)
    }
  }
  const automation = host?.automation
  if (!automation?.registerCommand || !automation?.addMenuItem) {
    return { ok: false }
  }
  for (const item of BIBLIOGRAPHY_MENU_ITEMS) {
    try {
      automation.unregisterCommand?.(item.id)
    } catch {
      // not previously registered
    }
    try {
      automation.registerCommand({
        id: item.id,
        label: labels[item.key],
        canExecute: (ctx) => ctx?.hasDocument !== false,
        execute: () => {
          globalThis.dispatchEvent?.(
            new CustomEvent(BIBLIOGRAPHY_COMMAND_EVENT, {
              detail: { action: item.action },
            }),
          )
        },
      })
    } catch {
      // registered by an earlier call
    }
  }
  try {
    for (const item of BIBLIOGRAPHY_MENU_ITEMS) {
      automation.addMenuItem({
        menuId: 'tool',
        commandId: item.id,
        position: 'bottom',
      })
    }
  } catch {
    // an editor without a Tool menu
    return { ok: false }
  }
  return { ok: true }
}
