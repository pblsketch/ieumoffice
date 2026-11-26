import { describe, expect, it } from 'vitest'
import { createMobileClient, type MobileDocSession, type MobileTransport } from '../src/transport'
import {
  IDENTITY_TEXT_ENVELOPE,
  parseTextEnvelope,
  serializeTextEnvelope,
  type TextEnvelope,
} from '../src/html'
import { createMobileMarkdownApi } from '../src/markdown'

const BOM_BYTES = [0xef, 0xbb, 0xbf]

function encode(text: string, opts: { bom?: boolean } = {}): Uint8Array {
  const body = Array.from(new TextEncoder().encode(text))
  return new Uint8Array(opts.bom ? [...BOM_BYTES, ...body] : body)
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromB64(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(String(value), 'base64'))
}

/** Every combination of BOM / no BOM, LF / CRLF, trailing newline / none. */
const COMBOS = [false, true].flatMap((bom) =>
  (['\n', '\r\n'] as const).flatMap((eol) =>
    [false, true].map((trailing) => ({ bom, eol, trailing })),
  ),
)

function sample(combo: { eol: '\n' | '\r\n'; trailing: boolean }): string {
  const lines = ['# 제목', '', '- 하나', '- 둘', '끝 줄']
  return lines.join(combo.eol) + (combo.trailing ? combo.eol : '')
}

function comboName(combo: { bom: boolean; eol: string; trailing: boolean }): string {
  return `${combo.bom ? 'BOM' : 'no BOM'}, ${combo.eol === '\n' ? 'LF' : 'CRLF'}, ${
    combo.trailing ? 'trailing newline' : 'no trailing newline'
  }`
}

function makeSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'md-sess-1',
    docKey: 'abcd1234abcd1234',
    name: 'note.md',
    ext: 'md',
    format: 'md',
    writable: true,
    ephemeral: false,
    uriHint: 'content://notes/note.md',
    ...overrides,
  }
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

function fakeClient(fileBytes: Uint8Array, savedAs?: Partial<MobileDocSession>) {
  const calls: Call[] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: b64(fileBytes) } as T
        case 'mobile_save_as_file_bytes':
          return makeSession({
            sessionId: 'md-sess-saved',
            docKey: '9999888877776666',
            name: 'saved.md',
            ...savedAs,
          }) as T
        case 'mobile_save_file_bytes':
        case 'mobile_recovery_discard':
        case 'mobile_recovery_write':
        case 'mobile_share_file':
          return { ok: true } as T
        default:
          throw new Error(`unexpected ${command}`)
      }
    },
    async listen() {
      return () => {}
    },
  }
  return { client: createMobileClient(transport), calls }
}

function lastBytes(calls: Call[], command: string): Uint8Array {
  const call = calls.filter((c) => c.command === command).at(-1)
  expect(call, `${command} was called`).toBeDefined()
  return fromB64(call?.args?.bytesBase64)
}

describe('parseTextEnvelope / serializeTextEnvelope', () => {
  for (const combo of COMBOS) {
    it(`round-trips ${comboName(combo)} byte for byte`, () => {
      const bytes = encode(sample(combo), { bom: combo.bom })
      const parsed = parseTextEnvelope(bytes)
      expect(parsed.utf8).toBe(true)
      expect(parsed.envelope).toEqual({ bom: combo.bom, eol: combo.eol })
      // the body editors see: no BOM, LF only, the trailing newline kept in the body
      expect(parsed.body.startsWith('﻿')).toBe(false)
      expect(parsed.body.includes('\r')).toBe(false)
      expect(parsed.body.endsWith('\n')).toBe(combo.trailing)
      expect(Array.from(serializeTextEnvelope(parsed.body, parsed.envelope))).toEqual(
        Array.from(bytes),
      )
    })
  }

  it('picks CRLF only when CRLF line ends outnumber lone LF ones', () => {
    expect(parseTextEnvelope(encode('a\r\nb\r\nc\nd')).envelope.eol).toBe('\r\n')
    expect(parseTextEnvelope(encode('a\r\nb\nc\nd')).envelope.eol).toBe('\n')
    expect(parseTextEnvelope(encode('a\r\nb\nc')).envelope.eol).toBe('\n')
    expect(parseTextEnvelope(encode('one line')).envelope).toEqual(IDENTITY_TEXT_ENVELOPE)
  })

  it('keeps a BOM that only a BOM-aware decoder would see', () => {
    const parsed = parseTextEnvelope(encode('﻿text', { bom: true }))
    // only the first U+FEFF is the BOM; a second one is text
    expect(parsed.envelope.bom).toBe(true)
    expect(parsed.body).toBe('﻿text')
  })

  it('reports non-UTF-8 bytes and still gives a lossy body for viewing', () => {
    // "한글" in EUC-KR
    const parsed = parseTextEnvelope(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x0d, 0x0a]))
    expect(parsed.utf8).toBe(false)
    expect(parsed.body).toContain('�')
  })

  it('re-applies the envelope to an edited body', () => {
    const envelope: TextEnvelope = { bom: true, eol: '\r\n' }
    expect(Array.from(serializeTextEnvelope('a\nb\n', envelope))).toEqual([
      ...BOM_BYTES,
      0x61,
      0x0d,
      0x0a,
      0x62,
      0x0d,
      0x0a,
    ])
    expect(new TextDecoder().decode(serializeTextEnvelope('a\nb', IDENTITY_TEXT_ENVELOPE))).toBe(
      'a\nb',
    )
  })
})

describe('createMobileMarkdownApi keeps the text envelope', () => {
  for (const combo of COMBOS) {
    it(`${comboName(combo)}: unchanged save is the original bytes, edited save keeps the envelope`, async () => {
      const original = encode(sample(combo), { bom: combo.bom })
      const { client, calls } = fakeClient(original)
      const api = createMobileMarkdownApi(client)
      const session = makeSession()

      const { text } = await api.readDocument(session)
      expect(text.includes('\r')).toBe(false)

      await api.saveDocument(session, text)
      expect(Array.from(lastBytes(calls, 'mobile_save_file_bytes'))).toEqual(Array.from(original))

      await api.shareDocument(session, text)
      expect(Array.from(lastBytes(calls, 'mobile_share_file'))).toEqual(Array.from(original))

      await api.writeRecovery(session, text)
      expect(Array.from(lastBytes(calls, 'mobile_recovery_write'))).toEqual(Array.from(original))

      const edited = text.replace('- 둘', '- 둘\n- 셋')
      const expected = encode(edited.split('\n').join(combo.eol), { bom: combo.bom })
      await api.saveDocument(session, edited)
      expect(Array.from(lastBytes(calls, 'mobile_save_file_bytes'))).toEqual(Array.from(expected))
      await api.shareDocument(session, edited)
      expect(Array.from(lastBytes(calls, 'mobile_share_file'))).toEqual(Array.from(expected))
      await api.writeRecovery(session, edited)
      expect(Array.from(lastBytes(calls, 'mobile_recovery_write'))).toEqual(Array.from(expected))
    })
  }

  it('writes a mixed line-end file back unchanged when nothing was edited', async () => {
    const original = encode('a\r\nb\nc\rd\r\n', { bom: true })
    const { client, calls } = fakeClient(original)
    const api = createMobileMarkdownApi(client)
    const session = makeSession()
    const { text } = await api.readDocument(session)
    await api.saveDocument(session, text)
    expect(Array.from(lastBytes(calls, 'mobile_save_file_bytes'))).toEqual(Array.from(original))
  })

  it('moves the envelope to the new session on save as', async () => {
    const original = encode('a\r\nb\r\n', { bom: true })
    const { client, calls } = fakeClient(original)
    const api = createMobileMarkdownApi(client)
    const session = makeSession({ writable: false })
    const { text } = await api.readDocument(session)

    const next = await api.saveAsDocument(session, 'note.md', `${text}c\n`)
    const expected = encode('a\r\nb\r\nc\r\n', { bom: true })
    expect(Array.from(lastBytes(calls, 'mobile_save_as_file_bytes'))).toEqual(Array.from(expected))

    // the new session saves what is on disk unchanged, and keeps the envelope when edited
    await api.saveDocument(next, `${text}c\n`)
    expect(Array.from(lastBytes(calls, 'mobile_save_file_bytes'))).toEqual(Array.from(expected))
    await api.saveDocument(next, `${text}c\nd`)
    expect(Array.from(lastBytes(calls, 'mobile_save_file_bytes'))).toEqual(
      Array.from(encode('a\r\nb\r\nc\r\nd', { bom: true })),
    )
  })

  it('uses the identity envelope for a session it never read (untitled)', async () => {
    const { client, calls } = fakeClient(new Uint8Array())
    const api = createMobileMarkdownApi(client)
    const untitled = makeSession({ sessionId: 'untitled-1', writable: false, uriHint: '' })
    await api.writeRecovery(untitled, 'ab')
    expect(new TextDecoder().decode(lastBytes(calls, 'mobile_recovery_write'))).toBe('ab')
    await api.saveAsDocument(untitled, 'new.md', 'a\nb')
    expect(Array.from(lastBytes(calls, 'mobile_save_as_file_bytes'))).toEqual(
      Array.from(encode('a\nb')),
    )
  })

  it('takes the envelope of a recovery copy from its bytes', async () => {
    const { client, calls } = fakeClient(new Uint8Array())
    const api = createMobileMarkdownApi(client)
    const untitled = makeSession({ sessionId: 'untitled-2', writable: false, uriHint: '' })
    const recovered = encode('x\r\ny\r\n', { bom: true })

    const opened = api.openFromBytes(untitled, recovered)
    expect(opened.text).toBe('x\ny\n')
    expect(opened.utf8).toBeUndefined()

    await api.saveAsDocument(untitled, 'restored.md', opened.text)
    expect(Array.from(lastBytes(calls, 'mobile_save_as_file_bytes'))).toEqual(Array.from(recovered))
  })

  it('reports utf8: false and writes the original bytes for a non-UTF-8 file', async () => {
    const original = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x0a])
    const { client, calls } = fakeClient(original)
    const api = createMobileMarkdownApi(client)
    const session = makeSession()

    const opened = await api.readDocument(session)
    expect(opened.utf8).toBe(false)

    await api.shareDocument(session, opened.text)
    expect(Array.from(lastBytes(calls, 'mobile_share_file'))).toEqual(Array.from(original))
    await api.saveDocument(session, opened.text)
    expect(Array.from(lastBytes(calls, 'mobile_save_file_bytes'))).toEqual(Array.from(original))
    // changed text would be written in another encoding than the file's: refused
    await expect(api.saveDocument(session, `${opened.text}x`)).rejects.toThrow(/INVALID_ARGUMENT/)
  })

  it('reports nothing extra for a UTF-8 file', async () => {
    const { client } = fakeClient(encode('# ok\n'))
    const api = createMobileMarkdownApi(client)
    expect(await api.readDocument(makeSession())).toEqual({ text: '# ok\n' })
  })
})
