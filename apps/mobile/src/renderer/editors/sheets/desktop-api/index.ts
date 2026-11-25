import type { DesktopApi } from '../../../../../../sheets/src/shared/desktop-api'
import type { SheetsEngineClient } from './engine'
import { createMobileReadApi } from './read'
import { MobileWorkbookSessions } from './sessions'

export { callSheetsEngine, SheetsEngineError, type SheetsEngineClient } from './engine'
export { openMobileWorkbook, type OpenMobileWorkbookInput } from './open'
export { MobileWorkbookSessions, type MobileWorkbookSession } from './sessions'

/** The desktop API methods the phone implements so far (one file per area; saving comes later). */
export type MobileDesktopApi = ReturnType<typeof createMobileReadApi>

/**
 * The phone's `window.desktopApi`: the methods the reused PC grid modules call,
 * each one over the in-process engine. Areas live in their own files and are
 * spread here (read side now; the save side is a later file).
 */
export function createMobileDesktopApi(
  client: SheetsEngineClient,
  sessions: MobileWorkbookSessions,
): MobileDesktopApi {
  return {
    ...createMobileReadApi(client, sessions),
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
