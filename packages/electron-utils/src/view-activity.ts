/** Event-driven activity for optional work; contains no Electron or React runtime. */
import type { ViewVisibilityBridge } from './view-visibility'

interface VisibilityDocument {
  readonly visibilityState: string
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export function createViewActivity(document: VisibilityDocument, bridge?: ViewVisibilityBridge) {
  let stopped = false
  let nativeVisible = !bridge
  let revision = 0
  const listeners = new Set<() => void>()
  const pending = new Set<(visible: boolean) => void>()
  const isVisible = () => !stopped && nativeVisible && document.visibilityState !== 'hidden'
  const changed = () => {
    if (stopped) return
    if (isVisible()) for (const finish of [...pending]) finish(true)
    for (const listener of listeners) listener()
  }
  document.addEventListener('visibilitychange', changed)
  const unsubscribe = bridge?.onChanged((visible) => {
    if (stopped) return
    revision++
    nativeVisible = visible
    changed()
  })
  if (bridge) {
    const requestedAt = revision
    void bridge
      .getVisible()
      .catch(() => true)
      .then((visible) => {
        if (stopped || requestedAt !== revision) return
        nativeVisible = visible
        changed()
      })
  }
  return {
    isVisible,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    wait(signal?: AbortSignal): Promise<boolean> {
      if (stopped || signal?.aborted) return Promise.resolve(false)
      if (isVisible()) return Promise.resolve(true)
      return new Promise((resolve) => {
        const abort = () => finish(false)
        const finish = (visible: boolean) => {
          if (!pending.delete(finish)) return
          signal?.removeEventListener('abort', abort)
          resolve(visible)
        }
        pending.add(finish)
        signal?.addEventListener('abort', abort, { once: true })
      })
    },
    dispose() {
      stopped = true
      document.removeEventListener('visibilitychange', changed)
      unsubscribe?.()
      for (const finish of [...pending]) finish(false)
      listeners.clear()
    },
  }
}
