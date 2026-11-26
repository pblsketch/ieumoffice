/**
 * The phone's `node:fs/promises` for the spreadsheet save and open modules.
 * Asynchronous calls reach the T1 work folder through the backend (Tauri);
 * files written in memory (`vfs.ts`) are handed over first where a call needs
 * them on disk.
 */
import { Buffer, type BufferBytes } from './buffer'
import { fsError, mobileVfs } from './vfs'

export async function mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
  await mobileVfs.io().mkdir(path)
}

/** Creates `<prefix>XXXXXX` (as Node does) and returns its path. */
export async function mkdtemp(prefix: string): Promise<string> {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  const path = `${prefix}${suffix}`
  await mobileVfs.io().mkdir(path)
  return path
}

export async function rm(
  path: string,
  _options?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  mobileVfs.forget(path)
  await mobileVfs.io().remove(path)
}

export async function unlink(path: string): Promise<void> {
  const known = mobileVfs.has(path)
  mobileVfs.forget(path)
  const found = await mobileVfs.io().stat(path)
  if (!found && !known) throw fsError('ENOENT', path)
  await mobileVfs.io().remove(path)
}

export async function rename(from: string, to: string): Promise<void> {
  if (mobileVfs.has(from)) await mobileVfs.flush(from)
  await mobileVfs.io().rename(from, to)
}

export async function copyFile(from: string, to: string, _mode?: number): Promise<void> {
  if (mobileVfs.has(from)) await mobileVfs.flush(from)
  await mobileVfs.io().copy(from, to)
}

export interface MobileStats {
  readonly size: number
  readonly mtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
}

export async function stat(path: string): Promise<MobileStats> {
  const inMemory = mobileVfs.sizeOf(path)
  if (inMemory !== undefined) {
    return { size: inMemory, mtimeMs: 0, isFile: () => true, isDirectory: () => false }
  }
  const found = await mobileVfs.io().stat(path)
  if (!found) throw fsError('ENOENT', path)
  return {
    size: found.size,
    mtimeMs: 0,
    isFile: () => found.isFile,
    isDirectory: () => found.isDir,
  }
}

export async function readFile(
  path: string,
  options?: BufferEncoding | { encoding?: BufferEncoding | null } | null,
): Promise<string | BufferBytes> {
  const bytes = mobileVfs.has(path) ? mobileVfs.readFileSync(path) : await mobileVfs.io().read(path)
  const encoding = typeof options === 'string' ? options : (options?.encoding ?? null)
  if (encoding === null) return Buffer.fromBytes(bytes)
  return new TextDecoder().decode(bytes)
}

export async function writeFile(path: string, data: string | Uint8Array): Promise<void> {
  mobileVfs.forget(path)
  await mobileVfs.io().write(path, data, false)
}

export interface MobileFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number; buffer: Uint8Array }>
  close(): Promise<void>
}

/** A read-only handle: `read` fetches the asked range from the work folder. */
export async function open(path: string, flags: string = 'r'): Promise<MobileFileHandle> {
  if (flags !== 'r') throw new Error(`open: flags ${flags} are not supported here`)
  if (!(await mobileVfs.io().stat(path))) throw fsError('ENOENT', path)
  let cursor = 0
  return {
    async read(buffer, offset, length, position) {
      const from = position ?? cursor
      const bytes = await mobileVfs.io().read(path, { offset: from, length })
      buffer.set(bytes, offset)
      cursor = from + bytes.byteLength
      return { bytesRead: bytes.byteLength, buffer }
    },
    async close() {},
  }
}

export default {
  mkdir,
  mkdtemp,
  rm,
  unlink,
  rename,
  copyFile,
  stat,
  readFile,
  writeFile,
  open,
}
