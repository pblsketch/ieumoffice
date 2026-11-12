import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { MARKDOWN_CHANNELS } from '../shared/ipc'
import {
  createSensitiveExclusionStore,
  isSensitiveExclusion,
  type SensitiveExclusionStore,
} from './sensitive-exclusions'

let store: SensitiveExclusionStore | null = null
function exclusions(): SensitiveExclusionStore {
  store ??= createSensitiveExclusionStore(
    join(app.getPath('userData'), 'sensitive-info'),
    'markdown',
  )
  return store
}

/** Where "exclude" in the sensitive-info candidate list is remembered, per document path. */
export function registerMarkdownSensitiveIpc(): void {
  ipcMain.handle(MARKDOWN_CHANNELS.sensitiveExclusionsGet, async (_e, docPath: unknown) =>
    typeof docPath === 'string' && docPath ? exclusions().get(docPath) : null,
  )
  ipcMain.handle(
    MARKDOWN_CHANNELS.sensitiveExclusionsAdd,
    async (_e, docPath: unknown, entry: unknown) =>
      typeof docPath === 'string' && docPath && isSensitiveExclusion(entry)
        ? exclusions().add(docPath, entry)
        : false,
  )
}
