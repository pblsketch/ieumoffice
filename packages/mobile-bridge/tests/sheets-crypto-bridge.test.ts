import { describe, expect, it, vi } from 'vitest'
import type { MobileTransport } from '../src/transport'
import { sheetsDecrypt, sheetsEncrypt, sheetsProbeEncryption } from '../src/sheets'

function clientWith(invoke: MobileTransport['invoke']) {
  return { transport: { invoke, listen: async () => () => {} } satisfies MobileTransport }
}

describe('the sheets password commands', () => {
  it('send one crypto request line per call and pass the answer through', async () => {
    const answers = [
      { ok: true, result: { encrypted: true, supported: true, document: 'ooxml' } },
      { ok: false, error: { code: 'wrong_password', message: 'The password is incorrect.' } },
      { ok: true, result: {} },
    ]
    const invoke = vi.fn(async () => answers.shift()) as unknown as MobileTransport['invoke']
    const client = clientWith(invoke)

    await expect(sheetsProbeEncryption(client, '/w/a.xlsx')).resolves.toEqual({
      ok: true,
      result: { encrypted: true, supported: true, document: 'ooxml' },
    })
    await expect(sheetsDecrypt(client, '/w/a.xlsx', '/w/b.xlsx', 'pw')).resolves.toMatchObject({
      ok: false,
      error: { code: 'wrong_password' },
    })
    await expect(sheetsEncrypt(client, '/w/b.xlsx', '/w/c.xlsx', 'pw')).resolves.toEqual({
      ok: true,
      result: {},
    })
    const calls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.map(([command, args]) => [command, JSON.parse(args.line)])).toEqual([
      ['mobile_sheets_crypto', { op: 'probe', path: '/w/a.xlsx' }],
      [
        'mobile_sheets_crypto',
        { op: 'decrypt', source: '/w/a.xlsx', target: '/w/b.xlsx', password: 'pw' },
      ],
      [
        'mobile_sheets_crypto',
        { op: 'encrypt', source: '/w/b.xlsx', target: '/w/c.xlsx', password: 'pw' },
      ],
    ])
  })
})
