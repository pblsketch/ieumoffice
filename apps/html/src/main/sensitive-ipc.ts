import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { HTML_CHANNELS } from '../shared/ipc'
import {
  createSensitiveExclusionStore,
  isSensitiveExclusion,
  type SensitiveExclusionStore,
} from './sensitive-exclusions'

let store: SensitiveExclusionStore | null = null
function exclusions(): SensitiveExclusionStore {
  store ??= createSensitiveExclusionStore(join(app.getPath('userData'), 'sensitive-info'), 'html')
  return store
}

/** Where "exclude" in the sensitive-info candidate list is remembered, per document path. */
export function registerHtmlSensitiveIpc(): void {
  ipcMain.handle(HTML_CHANNELS.sensitiveExclusionsGet, async (_e, docPath: unknown) =>
    typeof docPath === 'string' && docPath ? exclusions().get(docPath) : null,
  )
  ipcMain.handle(
    HTML_CHANNELS.sensitiveExclusionsAdd,
    async (_e, docPath: unknown, entry: unknown) =>
      typeof docPath === 'string' && docPath && isSensitiveExclusion(entry)
        ? exclusions().add(docPath, entry)
        : false,
  )
}
