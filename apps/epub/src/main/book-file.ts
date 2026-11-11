/** Immutable, file-backed book bytes. No handle or path crosses IPC. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, open, rm, stat, unlink, type FileHandle } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { atomicWriteVia } from '@genoffice/electron-utils/atomic-write'
import type { ZipByteSource, ZipByteLease } from '@genoffice/zip-gate'

export interface BookFileSource extends ZipByteSource {
  readonly mtimeMs: number
  docHash(): Promise<string>
  close(): Promise<void>
}

async function snapshotDirectory(cacheDir: string): Promise<string> {
  const root = resolve(cacheDir)
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'book-'))
  const inside = relative(root, resolve(dir))
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || resolve(dir) === root)
    throw new Error('epub: snapshot is outside its cache directory')
  return dir
}

function ownedSource(
  handle: FileHandle,
  dir: string,
  size: number,
  mtimeMs: number,
  knownHash?: string,
): BookFileSource {
  let closing: Promise<void> | undefined
  let closed = false
  let users = 0
  let usersFinished: (() => void) | undefined
  const finished = () => {
    if (--users === 0) usersFinished?.()
  }
  async function read(offset: number, length: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > size ||
      length > size - offset
    )
      throw new Error('epub: read outside the snapshot')
    const bytes = new Uint8Array(length)
    for (let done = 0; done < length;) {
      const { bytesRead } = await handle.read(bytes, done, length - done, offset + done)
      if (!bytesRead) throw new Error('epub: incomplete book snapshot')
      done += bytesRead
    }
    return bytes
  }
  async function withFile<T>(use: () => Promise<T>): Promise<T> {
    if (closed) throw new Error('epub: book snapshot is closed')
    users++
    try {
      return await use()
    } finally {
      finished()
    }
  }
  return {
    size,
    mtimeMs,
    read: (offset, length) => withFile(() => read(offset, length)),
    lease(): ZipByteLease {
      if (closed) throw new Error('epub: book snapshot is closed')
      users++
      let released = false
      let reads = 0
      let readsFinished: (() => void) | undefined
      let releasing: Promise<void> | undefined
      return {
        size,
        async read(offset, length) {
          if (released) throw new Error('epub: source lease is released')
          reads++
          try {
            return await read(offset, length)
          } finally {
            if (--reads === 0) readsFinished?.()
          }
        },
        release() {
          return (releasing ??= (async () => {
            released = true
            if (reads)
              await new Promise<void>((done) => {
                readsFinished = done
              })
            finished()
          })())
        },
      }
    },
    docHash: () =>
      withFile(async () => {
        if (knownHash) return knownHash
        const hash = createHash('sha256')
        const buffer = new Uint8Array(1024 * 1024)
        for (let at = 0; at < size;) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - at), at)
          if (!bytesRead) throw new Error('epub: incomplete book snapshot')
          hash.update(buffer.subarray(0, bytesRead))
          at += bytesRead
        }
        return (knownHash = hash.digest('hex'))
      }),
    close() {
      closed = true
      return (closing ??= (async () => {
        if (users)
          await new Promise<void>((done) => {
            usersFinished = done
          })
        await handle.close()
        await rm(dir, { recursive: true, force: true, maxRetries: 3 })
      })())
    },
  }
}

/** Pin a private copy, then unlink it; the OS reclaims it even on process exit. */
export async function snapshotBookFile(path: string, cacheDir: string): Promise<BookFileSource> {
  const dir = await snapshotDirectory(cacheDir)
  const snapshot = join(dir, 'source.epub')
  let file: FileHandle | undefined
  try {
    const before = await stat(path)
    await copyFile(path, snapshot, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
    const after = await stat(path)
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('epub: source changed while it was being opened')
    file = await open(snapshot, 'r')
    if ((await file.stat()).size !== before.size) throw new Error('epub: incomplete book snapshot')
    await unlink(snapshot)
    return ownedSource(file, dir, before.size, before.mtimeMs)
  } catch (error) {
    await file?.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}

/** Build a private immutable save without holding its complete output in memory. */
export async function createBookFile(
  cacheDir: string,
  produce: (write: (bytes: Uint8Array) => Promise<void>) => Promise<void>,
): Promise<BookFileSource> {
  const dir = await snapshotDirectory(cacheDir)
  const path = join(dir, 'saved.epub')
  let file: FileHandle | undefined
  try {
    file = await open(path, 'wx+')
    const handle = file
    const hash = createHash('sha256')
    let size = 0
    await produce(async (bytes) => {
      if (bytes.length > 2 * 1024 * 1024 * 1024 - size)
        throw new Error('epub: saved book is too large')
      await writeChunk(handle, bytes, size)
      size += bytes.length
      hash.update(bytes)
    })
    await unlink(path)
    return ownedSource(handle, dir, size, Date.now(), hash.digest('hex'))
  } catch (error) {
    await file?.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}

async function writeChunk(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  for (let done = 0; done < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done)
    if (!bytesWritten) throw new Error('epub: incomplete book write')
    done += bytesWritten
  }
}

/** Preserve the common atomic writer's flush/retry/fallback contract. */
export async function publishBookFile(path: string, source: ZipByteSource): Promise<void> {
  const lease = source.lease?.()
  const pinned = lease ?? source
  try {
    await atomicWriteVia(path, async (temp) => {
      const handle = await open(temp, 'wx')
      try {
        for (let at = 0; at < pinned.size; at += 1024 * 1024)
          await writeChunk(
            handle,
            await pinned.read(at, Math.min(1024 * 1024, pinned.size - at)),
            at,
          )
      } finally {
        await handle.close()
      }
    })
  } finally {
    await lease?.release()
  }
}
