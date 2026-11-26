import type { DesktopApi } from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetsEngineClient } from './engine'
import { createMobileReadApi } from './read'
import { createMobileSaveApi, type MobileSaveApiOptions } from './save'
import { MobileWorkbookSessions } from './sessions'

export { callSheetsEngine, SheetsEngineError, type SheetsEngineClient } from './engine'
export { openMobileWorkbook, type OpenMobileWorkbookInput } from './open'
export { createMobileSaveApi, type MobileSaveApiOptions } from './save'
export {
  MobileWorkbookSessions,
  type MobileWorkbookDocument,
  type MobileWorkbookSession,
} from './sessions'

/** The desktop API methods the phone implements so far (one file per area). */
export type MobileDesktopApi = ReturnType<typeof createMobileReadApi> &
  ReturnType<typeof createMobileSaveApi>

/**
 * The phone's `window.desktopApi`: the methods the reused PC grid modules call,
 * each one over the in-process engine. Areas live in their own files and are
 * spread here: the read side (`read.ts`) and the save side (`save.ts`).
 */
export function createMobileDesktopApi(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
  saveOptions: MobileSaveApiOptions = { locale: () => 'en' },
): MobileDesktopApi {
  return {
    ...createMobileReadApi(client, sessions),
    ...createMobileSaveApi(client, sessions, saveOptions),
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
