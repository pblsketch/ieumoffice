import { describe, expect, it } from 'vitest'
import { createMobileClient, type MobileDocSession, type MobileTransport } from '../src/transport'
import { createMobileHtmlApi, createTextSessionStore } from '../src/html'

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

const COMBOS = [false, true].flatMap((bom) =>
  (['\n', '\r\n'] as const).flatMap((eol) =>
    [false, true].map((trailing) => ({ bom, eol, trailing })),
  ),
)

function sample(combo: { eol: '\n' | '\r\n'; trailing: boolean }): string {
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="ko">',
    '<head><meta charset="UTF-8"><title>보고서</title></head>',
    '<body>',
    '  <h1>제목</h1>',
    '  <p>문단 하나</p>',
    '</body>',
    '</html>',
  ]
  return lines.join(combo.eol) + (combo.trailing ? combo.eol : '')
}

function comboName(combo: { bom: boolean; eol: string; trailing: boolean }): string {
  return `${combo.bom ? 'BOM' : 'no BOM'}, ${combo.eol === '\n' ? 'LF' : 'CRLF'}, ${
    combo.trailing ? 'trailing newline' : 'no trailing newline'
  }`
}

function makeSession(overrides: Partial<MobileDocSession> = {}): MobileDocSession {
  return {
    sessionId: 'html-sess-1',
    docKey: 'abcd1234abcd1234',
    name: 'page.html',
    ext: 'html',
    format: 'html',
    writable: true,
    ephemeral: false,
    uriHint: 'content://docs/page.html',
    ...overrides,
  }
}

interface Call {
  command: string
  args?: Record<string, unknown>
}

function fakeClient(fileBytes: Uint8Array) {
  const calls: Call[] = []
  const transport: MobileTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      switch (command) {
        case 'mobile_read_file_bytes':
          return { bytesBase64: b64(fileBytes) } as T
        case 'mobile_save_as_file_bytes':
          return makeSession({
            sessionId: 'html-sess-saved',
            docKey: '9999888877776666',
            name: 'saved.html',
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

function lastCall(calls: Call[], command: string): Call {
  const call = calls.filter((c) => c.command === command).at(-1)
  expect(call, `${command} was called`).toBeDefined()
  return call as Call
}

function lastBytes(calls: Call[], command: string): number[] {
  return Array.from(fromB64(lastCall(calls, command).args?.bytesBase64))
}

describe('createMobileHtmlApi keeps the bytes of the file', () => {
  for (const combo of COMBOS) {
    it(`${comboName(combo)}: unchanged save is the original bytes, edited save keeps the envelope`, async () => {
      const original = encode(sample(combo), { bom: combo.bom })
      const { client, calls } = fakeClient(original)
      const api = createMobileHtmlApi(client)
      const session = makeSession()

      const opened = await api.readDocument(session)
      expect(opened.utf8).toBeUndefined()
      expect(opened.text.includes('\r')).toBe(false)
      expect(opened.text.startsWith('﻿')).toBe(false)

      await api.saveDocument(session, opened.text)
      expect(lastBytes(calls, 'mobile_save_file_bytes')).toEqual(Array.from(original))
      await api.shareDocument(session, opened.text)
      expect(lastBytes(calls, 'mobile_share_file')).toEqual(Array.from(original))
      await api.writeRecovery(session, opened.text)
      expect(lastBytes(calls, 'mobile_recovery_write')).toEqual(Array.from(original))

      const edited = opened.text.replace('<p>문단 하나</p>', '<p>문단 하나</p>\n  <p>둘</p>')
      const expected = Array.from(encode(edited.split('\n').join(combo.eol), { bom: combo.bom }))
      await api.saveDocument(session, edited)
      expect(lastBytes(calls, 'mobile_save_file_bytes')).toEqual(expected)
      await api.shareDocument(session, edited)
      expect(lastBytes(calls, 'mobile_share_file')).toEqual(expected)
      await api.writeRecovery(session, edited)
      expect(lastBytes(calls, 'mobile_recovery_write')).toEqual(expected)
    })
  }

  it('saves as, shares and keeps recovery copies in the html format', async () => {
    const { client, calls } = fakeClient(encode('<p>a</p>'))
    const api = createMobileHtmlApi(client)
    const session = makeSession()
    const { text } = await api.readDocument(session)

    await api.writeRecovery(session, text)
    expect(lastCall(calls, 'mobile_recovery_write').args).toMatchObject({
      docKey: session.docKey,
      format: 'html',
      title: 'page.html',
    })
    await api.shareDocument(session, text)
    expect(lastCall(calls, 'mobile_share_file').args).toMatchObject({
      sessionId: session.sessionId,
      mode: 'edited',
    })
    const next = await api.saveAsDocument(session, 'page.html', text)
    expect(next.sessionId).toBe('html-sess-saved')
    expect(lastCall(calls, 'mobile_save_as_file_bytes').args).toMatchObject({
      sessionId: session.sessionId,
      format: 'html',
    })
  })

  it('moves the envelope to the new session on save as', async () => {
    const original = encode('<p>a</p>\r\n<p>b</p>\r\n', { bom: true })
    const { client, calls } = fakeClient(original)
    const api = createMobileHtmlApi(client)
    const session = makeSession({ writable: false })
    const { text } = await api.readDocument(session)

    await expect(api.saveDocument(session, text)).rejects.toMatchObject({ code: 'READ_ONLY_URI' })
    const next = await api.saveAsDocument(session, session.name, text)
    expect(lastBytes(calls, 'mobile_save_as_file_bytes')).toEqual(Array.from(original))

    await api.saveDocument(next, `${text}<p>c</p>\n`)
    expect(lastBytes(calls, 'mobile_save_file_bytes')).toEqual(
      Array.from(encode('<p>a</p>\r\n<p>b</p>\r\n<p>c</p>\r\n', { bom: true })),
    )
  })

  it('reopens a recovery copy with that copy’s envelope', async () => {
    const { client, calls } = fakeClient(new Uint8Array())
    const api = createMobileHtmlApi(client)
    const untitled = makeSession({ sessionId: 'untitled-1', writable: false, ephemeral: true })
    const copy = encode('<h1>복구</h1>\r\n<p>글</p>\r\n', { bom: true })

    const { text } = api.openFromBytes(untitled, copy)
    expect(text).toBe('<h1>복구</h1>\n<p>글</p>\n')
    await api.writeRecovery(untitled, text)
    expect(lastBytes(calls, 'mobile_recovery_write')).toEqual(Array.from(copy))
    await api.writeRecovery(untitled, `${text}<p>더</p>`)
    expect(lastBytes(calls, 'mobile_recovery_write')).toEqual(
      Array.from(encode('<h1>복구</h1>\r\n<p>글</p>\r\n<p>더</p>', { bom: true })),
    )
  })

  it('writes the typed text as is for a session never read (new document)', async () => {
    const { client, calls } = fakeClient(new Uint8Array())
    const api = createMobileHtmlApi(client)
    const untitled = makeSession({ sessionId: 'untitled-2', writable: false, ephemeral: true })
    await api.writeRecovery(untitled, '<p>ab</p>')
    expect(lastBytes(calls, 'mobile_recovery_write')).toEqual(Array.from(encode('<p>ab</p>')))
  })

  it('opens a non-UTF-8 file for viewing only: unchanged bytes still go out, edits are refused', async () => {
    // "<p>한글</p>" in EUC-KR
    const original = new Uint8Array([
      0x3c, 0x70, 0x3e, 0xc7, 0xd1, 0xb1, 0xdb, 0x3c, 0x2f, 0x70, 0x3e, 0x0d, 0x0a,
    ])
    const { client, calls } = fakeClient(original)
    const api = createMobileHtmlApi(client)
    const session = makeSession()
    const opened = await api.readDocument(session)
    expect(opened.utf8).toBe(false)

    await api.shareDocument(session, opened.text)
    expect(lastBytes(calls, 'mobile_share_file')).toEqual(Array.from(original))
    await expect(api.saveDocument(session, `${opened.text}x`)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })
})

describe('createTextSessionStore', () => {
  it('keeps each session apart and forgets one on request', () => {
    const store = createTextSessionStore()
    const a = makeSession({ sessionId: 'a' })
    const b = makeSession({ sessionId: 'b' })
    const crlf = encode('x\r\ny\r\n', { bom: true })
    store.remember('a', crlf)
    store.remember('b', encode('x\ny\n'))
    expect(Array.from(store.bytesFor(a, 'x\ny\n'))).toEqual(Array.from(crlf))
    expect(Array.from(store.bytesFor(b, 'x\ny\nz'))).toEqual(Array.from(encode('x\ny\nz')))
    store.forget('a')
    expect(Array.from(store.bytesFor(a, 'x\ny\n'))).toEqual(Array.from(encode('x\ny\n')))
  })
})
