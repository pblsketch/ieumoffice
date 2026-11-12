import { describe, expect, it } from 'vitest'
import { workbookHidingOf } from '../src/formats/xlsx-hiding'

/**
 * A workbook whose package cannot be opened is not taken for one without
 * hidden ranges (민감정보 가리기): another reader may still open it, so its
 * hiding is refused as unreadable rather than skipped.
 */
describe('workbookHidingOf fails closed', () => {
  it('a zip package it cannot open is unsupported, not "no hiding"', async () => {
    // a zip local header followed by garbage: a zip, but not one that opens
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, ...new TextEncoder().encode('broken')])
    await expect(workbookHidingOf(bytes)).rejects.toMatchObject({
      name: 'CliError',
      reason: 'unsupported',
    })
  })

  it('bytes that are no zip at all hold no mark', async () => {
    await expect(workbookHidingOf(new TextEncoder().encode('not a zip at all'))).resolves.toBeNull()
  })
})
