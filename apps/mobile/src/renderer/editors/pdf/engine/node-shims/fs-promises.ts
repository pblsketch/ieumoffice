/**
 * Stand-in for `node:fs/promises` inside the PC PDF save code on the phone.
 * Reads come from the virtual file table. Writes are refused, except inside
 * the in-memory save sink (vfs.ts SAVE_SINK_DIR): the engine names a sink path
 * as the PC save function's target so the PC function runs unchanged, and
 * reads the bytes back from the table. Nothing reaches a real file.
 */
import { notOnMobile } from './unsupported'
import {
  bytesOf,
  encodeRead,
  enoent,
  inSaveSink,
  statOf,
  vfsDelete,
  vfsGet,
  vfsIsDir,
  vfsIsFile,
  vfsPut,
} from './vfs'

export async function readFile(path: unknown, options?: unknown) {
  const bytes = vfsGet(path)
  if (bytes === undefined) throw enoent('open', path)
  return encodeRead(bytes, options)
}

export async function writeFile(path: unknown, data: unknown): Promise<void> {
  if (!inSaveSink(path)) notOnMobile(`fs.promises.writeFile(${String(path)})`)
  vfsPut(String(path), bytesOf(data).slice())
}

export async function rename(from: unknown, to: unknown): Promise<void> {
  if (!inSaveSink(from) || !inSaveSink(to)) notOnMobile(`fs.promises.rename(${String(to)})`)
  const bytes = vfsGet(from)
  if (bytes === undefined) throw enoent('rename', from)
  vfsDelete(String(from))
  vfsPut(String(to), bytes)
}

export async function rm(path: unknown, options?: { force?: boolean }): Promise<void> {
  const exists = vfsIsFile(path)
  if (!exists) {
    if (options?.force) return
    throw enoent('rm', path)
  }
  if (!inSaveSink(path)) notOnMobile(`fs.promises.rm(${String(path)})`)
  vfsDelete(String(path))
}

export async function unlink(path: unknown): Promise<void> {
  if (!vfsIsFile(path)) throw enoent('unlink', path)
  if (!inSaveSink(path)) notOnMobile(`fs.promises.unlink(${String(path)})`)
  vfsDelete(String(path))
}

export async function stat(path: unknown) {
  return statOf(path, 'stat')
}

export const lstat = stat

export async function access(path: unknown): Promise<void> {
  if (!vfsIsFile(path) && !vfsIsDir(path)) throw enoent('access', path)
}

export async function realpath(path: unknown): Promise<string> {
  if (!vfsIsFile(path) && !vfsIsDir(path)) throw enoent('realpath', path)
  return String(path)
}

export const open = async (path: unknown): Promise<never> =>
  notOnMobile(`fs.promises.open(${String(path)})`)
export const copyFile = async (): Promise<never> => notOnMobile('fs.promises.copyFile')
export const mkdir = async (): Promise<never> => notOnMobile('fs.promises.mkdir')
export const appendFile = async (): Promise<never> => notOnMobile('fs.promises.appendFile')
export const readdir = async (): Promise<never> => notOnMobile('fs.promises.readdir')

export default {
  readFile,
  writeFile,
  rename,
  rm,
  unlink,
  stat,
  lstat,
  access,
  realpath,
  open,
  copyFile,
  mkdir,
  appendFile,
  readdir,
}
