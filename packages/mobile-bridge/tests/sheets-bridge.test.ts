import { describe, expect, it, vi } from 'vitest'
import { MobileCommandError, type MobileTransport } from '../src/transport'
import {
  SHEETS_ENGINE_PROTOCOL_VERSION,
  sheetsCopySessionToTemp,
  sheetsEngineRequest,
  sheetsTempClear,
  sheetsTempCreateDir,
  sheetsTempDelete,
  sheetsTempNewPath,
  sheetsTempReadBytes,
  sheetsTempReadText,
  sheetsTempWriteBytes,
  sheetsTempWriteText,
} from '../src/sheets'

function clientWith(invoke: MobileTransport['invoke']) {
  return { transport: { invoke, listen: async () => () => {} } satisfies MobileTransport }
}

describe('sheetsEngineRequest', () => {
  it('sends the request as one protocol line and returns the engine response', async () => {
    const response = {
      version: 1,
      requestId: 'r1',
      ok: true,
      result: { entries: [] },
    }
    const invoke = vi.fn(async () => response) as unknown as MobileTransport['invoke']
    const request = {
      version: SHEETS_ENGINE_PROTOCOL_VERSION,
      requestId: 'r1',
      command: 'archive_manifest',
      path: '/cache/ieum-sheets/f-1.xlsx',
    }
    await expect(sheetsEngineRequest(clientWith(invoke), request)).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith('mobile_sheets_request', {
      line: JSON.stringify(request),
    })
  })

  it('passes an already serialized line through unchanged', async () => {
    const invoke = vi.fn(async () => ({})) as unknown as MobileTransport['invoke']
    await sheetsEngineRequest(clientWith(invoke), '{"version":1}')
    expect(invoke).toHaveBeenCalledWith('mobile_sheets_request', { line: '{"version":1}' })
  })

  it('resolves engine failures (ok: false) instead of throwing, like the desktop sidecar', async () => {
    const busy = {
      version: 1,
      requestId: 'c1',
      ok: false,
      error: {
        code: 'recalc_busy',
        message: 'Formula engine is busy with another recalculation.',
      },
    }
    const invoke = vi.fn(async () => busy) as unknown as MobileTransport['invoke']
    const answer = await sheetsEngineRequest(clientWith(invoke), {
      version: 1,
      requestId: 'c1',
      command: 'recalc_cells',
      path: '/cache/ieum-sheets/f-1.xlsx',
    })
    expect(answer.ok).toBe(false)
    expect(answer.error?.message).toContain('busy with another recalculation')
  })

  it('turns a command failure into a MobileCommandError', async () => {
    const invoke = vi.fn(async () => {
      throw { code: 'INTERNAL_ERROR', messageKey: 'mobile.internalError' }
    }) as unknown as MobileTransport['invoke']
    const err = await sheetsEngineRequest(clientWith(invoke), '{}').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('INTERNAL_ERROR')
  })
})

describe('sheets work-folder helpers', () => {
  it('call their commands with camelCase arguments', async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as MobileTransport['invoke']
    const client = clientWith(invoke)
    await sheetsCopySessionToTemp(client, 'sess-1', 'xlsx')
    await sheetsTempCreateDir(client)
    await sheetsTempNewPath(client, 'xml')
    await sheetsTempReadText(client, '/w/a.xml')
    await sheetsTempReadBytes(client, '/w/a.bin')
    await sheetsTempWriteText(client, '/w/a.xml', '<a/>')
    await sheetsTempWriteBytes(client, '/w/a.bin', 'AAE=')
    await sheetsTempDelete(client, '/w/a.bin')
    await sheetsTempClear(client)
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['mobile_sheets_copy_session_to_temp', { sessionId: 'sess-1', ext: 'xlsx' }],
      ['mobile_sheets_temp_create_dir', undefined],
      ['mobile_sheets_temp_new_path', { ext: 'xml' }],
      ['mobile_sheets_temp_read_text', { path: '/w/a.xml' }],
      ['mobile_sheets_temp_read_bytes', { path: '/w/a.bin' }],
      ['mobile_sheets_temp_write_text', { path: '/w/a.xml', text: '<a/>' }],
      ['mobile_sheets_temp_write_bytes', { path: '/w/a.bin', bytesBase64: 'AAE=' }],
      ['mobile_sheets_temp_delete', { path: '/w/a.bin' }],
      ['mobile_sheets_temp_clear', undefined],
    ])
  })

  it('surfaces a refused path as INVALID_ARGUMENT', async () => {
    const invoke = vi.fn(async () => {
      throw {
        code: 'INVALID_ARGUMENT',
        messageKey: 'mobile.sheets.pathOutsideWork',
        detail: '/data/secret',
      }
    }) as unknown as MobileTransport['invoke']
    const err = await sheetsTempReadText(clientWith(invoke), '/data/secret').catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).messageKey).toBe('mobile.sheets.pathOutsideWork')
  })
})
