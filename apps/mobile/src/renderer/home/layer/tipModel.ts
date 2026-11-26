// First-use tips (track T6, spec 3.14): when each tip may show and which editor element it points
// at. The editor screen is not ours to edit, so the tips find its elements by test id and by the
// view tool's accessible name; tests in home-layer.test.tsx keep those names honest.
import type { DocumentMode } from '@genoffice/mobile-bridge/view-edit-gate'
import type { MobileStringKey } from '../../i18n'
import { HOME_TIP_IDS, type HomeTipId } from '../prefsStore'

export const TIP_TEXT_KEYS: Readonly<Record<HomeTipId, MobileStringKey>> = {
  editButton: 'homeRunTipEditButton',
  flowView: 'homeRunTipFlowView',
  firstEdit: 'homeRunTipFirstEdit',
  firstKeyboard: 'homeRunTipFirstKeyboard',
}

export interface TipContext {
  readonly mode: DocumentMode
  /** The "page view" view tool's label in the screen language. */
  readonly pageViewLabel: string
}

function shown(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false
  return element.closest('[hidden]') === null
}

function byTestId(root: ParentNode, testId: string): HTMLElement | null {
  const element = root.querySelector(`[data-testid="${testId}"]`)
  return shown(element) ? element : null
}

function keyboardUp(): boolean {
  if (typeof document === 'undefined') return false
  const raw = document.documentElement.style.getPropertyValue('--m-kb')
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0
}

/** The element tip `id` points at now, or null when it may not show (yet). */
export function tipAnchor(
  id: HomeTipId,
  context: TipContext,
  root: ParentNode = document,
): HTMLElement | null {
  switch (id) {
    case 'editButton':
      return context.mode === 'view' ? byTestId(root, 'editor-mode-toggle') : null
    case 'flowView': {
      const flow = byTestId(root, 'hwp-flow-view')
      if (!flow) return null
      const pageView = [...root.querySelectorAll('button')].find(
        (button) =>
          shown(button) &&
          (button.getAttribute('aria-label') === context.pageViewLabel ||
            button.getAttribute('title') === context.pageViewLabel),
      )
      return pageView ?? flow
    }
    case 'firstEdit':
      return context.mode === 'edit' ? byTestId(root, 'editor-save-btn') : null
    case 'firstKeyboard':
      // the keyboard's accessory bar shows [Aa]; with the keyboard up and no [Aa], the bar itself
      return (
        byTestId(root, 'format-panel-btn') ??
        (keyboardUp() ? byTestId(root, 'phone-quick-toolbar') : null)
      )
  }
}

/** The first tip of spec 3.14's order that was not seen and has its element on screen. */
export function nextTip(
  seen: readonly string[],
  context: TipContext,
  root: ParentNode = document,
): { readonly id: HomeTipId; readonly anchor: HTMLElement } | null {
  for (const id of HOME_TIP_IDS) {
    if (seen.includes(id)) continue
    const anchor = tipAnchor(id, context, root)
    if (anchor) return { id, anchor }
  }
  return null
}

/** True while something modal (a sheet, a dialog) is open; tips wait for it to close. */
export function modalOpen(root: ParentNode = document): boolean {
  return root.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null
}
