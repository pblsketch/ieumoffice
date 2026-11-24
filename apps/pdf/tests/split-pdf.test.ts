import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import {
  cutAfterToRanges,
  formatPartPages,
  formatSplitOutputNames,
  formatSplitRangeList,
  parseSplitRangeList,
  planBookmarkParts,
  planSplitParts,
  rangesToCutAfter,
  sanitizeSplitName,
  splitSubfolderName,
} from '../src/shared/split-plan'
import { executeSplitPlan, readPdfBookmarks, uniqueSplitSubfolder } from '../src/main/split-pdf'
import { applySaveRequest } from '../src/main/save-pdf'

/** Build a PDF whose page widths (100, 101, ...) uniquely identify each page */
async function makeNumberedPdf(pageCount: number, base = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([base + i, 300])
  }
  return doc.save({ useObjectStreams: false })
}

/** Build a PDF where each page carries a sizable unique text payload so byte size scales per page */
async function makeSizedPdf(pageCountsBytes: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pageCountsBytes.length; i++) {
    const page = doc.addPage([100 + i, 500])
    const lines = Math.max(1, Math.floor(pageCountsBytes[i]! / 60))
    for (let l = 0; l < lines; l++) {
      // Unique strings per line resist Flate repetition compression
      const line = `P${i}-L${l}-${((i + 1) * (l + 7) * 2654435761).toString(36).repeat(3)}`
      page.drawText(line, { x: 10, y: 480 - (l % 45) * 10, size: 8, font })
    }
  }
  return doc.save({ useObjectStreams: false })
}

async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => Math.round(p.getWidth()))
}

describe('split-plan pure helpers', () => {
  it('parses comma/semicolon and full-width range lists without merging adjacent ranges', () => {
    expect(parseSplitRangeList('1-3, 4-8, 9', 10)).toEqual({
      ok: true,
      ranges: [
        { start: 1, end: 3 },
        { start: 4, end: 8 },
        { start: 9, end: 9 },
      ],
    })
    expect(parseSplitRangeList('5-3； 1～2， 2—4', 10)).toEqual({
      ok: true,
      ranges: [
        { start: 3, end: 5 },
        { start: 1, end: 2 },
        { start: 2, end: 4 },
      ],
    })
    expect(parseSplitRangeList('', 5)).toEqual({ ok: false, reason: 'empty' })
    expect(parseSplitRangeList('1-a', 5)).toEqual({ ok: false, reason: 'syntax' })
    expect(parseSplitRangeList('1-6', 5)).toEqual({ ok: false, reason: 'outOfRange' })
    expect(parseSplitRangeList('0-2', 5)).toEqual({ ok: false, reason: 'outOfRange' })
  })

  it('round-trips scissor cuts and contiguous ranges', () => {
    const ranges = cutAfterToRanges([3, 8, 3, 0, 12], 12)
    expect(ranges).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 8 },
      { start: 9, end: 12 },
    ])
    expect(formatSplitRangeList(ranges)).toBe('1-3, 4-8, 9-12')
    expect(rangesToCutAfter(ranges, 12)).toEqual([3, 8])
    // Gaps or overlaps are not pure scissor partitions
    expect(
      rangesToCutAfter(
        [
          { start: 1, end: 3 },
          { start: 5, end: 12 },
        ],
        12,
      ),
    ).toBeNull()
    expect(
      rangesToCutAfter(
        [
          { start: 1, end: 4 },
          { start: 3, end: 12 },
        ],
        12,
      ),
    ).toBeNull()
  })

  it('plans fixed pagesPerFile and fileCount evenly', () => {
    const byPages = planSplitParts({ mode: 'fixed', kind: 'pagesPerFile', value: 3 }, 10)
    expect(byPages).toEqual({
      ok: true,
      dynamic: false,
      parts: [{ pages: [1, 2, 3] }, { pages: [4, 5, 6] }, { pages: [7, 8, 9] }, { pages: [10] }],
    })

    const byFiles = planSplitParts({ mode: 'fixed', kind: 'fileCount', value: 3 }, 10)
    expect(byFiles).toEqual({
      ok: true,
      dynamic: false,
      parts: [{ pages: [1, 2, 3, 4] }, { pages: [5, 6, 7] }, { pages: [8, 9, 10] }],
    })

    // Clamps fileCount to pageCount when asking for more files than pages
    const clamped = planSplitParts({ mode: 'fixed', kind: 'fileCount', value: 8 }, 3)
    expect(clamped).toEqual({
      ok: true,
      dynamic: false,
      parts: [{ pages: [1] }, { pages: [2] }, { pages: [3] }],
    })
  })

  it('plans merged ranges into a single part preserving order', () => {
    const merged = planSplitParts(
      {
        mode: 'ranges',
        ranges: [
          { start: 1, end: 2 },
          { start: 5, end: 6 },
        ],
        mergeRanges: true,
      },
      8,
    )
    expect(merged).toEqual({
      ok: true,
      dynamic: false,
      parts: [{ pages: [1, 2, 5, 6] }],
    })
  })

  it('plans bookmark parts by level, deduplicating same-page bookmarks and handling leading pages', () => {
    const bookmarks = [
      { title: 'Chapter 1', level: 1, page: 3 },
      { title: 'Section 1.1', level: 2, page: 3 },
      { title: 'Section 1.2', level: 2, page: 5 },
      { title: 'Chapter 2', level: 1, page: 8 },
    ]
    expect(planBookmarkParts(bookmarks, 10, 1, true)).toEqual([
      { pages: [1, 2] },
      { pages: [3, 4, 5, 6, 7], label: 'Chapter 1' },
      { pages: [8, 9, 10], label: 'Chapter 2' },
    ])
    expect(planBookmarkParts(bookmarks, 10, 1, false)).toEqual([
      { pages: [3, 4, 5, 6, 7], label: 'Chapter 1' },
      { pages: [8, 9, 10], label: 'Chapter 2' },
    ])
    expect(planBookmarkParts(bookmarks, 10, 2, false)).toEqual([
      { pages: [3, 4], label: 'Chapter 1' },
      { pages: [5, 6, 7], label: 'Section 1.2' },
      { pages: [8, 9, 10], label: 'Chapter 2' },
    ])
  })

  it('formats filenames with smart zero-padding, range tags, bookmark titles and deduplication', () => {
    const three = [{ pages: [1, 2] }, { pages: [3] }, { pages: [4, 5] }]
    expect(formatSplitOutputNames(three, 'Report.pdf', { pattern: 'numbered' })).toEqual([
      'Report-1.pdf',
      'Report-2.pdf',
      'Report-3.pdf',
    ])
    expect(formatSplitOutputNames(three, 'Report.pdf', { pattern: 'range' })).toEqual([
      'Report_p1-2.pdf',
      'Report_p3.pdf',
      'Report_p4-5.pdf',
    ])

    const ten = Array.from({ length: 10 }, (_, i) => ({ pages: [i + 1] }))
    const tenNames = formatSplitOutputNames(ten, 'Doc.pdf', { pattern: 'numbered' })
    expect(tenNames[0]).toBe('Doc-01.pdf')
    expect(tenNames[9]).toBe('Doc-10.pdf')

    const bmParts = [
      { pages: [1, 2] },
      { pages: [3, 4], label: '1. 서론: 배경/목적?' },
      { pages: [5, 6], label: '1. 서론: 배경/목적?' },
    ]
    expect(formatSplitOutputNames(bmParts, 'Thesis.pdf', { pattern: 'bookmark' })).toEqual([
      '1_Thesis_p1-2.pdf',
      '2_1. 서론_ 배경_목적_.pdf',
      '3_1. 서론_ 배경_목적_.pdf',
    ])

    // Duplicate ranges deduplicate cleanly
    const dupRanges = [{ pages: [1, 2] }, { pages: [1, 2] }]
    expect(formatSplitOutputNames(dupRanges, 'a.pdf', { pattern: 'range' })).toEqual([
      'a_p1-2.pdf',
      'a_p1-2-2.pdf',
    ])

    expect(sanitizeSplitName('CON', 'fallback')).toBe('fallback')
    expect(splitSubfolderName('Report.pdf')).toBe('Report-split')
    expect(formatPartPages([1, 2, 3, 5, 7, 8])).toBe('1-3,5,7-8')
  })
})

describe('split-pdf execution engine', () => {
  it('executes custom range and merged-range splits without mutating source bytes', async () => {
    const src = await makeNumberedPdf(6)
    const snapshot = Buffer.from(src)

    const split = await executeSplitPlan(
      src,
      {
        mode: 'ranges',
        ranges: [
          { start: 1, end: 2 },
          { start: 4, end: 6 },
        ],
      },
      { sourceName: 'handout.pdf', output: { pattern: 'range' } },
    )
    expect(Buffer.from(src).equals(snapshot)).toBe(true)
    expect(split.parts.map((p) => p.name)).toEqual(['handout_p1-2.pdf', 'handout_p4-6.pdf'])
    expect(await Promise.all(split.parts.map((p) => pageWidths(p.bytes)))).toEqual([
      [100, 101],
      [103, 104, 105],
    ])

    const merged = await executeSplitPlan(
      src,
      {
        mode: 'ranges',
        ranges: [
          { start: 1, end: 2 },
          { start: 5, end: 6 },
        ],
        mergeRanges: true,
      },
      { sourceName: 'handout.pdf' },
    )
    expect(merged.parts).toHaveLength(1)
    expect(await pageWidths(merged.parts[0]!.bytes)).toEqual([100, 101, 104, 105])
  })

  it('reads nested outlines (including Unicode titles) and splits by bookmark level', async () => {
    const base = await makeNumberedPdf(7)
    const withOutline = (
      await applySaveRequest(base, {
        path: '',
        markups: [],
        drawings: [],
        formValues: [],
        stamps: [],
        outline: [
          {
            title: '제1장 개요',
            pageIndex: 1,
            children: [{ title: '1.1 세부 내용', pageIndex: 2 }],
          },
          { title: '제2장 결론', pageIndex: 4 },
        ],
      })
    ).bytes

    const bookmarks = await readPdfBookmarks(withOutline)
    expect(bookmarks).toEqual([
      { title: '제1장 개요', level: 1, page: 2 },
      { title: '1.1 세부 내용', level: 2, page: 3 },
      { title: '제2장 결론', level: 1, page: 5 },
    ])

    const byTop = await executeSplitPlan(
      withOutline,
      { mode: 'bookmarks', level: 1, includeLeadingPages: true },
      { sourceName: 'book.pdf', output: { pattern: 'bookmark' } },
    )
    expect(byTop.parts.map((p) => p.pages)).toEqual([[1], [2, 3, 4], [5, 6, 7]])
    expect(byTop.parts.map((p) => p.name)).toEqual([
      '1_book_p1.pdf',
      '2_제1장 개요.pdf',
      '3_제2장 결론.pdf',
    ])

    const byTwo = await executeSplitPlan(
      withOutline,
      { mode: 'bookmarks', level: 2, includeLeadingPages: false },
      { sourceName: 'book.pdf', output: { pattern: 'bookmark' } },
    )
    expect(byTwo.parts.map((p) => p.pages)).toEqual([[2], [3, 4], [5, 6, 7]])
  })

  it('protects against cyclic /Next bookmark chains', async () => {
    const base = await makeNumberedPdf(3)
    const doc = await PDFDocument.load(base)
    const itemRef = doc.context.nextRef()
    const rootRef = doc.context.register(
      doc.context.obj({ Type: 'Outlines', First: itemRef, Last: itemRef, Count: 1 }),
    )
    // Self-referential /Next cycle
    doc.context.assign(
      itemRef,
      doc.context.obj({
        Title: PDFString.of('Loop'),
        Parent: rootRef,
        Next: itemRef,
        Dest: [doc.getPage(0).ref, PDFName.of('Fit')],
      }),
    )
    doc.catalog.set(PDFName.of('Outlines'), rootRef)
    const bytes = await doc.save({ useObjectStreams: false })
    const bookmarks = await readPdfBookmarks(bytes)
    expect(bookmarks).toEqual([{ title: 'Loop', level: 1, page: 1 }])
  })

  it('resolves /GoTo actions and named destinations in /Names /Dests', async () => {
    const base = await makeNumberedPdf(4)
    const doc = await PDFDocument.load(base)
    const p3Ref = doc.getPage(2).ref
    const namesTreeRef = doc.context.register(
      doc.context.obj({
        Dests: doc.context.obj({
          Names: [PDFString.of('ch-three'), [p3Ref, PDFName.of('Fit')]],
        }),
      }),
    )
    doc.catalog.set(PDFName.of('Names'), namesTreeRef)

    const itemRef = doc.context.nextRef()
    const rootRef = doc.context.register(
      doc.context.obj({ Type: 'Outlines', First: itemRef, Last: itemRef, Count: 1 }),
    )
    doc.context.assign(
      itemRef,
      doc.context.obj({
        Title: PDFString.of('Named Chapter'),
        Parent: rootRef,
        A: doc.context.obj({ S: PDFName.of('GoTo'), D: PDFString.of('ch-three') }),
      }),
    )
    doc.catalog.set(PDFName.of('Outlines'), rootRef)
    const bytes = await doc.save({ useObjectStreams: false })
    expect(await readPdfBookmarks(bytes)).toEqual([{ title: 'Named Chapter', level: 1, page: 3 }])
  })

  it('splits by maxSize under the byte cap and flags oversized single pages', async () => {
    // Pages 1..4 are ~12 KB each, page 5 is ~80 KB (exceeds 30 KB limit alone), pages 6..7 are ~12 KB
    const src = await makeSizedPdf([12000, 12000, 12000, 12000, 80000, 12000, 12000])
    const maxBytes = 32 * 1024
    const progressCalls: [number, number][] = []

    const result = await executeSplitPlan(
      src,
      { mode: 'maxSize', maxBytes },
      {
        sourceName: 'big.pdf',
        output: { pattern: 'range' },
        onProgress: (done, total) => progressCalls.push([done, total]),
      },
    )

    // Every page appears exactly once in order
    expect(result.parts.flatMap((p) => p.pages)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(result.oversizedPages).toEqual([5])
    for (const part of result.parts) {
      if (part.pages.length === 1 && result.oversizedPages.includes(part.pages[0]!)) {
        expect(part.bytes.length).toBeGreaterThan(maxBytes)
      } else {
        expect(part.bytes.length).toBeLessThanOrEqual(maxBytes)
      }
    }
    expect(progressCalls.length).toBeGreaterThan(0)
    expect(progressCalls[progressCalls.length - 1]).toEqual([7, 7])
  })

  it('aborts cleanly when AbortSignal is triggered', async () => {
    const src = await makeNumberedPdf(4)
    const ac = new AbortController()
    ac.abort()
    await expect(
      executeSplitPlan(
        src,
        { mode: 'fixed', kind: 'pagesPerFile', value: 1 },
        { signal: ac.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('picks collision-free subfolder names', () => {
    const parent = join('tmp', 'out')
    const taken = new Set([join(parent, 'Report-split'), join(parent, 'Report-split (2)')])
    expect(uniqueSplitSubfolder(parent, 'Report-split', (p) => taken.has(p))).toBe(
      join(parent, 'Report-split (3)'),
    )
  })

  it('preserves non-ascending and overlapping ranges both separately and merged', async () => {
    const src = await makeNumberedPdf(5)
    const separate = await executeSplitPlan(
      src,
      {
        mode: 'ranges',
        ranges: [
          { start: 4, end: 5 },
          { start: 1, end: 2 },
          { start: 2, end: 3 },
        ],
      },
      { sourceName: 'mix.pdf', output: { pattern: 'range' } },
    )
    expect(separate.parts.map((p) => p.name)).toEqual([
      'mix_p4-5.pdf',
      'mix_p1-2.pdf',
      'mix_p2-3.pdf',
    ])
    expect(await Promise.all(separate.parts.map((p) => pageWidths(p.bytes)))).toEqual([
      [103, 104],
      [100, 101],
      [101, 102],
    ])

    const merged = await executeSplitPlan(
      src,
      {
        mode: 'ranges',
        ranges: [
          { start: 4, end: 5 },
          { start: 1, end: 2 },
        ],
        mergeRanges: true,
      },
      { sourceName: 'mix.pdf' },
    )
    expect(merged.parts).toHaveLength(1)
    expect(await pageWidths(merged.parts[0]!.bytes)).toEqual([103, 104, 100, 101])
  })

  it('handles maxSize edge cases: whole document fits in one file, or every page exceeds cap', async () => {
    const small = await makeNumberedPdf(4)
    const singleFile = await executeSplitPlan(
      small,
      { mode: 'maxSize', maxBytes: 200 * 1024 },
      { sourceName: 'tiny.pdf' },
    )
    expect(singleFile.parts).toHaveLength(1)
    expect(singleFile.parts[0]!.pages).toEqual([1, 2, 3, 4])
    expect(singleFile.oversizedPages).toEqual([])

    const heavy = await makeSizedPdf([40000, 40000, 40000])
    const allOver = await executeSplitPlan(
      heavy,
      { mode: 'maxSize', maxBytes: 12 * 1024 },
      { sourceName: 'heavy.pdf' },
    )
    expect(allOver.parts.map((p) => p.pages)).toEqual([[1], [2], [3]])
    expect(allOver.oversizedPages).toEqual([1, 2, 3])
  })

  it('resolves legacy /Catalog /Dests and nested /Names /Dests /Kids trees', async () => {
    const base = await makeNumberedPdf(4)
    const doc = await PDFDocument.load(base)
    const p2Ref = doc.getPage(1).ref
    const p4Ref = doc.getPage(3).ref

    // Legacy /Dests dictionary
    doc.catalog.set(
      PDFName.of('Dests'),
      doc.context.register(doc.context.obj({ legacyTarget: [p2Ref, PDFName.of('Fit')] })),
    )
    // Nested /Names /Dests /Kids B-tree
    const leaf = doc.context.register(
      doc.context.obj({ Names: [PDFString.of('kid-target'), [p4Ref, PDFName.of('Fit')]] }),
    )
    doc.catalog.set(
      PDFName.of('Names'),
      doc.context.register(doc.context.obj({ Dests: doc.context.obj({ Kids: [leaf] }) })),
    )

    const item1 = doc.context.nextRef()
    const item2 = doc.context.nextRef()
    const rootRef = doc.context.register(
      doc.context.obj({ Type: 'Outlines', First: item1, Last: item2, Count: 2 }),
    )
    doc.context.assign(
      item1,
      doc.context.obj({
        Title: PDFString.of('Legacy Dest'),
        Parent: rootRef,
        Next: item2,
        Dest: PDFName.of('legacyTarget'),
      }),
    )
    doc.context.assign(
      item2,
      doc.context.obj({
        Title: PDFString.of('BTree Dest'),
        Parent: rootRef,
        Prev: item1,
        Dest: PDFString.of('kid-target'),
      }),
    )
    doc.catalog.set(PDFName.of('Outlines'), rootRef)

    const bytes = await doc.save({ useObjectStreams: false })
    expect(await readPdfBookmarks(bytes)).toEqual([
      { title: 'Legacy Dest', level: 1, page: 2 },
      { title: 'BTree Dest', level: 1, page: 4 },
    ])
  })

  it('sanitizes long and punctuation-only bookmark names safely', () => {
    const longTitle = 'A'.repeat(120)
    const names = formatSplitOutputNames(
      [
        { pages: [1], label: longTitle },
        { pages: [2], label: '///:::...' },
      ],
      'doc.pdf',
      { pattern: 'bookmark' },
    )
    expect(names[0]!.length).toBeLessThanOrEqual(70)
    expect(names[0]!.endsWith('.pdf')).toBe(true)
    expect(names[1]!.endsWith('.pdf')).toBe(true)
    expect(names[1]).not.toMatch(/[/\\:*?"<>|]/)
  })
})
