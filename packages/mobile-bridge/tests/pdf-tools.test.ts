import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { bytesToBase64, savePdfToolResultCopy, sharePdfToolResult } from '../src/pdf-tools/index'
import {
  createMobileClient,
  MobileCommandError,
  parseMobileCommandError,
  type MobileTransport,
} from '../src/transport'

type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>

function makeClient(invoke: InvokeFn) {
  const spy = vi.fn(invoke)
  const transport: MobileTransport = {
    invoke: spy as unknown as MobileTransport['invoke'],
    listen: async () => () => {},
  }
  return { client: createMobileClient(transport), spy }
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Index of the first differing byte, or -1; deep equality on megabytes is too slow. */
function firstMismatch(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length)
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return i
  return -1
}

function patterned(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + (i >> 8)) & 0xff
  return out
}

describe('sharePdfToolResult', () => {
  it('calls mobile_pdf_tools_share with camelCase argument names', async () => {
    const { client, spy } = makeClient(async () => ({ ok: true }))
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    await expect(
      sharePdfToolResult(client, { name: 'merged.pdf', mime: 'application/pdf', bytes }),
    ).resolves.toEqual({ ok: true })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('mobile_pdf_tools_share', {
      suggestedName: 'merged.pdf',
      mime: 'application/pdf',
      bytesBase64: 'JVBERg==',
    })
  })

  it('turns a structured rejection into a MobileCommandError', async () => {
    const { client } = makeClient(async () => {
      throw { code: 'INVALID_ARGUMENT', messageKey: 'mobile.pdfTools.mimeNotAllowed' }
    })
    const err = await sharePdfToolResult(client, {
      name: 'a.html',
      mime: 'text/html',
      bytes: new Uint8Array([1]),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INVALID_ARGUMENT')
    expect((err as MobileCommandError).messageKey).toBe('mobile.pdfTools.mimeNotAllowed')
  })
})

describe('savePdfToolResultCopy', () => {
  it('calls mobile_pdf_tools_save_copy and returns the saved name', async () => {
    const { client, spy } = makeClient(async () => ({ name: 'report-split.zip' }))
    await expect(
      savePdfToolResultCopy(client, {
        name: 'report-split.zip',
        mime: 'application/zip',
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      }),
    ).resolves.toEqual({ name: 'report-split.zip' })
    expect(spy).toHaveBeenCalledWith('mobile_pdf_tools_save_copy', {
      suggestedName: 'report-split.zip',
      mime: 'application/zip',
      bytesBase64: 'UEsDBA==',
    })
  })

  it('reports a closed save dialog as USER_CANCELLED', async () => {
    const { client } = makeClient(async () => {
      throw { code: 'USER_CANCELLED', messageKey: 'mobile.fs.cancelled', detail: 'closed' }
    })
    const err = await savePdfToolResultCopy(client, {
      name: 'out.pdf',
      mime: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect(err).toEqual(
      parseMobileCommandError({
        code: 'USER_CANCELLED',
        messageKey: 'mobile.fs.cancelled',
        detail: 'closed',
      }),
    )
    expect((err as MobileCommandError).code).toBe('USER_CANCELLED')
  })

  it('turns an unknown rejection into INTERNAL_ERROR', async () => {
    const { client } = makeClient(async () => {
      throw new Error('bridge gone')
    })
    const err = await savePdfToolResultCopy(client, {
      name: 'out.pdf',
      mime: 'application/pdf',
      bytes: new Uint8Array(),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INTERNAL_ERROR')
  })
})

describe('bytesToBase64', () => {
  it('encodes an empty array as an empty string', async () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
    const { client, spy } = makeClient(async () => ({ ok: true }))
    await sharePdfToolResult(client, { name: 'e.txt', mime: 'text/plain', bytes: new Uint8Array() })
    expect(spy.mock.calls[0][1]).toMatchObject({ bytesBase64: '' })
  })

  it('matches the standard alphabet with padding for every tail length', () => {
    expect(bytesToBase64(new Uint8Array([0xfb]))).toBe('+w==')
    expect(bytesToBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=')
    expect(bytesToBase64(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('+/+/')
    expect(bytesToBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
  })

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) all[i] = i
    expect(decodeBase64(bytesToBase64(all))).toEqual(all)
  })

  it('round-trips a large (>1 MB) array of an odd length', () => {
    const big = patterned(3 * 1024 * 1024 + 7)
    const encoded = bytesToBase64(big)
    expect(encoded.length).toBe(Math.ceil(big.length / 3) * 4)
    expect(firstMismatch(decodeBase64(encoded), big)).toBe(-1)
  })

  it('encodes only the view of a subarray', () => {
    const backing = new Uint8Array([9, 9, 0x68, 0x69, 9])
    expect(bytesToBase64(backing.subarray(2, 4))).toBe('aGk=')
  })

  it('sends a large result through the share command intact', async () => {
    const { client, spy } = makeClient(async () => ({ ok: true }))
    const big = patterned(1024 * 1024 + 1)
    await sharePdfToolResult(client, { name: 'big.pdf', mime: 'application/pdf', bytes: big })
    const args = spy.mock.calls[0][1] as { bytesBase64: string }
    expect(firstMismatch(decodeBase64(args.bytesBase64), big)).toBe(-1)
  })
})

describe('the Rust side of the PDF tools commands', () => {
  // Tauri maps snake_case Rust parameters to camelCase arguments; this keeps both
  // sides of the contract in one place, so a rename on either side fails here.
  const root = fileURLToPath(new URL('../../../apps/mobile/src-tauri/src/', import.meta.url))
  const commands = readFileSync(join(root, 'commands/pdf_tools.rs'), 'utf8')
  const lib = readFileSync(join(root, 'lib.rs'), 'utf8')
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

  it.each(['mobile_pdf_tools_share', 'mobile_pdf_tools_save_copy'])(
    '%s takes the arguments the bridge sends and is registered',
    async (command) => {
      const start = commands.indexOf(`pub async fn ${command}<R: Runtime>(`)
      const signature =
        start < 0
          ? null
          : /\(([^)]*)\)/.exec(commands.slice(start + `pub async fn ${command}`.length))
      expect(signature, `${command} in commands/pdf_tools.rs`).not.toBeNull()
      const params = [...signature![1]!.matchAll(/(\w+):\s*([\w<>]+)/g)]
        .map((m) => m[1]!)
        .filter((name) => name !== 'app')
      const { client, spy } = makeClient(async () =>
        command.endsWith('share') ? { ok: true } : { name: 'x.pdf' },
      )
      const payload = { name: 'x.pdf', mime: 'application/pdf', bytes: new Uint8Array([1]) }
      if (command.endsWith('share')) await sharePdfToolResult(client, payload)
      else await savePdfToolResultCopy(client, payload)
      const [sent, args] = spy.mock.calls[0]!
      expect(sent).toBe(command)
      expect(Object.keys(args ?? {}).sort()).toEqual(params.map(camel).sort())
      // registered in generate_handler! between the T3 slot comment and the next track's
      const slot = lib.indexOf('// T3 pdf tools\n')
      const next = lib.indexOf('// T4 html\n', slot)
      const line = lib.indexOf(`commands::pdf_tools::${command},`, slot)
      expect(slot, 'the T3 slot in lib.rs').toBeGreaterThan(-1)
      expect(line > slot && line < next, `${command} under // T3 pdf tools`).toBe(true)
    },
  )
})
