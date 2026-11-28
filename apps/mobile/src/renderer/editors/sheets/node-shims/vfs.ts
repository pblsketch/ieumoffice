/**
 * The in-memory file layer behind the phone's stand-ins for `node:fs`,
 * `node:fs/promises` and `node:os` (see `config/tracks/sheets.ts`).
 *
 * The spreadsheet save code (`@genoffice/xlsx-gateway`'s
 * `saveWorkbookViaSidecar`) reads extracted entries and writes patched ones
 * with synchronous Node calls, while the engine reads and writes real files
 * in the T1 work folder. A WebView cannot touch those files synchronously, so:
 *
 * - paths are the real work-folder paths (`tmpdir()` is the work folder);
 * - an entry the engine extracted is fetched into memory first
 *   (`prefetch`), and the synchronous read is served from there;
 * - synchronous writes land in memory, and `flush` hands them to the work
 *   folder before the engine reads them (`save_archive`);
 * - asynchronous calls (`mkdir`, `rename`, `rm`, `stat`, ...) go to the work
 *   folder through the backend (Tauri commands on the phone).
 *
 * A prefetched entry is read once (`consumeOnRead`): the save code caches the
 * text it read, and dropping the bytes keeps one copy of a large sheet in
 * memory instead of two. A second read of such a path fails loudly.
 */

/** Work-folder operations the layer needs (Tauri commands on the phone, a folder in tests). */
export interface VfsBackend {
  mkdir(path: string): Promise<void>
  /** Removes a file or folder; a missing path is not an error. */
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  stat(path: string): Promise<{ size: number; isFile: boolean; isDir: boolean } | null>
  read(path: string, range?: { offset: number; length: number }): Promise<Uint8Array>
  /** Writes (or, with `append`, extends) a file with text (as UTF-8) or bytes. */
  write(path: string, content: string | Uint8Array, append: boolean): Promise<void>
}

/** Node-style error with a `code`, as the save code's error checks expect. */
export function fsError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

interface MemoryFile {
  chunks: Uint8Array[]
  size: number
  /** Written here and not yet handed to the work folder. */
  dirty: boolean
  /** Fetched from the work folder for one read. */
  consumeOnRead: boolean
}

interface Descriptor {
  readonly path: string
  /** A real work-folder file opened for `fsync` only (nothing is held in memory). */
  readonly passthrough: boolean
}

/** Pieces handed to the work folder are at most this large (one IPC message each). */
export const FLUSH_CHUNK_BYTES = 4 * 1024 * 1024

export interface VfsStats {
  /** Bytes held in memory right now. */
  readonly heldBytes: number
  /** The most bytes held at once since the last `resetPeak`. */
  readonly peakBytes: number
}

export class MobileVfs {
  private backend: VfsBackend | null = null
  private root: string | null = null
  private readonly files = new Map<string, MemoryFile>()
  private readonly descriptors = new Map<number, Descriptor>()
  private nextDescriptor = 3
  private held = 0
  private peak = 0

  /** Points the layer at the work folder. The save code may run only after this. */
  configure(backend: VfsBackend, workFolder: string): void {
    this.backend = backend
    this.root = trimSlash(workFolder)
  }

  get configured(): boolean {
    return this.backend !== null && this.root !== null
  }

  tmpdir(): string {
    if (this.root === null) throw new Error('The spreadsheet work folder is not set up yet.')
    return this.root
  }

  io(): VfsBackend {
    if (this.backend === null) throw new Error('The spreadsheet work folder is not set up yet.')
    return this.backend
  }

  stats(): VfsStats {
    return { heldBytes: this.held, peakBytes: this.peak }
  }

  resetPeak(): void {
    this.peak = this.held
  }

  has(path: string): boolean {
    return this.files.has(path)
  }

  /** Fetches a work-folder file into memory for the next synchronous read. */
  async prefetch(path: string): Promise<void> {
    const bytes = await this.io().read(path)
    this.store(path, { chunks: [bytes], size: bytes.byteLength, dirty: false, consumeOnRead: true })
  }

  /**
   * Hands a file written in memory to the work folder (in pieces) and drops
   * it from memory. A path that was not written here is left alone.
   */
  async flush(path: string): Promise<void> {
    const file = this.files.get(path)
    if (!file || !file.dirty) return
    const io = this.io()
    const pieces = coalesce(file.chunks, FLUSH_CHUNK_BYTES)
    file.chunks = []
    if (pieces.length === 0) {
      await io.write(path, new Uint8Array(0), false)
    }
    for (let index = 0; index < pieces.length; index += 1) {
      await io.write(path, asTextIfUtf8(pieces[index]!), index > 0)
      // Let the piece go as soon as it is on disk.
      pieces[index] = EMPTY
    }
    this.files.delete(path)
    this.release(file.size)
  }

  /** Forgets in-memory files at or under `path` (no work-folder call). */
  forget(path: string): void {
    const prefix = `${trimSlash(path)}/`
    for (const [name, file] of [...this.files]) {
      if (name === path || name.startsWith(prefix)) {
        this.files.delete(name)
        this.release(file.size)
      }
    }
  }

  /** Moves an in-memory file (no work-folder call). */
  moveInMemory(from: string, to: string): boolean {
    const file = this.files.get(from)
    if (!file) return false
    this.files.delete(from)
    const replaced = this.files.get(to)
    if (replaced) this.release(replaced.size)
    this.files.set(to, file)
    return true
  }

  sizeOf(path: string): number | undefined {
    return this.files.get(path)?.size
  }

  // ---- synchronous calls (node:fs) ----

  readFileSync(path: string): Uint8Array {
    const file = this.files.get(path)
    if (!file) {
      throw fsError('ENOENT', `${path} is not loaded into memory (prefetch it first)`)
    }
    const bytes = concat(file.chunks, file.size)
    if (file.consumeOnRead) {
      this.files.delete(path)
      this.release(file.size)
    }
    return bytes
  }

  writeFileSync(path: string, data: Uint8Array, exclusive: boolean): void {
    if (exclusive && this.files.has(path)) throw fsError('EEXIST', `${path} already exists`)
    const copy = data.slice()
    this.store(path, { chunks: [copy], size: copy.byteLength, dirty: true, consumeOnRead: false })
  }

  openSync(path: string, flags: string): number {
    const exists = this.files.has(path)
    if (flags === 'wx' || flags === 'wx+') {
      if (exists) throw fsError('EEXIST', `${path} already exists`)
      this.store(path, { chunks: [], size: 0, dirty: true, consumeOnRead: false })
    } else if (flags === 'w' || flags === 'w+') {
      this.store(path, { chunks: [], size: 0, dirty: true, consumeOnRead: false })
    } else if (flags === 'a' || flags === 'a+') {
      if (!exists) this.store(path, { chunks: [], size: 0, dirty: true, consumeOnRead: false })
    } else if (flags !== 'r' && flags !== 'r+') {
      throw fsError('EINVAL', `open flags ${flags} are not supported here`)
    }
    const descriptor = this.nextDescriptor
    this.nextDescriptor += 1
    // `r+` on a file the engine wrote (the save code's fsync before a rename):
    // nothing to hold, the work folder already has it.
    this.descriptors.set(descriptor, { path, passthrough: !this.files.has(path) })
    return descriptor
  }

  writeSync(descriptor: number, buffer: Uint8Array, offset = 0, length?: number): number {
    const open = this.descriptors.get(descriptor)
    if (!open) throw fsError('EBADF', `descriptor ${descriptor} is not open`)
    const file = this.files.get(open.path)
    if (open.passthrough || !file) {
      throw fsError('EBADF', `${open.path} is not open for writing in memory`)
    }
    const end = length === undefined ? buffer.byteLength : offset + length
    const piece = buffer.slice(offset, end)
    file.chunks.push(piece)
    file.size += piece.byteLength
    file.dirty = true
    this.hold(piece.byteLength)
    return piece.byteLength
  }

  fsyncSync(descriptor: number): void {
    if (!this.descriptors.has(descriptor)) throw fsError('EBADF', `descriptor ${descriptor}`)
    // Durability is the work folder's: Rust writes each flushed piece to disk.
  }

  closeSync(descriptor: number): void {
    if (!this.descriptors.delete(descriptor)) throw fsError('EBADF', `descriptor ${descriptor}`)
  }

  private store(path: string, file: MemoryFile): void {
    const previous = this.files.get(path)
    if (previous) this.release(previous.size)
    this.files.set(path, file)
    this.hold(file.size)
  }

  private hold(bytes: number): void {
    this.held += bytes
    if (this.held > this.peak) this.peak = this.held
  }

  private release(bytes: number): void {
    this.held = Math.max(0, this.held - bytes)
  }
}

const EMPTY = new Uint8Array(0)

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Joins small pieces up to `limit` bytes; larger pieces are split. */
function coalesce(chunks: readonly Uint8Array[], limit: number): Uint8Array[] {
  const out: Uint8Array[] = []
  let pending: Uint8Array[] = []
  let pendingSize = 0
  const emit = () => {
    if (pendingSize === 0) return
    out.push(concat(pending, pendingSize))
    pending = []
    pendingSize = 0
  }
  for (const chunk of chunks) {
    if (chunk.byteLength >= limit) {
      emit()
      out.push(chunk)
      continue
    }
    if (pendingSize + chunk.byteLength > limit) emit()
    pending.push(chunk)
    pendingSize += chunk.byteLength
  }
  emit()
  return out
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Text travels as a JSON string (cheaper than base64 for XML); anything that
 * is not whole UTF-8 travels as bytes. The save code writes each string slice
 * as one complete UTF-8 run, so a sheet part decodes piece by piece.
 */
function asTextIfUtf8(piece: Uint8Array): string | Uint8Array {
  try {
    return strictUtf8.decode(piece)
  } catch {
    return piece
  }
}

/** The one layer the stand-in modules share. */
export const mobileVfs = new MobileVfs()
