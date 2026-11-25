import { describe, expect, it, vi } from 'vitest'
import { createMobileClient, MobileCommandError, type MobileTransport } from '../src/transport'
import { WEB_EXPORT_MIME, saveNewFile } from '../src/html'

function makeTransport(invoke: MobileTransport['invoke']): MobileTransport {
  return {
    invoke,
    listen: async () => () => {},
  }
}

describe('saveNewFile (export to a new file without touching the open document)', () => {
  it('exposes exactly the three export MIME types', () => {
    expect(WEB_EXPORT_MIME).toEqual({
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      odt: 'application/vnd.oasis.opendocument.text',
      hwpx: 'application/haansofthwpx',
    })
  })

  it('calls mobile_web_save_new_file with camelCase args and base64 bytes', async () => {
    const invoke = vi.fn(async () => ({
      name: 'note.docx',
    })) as unknown as MobileTransport['invoke']
    const client = createMobileClient(makeTransport(invoke))
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00])

    await expect(
      saveNewFile(client, { suggestedName: 'note.docx', mime: WEB_EXPORT_MIME.docx, bytes }),
    ).resolves.toEqual({ name: 'note.docx' })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('mobile_web_save_new_file', {
      suggestedName: 'note.docx',
      mime: WEB_EXPORT_MIME.docx,
      bytesBase64: Buffer.from(bytes).toString('base64'),
    })
  })

  it('does not use the shared save-as command that would replace the open session', async () => {
    const invoke = vi.fn(async () => ({ name: 'a.hwpx' })) as unknown as MobileTransport['invoke']
    const client = createMobileClient(makeTransport(invoke))
    await saveNewFile(client, {
      suggestedName: 'a.hwpx',
      mime: WEB_EXPORT_MIME.hwpx,
      bytes: new Uint8Array([1]),
    })
    const commands = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(commands).toEqual(['mobile_web_save_new_file'])
  })

  it('surfaces a dialog cancel as a USER_CANCELLED MobileCommandError', async () => {
    const client = createMobileClient(
      makeTransport(async () => {
        throw { code: 'USER_CANCELLED', messageKey: 'mobile.fs.cancelled' }
      }),
    )
    const err = await saveNewFile(client, {
      suggestedName: 'a.odt',
      mime: WEB_EXPORT_MIME.odt,
      bytes: new Uint8Array(),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MobileCommandError)
    expect((err as MobileCommandError).code).toBe('USER_CANCELLED')
  })
})
