/** Random-access ZIP validation without retaining the archive's payload. */
import { decompressionStream } from './byte-stream'
import { DEFAULT_ZIP_LIMITS, type ZipLimits } from './index'

export interface ZipByteSource {
  readonly size: number
  /** Exactly length bytes, or an error. The returned bytes belong to the caller. */
  read(offset: number, length: number): Promise<Uint8Array>
  /** Pin a closable immutable source for a consumer that performs several reads. */
  lease?(): ZipByteLease
}

export interface ZipByteLease extends ZipByteSource {
  release(): Promise<void>
}

export interface ZipSourcePart {
  /** Raw central-directory name, used only in diagnostics. */
  name: string
  method: number
  csize: number
  usize: number
  dataStart: number
  directory: boolean
  /** Headers including their variable fields; no payload or data descriptor. */
  localHeader: Uint8Array
  centralHeader: Uint8Array
}

const MAX_HEADER_BYTES = 32 * 1024 * 1024
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

async function read(source: ZipByteSource, at: number, length: number): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(at) ||
    !Number.isSafeInteger(length) ||
    at < 0 ||
    length < 0 ||
    at > source.size ||
    length > source.size - at
  )
    throw new Error('zip: read outside the archive')
  const bytes = await source.read(at, length)
  if (bytes.length !== length) throw new Error('zip: unexpected end of file')
  return bytes
}

/** Coalesce small adjacent header reads without trusting a declared directory size. */
function headerReader(source: ZipByteSource, begin: number, end: number, windowBytes: number) {
  let start = -1
  let bytes: Uint8Array = new Uint8Array(0)
  return async (at: number, length: number): Promise<Uint8Array> => {
    if (at < begin || length < 0 || at > end || length > end - at)
      throw new Error('zip: read outside the archive')
    if (at < start || at + length > start + bytes.length) {
      bytes = await read(source, at, Math.min(Math.max(windowBytes, length), end - at))
      start = at
    }
    return bytes.subarray(at - start, at - start + length)
  }
}

async function scanSource(source: ZipByteSource, limits: ZipLimits): Promise<ZipSourcePart[]> {
  const tailLength = Math.min(source.size, 22 + 0xffff + 20)
  const tail = await read(source, source.size - tailLength, tailLength)
  const tailView = viewOf(tail)
  let end = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('zip: end of central directory not found')
  if (end >= 20 && tailView.getUint32(end - 20, true) === 0x07064b50) {
    throw new Error('zip: zip64 archives are not supported')
  }
  const count = tailView.getUint16(end + 10, true)
  if (
    tailView.getUint16(end + 4, true) !== 0 ||
    tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== count
  ) {
    throw new Error('zip: multi-volume archives are not supported')
  }
  const cdSize = tailView.getUint32(end + 12, true)
  const cdOffset = tailView.getUint32(end + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('zip: zip64 archives are not supported')
  }
  if (cdOffset > source.size || cdSize > source.size - cdOffset) {
    throw new Error('zip: corrupt central directory')
  }
  const central = headerReader(source, cdOffset, cdOffset + cdSize, 1024 * 1024)
  const localHeaders = headerReader(source, 0, source.size, 4096)
  const parts: ZipSourcePart[] = []
  let at = cdOffset
  let headerBytes = 0
  let files = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > cdOffset + cdSize) throw new Error('zip: corrupt central directory')
    const fixed = viewOf(await central(at, 46))
    if (fixed.getUint32(0, true) !== 0x02014b50) throw new Error('zip: corrupt central directory')
    if (fixed.getUint16(8, true) & 1) throw new Error('zip: encrypted entries are not supported')
    const nameLength = fixed.getUint16(28, true)
    const length = 46 + nameLength + fixed.getUint16(30, true) + fixed.getUint16(32, true)
    if (length > cdOffset + cdSize - at) throw new Error('zip: corrupt central directory')
    headerBytes += length
    if (headerBytes > MAX_HEADER_BYTES)
      throw new Error('zip rejected: ZIP headers exceed the 32 MiB limit')
    const centralHeader = new Uint8Array(await central(at, length))
    const nameBytes = centralHeader.subarray(46, 46 + nameLength)
    let name = ''
    for (const byte of nameBytes) name += String.fromCharCode(byte)
    const directory = name.endsWith('/')
    if (!directory && ++files > limits.maxParts) {
      throw new Error(`zip rejected: ${files} parts exceeds the ${limits.maxParts} limit`)
    }
    const csize = fixed.getUint32(20, true)
    const usize = fixed.getUint32(24, true)
    const localOffset = fixed.getUint32(42, true)
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('zip: zip64 archives are not supported')
    }
    if (!directory && usize > limits.maxPartBytes) {
      throw new Error(
        `zip rejected: part ${name} declares ${usize} uncompressed bytes (limit ${limits.maxPartBytes})`,
      )
    }
    const local = viewOf(await localHeaders(localOffset, 30))
    if (local.getUint32(0, true) !== 0x04034b50)
      throw new Error(`zip: corrupt local header for ${name}`)
    const localLength = 30 + local.getUint16(26, true) + local.getUint16(28, true)
    headerBytes += localLength
    if (headerBytes > MAX_HEADER_BYTES)
      throw new Error('zip rejected: ZIP headers exceed the 32 MiB limit')
    const dataStart = localOffset + localLength
    if (dataStart > source.size || csize > source.size - dataStart) {
      throw new Error(
        `zip: entry ${name} declares ${csize} bytes at ${dataStart}, outside the ${source.size}-byte archive`,
      )
    }
    parts.push({
      name,
      method: fixed.getUint16(10, true),
      csize,
      usize,
      dataStart,
      directory,
      localHeader: new Uint8Array(await localHeaders(localOffset, localLength)),
      centralHeader,
    })
    at += length
  }
  return parts
}

export function streamZipSourceCompressed(
  source: ZipByteSource,
  part: ZipSourcePart,
): ReadableStream<Uint8Array> {
  const lease = source.lease?.()
  const pinned = lease ?? source
  let offset = 0
  let stopped = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (offset < part.csize) {
          const length = Math.min(1024 * 1024, part.csize - offset)
          const bytes = await read(pinned, part.dataStart + offset, length)
          if (stopped) return
          controller.enqueue(bytes)
          offset += length
        }
        if (offset === part.csize) {
          stopped = true
          controller.close()
          await lease?.release()
        }
      } catch (error) {
        if (!stopped) {
          stopped = true
          controller.error(error)
        }
        await lease?.release()
      }
    },
    async cancel() {
      stopped = true
      await lease?.release()
    },
  })
}

/** A bounded, size-checked entry body. Cancelling it releases the pinned source. */
export function streamZipSourcePart(
  source: ZipByteSource,
  part: ZipSourcePart,
): ReadableStream<Uint8Array> {
  if (part.method !== 0 && part.method !== 8)
    throw new Error(`zip: unsupported compression method ${part.method} for ${part.name}`)
  const raw = streamZipSourceCompressed(source, part)
  const body = part.method === 8 ? raw.pipeThrough(decompressionStream('deflate-raw')) : raw
  let size = 0
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        size += bytes.length
        if (size > part.usize) throw new Error(`zip: uncompressed size mismatch for ${part.name}`)
        controller.enqueue(bytes)
      },
      flush() {
        if (size !== part.usize) throw new Error(`zip: uncompressed size mismatch for ${part.name}`)
      },
    }),
  )
}

async function inflate(
  source: ZipByteSource,
  part: ZipSourcePart,
  collect: boolean,
): Promise<{ size: number; bytes: Uint8Array | null }> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = streamZipSourceCompressed(source, part)
    .pipeThrough(decompressionStream('deflate-raw'))
    .getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > part.usize) {
        await reader.cancel()
        throw new Error(
          `zip rejected: part ${part.name} declares ${part.usize} uncompressed bytes but inflates past that`,
        )
      }
      if (collect) chunks.push(value)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('zip rejected:')) throw error
    throw new Error(`zip rejected: part ${part.name} cannot be inflated: ${String(error)}`, {
      cause: error,
    })
  } finally {
    reader.releaseLock()
  }
  if (!collect) return { size, bytes: null }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return { size, bytes }
}

/** Validate every payload before exposing entries, using the same metered size policy. */
export async function assertZipSourceInflatesWithinLimits(
  source: ZipByteSource,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Promise<ZipSourcePart[]> {
  const parts = await scanSource(source, limits)
  let total = 0
  for (const part of parts) {
    if (part.directory) continue
    if (part.method === 0) {
      if (part.csize > part.usize) {
        throw new Error(
          `zip rejected: part ${part.name} declares ${part.usize} uncompressed bytes but inflates past that`,
        )
      }
      total += part.csize
    } else if (part.method === 8) {
      total += (await inflate(source, part, false)).size
    } else throw new Error(`zip: unsupported compression method ${part.method} for ${part.name}`)
    if (total > limits.maxTotalBytes) {
      throw new Error(
        `zip rejected: total uncompressed size ${total} exceeds the ${limits.maxTotalBytes} limit`,
      )
    }
  }
  return parts
}

/** Read an entry of a source that already passed the gate. */
export async function readZipSourcePart(
  source: ZipByteSource,
  part: ZipSourcePart,
): Promise<Uint8Array> {
  let bytes: Uint8Array
  if (part.method === 0) bytes = await read(source, part.dataStart, part.csize)
  else if (part.method === 8) bytes = (await inflate(source, part, true)).bytes!
  else throw new Error(`zip: unsupported compression method ${part.method} for ${part.name}`)
  // The gate permits overstatements, but materialized entry reads must match
  // JSZip's content-size check, including malformed package metadata.
  if (bytes.length !== part.usize)
    throw new Error(`zip: uncompressed size mismatch for ${part.name}`)
  return bytes
}
