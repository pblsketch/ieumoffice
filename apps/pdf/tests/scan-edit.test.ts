import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { applyImageEdits } from '../src/main/image-edit'
import {
  applyTextInserts,
  fitStretch,
  insertCharStyles,
  validateTextEdits,
} from '../src/main/text-edit'
import { encodeStyle } from '../src/renderer/color-runs'
import type { LocalImageEdit } from '../src/renderer/ImageEditLayer'
import {
  coveredByScanPatch,
  growInkBox,
  paperRgb,
  scanCoverRect,
  scanDraftUntouched,
  scanInsertFromDraft,
  scanInsertFromEdit,
  scanPatchRects,
  splitScanInk,
} from '../src/renderer/scan-edit'
import type { TextDraft } from '../src/renderer/text-edit-preview'
import type { TextEditInput } from '../src/shared/ipc'

// Inserting decodes the picture with Electron; any 2x2 opaque bitmap will do here
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 2, height: 2 }),
      toBitmap: () => Buffer.alloc(16, 255),
    }),
  },
}))

// 2x2 opaque PNG (base64; pdf-lib accepts strings, which sidesteps jsdom's realm check)
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBNBAAAFRNB/8GxGIYAAAAAElFTkSuQmCC'

/** A scanned page: one page-sized picture and no text */
async function scanPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  page.drawImage(await doc.embedPng(PNG), { x: 0, y: 0, width: 595, height: 842 })
  return doc.save({ useObjectStreams: false })
}

/** pdf.js operator order on the first page: 'img' per painted image, 'text' per shown run */
async function paintOrder(bytes: Uint8Array): Promise<string[]> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: bytes.slice() }).promise
  try {
    const page = await doc.getPage(1)
    const ops = await page.getOperatorList()
    const out: string[] = []
    for (const f of ops.fnArray) {
      if (f === OPS.paintImageXObject) out.push('img')
      else if (f === OPS.showText) out.push('text')
    }
    return out
  } finally {
    await doc.loadingTask.destroy()
  }
}

const draft = (over: Partial<TextDraft> = {}): TextDraft => ({
  origIdx: 2,
  rect: [100, 500, 160, 520],
  oldText: '2',
  fontSize: 18,
  value: '2',
  ...over,
})

describe('scan edit helpers', () => {
  it('grows the cover past the recognized box', () => {
    const r = scanCoverRect([100, 500, 160, 520])
    expect(r[0]).toBeLessThan(100)
    expect(r[1]).toBeLessThan(500)
    expect(r[2]).toBeGreaterThan(160)
    expect(r[3]).toBeGreaterThan(520)
  })

  it('finds words under a pending patch by their center', () => {
    const covers = [[90, 490, 170, 530]]
    expect(coveredByScanPatch([100, 500, 160, 520], covers)).toBe(true)
    expect(coveredByScanPatch([300, 500, 360, 520], covers)).toBe(false)
    expect(coveredByScanPatch([100, 500, 160, 520], [])).toBe(false)
  })

  it('collects only scan patches, per page', () => {
    const insert = (pageIndex: number, scanPatch?: true): LocalImageEdit => ({
      id: `${pageIndex}-${scanPatch ? 's' : 'n'}`,
      input: {
        kind: 'insertImage',
        pageIndex,
        image: PNG,
        rect: [0, 0, 10, 10],
        layer: 'belowText',
      },
      ...(scanPatch ? { scanPatch } : {}),
    })
    const map = scanPatchRects([insert(0, true), insert(0), insert(1, true), insert(1, true)])
    expect(map.get(0)).toHaveLength(1)
    expect(map.get(1)).toHaveLength(2)
  })

  it('reads the sampled paper, white when there is none', () => {
    expect(paperRgb('#f4f0e8')).toEqual([244, 240, 232])
    expect(paperRgb(undefined)).toEqual([255, 255, 255])
  })

  it('an untouched draft changes nothing; any new word or style does', () => {
    expect(scanDraftUntouched(draft())).toBe(true)
    expect(scanDraftUntouched(draft({ value: '3' }))).toBe(false)
    expect(scanDraftUntouched(draft({ color: '#d32f2f' }))).toBe(false)
    expect(scanDraftUntouched(draft({ bold: true }))).toBe(false)
  })

  it('places the new text at the block baseline in the reader’s own lines', () => {
    const block = {
      leftPt: 100,
      firstBaseline: 503,
      widthPt: 12,
      lineHeight: 21.6,
      align: 'left' as const,
      bottomPt: 500,
    }
    // A block as narrow as the handwritten "2" must not split "3시간" across lines
    const insert = scanInsertFromDraft(draft({ value: '3시간', size: 12, block }), 0)!
    expect(insert.text).toBe('3시간')
    expect(insert.origin).toEqual([100, 503])
    expect(insert.fontSize).toBe(12)
    expect(insert.lineLeading).toBeCloseTo(21.6 * (12 / 18))
    expect(insert.color).toEqual([0, 0, 0])
    expect(insert.invisible).toBeUndefined()
  })

  it('a line draft sits on its box; a cleared draft only erases', () => {
    const insert = scanInsertFromDraft(draft({ value: '3', color: '#1a73e8' }), 90)!
    expect(insert.origin).toEqual([100, 504])
    expect(insert.color).toEqual([0x1a, 0x73, 0xe8])
    expect(insert.rotate).toBe(90)
    expect(scanInsertFromDraft(draft({ value: '  ' }), 0)).toBeNull()
  })

  it('carries a committed text edit over to an insert', () => {
    const input: TextEditInput = {
      pageIndex: 0,
      rect: [100, 500, 160, 520],
      oldText: '2',
      newText: '3',
      fontSize: 18,
      newFontSize: 14,
      origin: [100, 503],
    }
    const insert = scanInsertFromEdit(input, 0)!
    expect(insert).toMatchObject({ text: '3', fontSize: 14, origin: [100, 503] })
    expect(scanInsertFromEdit({ ...input, newText: '' }, 0)).toBeNull()
  })
})

describe('growInkBox', () => {
  /** ink as a set of 'x,y' cells */
  const inkOf = (cells: [number, number][]) => {
    const set = new Set(cells.map(([x, y]) => `${x},${y}`))
    return (x: number, y: number) => set.has(`${x},${y}`)
  }
  const limit = { x0: 0, y0: 0, x1: 40, y1: 20 }

  it('takes in strokes that run past the box, and stops at blank paper', () => {
    // a word from x 10..24 whose box only reaches x 20; another word starts at x 30
    const cells: [number, number][] = []
    for (let x = 10; x < 25; x++) cells.push([x, 8])
    cells.push([24, 11], [24, 12]) // a descender below the box
    for (let x = 30; x < 36; x++) cells.push([x, 8])
    const g = growInkBox(inkOf(cells), { x0: 10, y0: 6, x1: 20, y1: 11 }, limit)
    expect(g).toEqual({ x0: 10, y0: 6, x1: 25, y1: 13 })
  })

  it('a ruled line the word touches grows only to the limit', () => {
    const cells: [number, number][] = []
    for (let x = 0; x < 40; x++) cells.push([x, 11]) // table rule under the word
    const g = growInkBox(
      inkOf(cells),
      { x0: 10, y0: 6, x1: 20, y1: 11 },
      {
        x0: 5,
        y0: 3,
        x1: 25,
        y1: 14,
      },
    )
    expect(g).toEqual({ x0: 5, y0: 6, x1: 25, y1: 12 })
  })
})

describe('scan edits in the file', () => {
  it('reports an invisible OCR layer, matched or not, and nothing for visible text', async () => {
    const baked = await applyTextInserts(await scanPage(), [
      {
        pageIndex: 0,
        origin: [100, 500],
        text: 'Hours 2',
        fontSize: 18,
        color: [255, 255, 255],
        invisible: true,
      },
      { pageIndex: 0, origin: [100, 300], text: 'Visible', fontSize: 18, color: [0, 0, 0] },
    ])
    expect(baked.skipped).toEqual([])
    const ocrRect: [number, number, number, number] = [98, 494, 180, 520]
    const [edit, move, wrong, visible] = await validateTextEdits(baked.bytes, [
      { pageIndex: 0, rect: ocrRect, oldText: 'Hours 2', newText: 'Hours 3', fontSize: 18 },
      {
        pageIndex: 0,
        rect: ocrRect,
        oldText: 'Hours 2',
        newText: 'Hours 2',
        fontSize: 18,
        translate: [0, -40],
      },
      { pageIndex: 0, rect: ocrRect, oldText: 'garbled', newText: 'x', fontSize: 18 },
      { pageIndex: 0, rect: [98, 294, 180, 320], oldText: 'Visible', newText: 'V', fontSize: 18 },
    ])
    expect(edit).toMatchObject({ reason: null, invisible: true })
    expect(move).toMatchObject({ reason: null, invisible: true })
    expect(wrong!.reason).toBeTruthy()
    expect(wrong!.invisible).toBe(true)
    expect(visible!.reason).toBeNull()
    expect(visible!.invisible).toBeUndefined()
  })

  const patchAt = (rect: [number, number, number, number]) => ({
    kind: 'insertImage' as const,
    pageIndex: 0,
    image: PNG,
    rect,
    layer: 'belowText' as const,
    rotate: 0,
    overPicture: true as const,
  })

  it('saves the patch over the page picture and under the new text', async () => {
    // The save's order: text inserts first, then image edits
    const withText = await applyTextInserts(await scanPage(), [
      { pageIndex: 0, origin: [100, 503], text: '3', fontSize: 14, color: [0, 0, 0] },
    ])
    expect(withText.skipped).toEqual([])
    const patched = await applyImageEdits(withText.bytes, [patchAt([95, 495, 165, 525])])
    expect(patched.skipped).toEqual([])
    expect(await paintOrder(patched.bytes)).toEqual(['img', 'img', 'text'])
  })

  it('an erase alone (no text on the page) still lands over the picture', async () => {
    const patched = await applyImageEdits(await scanPage(), [patchAt([95, 495, 165, 525])])
    expect(patched.skipped).toEqual([])
    expect(await paintOrder(patched.bytes)).toEqual(['img', 'img'])
  })

  it('lands over the picture even when the page draws text before it', async () => {
    // a scanner that writes its OCR layer first, then the picture over it
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    page.drawText('header', { x: 50, y: 800, size: 12 })
    page.drawImage(await doc.embedPng(PNG), { x: 0, y: 0, width: 595, height: 842 })
    const bytes = await doc.save({ useObjectStreams: false })
    const patched = await applyImageEdits(bytes, [patchAt([95, 495, 165, 525])])
    expect(patched.skipped).toEqual([])
    // under the old 'belowText' rule the patch went before the header: under the scan
    expect(await paintOrder(patched.bytes)).toEqual(['text', 'img', 'img'])
  })

  it('two patches stack in the order they were made', async () => {
    const patched = await applyImageEdits(await scanPage(), [
      patchAt([95, 495, 165, 525]),
      patchAt([215, 495, 285, 525]),
    ])
    expect(patched.skipped).toEqual([])
    expect(await paintOrder(patched.bytes)).toEqual(['img', 'img', 'img'])
  })
})

describe('splitScanInk', () => {
  const paper: [number, number, number] = [250, 249, 245]
  /** w×h RGBA filled with paper, then `ink` cells set to a dark blue */
  const region = (w: number, h: number, ink: [number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let p = 0; p < w * h; p++) data.set([...paper, 255], p * 4)
    for (const [x, y] of ink) data.set([30, 40, 120, 255], (y * w + x) * 4)
    return data
  }
  const at = (a: Uint8ClampedArray, w: number, x: number, y: number) =>
    Array.from(a.slice((y * w + x) * 4, (y * w + x) * 4 + 4))

  it('erases the handwriting but keeps a ruled line that crosses the patch', () => {
    const w = 20
    const h = 10
    const ink: [number, number][] = []
    for (let x = 0; x < w; x++) ink.push([x, 8]) // table rule along the bottom
    for (let y = 2; y < 9; y++) ink.push([6, y]) // a stroke that touches the rule
    const { patch, cutout } = splitScanInk(region(w, h, ink), w, h, paper)
    expect(at(patch, w, 6, 4)).toEqual([...paper, 255]) // stroke gone
    expect(at(patch, w, 12, 8)).toEqual([30, 40, 120, 255]) // rule kept
    expect(at(patch, w, 6, 8)).toEqual([30, 40, 120, 255]) // where they cross: the rule
    // the cutout is the stroke alone: the rule does not travel with a move
    expect(at(cutout, w, 6, 4)[3]).toBe(255)
    expect(at(cutout, w, 12, 8)[3]).toBe(0)
    expect(at(cutout, w, 1, 1)[3]).toBe(0)
  })

  it('a vertical rule is kept too; a long stroke that stops short of an edge is not', () => {
    const w = 20
    const h = 10
    const ink: [number, number][] = []
    for (let y = 0; y < h; y++) ink.push([15, y]) // column line
    for (let x = 1; x < 19; x++) ink.push([x, 4]) // long dash, not edge to edge
    const { patch } = splitScanInk(region(w, h, ink), w, h, paper)
    expect(at(patch, w, 15, 2)).toEqual([30, 40, 120, 255])
    expect(at(patch, w, 5, 4)).toEqual([...paper, 255])
  })
})

describe('text insert styles and fitting', () => {
  it('maps styleRuns onto the insert text, skipping line breaks', () => {
    const styles = insertCharStyles({
      text: 'ab\ncd',
      styleRuns: [{ start: 1, end: 4, color: [200, 0, 0] }],
    })!
    expect(styles[0]).toBeNull()
    expect(styles[1]?.color).toEqual([200, 0, 0])
    expect(styles[2]).toBeNull() // the line break
    expect(styles[3]?.color).toEqual([200, 0, 0])
    expect(styles[4]).toBeNull()
    expect(insertCharStyles({ text: 'ab' })).toBeNull()
  })

  it('stretches a line to the target width, and leaves it when it cannot measure', () => {
    const advance = () => 5
    expect(fitStretch('abcd', null, 40, advance)).toBe(2)
    expect(fitStretch('abcd', null, undefined, advance)).toBe(1)
    expect(fitStretch('abcd', null, 40, () => null)).toBe(1)
  })

  it('draws a styled range as its own run and fits a line to its box', async () => {
    const result = await applyTextInserts(await scanPage(), [
      {
        pageIndex: 0,
        origin: [100, 500],
        text: 'AB CD',
        fontSize: 12,
        color: [0, 0, 0],
        styleRuns: [{ start: 3, end: 5, color: [200, 0, 0] }],
      },
      {
        pageIndex: 0,
        origin: [100, 300],
        text: 'stretched',
        fontSize: 12,
        color: [0, 0, 0],
        fitWidth: 200,
        invisible: true,
      },
    ])
    expect(result.skipped).toEqual([])
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await getDocument({ data: result.bytes.slice() }).promise
    try {
      const page = await doc.getPage(1)
      // pdf.js joins touching runs when it extracts text, so read the drawing itself:
      // two runs for the styled line (black, then red) and one for the fitted line
      const ops = await page.getOperatorList()
      const fills: unknown[][] = []
      let shown = 0
      ops.fnArray.forEach((f, k) => {
        if (f === OPS.showText) shown++
        if (f === OPS.setFillRGBColor) fills.push(Array.from(ops.argsArray[k] as unknown[]))
      })
      expect(shown).toBe(3)
      expect(fills.map((c) => String(c[0]))).toEqual(['#000000', '#c80000', '#000000'])
      const items = (await page.getTextContent()).items.filter(
        (i): i is typeof i & { str: string; width: number } => 'str' in i && i.str.trim() !== '',
      )
      expect(items.find((i) => i.str.startsWith('AB'))?.str).toBe('AB CD')
      const fitted = items.find((i) => i.str === 'stretched')!
      expect(fitted.width).toBeCloseTo(200, 0)
    } finally {
      await doc.loadingTask.destroy()
    }
  })
})

describe('scan draft styles', () => {
  it('carries the editor’s selection styles onto the insert', () => {
    const red = encodeStyle({ color: '#d32f2f' })
    const insert = scanInsertFromDraft(draft({ value: '4시간', charStyles: [red, '', ''] }), 0)!
    expect(insert.styleRuns).toEqual([
      {
        start: 0,
        end: 1,
        color: [211, 47, 47],
        font: undefined,
        size: undefined,
        bold: undefined,
        italic: undefined,
      },
    ])
    expect(scanInsertFromDraft(draft({ value: '4시간' }), 0)!.styleRuns).toBeUndefined()
  })
})
