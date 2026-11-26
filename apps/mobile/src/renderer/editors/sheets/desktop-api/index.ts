import type { DesktopApi } from '../../../../../../sheets/src/shared/desktop-api'
import { createMobileAiApi } from './ai'
import type { SheetsEngineClient } from './engine'
import { createMobileReadApi } from './read'
import { createMobileSaveApi, type MobileSaveApiOptions } from './save'
import { MobileWorkbookSessions } from './sessions'
import { createMobileToolbarApi } from './toolbar'

export { callSheetsEngine, SheetsEngineError, type SheetsEngineClient } from './engine'
export {
  openMobileWorkbook,
  type MobileWorkbookUnlockedCopy,
  type OpenMobileWorkbookInput,
} from './open'
export { createMobileSaveApi, type MobileSaveApiOptions } from './save'
export {
  MobileWorkbookSessions,
  type MobileWorkbookDocument,
  type MobileWorkbookSession,
} from './sessions'

/** The desktop API methods the phone implements (one file per area). */
export type MobileDesktopApi = ReturnType<typeof createMobileReadApi> &
  ReturnType<typeof createMobileSaveApi> &
  ReturnType<typeof createMobileToolbarApi> &
  ReturnType<typeof createMobileAiApi>

/**
 * The phone's `window.desktopApi`: the methods the reused PC modules call,
 * each one over the in-process engine. Each area lives in its own file and
 * only that area's task changes it; this file spreads them:
 * `read.ts` (grid reads, XLS-T8), `toolbar.ts` (XLS-T9), `save.ts` (save,
 * export, XLS-T10), `ai.ts` (AI tools, XLS-T11).
 */
export function createMobileDesktopApi(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
  saveOptions: MobileSaveApiOptions = { locale: () => 'en' },
): MobileDesktopApi {
  return {
    ...createMobileReadApi(client, sessions),
    ...createMobileToolbarApi(client, sessions),
    ...createMobileSaveApi(client, sessions, saveOptions),
    ...createMobileAiApi(client, sessions),
  }
}

/** Methods a PC module asked for that the phone does not have (diagnostics for the prototype). */
const missing = new Set<string>()

export function missingDesktopApiMethods(): readonly string[] {
  return [...missing]
}

/**
 * Installs the phone's desktop API as `window.desktopApi`. A method the phone
 * does not implement reads as `undefined` (PC code guards optional methods with
 * `?.`), and its name is remembered so a prototype run can list what the
 * reused modules still need.
 */
export function installMobileDesktopApi(api: MobileDesktopApi): void {
  const view = new Proxy(api as Record<string, unknown>, {
    get(target, property) {
      if (typeof property !== 'string') return undefined
      if (property in target) return target[property]
      if (property !== 'then') missing.add(property)
      return undefined
    },
  })
  Object.defineProperty(window, 'desktopApi', {
    configurable: true,
    enumerable: true,
    value: view as unknown as DesktopApi,
  })
}
