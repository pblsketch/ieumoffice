/**
 * Issue #693: an `.hwp` saved as HWPX must give a zip every reader accepts.
 *
 * Hancom writes a compressed BinData stream as raw deflate followed by a gzip
 * trailer (CRC-32 and size). The engine's HWPX writer reuses that stream instead
 * of compressing the picture again, and used to copy the trailer into the zip
 * entry too: Hancom and the engine read the file, but the zip gate the text
 * readers pass (`hwpToText`, the command line, MCP, attachments) rejected it.
 * Engine patch 0062 copies the deflate stream alone; the zip gate also accepts
 * exactly that trailer, for files saved before the fix.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { hwpToText } from '@genoffice/file-parse'
import { inspectHwp5, readStream } from '@genoffice/hwp5-wasm/node'

const require = createRequire(import.meta.url)
const FIXTURES = join(__dirname, 'fixtures')
// a Hancom file whose compressed BinData streams all end in a gzip trailer
const SOURCE = 'memo-source.hwp'

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface Entry {
  name: string
  method: number
  data: Buffer
}

/** The entries of a zip in memory, read from its central directory. */
function zipEntries(bytes: Uint8Array): Entry[] {
  const b = Buffer.from(bytes)
  let eocd = -1
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  expect(eocd).toBeGreaterThan(0)
  const entries: Entry[] = []
  let pos = b.readUInt32LE(eocd + 16)
  for (let i = b.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = b.readUInt16LE(pos + 10)
    const csize = b.readUInt32LE(pos + 20)
    const nameLen = b.readUInt16LE(pos + 28)
    const local = b.readUInt32LE(pos + 42)
    const name = b.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
    entries.push({ name, method, data: b.subarray(start, start + csize) })
    pos += 46 + nameLen + b.readUInt16LE(pos + 30) + b.readUInt16LE(pos + 32)
  }
  return entries
}

/**
 * How many bytes of a deflated entry come after the end of its deflate stream;
 * null when the bytes are not raw deflate (an HWP stream stored uncompressed).
 */
function bytesAfterStream(data: Buffer): number | null {
  try {
    const { engine } = inflateRawSync(data, { info: true }) as unknown as {
      engine: { bytesWritten: number }
    }
    return data.length - engine.bytesWritten
  } catch {
    return null
  }
}

describe('saving an .hwp as HWPX (#693)', () => {
  it('starts from BinData streams that carry a gzip trailer', () => {
    const source = new Uint8Array(readFileSync(join(FIXTURES, SOURCE)))
    const names = inspectHwp5(source).streamPaths.filter((path) => path.includes('BinData/'))
    expect(names.length).toBeGreaterThan(0)
    const trailed = names.filter((path) => {
      const raw = Buffer.from(readStream(source, path, false) ?? [])
      return raw.length > 0 && bytesAfterStream(raw) === 8
    })
    expect(trailed.length).toBeGreaterThan(0)
  })

  it('writes every BinData entry as a deflate stream with nothing after it', async () => {
    const doc = new HwpDocument(new Uint8Array(readFileSync(join(FIXTURES, SOURCE))))
    let hwpx: Uint8Array
    try {
      hwpx = doc.exportHwpx()
    } finally {
      doc.free()
    }
    const pictures = zipEntries(hwpx).filter(
      (entry) => entry.name.startsWith('BinData/') && entry.method === 8,
    )
    expect(pictures.length).toBeGreaterThan(0)
    for (const entry of pictures)
      expect([entry.name, bytesAfterStream(entry.data)]).toEqual([entry.name, 0])
    // and the readers behind the zip gate take the file
    await expect(hwpToText(hwpx)).resolves.toMatch(/\S/)
  })
})
