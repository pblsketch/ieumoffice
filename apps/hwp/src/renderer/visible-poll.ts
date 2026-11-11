/** Optional UI inspection sleeps while its WebContents is hidden. */
import type { ViewVisibilityBridge } from '@genoffice/electron-utils/view-visibility'
import { createViewActivity } from '@genoffice/electron-utils/view-activity'

export function observeViewVisibility(listener: (visible: boolean) => void): () => void {
  const bridge = (window as Window & { aiOfficeViewVisibility?: ViewVisibilityBridge })
    .aiOfficeViewVisibility
  const activity = createViewActivity(document, bridge)
  const stop = activity.subscribe(() => listener(activity.isVisible()))
  if (!bridge) listener(activity.isVisible())
  return () => {
    stop()
    activity.dispose()
  }
}

export function pollWhileVisible(read: () => Promise<void>, delay: number): () => void {
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const bridge = (window as Window & { aiOfficeViewVisibility?: ViewVisibilityBridge })
    .aiOfficeViewVisibility
  const activity = createViewActivity(document, bridge)
  const isVisible = activity.isVisible
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const tick = async () => {
    if (stopped || running || !isVisible()) return
    running = true
    try {
      await read()
    } catch {
      /* supplementary inspection retries on the next tick */
    } finally {
      running = false
      if (!stopped && isVisible()) timer = setTimeout(() => void tick(), delay)
    }
  }
  const visibility = () => {
    clear()
    if (isVisible()) void tick()
  }
  const stopView = activity.subscribe(visibility)
  void tick()
  return () => {
    stopped = true
    clear()
    stopView?.()
    activity.dispose()
  }
}
