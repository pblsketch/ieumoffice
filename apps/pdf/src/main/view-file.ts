/** Immutable, file-backed input shared by range loading and bitmap rendering. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, open, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { SaveDiskState } from '@genoffice/electron-utils'
import { hasXfaMarker } from '../shared/xfa-marker'
import { PDF_VIEW_RANGE_CHUNK_BYTES } from '../shared/view-source'

export interface PdfViewFile {
  readonly fd: number
  readonly size: number
  readonly diskState: SaveDiskState | null
  readonly hasXfa: boolean
  read(offset: number, length: number): Promise<Uint8Array>
  close(): Promise<void>
}

export async function snapshotPdfViewFile(
  path: string,
  cacheDir: string,
  replacement?: Uint8Array,
): Promise<PdfViewFile> {
  const root = resolve(cacheDir)
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'view-'))
  const inside = relative(root, resolve(dir))
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || resolve(dir) === root)
    throw new Error('pdf: snapshot is outside its cache directory')
  const snapshot = join(dir, 'source.pdf')
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const before = replacement ? null : await stat(path)
    if (replacement) await writeFile(snapshot, replacement, { flag: 'wx' })
    else await copyFile(path, snapshot, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
    const after = replacement ? null : await stat(path)
    if (
      before &&
      after &&
      (before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs)
    )
      throw new Error('pdf: source changed while it was being opened')
    handle = await open(snapshot, 'r')
    const size = (await handle.stat()).size
    if (size !== (replacement?.byteLength ?? before!.size))
      throw new Error('pdf: incomplete view snapshot')
    await unlink(snapshot)
    const file = handle
    const hash = createHash('sha256')
    const chunkSize = PDF_VIEW_RANGE_CHUNK_BYTES
    const buffer = new Uint8Array(chunkSize + 4)
    let xfa = false
    for (let position = 0; position < size; position += chunkSize) {
      const amount = Math.min(buffer.length, size - position)
      let done = 0
      while (done < amount) {
        const { bytesRead } = await file.read(buffer, done, amount - done, position + done)
        if (!bytesRead) throw new Error('pdf: incomplete view snapshot')
        done += bytesRead
      }
      hash.update(buffer.subarray(0, Math.min(chunkSize, size - position)))
      xfa ||= hasXfaMarker(buffer.subarray(0, amount), position + amount === size)
    }
    const diskState = replacement
      ? null
      : { size, mtimeMs: before!.mtimeMs, hash: hash.digest('hex') }
    let closing: Promise<void> | undefined
    let readers = 0
    let readersFinished: (() => void) | undefined
    return {
      fd: file.fd,
      size,
      diskState,
      hasXfa: xfa,
      async read(offset, length) {
        if (closing) throw new Error('pdf: view snapshot is closed')
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          length > PDF_VIEW_RANGE_CHUNK_BYTES ||
          offset > size ||
          length > size - offset
        )
          throw new Error('pdf: read outside the view snapshot')
        readers++
        try {
          const data = new Uint8Array(length)
          let done = 0
          while (done < length) {
            const { bytesRead } = await file.read(data, done, length - done, offset + done)
            if (!bytesRead) throw new Error('pdf: incomplete view snapshot')
            done += bytesRead
          }
          return data
        } finally {
          if (--readers === 0) readersFinished?.()
        }
      },
      close() {
        return (closing ??= (async () => {
          if (readers)
            await new Promise<void>((done) => {
              readersFinished = done
            })
          await file.close()
          await rm(dir, { recursive: true, force: true, maxRetries: 3 })
        })())
      },
    }
  } catch (error) {
    await handle?.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}
