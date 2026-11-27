import { describe, expect, it, vi } from 'vitest'
import { createMobileClient, type MobileTransport } from '../src/transport'
import {
  PRINT_STAGE_CHUNK_BYTES,
  pdfSuggestedName,
  printPdfBytes,
  printSessionPdf,
  sharePdfBytes,
} from '../src/print'
import { getHomeThumbnail } from '../src/home'

function mockClient(handler: (command: string, args?: Record<string, unknown>) => unknown) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const transport: MobileTransport = {
    invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args })
      return handler(command, args) as T
    },
    listen: vi.fn(async () => () => {}),
  }
  return { client: createMobileClient(transport), calls }
}

describe('mobile-bridge print and thumbnail helpers', () => {
  it('normalizes suggested PDF file names', () => {
    expect(pdfSuggestedName('report.hwpx')).toBe('report.pdf')
    expect(pdfSuggestedName('slides.pptx')).toBe('slides.pdf')
    expect(pdfSuggestedName('plain')).toBe('plain.pdf')
    expect(pdfSuggestedName('Report v1.2')).toBe('Report v1.2.pdf')
    expect(pdfSuggestedName('   ')).toBe('document.pdf')
  })

  it('streams PDF bytes in chunks and finishes for print and share', async () => {
    const { client, calls } = mockClient((cmd) => {
      if (cmd === 'mobile_print_stage_begin') return { stageId: 'st-1' }
      if (cmd === 'mobile_print_stage_append') return { written: 10 }
      return { ok: true }
    })

    const big = new Uint8Array(PRINT_STAGE_CHUNK_BYTES + 12)
    big.set(new TextEncoder().encode('%PDF-1.7'))

    await printPdfBytes(client, {
      sessionId: 'sess-1',
      suggestedName: 'memo.hwp',
      bytes: big,
    })

    expect(calls.map((c) => c.command)).toEqual([
      'mobile_print_stage_begin',
      'mobile_print_stage_append',
      'mobile_print_stage_append',
      'mobile_print_stage_finish',
    ])
    expect(calls[0].args).toEqual({
      sessionId: 'sess-1',
      suggestedName: 'memo.pdf',
      target: 'print',
      expectedBytes: big.byteLength,
    })

    calls.length = 0
    await sharePdfBytes(client, {
      sessionId: 'sess-2',
      suggestedName: 'notes.md',
      bytes: new TextEncoder().encode('%PDF-1.4\n'),
    })
    expect(calls[0].args).toMatchObject({
      sessionId: 'sess-2',
      suggestedName: 'notes.pdf',
      target: 'share',
    })
  })

  it('aborts the stage when append fails', async () => {
    const { client, calls } = mockClient((cmd) => {
      if (cmd === 'mobile_print_stage_begin') return { stageId: 'st-err' }
      if (cmd === 'mobile_print_stage_append') throw new Error('disk full')
      return { ok: true }
    })

    await expect(
      printPdfBytes(client, {
        sessionId: 'sess-1',
        suggestedName: 'doc.html',
        bytes: new TextEncoder().encode('%PDF-1.4'),
      }),
    ).rejects.toThrow()

    expect(calls.map((c) => c.command)).toEqual([
      'mobile_print_stage_begin',
      'mobile_print_stage_append',
      'mobile_print_stage_abort',
    ])
    expect(calls[2].args).toEqual({ stageId: 'st-err' })
  })

  it('calls direct unmodified session PDF printing', async () => {
    const { client, calls } = mockClient(() => ({ ok: true }))
    await printSessionPdf(client, 'sess-pdf')
    expect(calls).toEqual([
      { command: 'mobile_print_session_pdf', args: { sessionId: 'sess-pdf' } },
    ])
  })

  it('handles home thumbnail payloads and stub fallbacks', async () => {
    const { client: stubClient } = mockClient(() => ({ ok: true }))
    await expect(getHomeThumbnail(stubClient, { kind: 'recent', id: 'r1' })).resolves.toEqual({
      kind: 'none',
    })

    const { client: liveClient, calls } = mockClient((cmd) => {
      if (cmd === 'mobile_home_get_thumbnail') {
        return { kind: 'text', title: 'Plan', snippet: 'Hello world' }
      }
      return { ok: true }
    })
    await expect(getHomeThumbnail(liveClient, { kind: 'recent', id: 'r1' }, 320)).resolves.toEqual({
      kind: 'text',
      title: 'Plan',
      snippet: 'Hello world',
    })
    expect(calls[0].command).toBe('mobile_home_get_thumbnail')
  })
})
