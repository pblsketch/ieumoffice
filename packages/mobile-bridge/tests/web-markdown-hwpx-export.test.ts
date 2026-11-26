import { describe, expect, it, vi } from 'vitest'
import { createMobileClient, type MobileTransport } from '../src/transport'
import { WEB_EXPORT_MIME } from '../src/html'
import { createMobileMarkdownApi } from '../src/markdown'

function makeTransport(invoke: MobileTransport['invoke']): MobileTransport {
  return { invoke, listen: async () => () => {} }
}

describe('saveConvertedHwpx (Markdown → HWPX written as a new file)', () => {
  it('writes through mobile_web_save_new_file with the HWPX MIME and returns the picked name', async () => {
    const invoke = vi.fn(async () => ({
      name: 'picked.hwpx',
    })) as unknown as MobileTransport['invoke']
    const api = createMobileMarkdownApi(createMobileClient(makeTransport(invoke)))
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

    await expect(api.saveConvertedHwpx('note.hwpx', bytes)).resolves.toEqual({
      name: 'picked.hwpx',
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('mobile_web_save_new_file', {
      suggestedName: 'note.hwpx',
      mime: WEB_EXPORT_MIME.hwpx,
      bytesBase64: Buffer.from(bytes).toString('base64'),
    })
  })

  it('never uses the save-as command that would replace the open session', async () => {
    const invoke = vi.fn(async () => ({ name: 'a.hwpx' })) as unknown as MobileTransport['invoke']
    const api = createMobileMarkdownApi(createMobileClient(makeTransport(invoke)))
    await api.saveConvertedHwpx('a.hwpx', new Uint8Array([1]))
    const commands = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(commands).not.toContain('mobile_save_as_file_bytes')
  })
})
