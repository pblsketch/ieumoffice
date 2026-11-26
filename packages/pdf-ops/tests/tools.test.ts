// @vitest-environment node
/**
 * The tool runner and its rules, shared by the PC tools window and the phone.
 * With the mirror page engine the runner must give the bytes the PC runner
 * gives (the PC fills the engine with save-pdf.ts and read-text.ts), the
 * later tools refuse with "unsupported" when the engine leaves them out, and
 * the window's input and result checks keep the PC rules.
 *
 * Only Date is frozen: pdf-lib stamps its dates from the clock and waits on
 * timer ticks while saving, so faking every timer would hang it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mirrorPageEngine } from '../src/mirror-pages'
import type { PdfTextPdfium } from '../src/mirror-text'
import { checkToolResult, inspectToolInput } from '../src/rules'
import {
  PdfToolRefusal,
  checkOptions,
  outputNames,
  runPdfTool,
  runSplitPdfTool,
  type PageEngine,
} from '../src/tools'
import type { PdfToolId, PdfToolOptions } from '../src/tool-ids'

const FIXED_NOW = new Date('2026-01-02T03:04:05Z')

/**
 * The PC code this is checked against, loaded by a computed path so the apps'
 * type graph (Electron, React, Node) stays out of this package's type check.
 */
const PC_TOOLS = fileURLToPath(
  new URL('../../../apps/shell/src/main/pdf-tools/tools.ts', import.meta.url),
)
const PC_TEXT_EDIT = fileURLToPath(
  new URL('../../../apps/pdf/src/main/text-edit.ts', import.meta.url),
)
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../apps/pdf/tests/fixtures/${name}`, import.meta.url)),
    ),
  )

interface PcTools {
  runPdfTool(
    tool: PdfToolId,
    inputs: Uint8Array[],
    options: PdfToolOptions,
    deps?: Record<string, unknown>,
  ): Promise<Uint8Array[]>
  runSplitPdfTool(
    first: Uint8Array,
    sourceName: string,
    options: PdfToolOptions,
  ): Promise<{ parts: Uint8Array[]; names: string[]; oversizedPages: number[] }>
  outputNames: typeof outputNames
}

let pc: PcTools
let engine: PageEngine

beforeAll(async () => {
  pc = (await import(/* @vite-ignore */ PC_TOOLS)) as PcTools
  const edit = (await import(/* @vite-ignore */ PC_TEXT_EDIT)) as {
    loadPdfium(): Promise<unknown>
  }
  engine = mirrorPageEngine(async () => (await edit.loadPdfium()) as PdfTextPdfium)
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

async function textPages(count: number, base = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([base + i, 300])
    if (i % 3 !== 2) page.drawText(`Line on page ${i + 1}`, { x: 10, y: 250, size: 12, font })
  }
  return doc.save({ useObjectStreams: false })
}

/** a form on two pages, one page turned already */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const first = doc.addPage([300, 400])
  const second = doc.addPage([300, 400])
  second.setRotation(degrees(90))
  doc.addPage([300, 400])
  const form = doc.getForm()
  const field = form.createTextField('name')
  field.setText('Lee')
  field.addToPage(first, { x: 20, y: 300, width: 200, height: 24 })
  const box = form.createCheckBox('ok')
  box.check()
  box.addToPage(second, { x: 20, y: 300, width: 18, height: 18 })
  return doc.save({ useObjectStreams: false })
}

const same = (a: Uint8Array[], b: Uint8Array[]) => {
  expect(a.length).toBe(b.length)
  a.forEach((bytes, i) => expect(Buffer.from(bytes).equals(Buffer.from(b[i]!))).toBe(true))
}

/** the options the window would send, checked as it checks them */
function checked(tool: PdfToolId, raw: unknown, pages: number): PdfToolOptions {
  const result = checkOptions(tool, raw, pages)
  if (!result.ok) throw new Error(`options refused: ${result.error}`)
  return result.options
}

describe('runPdfTool with the mirror page engine', () => {
  it('merges to the PC bytes', async () => {
    const inputs = [await textPages(2), await formPdf(), await textPages(3, 200)]
    same(
      await runPdfTool('merge', inputs, {}, { engine }),
      await pc.runPdfTool('merge', inputs, {}),
    )
  })

  it('extracts and reverses to the PC bytes', async () => {
    for (const bytes of [await textPages(5), await formPdf()]) {
      const count = (await PDFDocument.load(bytes)).getPageCount()
      const extract = checked('extract', { pages: `${count},1-2` }, count)
      same(
        await runPdfTool('extract', [bytes], extract, { engine }),
        await pc.runPdfTool('extract', [bytes], extract),
      )
      same(
        await runPdfTool('reverse', [bytes], {}, { engine }),
        await pc.runPdfTool('reverse', [bytes], {}),
      )
    }
  })

  it('rotates to the PC bytes, forms and turned pages included', async () => {
    for (const bytes of [await textPages(4), await formPdf()]) {
      for (const rotation of [90, 180, 270]) {
        const options = checked('rotate', { rotation }, 4)
        same(
          await runPdfTool('rotate', [bytes], options, { engine }),
          await pc.runPdfTool('rotate', [bytes], options),
        )
      }
    }
  })

  it('removes the chosen blank pages to the PC bytes', async () => {
    for (const [bytes, removePages] of [
      [await textPages(6), '3,6'],
      [await formPdf(), '2'],
      [await formPdf(), '1,3'],
    ] as const) {
      const count = (await PDFDocument.load(bytes)).getPageCount()
      const options = checked('blankPages', { removePages }, count)
      same(
        await runPdfTool('blankPages', [bytes], options, { engine }),
        await pc.runPdfTool('blankPages', [bytes], options),
      )
    }
  })

  it('writes the PC text, and refuses a PDF without text as the PC does', async () => {
    const bytes = await textPages(5)
    same(
      await runPdfTool('toText', [bytes], {}, { engine }),
      await pc.runPdfTool('toText', [bytes], {}),
    )
    const blank = await PDFDocument.create()
    blank.addPage([200, 200])
    const noText = await blank.save({ useObjectStreams: false })
    const refused = runPdfTool('toText', [noText], {}, { engine })
    await expect(refused).rejects.toBeInstanceOf(PdfToolRefusal)
    await expect(refused).rejects.toMatchObject({ reason: 'no-text' })
    await expect(pc.runPdfTool('toText', [noText], {})).rejects.toMatchObject({ reason: 'no-text' })
  })

  it('splits to the PC parts and names without an engine', async () => {
    const bytes = await textPages(7)
    const options = checked('split', { splitMode: 'fixed', splitFixedValue: 3 }, 7)
    const mine = await runSplitPdfTool(bytes, 'Report.pdf', options)
    const theirs = await pc.runSplitPdfTool(bytes, 'Report.pdf', options)
    same(mine.parts, theirs.parts)
    expect(mine.names).toEqual(theirs.names)
    expect(mine.oversizedPages).toEqual(theirs.oversizedPages)
    same(
      await runPdfTool('split', [bytes], options, { engine }),
      await pc.runPdfTool('split', [bytes], options),
    )
  })

  it('refuses the later tools the mirror engine leaves out', async () => {
    const bytes = await textPages(2)
    for (const tool of ['nup', 'pageSize', 'splitPages'] as const) {
      await expect(runPdfTool(tool, [bytes], checked(tool, {}, 2), { engine })).rejects.toThrow(
        `unsupported: ${tool}`,
      )
    }
  })

  it('uses an engine that has the later tools', async () => {
    const bytes = await textPages(2)
    const calls: string[] = []
    const fuller: PageEngine = {
      ...engine,
      async mergePagesBytes(b, o) {
        calls.push(`nup ${o.perSheet} ${o.direction} ${o.separator}`)
        return b
      },
      async setPageSizeBytes(b, w, h) {
        calls.push(`size ${w}x${h}`)
        return b
      },
      async splitPagesBytes(b, perPage) {
        calls.push(`split ${perPage}`)
        return b
      },
    }
    await runPdfTool('nup', [bytes], checked('nup', { perSheet: 4 }, 2), { engine: fuller })
    await runPdfTool('pageSize', [bytes], checked('pageSize', { paper: 'A5' }, 2), {
      engine: fuller,
    })
    await runPdfTool('splitPages', [bytes], checked('splitPages', { perPage: 9 }, 2), {
      engine: fuller,
    })
    expect(calls).toEqual(['nup 4 horizontal false', 'size 420x595', 'split 9'])
  })

  it('leaves passwords and repair to a job, as the PC does', async () => {
    const bytes = await textPages(1)
    for (const tool of ['encrypt', 'decrypt', 'repair'] as const) {
      await expect(runPdfTool(tool, [bytes], {}, { engine })).rejects.toThrow(
        `${tool} runs as a job`,
      )
    }
  })

  it('refuses no input', async () => {
    await expect(runPdfTool('merge', [], {}, { engine })).rejects.toThrow('no input')
  })
})

describe('outputNames', () => {
  it('drops the picture endings phones pick, in any case', () => {
    const names = [
      'photo.heic',
      'photo.HEIF',
      'photo.webp',
      'photo.gif',
      'photo.BMP',
      'photo.avif',
      'photo.tif',
      'photo.TIFF',
      'photo.jpeg',
      'photo.JPG',
      'photo.png',
      'photo.Pdf',
    ]
    for (const name of names) {
      expect(outputNames('imagesToPdf', name, 1, {}), name).toEqual(['photo.pdf'])
      expect(outputNames('merge', name, 1, {}), name).toEqual(['photo-merged.pdf'])
    }
  })

  it('keeps other endings and the PC names for what the PC takes', () => {
    expect(outputNames('merge', 'notes.docx', 1, {})).toEqual(['notes.docx-merged.pdf'])
    expect(outputNames('compress', 'archive.tiffs', 1, {})).toEqual(['archive.tiffs-smaller.pdf'])
    expect(outputNames('toText', '.pdf', 1, {})).toEqual(['document.txt'])
    const tools: PdfToolId[] = ['merge', 'split', 'nup', 'pageSize', 'toText', 'encrypt', 'repair']
    for (const tool of tools) {
      for (const name of ['Report.pdf', 'scan.JPG', 'shot.png', 'plain']) {
        const options = { perSheet: 4, paper: 'Letter', splitPrefix: 'part' } as const
        expect(outputNames(tool, name, 12, options), `${tool} ${name}`).toEqual(
          pc.outputNames(tool, name, 12, options),
        )
      }
    }
  })
})

/** a JPEG header pdf-lib can read: the scan data is a stub */
const jpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0, 10, 0, 20, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff,
  0xd9,
])

describe('inspectToolInput', () => {
  it('counts a picture as one page and refuses what is not one', async () => {
    expect(await inspectToolInput(jpeg, 'image', 'pdf')).toEqual({ ok: true, pages: 1 })
    expect(await inspectToolInput(await textPages(2), 'image', 'pdf')).toEqual({
      ok: false,
      problem: 'not-image',
    })
  })

  it('takes readable PDFs, except for "remove password"', async () => {
    const plain = await textPages(3)
    expect(await inspectToolInput(plain, 'pdf', 'pdf')).toEqual({ ok: true, pages: 3 })
    expect(await inspectToolInput(plain, 'pdf', 'damaged')).toEqual({ ok: true, pages: 3 })
    expect(await inspectToolInput(plain, 'pdf', 'encrypted')).toEqual({
      ok: false,
      problem: 'not-encrypted',
    })
  })

  it('takes a password-protected PDF only for "remove password", with its page count', async () => {
    const locked = fixture('enc-r5-aes256.pdf')
    expect(await inspectToolInput(locked, 'pdf', 'encrypted')).toEqual({ ok: true, pages: 1 })
    // a page tree pdf-lib cannot walk without the key: taken, its pages unknown
    expect(await inspectToolInput(fixture('enc256.pdf'), 'pdf', 'encrypted')).toEqual({
      ok: true,
      pages: 0,
    })
    expect(await inspectToolInput(locked, 'pdf', 'pdf')).toEqual({
      ok: false,
      problem: 'encrypted',
    })
    expect(await inspectToolInput(locked, 'pdf', 'damaged')).toEqual({
      ok: false,
      problem: 'encrypted',
    })
  })

  it('takes a file pdf-lib cannot read only for "repair", its pages unknown', async () => {
    const broken = new TextEncoder().encode('%PDF-1.7\nnot really a pdf')
    expect(await inspectToolInput(broken, 'pdf', 'damaged')).toEqual({ ok: true, pages: 0 })
    expect(await inspectToolInput(broken, 'pdf', 'pdf')).toEqual({
      ok: false,
      problem: 'unreadable',
    })
    expect(await inspectToolInput(broken, 'pdf', 'encrypted')).toEqual({
      ok: false,
      problem: 'unreadable',
    })
  })
})

describe('checkToolResult', () => {
  it('wants a password-protected file from "add password"', async () => {
    expect(await checkToolResult('encrypt', fixture('enc256.pdf'))).toBe(true)
    expect(await checkToolResult('encrypt', await textPages(1))).toBe(false)
  })

  it('wants a file the other tools can read from "remove password" and "repair"', async () => {
    const plain = await textPages(1)
    const broken = new TextEncoder().encode('%PDF-1.7\nnot really a pdf')
    for (const tool of ['decrypt', 'repair'] as const) {
      expect(await checkToolResult(tool, plain), tool).toBe(true)
      expect(await checkToolResult(tool, fixture('enc256.pdf')), tool).toBe(false)
      expect(await checkToolResult(tool, broken), tool).toBe(false)
    }
  })
})
