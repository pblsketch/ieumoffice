import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { getSlideComments, getSlideNotes } from '@genoffice/pptx-engine'
import { sessions } from './session-state'
import { deckSensitiveText } from './sensitive-text'
import {
  createSensitiveExclusionStore,
  isSensitiveExclusion,
  type SensitiveExclusionStore,
} from './sensitive-exclusions'
import type { SlidesSensitiveText } from '../shared/sensitive-text'

let store: SensitiveExclusionStore | null = null
function exclusions(): SensitiveExclusionStore {
  store ??= createSensitiveExclusionStore(join(app.getPath('userData'), 'sensitive-info'), 'slides')
  return store
}

/** "Find sensitive info": the deck's text, and where "exclude" is remembered (called from registerSlidesIpc). */
export function registerSlidesSensitiveIpc(): void {
  ipcMain.handle('slides:sensitive-text', (e): SlidesSensitiveText | null => {
    const session = sessions.get(e.sender.id)
    if (!session) return null
    const { archive, deck } = session.opened
    return deckSensitiveText(
      deck.slides,
      (slide) => getSlideNotes(archive, slide.path),
      (slide) => getSlideComments(archive, slide.path).map((c) => c.text),
    )
  })
  ipcMain.handle('slides:sensitive-exclusions-get', async (_e, docPath: unknown) =>
    typeof docPath === 'string' && docPath ? exclusions().get(docPath) : null,
  )
  ipcMain.handle('slides:sensitive-exclusions-add', async (_e, docPath: unknown, entry: unknown) =>
    typeof docPath === 'string' && docPath && isSensitiveExclusion(entry)
      ? exclusions().add(docPath, entry)
      : false,
  )
}
