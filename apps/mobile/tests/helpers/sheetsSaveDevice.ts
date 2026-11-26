/**
 * The save tests' phone: the shared stand-in device (sheetsFakeDevice.ts)
 * plus what the save area adds — the engine library's password requests,
 * Save As into a new document, copies, the share sheet, the recovery copy,
 * the ODS conversion, and the Rust refusals (original changed since it was
 * opened, file too large for the bridge).
 */
import type { MobileDocSession, MobileTransport } from '@genoffice/mobile-bridge/transport'
import { createFakeDevice, type FakeDevice, type FakeDeviceOptions } from './sheetsFakeDevice'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A stand-in encrypted workbook: a marker, the password, then the plain bytes. */
export function lockedBytes(plain: Uint8Array, password: string): Uint8Array {
  const head = encoder.encode(`LOCKED:${password}:`)
  const out = new Uint8Array(head.byteLength + plain.byteLength)
  out.set(head)
  out.set(plain, head.byteLength)
  return out
}

export function unlockBytes(bytes: Uint8Array): { password: string; plain: Uint8Array } | null {
  const match = /^LOCKED:([^:]*):/.exec(decoder.decode(bytes.slice(0, 80)))
  if (!match) return null
  return { password: match[1]!, plain: bytes.slice(encoder.encode(match[0]).byteLength) }
}

export interface SaveDeviceOptions extends FakeDeviceOptions {
  /** `encrypt` fails. */
  failEncrypt?: boolean
  /** The system save dialog is closed (Save As and copies). */
  cancelDialog?: boolean
  /** Writes of more bytes than this fail like the plugin's argument limit. */
  bridgeLimit?: number
  /** What `convert_to_ods` reports as left out. */
  odsDropped?: Partial<Record<string, number>>
  odsFormulasDropped?: number
  /** The ODS reader cannot open the converted file. */
  odsUnreadable?: boolean
}

export interface SavedCopy {
  readonly name: string
  readonly mime?: string
  readonly bytes: Uint8Array
}

export interface SaveDevice extends FakeDevice {
  options: SaveDeviceOptions
  /** Document sessions another app changed after the copy at open. */
  readonly changedElsewhere: Set<string>
  readonly savedAs: (SavedCopy & { readonly session: MobileDocSession })[]
  readonly copies: SavedCopy[]
  readonly shared: SavedCopy[]
  readonly recoveries: { docKey: string; title: string; bytes: Uint8Array }[]
}

function cancelled() {
  return { code: 'USER_CANCELLED', messageKey: 'mobile.fs.cancelled' }
}

export function createSaveDevice(options: SaveDeviceOptions = {}): SaveDevice {
  const base = createFakeDevice(options)
  const device = Object.assign(base, {
    options,
    changedElsewhere: new Set<string>(),
    savedAs: [],
    copies: [],
    shared: [],
    recoveries: [],
  }) as SaveDevice
  const inner = base.client.transport
  let saved = 0

  const file = (path: unknown): Uint8Array => {
    const bytes = device.files.get(String(path))
    if (!bytes) throw { code: 'INTERNAL_ERROR', messageKey: 'mobile.sheets.ioError', detail: path }
    return bytes
  }
  const bridgeWrite = (bytes: Uint8Array) => {
    const limit = device.options.bridgeLimit
    if (limit !== undefined && bytes.byteLength > limit) {
      throw {
        code: 'FILE_TOO_LARGE',
        messageKey: 'mobile.sheets.tooLargeToWrite',
        detail: `${bytes.byteLength} bytes`,
      }
    }
  }

  const engineAnswer = (request: Record<string, unknown>, result: unknown) => ({
    version: 1,
    requestId: request.requestId,
    ok: true,
    result,
  })

  const transport: MobileTransport = {
    async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (command === 'mobile_sheets_request') {
        const request = JSON.parse(String(args.line)) as Record<string, unknown>
        if (request.command === 'convert_to_ods') {
          device.engineRequests.push(request)
          device.log.push('engine:convert_to_ods')
          device.files.set(String(request.targetPath), encoder.encode(`ODS-OF:${request.path}`))
          return engineAnswer(request, {
            sheets: 1,
            cells: 3,
            formulasDropped: device.options.odsFormulasDropped ?? 0,
            dropped: device.options.odsDropped ?? {},
          }) as T
        }
        if (request.command === 'convert_workbook' && String(request.path).endsWith('.ods')) {
          device.engineRequests.push(request)
          device.log.push('engine:convert_workbook')
          file(request.path)
          if (device.options.odsUnreadable) {
            return {
              ...engineAnswer(request, null),
              ok: false,
              error: { code: 'workbook_error', message: 'unreadable' },
            } as T
          }
          device.files.set(String(request.targetPath), new Uint8Array([1]))
          return engineAnswer(request, { sheets: 1, cells: 3 }) as T
        }
        return inner.invoke<T>(command, args)
      }
      switch (command) {
        case 'mobile_sheets_crypto': {
          device.log.push(command)
          const request = JSON.parse(String(args.line)) as Record<string, string>
          // A locked legacy workbook (OLE2 magic inside) decrypts to an .xls.
          const kind = (plain: Uint8Array | undefined) =>
            plain?.[0] === 0xd0 && plain[1] === 0xcf ? 'xls' : 'ooxml'
          if (request.op === 'probe') {
            const opened = unlockBytes(file(request.path))
            return {
              ok: true,
              result: {
                encrypted: opened !== null,
                supported: true,
                document: kind(opened?.plain),
              },
            } as T
          }
          if (request.op === 'decrypt') {
            const opened = unlockBytes(file(request.source))
            if (!opened) return { ok: false, error: { code: 'not_encrypted', message: 'no' } } as T
            if (opened.password !== request.password) {
              return { ok: false, error: { code: 'wrong_password', message: 'wrong' } } as T
            }
            device.files.set(request.target!, opened.plain)
            return { ok: true, result: { document: kind(opened.plain) } } as T
          }
          if (device.options.failEncrypt) {
            return { ok: false, error: { code: 'io', message: 'encrypt failed' } } as T
          }
          device.files.set(request.target!, lockedBytes(file(request.source), request.password!))
          return { ok: true, result: {} } as T
        }
        case 'mobile_sheets_save_to_original': {
          const sessionId = String(args.sessionId)
          if (device.changedElsewhere.has(sessionId)) {
            device.log.push(command)
            throw {
              code: 'INVALID_ARGUMENT',
              messageKey: 'mobile.sheets.diskChanged',
              detail: 'the document changed after it was opened',
            }
          }
          bridgeWrite(file(args.path))
          return inner.invoke<T>(command, args)
        }
        case 'mobile_sheets_save_as': {
          device.log.push(command)
          if (device.options.cancelDialog) throw cancelled()
          const bytes = file(args.path).slice()
          bridgeWrite(bytes)
          const name = String(args.suggestedName)
          saved += 1
          const session: MobileDocSession = {
            sessionId: `saved-${saved}`,
            docKey: `saved-key-${saved}`,
            name,
            ext: name.slice(name.lastIndexOf('.') + 1),
            format: name.endsWith('.xlsm') ? 'xlsm' : 'xlsx',
            writable: true,
            ephemeral: false,
            uriHint: name,
          }
          device.originals.set(session.sessionId, bytes)
          device.savedAs.push({ name, bytes, session })
          return session as T
        }
        case 'mobile_sheets_write_copy': {
          device.log.push(command)
          if (device.options.cancelDialog) throw cancelled()
          const bytes = file(args.path).slice()
          bridgeWrite(bytes)
          device.copies.push({ name: String(args.suggestedName), mime: String(args.mime), bytes })
          return { name: String(args.suggestedName), size: bytes.byteLength } as T
        }
        case 'mobile_sheets_share_file': {
          device.log.push(command)
          const bytes = file(args.path).slice()
          bridgeWrite(bytes)
          device.shared.push({ name: String(args.suggestedName), bytes })
          return { ok: true } as T
        }
        case 'mobile_sheets_write_recovery': {
          device.log.push(command)
          device.recoveries.push({
            docKey: String(args.docKey),
            title: String(args.title),
            bytes: file(args.path).slice(),
          })
          return { ok: true } as T
        }
        default:
          return inner.invoke<T>(command, args)
      }
    },
    listen: inner.listen,
  }
  device.client.transport = transport
  return device
}
