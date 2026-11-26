/**
 * A stand-in phone for the spreadsheet save tests: the T1 work folder as an
 * in-memory map, the storage service's originals, and an engine that answers
 * the archive commands with JSZip (manifests carry real CRC-32s of the
 * entries, so the gateway's `assertManifestPreserved` checks real content).
 * The real engine's byte behaviour is tested against the desktop sidecar in
 * `sheets-save-real-engine.test.ts`.
 */
import JSZip from 'jszip'
import type { MobileTransport } from '@genoffice/mobile-bridge/transport'

export const WORK_ROOT = '/data/user/0/com.ieumoffice.mobile/cache/ieum-tmp/sheets'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ManifestEntry {
  readonly name: string
  readonly crc32: number
  readonly compressedSize: number
  readonly uncompressedSize: number
}

export async function zipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes)
  const out = new Map<string, Uint8Array>()
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    out.set(name, await file.async('uint8array'))
  }
  return out
}

export async function manifestOf(bytes: Uint8Array): Promise<ManifestEntry[]> {
  return [...(await zipEntries(bytes))].map(([name, content]) => ({
    name,
    crc32: crc32(content),
    compressedSize: content.byteLength,
    uncompressedSize: content.byteLength,
  }))
}

async function zipFrom(entries: readonly (readonly [string, Uint8Array])[]): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, content] of entries) zip.file(name, content, { compression: 'STORE' })
  return zip.generateAsync({ type: 'uint8array' })
}

function sheetMeta(id: string, name: string) {
  return {
    baseColumnWidth: null,
    columnCount: 3,
    columnWidths: [],
    comments: [],
    defaultColumnWidth: null,
    defaultRowHeight: null,
    defaultRowHeightFixed: false,
    freeze: null,
    hasScopedDefinedNames: false,
    hidden: false,
    id,
    name,
    pivotRanges: [],
    pivotTables: [],
    rightToLeft: false,
    rowCount: 3,
    showFormulas: false,
    showGridLines: true,
    showRowColHeaders: true,
    sourceXmlBytes: 100,
    storedCellCount: 3,
    tabColor: null,
    tables: [],
    valueCellCount: 3,
    valueColumnCount: 3,
    valueRowCount: 3,
  }
}

export interface FakeDeviceOptions {
  /** The engine refuses to open these paths (a save output it cannot read back). */
  readonly refuseOpen?: (path: string) => boolean
  /** The storage service fails the write back to the original. */
  readonly failWriteBack?: boolean
  /** What `convert_workbook` writes (a real .xls is beyond this stand-in). */
  readonly convertedXlsx?: Uint8Array
}

export interface FakeDevice {
  readonly client: { transport: MobileTransport }
  readonly files: Map<string, Uint8Array>
  /** Storage originals by document session id. */
  readonly originals: Map<string, Uint8Array>
  /** Every command in order (engine requests as `engine:<command>`). */
  readonly log: string[]
  /** Every engine request object. */
  readonly engineRequests: Record<string, unknown>[]
  options: FakeDeviceOptions
}

function inWorkFolder(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith(`${WORK_ROOT}/`)) {
    throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.sheets.pathOutsideWork', detail: path }
  }
  return path
}

const encoder = new TextEncoder()

export function createFakeDevice(options: FakeDeviceOptions = {}): FakeDevice {
  const files = new Map<string, Uint8Array>()
  const originals = new Map<string, Uint8Array>()
  const log: string[] = []
  const engineRequests: Record<string, unknown>[] = []
  let counter = 0
  const fresh = (ext: string) => `${WORK_ROOT}/f-${(counter += 1)}.${ext}`
  const device: FakeDevice = {
    client: { transport: undefined as unknown as MobileTransport },
    files,
    originals,
    log,
    engineRequests,
    options,
  }

  function read(path: unknown): Uint8Array {
    const bytes = files.get(inWorkFolder(path))
    if (!bytes) throw { code: 'INTERNAL_ERROR', messageKey: 'mobile.sheets.ioError', detail: path }
    return bytes
  }

  async function engine(request: Record<string, unknown>): Promise<unknown> {
    switch (request.command) {
      case 'archive_manifest':
        return { entries: await manifestOf(read(request.path)) }
      case 'read_entries': {
        const entries = await zipEntries(read(request.path))
        const outputDir = inWorkFolder(request.outputDir)
        return {
          entries: (request.entries as string[]).map((name, index) => {
            const content = entries.get(name)
            if (!content) throw new Error(`Missing entry ${name}`)
            const path = `${outputDir}/entry-${index}.bin`
            files.set(path, content)
            return { name, path }
          }),
        }
      }
      case 'scan_entries': {
        const entries = await zipEntries(read(request.path))
        const needle = String(request.needle)
        return {
          matches: (request.entries as string[]).filter((name) =>
            new TextDecoder().decode(entries.get(name) ?? new Uint8Array()).includes(needle),
          ),
        }
      }
      case 'save_archive': {
        const source = read(request.sourcePath)
        const targetPath = inWorkFolder(request.targetPath)
        if (targetPath === request.sourcePath) {
          throw new Error('Save target must differ from the source archive.')
        }
        const entries = await zipEntries(source)
        const replacements = request.replacements as { name: string; contentPath: string }[]
        const additions = request.additions as { name: string; contentPath: string }[]
        const removals = new Set(request.removals as string[])
        const out: [string, Uint8Array][] = []
        for (const [name, content] of entries) {
          if (removals.has(name)) continue
          const replaced = replacements.find((item) => item.name === name)
          out.push([name, replaced ? read(replaced.contentPath) : content])
        }
        for (const added of additions) out.push([added.name, read(added.contentPath)])
        const saved = await zipFrom(out)
        files.set(targetPath, saved)
        return { beforeEntries: await manifestOf(source), afterEntries: await manifestOf(saved) }
      }
      case 'open': {
        const path = inWorkFolder(request.path)
        if (device.options.refuseOpen?.(path)) {
          throw new Error('The workbook could not be read.')
        }
        const entries = await zipEntries(read(path))
        const workbook = new TextDecoder().decode(entries.get('xl/workbook.xml'))
        const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(
          (match) => match[1]!,
        )
        return {
          sessionId: crypto.randomUUID(),
          name: path.slice(path.lastIndexOf('/') + 1),
          entryCount: entries.size,
          sheets: names.map((name, index) => sheetMeta(`sheet-${index + 1}`, name)),
          styles: [],
          dxfStyles: [],
          visuals: [],
          definedNames: [],
        }
      }
      case 'close':
        return {}
      case 'convert_workbook': {
        read(request.path)
        const converted = device.options.convertedXlsx
        if (!converted) throw new Error('Unsupported workbook format.')
        files.set(inWorkFolder(request.targetPath), converted)
        return { sheets: 1, cells: 1, formulasDropped: 0 }
      }
      default:
        throw new Error(`fake engine: ${String(request.command)}`)
    }
  }

  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (command === 'mobile_sheets_request') {
        const request = JSON.parse(String(args.line)) as Record<string, unknown>
        engineRequests.push(request)
        log.push(`engine:${String(request.command)}`)
        try {
          const result = await engine(request)
          return { version: 1, requestId: request.requestId, ok: true, result } as T
        } catch (error) {
          return {
            version: 1,
            requestId: request.requestId,
            ok: false,
            error: {
              code: 'workbook_error',
              message: error instanceof Error ? error.message : String(error),
            },
          } as T
        }
      }
      log.push(command)
      switch (command) {
        case 'mobile_sheets_copy_session_to_temp': {
          const bytes = originals.get(String(args.sessionId))
          if (!bytes) throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.session.notFound' }
          const path = fresh(String(args.ext))
          files.set(path, bytes.slice())
          return { path, size: bytes.byteLength } as T
        }
        case 'mobile_sheets_temp_new_path':
          return { path: fresh(String(args.ext)) } as T
        case 'mobile_sheets_temp_create_dir':
          return { path: `${WORK_ROOT}/d-${(counter += 1)}` } as T
        case 'mobile_sheets_temp_root':
          return { path: WORK_ROOT } as T
        case 'mobile_sheets_temp_mkdir':
          inWorkFolder(args.path)
          return { ok: true } as T
        case 'mobile_sheets_temp_rename': {
          const bytes = read(args.from)
          files.delete(String(args.from))
          files.set(inWorkFolder(args.to), bytes)
          return { ok: true } as T
        }
        case 'mobile_sheets_temp_copy':
          files.set(inWorkFolder(args.to), read(args.from).slice())
          return { ok: true } as T
        case 'mobile_sheets_temp_stat': {
          const bytes = files.get(inWorkFolder(args.path))
          return (bytes ? { size: bytes.byteLength, isFile: true, isDir: false } : null) as T
        }
        case 'mobile_sheets_temp_read_raw': {
          const bytes = read(args.path)
          const offset = typeof args.offset === 'number' ? args.offset : 0
          const end = typeof args.length === 'number' ? offset + args.length : bytes.byteLength
          return bytes.slice(offset, end).buffer as T
        }
        case 'mobile_sheets_temp_write_text':
        case 'mobile_sheets_temp_append_text': {
          const path = inWorkFolder(args.path)
          const text = encoder.encode(String(args.text))
          const before = command.endsWith('append_text')
            ? (files.get(path) ?? new Uint8Array())
            : new Uint8Array()
          files.set(path, concat(before, text))
          return { ok: true } as T
        }
        case 'mobile_sheets_temp_write_bytes':
        case 'mobile_sheets_temp_append_bytes': {
          const path = inWorkFolder(args.path)
          const bytes = Uint8Array.from(atob(String(args.bytesBase64)), (c) => c.charCodeAt(0))
          const before = command.endsWith('append_bytes')
            ? (files.get(path) ?? new Uint8Array())
            : new Uint8Array()
          files.set(path, concat(before, bytes))
          return { ok: true } as T
        }
        case 'mobile_sheets_temp_delete': {
          const path = inWorkFolder(args.path)
          for (const name of [...files.keys()]) {
            if (name === path || name.startsWith(`${path}/`)) files.delete(name)
          }
          return { ok: true } as T
        }
        case 'mobile_sheets_temp_clear':
          files.clear()
          return { ok: true } as T
        case 'mobile_sheets_save_to_original': {
          const bytes = read(args.path)
          if (device.options.failWriteBack) {
            throw { code: 'PERMISSION_DENIED', messageKey: 'mobile.fs.permissionDenied' }
          }
          if (!originals.has(String(args.sessionId))) {
            throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.session.notFound' }
          }
          originals.set(String(args.sessionId), bytes.slice())
          return { ok: true, size: bytes.byteLength } as T
        }
        default:
          throw new Error(`fake device: ${command}`)
      }
    },
    async listen() {
      return () => {}
    },
  }
  device.client.transport = transport
  return device
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength)
  out.set(left, 0)
  out.set(right, left.byteLength)
  return out
}
