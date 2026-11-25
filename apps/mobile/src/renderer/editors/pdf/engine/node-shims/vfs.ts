/**
 * The virtual file table behind the `node:fs` stand-in. The PC save code reads
 * its wasm and font files by path; on the phone those bytes are loaded once
 * (engine/assets.ts) and placed here under the paths the PC code asks for.
 * A path that is not in the table does not exist, so the PC code takes the
 * same branch it takes for a missing file on a PC.
 *
 * Paths are POSIX and matched exactly. Directories exist implicitly: every
 * parent of a stored file is one.
 */
import { Buffer } from 'buffer'

/** Writes are refused everywhere except here: an in-memory sink the engine
    hands to the PC save function as its target and reads back afterwards. */
export const SAVE_SINK_DIR = '/ieum-mobile/save-sink'

const files = new Map<string, Uint8Array>()

export function normalizeVfsPath(path: unknown): string {
  const raw = path instanceof URL ? path.pathname : String(path)
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return raw.startsWith('/') ? `/${parts.join('/')}` : parts.join('/')
}

export function vfsPut(path: string, bytes: Uint8Array): void {
  files.set(normalizeVfsPath(path), bytes)
}

export function vfsDelete(path: string): boolean {
  return files.delete(normalizeVfsPath(path))
}

export function vfsGet(path: unknown): Uint8Array | undefined {
  return files.get(normalizeVfsPath(path))
}

export function vfsIsFile(path: unknown): boolean {
  return files.has(normalizeVfsPath(path))
}

export function vfsIsDir(path: unknown): boolean {
  const dir = normalizeVfsPath(path)
  const prefix = dir === '/' ? '/' : `${dir}/`
  for (const key of files.keys()) if (key.startsWith(prefix)) return true
  return false
}

/** Names directly inside `path`, sorted, each tagged as file or directory */
export function vfsList(path: unknown): { name: string; dir: boolean }[] {
  const dir = normalizeVfsPath(path)
  const prefix = dir === '/' ? '/' : `${dir}/`
  const out = new Map<string, boolean>()
  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const slash = rest.indexOf('/')
    const name = slash < 0 ? rest : rest.slice(0, slash)
    if (name) out.set(name, (out.get(name) ?? false) || slash >= 0)
  }
  return [...out.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, isDir]) => ({ name, dir: isDir }))
}

export function inSaveSink(path: unknown): boolean {
  return normalizeVfsPath(path).startsWith(`${SAVE_SINK_DIR}/`)
}

/** Node-shaped "no such file" error (code ENOENT), as fs would throw it */
export function enoent(syscall: string, path: unknown): Error {
  const p = String(path)
  return Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall,
    path: p,
  })
}

export const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Bytes of a value fs.writeFile accepts (string as UTF-8) */
export function bytesOf(data: unknown): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  throw new TypeError('unsupported data for a virtual file write')
}

export function encodeRead(bytes: Uint8Array, options: unknown): Buffer | string {
  const encoding =
    typeof options === 'string'
      ? options
      : options && typeof options === 'object' && 'encoding' in options
        ? (options as { encoding?: string | null }).encoding
        : undefined
  const buf = Buffer.from(bytes)
  return encoding ? buf.toString(encoding as BufferEncoding) : buf
}

export interface VfsStats {
  size: number
  mtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export function statOf(path: unknown, syscall: string): VfsStats {
  const file = vfsGet(path)
  const dir = file === undefined && vfsIsDir(path)
  if (file === undefined && !dir) throw enoent(syscall, path)
  return {
    size: file?.byteLength ?? 0,
    mtimeMs: 0,
    isFile: () => file !== undefined,
    isDirectory: () => dir,
    isSymbolicLink: () => false,
  }
}
