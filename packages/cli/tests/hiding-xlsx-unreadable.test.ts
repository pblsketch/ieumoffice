import { describe, expect, it } from 'vitest'
import { workbookHidingOf } from '../src/formats/xlsx-hiding'

/**
 * A workbook whose package cannot be opened is not taken for one without
 * hidden ranges (민감정보 가리기): another reader may still open it, so its
 * hiding is refused as unreadable rather than skipped.
 */
describe('workbookHidingOf fails closed', () => {
  it('a package that is not a readable zip is unsupported, not "no hiding"', async () => {
    const bytes = new TextEncoder().encode('not a zip at all')
    await expect(workbookHidingOf(bytes)).rejects.toMatchObject({
      name: 'CliError',
      reason: 'unsupported',
    })
  })
})
