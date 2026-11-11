// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { readPdfMetadataFile } from '../src/main/metadata-file'
import { readStaticFormFills } from '../src/main/save-pdf'
import { readPdfSignatures } from '../src/main/pdf-signatures'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture(bytes = new Uint8Array(2 * 1024 * 1024)) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-metadata-test-'))
  roots.push(root)
  const path = join(root, 'input.pdf')
  await writeFile(path, bytes)
  return path
}

describe('temporary PDF metadata inputs', () => {
  it('releases a large standalone file input immediately after metadata extraction', async () => {
    const path = await fixture()
    let input!: Uint8Array
    expect(
      await readPdfMetadataFile(path, async (bytes) => {
        input = bytes
        return { size: bytes.byteLength }
      }),
    ).toEqual({ size: 2 * 1024 * 1024 })
    expect(input.byteLength).toBe(0)
  })

  it('releases an owned input even if the parser fails', async () => {
    const path = await fixture()
    let input!: Uint8Array
    await expect(
      readPdfMetadataFile(path, async (bytes) => {
        input = bytes
        throw new Error('broken PDF')
      }),
    ).rejects.toThrow('broken PDF')
    expect(input.byteLength).toBe(0)
  })

  it('borrows recovery bytes without detaching them or reading the original file', async () => {
    const recovery = new Uint8Array(2 * 1024 * 1024).fill(42)
    expect(
      await readPdfMetadataFile('missing-original.pdf', async (bytes) => bytes[10], recovery),
    ).toBe(42)
    expect(recovery.byteLength).toBe(2 * 1024 * 1024)
    expect(recovery[10]).toBe(42)
  })

  it('retains metadata from a compressed catalog after its file buffer is released', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const record = {
      id: 'fill',
      pageIndex: 0,
      rect: [10, 20, 30, 40],
      kind: 'text',
      text: 'retained text',
    }
    doc.catalog.set(
      PDFName.of('GenOfficeStaticFormFills'),
      PDFHexString.fromText(JSON.stringify([record])),
    )
    const pdf = await doc.save({ useObjectStreams: true })
    const large = new Uint8Array(pdf.length + 2 * 1024 * 1024)
    large.set(pdf)
    large.fill(32, pdf.length)
    const path = await fixture(large)
    let input!: Uint8Array
    const actual = await readPdfMetadataFile(path, async (bytes) => {
      input = bytes
      return readStaticFormFills(bytes)
    })
    expect(input.byteLength).toBe(0)
    expect(actual).toEqual([record])
    expect(await readPdfMetadataFile(path, readPdfSignatures)).toEqual([])
  })
})
