import { describe, expect, it, vi } from 'vitest'
import type { MobileTransport } from '../src/transport'
import {
  sheetsSaveToOriginal,
  sheetsTempAppendBytes,
  sheetsTempAppendText,
  sheetsTempCopy,
  sheetsTempMkdir,
  sheetsTempReadRaw,
  sheetsTempRename,
  sheetsTempRoot,
  sheetsTempSha256,
  sheetsTempStat,
  sheetsWriteCopy,
} from '../src/sheets'

function clientWith(answer: unknown) {
  const invoke = vi.fn(async () => answer) as unknown as MobileTransport['invoke']
  return { invoke, client: { transport: { invoke, listen: async () => () => {} } } }
}

describe('sheets save-path command wrappers', () => {
  it('name the T1 commands with camelCase arguments', async () => {
    const cases: [() => Promise<unknown>, string, Record<string, unknown> | undefined][] = []
    const { invoke, client } = clientWith({ ok: true })
    cases.push(
      [() => sheetsTempRoot(client), 'mobile_sheets_temp_root', undefined],
      [() => sheetsTempMkdir(client, '/w/d'), 'mobile_sheets_temp_mkdir', { path: '/w/d' }],
      [
        () => sheetsTempRename(client, '/w/a', '/w/b'),
        'mobile_sheets_temp_rename',
        { from: '/w/a', to: '/w/b' },
      ],
      [
        () => sheetsTempCopy(client, '/w/a', '/w/b'),
        'mobile_sheets_temp_copy',
        { from: '/w/a', to: '/w/b' },
      ],
      [() => sheetsTempStat(client, '/w/a'), 'mobile_sheets_temp_stat', { path: '/w/a' }],
      [
        () => sheetsTempAppendText(client, '/w/a', '<x/>'),
        'mobile_sheets_temp_append_text',
        { path: '/w/a', text: '<x/>' },
      ],
      [
        () => sheetsTempAppendBytes(client, '/w/a', 'AAE='),
        'mobile_sheets_temp_append_bytes',
        { path: '/w/a', bytesBase64: 'AAE=' },
      ],
      [() => sheetsTempSha256(client, '/w/a'), 'mobile_sheets_temp_sha256', { path: '/w/a' }],
      [
        () => sheetsSaveToOriginal(client, 's-1', '/w/f.xlsx'),
        'mobile_sheets_save_to_original',
        { sessionId: 's-1', path: '/w/f.xlsx' },
      ],
      [
        () => sheetsWriteCopy(client, '/w/f.csv', 'book.csv', 'text/csv'),
        'mobile_sheets_write_copy',
        { path: '/w/f.csv', suggestedName: 'book.csv', mime: 'text/csv' },
      ],
    )
    for (const [call, command, args] of cases) {
      await call()
      expect(invoke).toHaveBeenLastCalledWith(command, args)
    }
  })

  it('reads raw answers as bytes whatever shape the transport hands back', async () => {
    const bytes = [0, 1, 254, 255]
    for (const answer of [
      new Uint8Array(bytes).buffer,
      new Uint8Array([9, ...bytes]).subarray(1),
      bytes,
    ]) {
      const { invoke, client } = clientWith(answer)
      expect([...(await sheetsTempReadRaw(client, '/w/a'))]).toEqual(bytes)
      expect(invoke).toHaveBeenLastCalledWith('mobile_sheets_temp_read_raw', { path: '/w/a' })
    }
    const { invoke, client } = clientWith(new ArrayBuffer(0))
    await sheetsTempReadRaw(client, '/w/a', { offset: 0, length: 8192 })
    expect(invoke).toHaveBeenLastCalledWith('mobile_sheets_temp_read_raw', {
      path: '/w/a',
      offset: 0,
      length: 8192,
    })
  })
})
