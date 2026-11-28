/**
 * The desktop API methods the edit toolbar and format sheets need (owned by
 * task XLS-T9). Empty until that task adds them; `index.ts` already spreads
 * this area into the phone's `window.desktopApi`.
 */
import type { DesktopApi } from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetsEngineClient } from './engine'
import type { MobileWorkbookSessions } from './sessions'

export type MobileDesktopToolbarApi = Partial<Pick<DesktopApi, never>>

export function createMobileToolbarApi(
  _client: SheetsEngineClient,
  _sessions: MobileWorkbookSessions,
): MobileDesktopToolbarApi {
  return {}
}
