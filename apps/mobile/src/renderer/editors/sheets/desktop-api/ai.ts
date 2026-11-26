/**
 * The desktop API methods the reused PC AI tools call (owned by task
 * XLS-T11). The tools read cells through the read area's methods
 * (`readWorkbookRange`, `readWorkbookFormulas`, `findWorkbookCells`); what is
 * left here are the picture reads of the desktop's `add_image` path
 * (op-executor.ts `prefetchOpImages`). The phone offers no image insert
 * (spec 2.6, `ai/phoneLimits.ts` refuses the operation before planning), so
 * these refuse in plain words should one ever be reached.
 */
import type { DesktopApi } from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

export type MobileDesktopAiApi = Pick<
  DesktopApi,
  'fetchImage' | 'readLocalImage' | 'readAttachmentImage'
>

const NOT_ON_PHONE = 'Inserting pictures is not available in the phone app.'

export function createMobileAiApi(
  _client: SheetsEngineClient,
  _sessions: MobileWorkbookSessions,
): MobileDesktopAiApi {
  return {
    fetchImage: () => Promise.reject(new Error(NOT_ON_PHONE)),
    readLocalImage: () => Promise.reject(new Error(NOT_ON_PHONE)),
    readAttachmentImage: () => Promise.reject(new Error(NOT_ON_PHONE)),
  }
}
