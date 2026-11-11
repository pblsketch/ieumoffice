/** Native view visibility is independent of Chromium's Page Visibility API. */
import type { IpcRenderer, WebContents, WebContentsView } from 'electron'

export const VIEW_VISIBILITY_CHANNELS = {
  get: 'app:get-view-visible',
  changed: 'app:view-visible-changed',
} as const
export const VIEW_VISIBILITY_BRIDGE_KEY = 'aiOfficeViewVisibility'

export interface ViewVisibilityBridge {
  getVisible(): Promise<boolean>
  onChanged(handler: (visible: boolean) => void): () => void
}

const visibility = new WeakMap<WebContents, boolean>()

/** Standalone windows have no shell-owned visibility and start visible. */
export function viewIsVisible(contents: WebContents): boolean {
  return visibility.get(contents) ?? true
}

/** Used by layout, initial hiding and detach/dock, with notifications on changes only. */
export function setViewVisible(view: WebContentsView, visible: boolean): void {
  view.setVisible(visible)
  const contents = view.webContents
  const previous = visibility.get(contents)
  visibility.set(contents, visible)
  if (previous === visible) return
  try {
    if (!contents.isDestroyed()) contents.send(VIEW_VISIBILITY_CHANNELS.changed, visible)
  } catch {
    // A frame may not have its preload yet. Its initial pull reads this state.
  }
}

export function viewVisibilityBridge(ipc: IpcRenderer): ViewVisibilityBridge {
  return {
    async getVisible() {
      const value: unknown = await ipc.invoke(VIEW_VISIBILITY_CHANNELS.get).catch(() => true)
      return typeof value === 'boolean' ? value : true
    },
    onChanged(handler) {
      const listener = (_event: unknown, value: unknown) => {
        if (typeof value === 'boolean') handler(value)
      }
      ipc.on(VIEW_VISIBILITY_CHANNELS.changed, listener)
      return () => ipc.removeListener(VIEW_VISIBILITY_CHANNELS.changed, listener)
    },
  }
}
