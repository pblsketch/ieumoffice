/**
 * ODS keeps no defined names, so the workbook's IeumHide_ names (hiding
 * marks) are asked about once before converting; Cancel writes nothing.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportWorkbookAsOds, hidingNamesInXlsx } from '../src/main/ods-export'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function workbook(names: string[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'sheets-ods-hiding-'))
  dirs.push(dir)
  const zip = new JSZip()
  const defined = names
    .map((n) => `<definedName name="${n}">'Data'!$B$2:$B$9</definedName>`)
    .join('')
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook><sheets/><definedNames>${defined}</definedNames></workbook>`,
  )
  const path = join(dir, 'book.xlsx')
  writeFileSync(path, await zip.generateAsync({ type: 'uint8array' }))
  return path
}

function sidecar() {
  return {
    convertToOds: vi.fn(async () => {
      throw new Error('not reached in these tests')
    }),
    convertWorkbook: vi.fn(),
  }
}

describe('ODS export of a workbook with hiding marks', () => {
  it('counts the IeumHide_ names, in any case, and nothing else', async () => {
    expect(
      await hidingNamesInXlsx(await workbook(['IeumHide_이름', 'ieumhide2_이름', 'Total'])),
    ).toBe(2)
    expect(await hidingNamesInXlsx(await workbook(['Total']))).toBe(0)
  })

  it('asks before converting; Cancel converts and writes nothing', async () => {
    const source = await workbook(['IeumHide_학생이름'])
    const target = join(dirs[0]!, 'out.ods')
    const side = sidecar()
    const confirmHidingLoss = vi.fn(async () => false)
    const outcome = await exportWorkbookAsOds({
      sidecar: side,
      sourcePath: source,
      targetPath: target,
      confirmLoss: async () => true,
      confirmHidingLoss,
    })
    expect(outcome).toEqual({ status: 'canceled' })
    expect(confirmHidingLoss).toHaveBeenCalledWith(1)
    expect(side.convertToOds).not.toHaveBeenCalled()
    expect(existsSync(target)).toBe(false)
  })

  it('does not ask for a workbook without hiding marks', async () => {
    const source = await workbook(['Total'])
    const confirmHidingLoss = vi.fn(async () => false)
    const outcome = await exportWorkbookAsOds({
      sidecar: sidecar(),
      sourcePath: source,
      targetPath: join(dirs[0]!, 'out.ods'),
      confirmLoss: async () => true,
      confirmHidingLoss,
    })
    expect(confirmHidingLoss).not.toHaveBeenCalled()
    // the stub sidecar refuses: the export went on to convert
    expect(outcome.status).toBe('failed')
  })
})
