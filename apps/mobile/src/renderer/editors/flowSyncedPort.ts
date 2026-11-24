import type { MobileHwpEditorPort } from '@genoffice/mobile-bridge/hwp'

/**
 * The page editor's port, but every call first hands pending flow-view edits
 * to the page editor. Save, share, recovery copies and AI all read the
 * document through this port, so they always see what the user typed in the
 * flow view.
 */
export function createFlowSyncedPort(
  getPort: () => MobileHwpEditorPort | null | undefined,
  flush: () => Promise<void>,
): MobileHwpEditorPort {
  const ready = async (): Promise<MobileHwpEditorPort> => {
    await flush()
    const port = getPort()
    if (!port) throw new Error('HWP editor is not ready.')
    return port
  }
  return {
    isPasswordProtected: async () => (await ready()).isPasswordProtected(),
    exportHwp: async () => (await ready()).exportHwp(),
    exportHwpx: async () => (await ready()).exportHwpx(),
    exportHwpVerify: async () => (await ready()).exportHwpVerify(),
    measureTabs: async (spots) => (await ready()).measureTabs(spots),
    getPlainText: async () => (await ready()).getPlainText(),
    replaceText: async (find, replace) => (await ready()).replaceText(find, replace),
    notifySaved: async (fileName) => (await ready()).notifySaved(fileName),
  }
}
