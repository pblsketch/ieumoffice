import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildHidingName } from '@genoffice/agent-core/hiding-name'
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

  it('a zip with bytes in front of it is still read for its marks', async () => {
    // zip readers find a package by its end record, so leading bytes do not hide it
    const zip = new JSZip()
    zip.file(
      'xl/workbook.xml',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
        `<definedNames><definedName name="${buildHidingName('이름', 'ko')}">Sheet1!$B$2:$B$5</definedName></definedNames>` +
        '</workbook>',
    )
    const packaged = await zip.generateAsync({ type: 'uint8array' })
    const prefixed = new Uint8Array([...new TextEncoder().encode('leading bytes'), ...packaged])
    const hiding = await workbookHidingOf(prefixed)
    expect(hiding?.marks.map((mark) => mark.label)).toEqual(['이름'])
  })

  it('a zip end record with bytes in front that does not open is unsupported', async () => {
    // an end record naming one entry whose central directory is not there
    const end = new Uint8Array(22)
    end.set([0x50, 0x4b, 5, 6])
    end[8] = 1 // entries on this disk
    end[10] = 1 // entries in total
    end[12] = 46 // central directory size
    const bytes = new Uint8Array([...new TextEncoder().encode('leading bytes'), ...end])
    await expect(workbookHidingOf(bytes)).rejects.toMatchObject({
      name: 'CliError',
      reason: 'unsupported',
    })
  })
})
