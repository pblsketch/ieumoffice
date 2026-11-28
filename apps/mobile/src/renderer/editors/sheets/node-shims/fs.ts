/**
 * The phone's `node:fs` for the spreadsheet save modules: synchronous calls
 * served from the in-memory layer (`vfs.ts`). Only the functions those
 * modules import exist here.
 */
import { Buffer, type BufferBytes } from './buffer'
import { mobileVfs } from './vfs'

type ReadOptions = BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null

function encodingOf(options: ReadOptions | undefined): string | null {
  if (options == null) return null
  if (typeof options === 'string') return options
  return options.encoding ?? null
}

export function readFileSync(path: string, options?: ReadOptions): string | BufferBytes {
  const bytes = mobileVfs.readFileSync(path)
  const encoding = encodingOf(options)
  if (encoding === null) return Buffer.fromBytes(bytes)
  if (encoding !== 'utf8' && encoding !== 'utf-8') {
    throw new Error(`readFileSync: encoding ${encoding} is not supported here`)
  }
  return new TextDecoder().decode(bytes)
}

export function writeFileSync(
  path: string,
  data: string | Uint8Array,
  options?: BufferEncoding | { flag?: string } | null,
): void {
  const flag = typeof options === 'object' && options !== null ? options.flag : undefined
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  mobileVfs.writeFileSync(path, bytes, flag === 'wx')
}

export function openSync(path: string, flags: string = 'r'): number {
  return mobileVfs.openSync(path, flags)
}

export function writeSync(
  descriptor: number,
  buffer: Uint8Array,
  offset?: number,
  length?: number,
): number {
  return mobileVfs.writeSync(descriptor, buffer, offset, length)
}

export function fsyncSync(descriptor: number): void {
  mobileVfs.fsyncSync(descriptor)
}

export function closeSync(descriptor: number): void {
  mobileVfs.closeSync(descriptor)
}

export function existsSync(path: string): boolean {
  return mobileVfs.has(path)
}

export default {
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  existsSync,
}
