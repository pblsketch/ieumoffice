/**
 * The in-memory layer's backend on the phone: the T1 work folder through the
 * `mobile_sheets_temp_*` commands.
 */
import {
  sheetsTempAppendBytes,
  sheetsTempAppendText,
  sheetsTempCopy,
  sheetsTempDelete,
  sheetsTempMkdir,
  sheetsTempReadRaw,
  sheetsTempRename,
  sheetsTempRoot,
  sheetsTempStat,
  sheetsTempWriteBytes,
  sheetsTempWriteText,
} from '@genoffice/mobile-bridge/sheets'
import type { SheetsEngineClient } from '../desktop-api/engine'
import { bytesToBase64 } from '../node-shims/buffer'
import { mobileVfs, type MobileVfs, type VfsBackend } from '../node-shims/vfs'

export function tauriWorkFolderBackend(client: SheetsEngineClient): VfsBackend {
  return {
    mkdir: async (path) => {
      await sheetsTempMkdir(client, path)
    },
    remove: async (path) => {
      await sheetsTempDelete(client, path)
    },
    rename: async (from, to) => {
      await sheetsTempRename(client, from, to)
    },
    copy: async (from, to) => {
      await sheetsTempCopy(client, from, to)
    },
    stat: (path) => sheetsTempStat(client, path),
    read: (path, range) => sheetsTempReadRaw(client, path, range),
    write: async (path, content, append) => {
      if (typeof content === 'string') {
        if (append) await sheetsTempAppendText(client, path, content)
        else await sheetsTempWriteText(client, path, content)
      } else {
        const encoded = bytesToBase64(content)
        if (append) await sheetsTempAppendBytes(client, path, encoded)
        else await sheetsTempWriteBytes(client, path, encoded)
      }
    },
  }
}

/** Points the shared in-memory layer at this client's work folder (once per client). */
export async function ensureWorkFolder(
  client: SheetsEngineClient,
  vfs: MobileVfs = mobileVfs,
): Promise<MobileVfs> {
  if (configuredFor.get(vfs) !== client) {
    const { path } = await sheetsTempRoot(client)
    vfs.configure(tauriWorkFolderBackend(client), path)
    configuredFor.set(vfs, client)
  }
  return vfs
}

const configuredFor = new WeakMap<MobileVfs, SheetsEngineClient>()
