/**
 * The desktop API methods the reused PC AI tools call (owned by task
 * XLS-T11). Empty until that task adds them; `index.ts` already spreads this
 * area into the phone's `window.desktopApi`.
 */
import type { DesktopApi } from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

export type MobileDesktopAiApi = Partial<Pick<DesktopApi, never>>

export function createMobileAiApi(
  _client: SheetsEngineClient,
  _sessions: MobileWorkbookSessions,
): MobileDesktopAiApi {
  return {}
}
