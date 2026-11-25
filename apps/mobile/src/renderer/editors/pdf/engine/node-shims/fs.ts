/**
 * Stand-in for `node:fs` inside the PC PDF save code on the phone (see
 * engine/build/nodeShimPlugin.ts for where it applies). Reads come from the
 * virtual file table; every write throws "not available on mobile".
 */
import { Buffer } from 'buffer'
import { notOnMobile } from './unsupported'
import { encodeRead, enoent, statOf, vfsGet, vfsIsDir, vfsIsFile, vfsList } from './vfs'
import * as promises from './fs-promises'

export { promises }

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
} as const

export function readFileSync(path: unknown, options?: unknown): Buffer | string {
  const bytes = vfsGet(path)
  if (bytes === undefined) throw enoent('open', path)
  return encodeRead(bytes, options)
}

export function existsSync(path: unknown): boolean {
  return vfsIsFile(path) || vfsIsDir(path)
}

export function statSync(path: unknown) {
  return statOf(path, 'stat')
}

export const lstatSync = statSync

interface Dirent {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export function readdirSync(path: unknown, options?: unknown): string[] | Dirent[] {
  if (!vfsIsDir(path)) throw enoent('scandir', path)
  const entries = vfsList(path)
  const withTypes =
    !!options && typeof options === 'object' && 'withFileTypes' in options && options.withFileTypes
  if (!withTypes) return entries.map((e) => e.name)
  return entries.map((e) => ({
    name: e.name,
    isFile: () => !e.dir,
    isDirectory: () => e.dir,
    isSymbolicLink: () => false,
  }))
}

// ── Read-only file descriptors (font-metrics reads single tables by offset) ──

const descriptors = new Map<number, Uint8Array>()
let nextFd = 100

export function openSync(path: unknown, flags: unknown = 'r'): number {
  if (flags !== 'r' && flags !== 'rs' && flags !== 0) notOnMobile(`fs.openSync(${String(flags)})`)
  const bytes = vfsGet(path)
  if (bytes === undefined) throw enoent('open', path)
  const fd = nextFd++
  descriptors.set(fd, bytes)
  return fd
}

function descriptor(fd: number): Uint8Array {
  const bytes = descriptors.get(fd)
  if (!bytes) {
    throw Object.assign(new Error('EBADF: bad file descriptor'), { code: 'EBADF', errno: -9 })
  }
  return bytes
}

export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number | null,
): number {
  const bytes = descriptor(fd)
  const start = Math.max(0, position ?? 0)
  const end = Math.min(bytes.byteLength, start + length)
  if (end <= start) return 0
  buffer.set(bytes.subarray(start, end), offset)
  return end - start
}

export function fstatSync(fd: number) {
  const size = descriptor(fd).byteLength
  return {
    size,
    mtimeMs: 0,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  }
}

export function closeSync(fd: number): void {
  descriptor(fd)
  descriptors.delete(fd)
}

// ── Writes: never on the phone ──

export const writeFileSync = (): never => notOnMobile('fs.writeFileSync')
export const appendFileSync = (): never => notOnMobile('fs.appendFileSync')
export const writeSync = (): never => notOnMobile('fs.writeSync')
export const mkdirSync = (): never => notOnMobile('fs.mkdirSync')
export const renameSync = (): never => notOnMobile('fs.renameSync')
export const unlinkSync = (): never => notOnMobile('fs.unlinkSync')
export const rmSync = (): never => notOnMobile('fs.rmSync')
export const copyFileSync = (): never => notOnMobile('fs.copyFileSync')
export const fsyncSync = (): never => notOnMobile('fs.fsyncSync')
export const createWriteStream = (): never => notOnMobile('fs.createWriteStream')
export const createReadStream = (): never => notOnMobile('fs.createReadStream')
export const watch = (): never => notOnMobile('fs.watch')

const fs = {
  constants,
  promises,
  readFileSync,
  existsSync,
  statSync,
  lstatSync,
  readdirSync,
  openSync,
  readSync,
  fstatSync,
  closeSync,
  writeFileSync,
  appendFileSync,
  writeSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  rmSync,
  copyFileSync,
  fsyncSync,
  createWriteStream,
  createReadStream,
  watch,
}

export default fs
