/**
 * Body table-of-contents (TOC) generation, refresh, legacy-TOC detection,
 * manual-edit protection, HWP/HWPX roundtrip, and staleness detection tests
 * against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  MARK_PREFIXES,
  SUBMISSION_STRIP_PREFIXES,
  isAppTocHyperlinkField,
  listMarks,
  stripMarks,
} from '../studio-plugin/doc-marks.mjs'
import { writeDocOutlineMap } from '../studio-plugin/outline.mjs'
import {
  DEFAULT_TOC_INDENT_PT,
  TOC_KINDS,
  checkTocStaleness,
  collectBodyTocEntries,
  detectLegacyToc,
  findTocRange,
  insertTocBlock,
  readTocMeta,
  refreshTocBlock,
  registerTocHelpers,
} from '../studio-plugin/toc.mjs'
import {
  columnWidthUnits,
  contentsOf,
  oneLine,
  tablesOf,
  textWidthPt,
  tocHtml,
  tocLookOf,
  withPortableWidths,
} from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface StyleEntry {
  id: number
  name: string
  englishName?: string
}

function makeDoc(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  return doc
}

function styleIdByName(doc: HwpDocument, name: string): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const found = styles.find((s) => s.name === name)
  if (!found) throw new Error(`Style not found: ${name}`)
  return found.id
}

function ensureStyle(doc: HwpDocument, name: string): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const existing = styles.find((s) => s.name === name)
  if (existing) return existing.id
  return doc.createStyle(
    JSON.stringify({
      name,
      englishName: name,
      type: 0,
      nextStyleId: 0,
    }),
  )
}

function paraText(doc: HwpDocument, sec: number, para: number): string {
  const len = doc.getParagraphLength(sec, para)
  return len > 0 ? doc.getTextRange(sec, para, 0, len) : ''
}

function makeHeadingDoc(): HwpDocument {
  const doc = makeDoc([
    '서론',
    '첫 번째 문단입니다.',
    '연구 배경',
    '배경 설명입니다.',
    '세부 목표',
    '목표 설명입니다.',
    '결론',
    '마무리입니다.',
  ])
  doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))
  doc.applyStyle(0, 2, styleIdByName(doc, '개요 2'))
  doc.applyStyle(0, 4, styleIdByName(doc, '개요 3'))
  doc.applyStyle(0, 6, styleIdByName(doc, '개요 1'))
  return doc
}

describe('dotted-tab TOC layout, styling, and links', () => {
  it('generates a dotted-tab TOC with right dot-leader tab stops, styles, bookmarks, and clean hyperlinks', () => {
    const doc = makeHeadingDoc()
    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 3 })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.kind).toBe('body')
    expect(res.kindId).toBe(TOC_KINDS.body)
    expect(res.layout).toBe('dotted-tab')
    expect(res.count).toBe(4)
    expect(res.linksApplied).toBe(true)
    expect(res.range).toEqual({ sec: 0, startPara: 0, endPara: 4 })

    // Title paragraph uses 차례 제목 style when present.
    expect(paraText(doc, 0, 0)).toBe('차례')
    expect(JSON.parse(doc.getStyleAt(0, 0)).name).toBe('차례 제목')

    // Entry lines have <text>\t<page>, 차례 N style, and right dot-leader tab stop at text right edge.
    const expectedTabPos = 2 * columnWidthUnits(doc, 0)
    const expectedStyles = ['차례 1', '차례 2', '차례 3', '차례 1']
    for (let i = 0; i < 4; i++) {
      const p = 1 + i
      const line = paraText(doc, 0, p)
      expect(line).toContain('\t')
      expect(JSON.parse(doc.getStyleAt(0, p)).name).toBe(expectedStyles[i])
      const paraProps = JSON.parse(doc.getParaPropertiesAt(0, p))
      expect(paraProps.tabStops).toEqual([{ position: expectedTabPos, type: 1, fill: 3 }])

      // Hyperlink points to a 제목: heading bookmark and leaves text non-underlined black.
      const ctx = JSON.parse(
        doc.getHyperlinkContext(JSON.stringify({ section: 0, para: p, cellPath: [] })),
      )
      expect(ctx.links).toHaveLength(1)
      expect(ctx.links[0].uri).toMatch(/^#제목:/)
      const charProps = JSON.parse(doc.getCharPropertiesAt(0, p, 0))
      expect(charProps.textColor.toLowerCase()).toBe('#000000')
      expect(charProps.underlineType).toBe('None')
    }

    // All hyperlink fields are classified as app TOC hyperlinks.
    const fields = JSON.parse(doc.getFieldList())
    expect(fields).toHaveLength(4)
    for (const field of fields) {
      expect(isAppTocHyperlinkField(field)).toBe(true)
    }

    // Heading bookmarks exist at the shifted heading paragraphs and range marks wrap [0..4].
    const headingMarks = listMarks(doc, [MARK_PREFIXES.heading])
    expect(headingMarks.map((m) => m.para)).toEqual([5, 7, 9, 11])
    const range = findTocRange(doc, 'body')
    expect(range).not.toBeNull()
    expect(range?.start.para).toBe(0)
    expect(range?.end.para).toBe(4)

    // Paragraph 0 still holds section/column layout controls.
    const controls = JSON.parse(doc.getControls()) as Array<{ para: number; ctrlId: string }>
    expect(controls.some((c) => c.para === 0 && c.ctrlId === 'secd')).toBe(true)
    expect(controls.some((c) => c.para === 0 && c.ctrlId === 'cold')).toBe(true)
  })

  it('falls back to body font and per-level marginLeft indent when 차례 N styles are missing for deep levels', () => {
    const doc = makeDoc(['1장', '1.1절', '1.1.1항', '1.1.1.1목'])
    const h4 = ensureStyle(doc, '제목 4')
    doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 1, styleIdByName(doc, '개요 2'))
    doc.applyStyle(0, 2, styleIdByName(doc, '개요 3'))
    doc.applyStyle(0, 3, h4)

    // Blank doc only has 차례 1..3, so maxLevel 4 with a level-4 heading triggers fallback indent.
    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 4, title: null })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.count).toBe(4)
    expect(res.range).toEqual({ sec: 0, startPara: 0, endPara: 3 })
    expect(res.linksApplied).toBe(true)

    const p0 = JSON.parse(doc.getParaPropertiesAt(0, 0))
    const p1 = JSON.parse(doc.getParaPropertiesAt(0, 1))
    const p3 = JSON.parse(doc.getParaPropertiesAt(0, 3))
    expect(p0.marginLeft).toBe(0)
    expect(p1.marginLeft).toBeGreaterThan(0)
    expect(p3.marginLeft).toBeGreaterThan(p1.marginLeft)
    // Level 2 indent is ~14pt (converted to px by getParaPropertiesAt: 14pt * 10 / 7.5 = 18.67px).
    expect(Math.round(p1.marginLeft * 7.5) / 10).toBeCloseTo(DEFAULT_TOC_INDENT_PT, 0)
  })

  it('reuses existing 제목: bookmarks on headings and supports links: false', () => {
    const doc = makeHeadingDoc()
    doc.addBookmark(0, 0, 0, '제목:custom_intro')
    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { links: true })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const firstLink = JSON.parse(
      doc.getHyperlinkContext(JSON.stringify({ section: 0, para: 1, cellPath: [] })),
    )
    expect(firstLink.links[0].uri).toBe('#제목:custom_intro')
    // Existing bookmark moved with heading 0 -> para 5 rather than staying on para 0.
    const introBm = listMarks(doc, [MARK_PREFIXES.heading]).find(
      (m) => m.name === '제목:custom_intro',
    )
    expect(introBm?.para).toBe(5)

    // links: false skips creating hyperlinks.
    const doc2 = makeHeadingDoc()
    const res2 = insertTocBlock(doc2, { sec: 0, para: 0 }, { links: false })
    expect(res2.ok).toBe(true)
    if (!res2.ok) return
    expect(res2.linksApplied).toBe(false)
    expect(JSON.parse(doc2.getFieldList())).toHaveLength(0)
  })
})

describe('table TOC layout and agent-plugin helper integration', () => {
  it('builds a 2-column borderless TOC table with links using exported agent-plugin helpers', () => {
    const helpers = {
      contentsOf,
      tocLookOf,
      tocHtml,
      withPortableWidths,
      textWidthPt,
      columnWidthUnits,
      oneLine,
      tablesOf,
    }
    registerTocHelpers(helpers)
    try {
      const doc = makeHeadingDoc()
      const res = insertTocBlock(
        doc,
        { sec: 0, para: 0 },
        { layout: 'table', title: '목차', links: true },
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.layout).toBe('table')
      expect(res.count).toBe(4)
      expect(res.linksApplied).toBe(true)
      expect(res.linksUnsupportedInTable).toBeUndefined()
      expect(paraText(doc, 0, 0)).toBe('목차')

      const { tables } = tablesOf(doc)
      expect(tables).toHaveLength(1)
      expect(tables[0].rows).toBe(4)
      expect(tables[0].cols).toBe(2)

      // Heading cell of row 0 has an internal bookmark link.
      const ci = tables[0].path[0].controlIndex
      const cellCtx = JSON.parse(
        doc.getHyperlinkContext(
          JSON.stringify({ section: 0, para: tables[0].para, cellPath: [[ci, 0, 0]] }),
        ),
      )
      expect(cellCtx.links).toHaveLength(1)
      expect(cellCtx.links[0].uri).toMatch(/^#제목:/)
    } finally {
      registerTocHelpers(null)
    }
  })

  it('degrades gracefully with linksUnsupportedInTable when cell hyperlink insertion throws', () => {
    const doc = makeHeadingDoc()
    const origInsert = doc.insertHyperlinkEx.bind(doc)
    ;(doc as unknown as { insertHyperlinkEx: (json: string) => unknown }).insertHyperlinkEx = (
      json: string,
    ) => {
      const payload = JSON.parse(json)
      if (payload.target.cellPath.length > 0) {
        throw new Error('cell link refused')
      }
      return origInsert(json)
    }

    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { layout: 'table', links: true })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.linksApplied).toBe(false)
    expect(res.linksUnsupportedInTable).toBe(true)
    expect(res.count).toBe(4)
  })
})

describe('printed page numbers: multi-page, new-number start, Roman numerals, and TOC page shift', () => {
  it('reflects section new-number starts and Roman numeral page formats', () => {
    const doc = makeDoc(['서문', '본문 시작', '결론'])
    doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 1, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 2, styleIdByName(doc, '개요 1'))

    // Put each heading on its own page, set uppercase Roman format (2), and start numbering at 4 (IV).
    doc.applyParaFormat(0, 1, JSON.stringify({ pageBreakBefore: true }))
    doc.applyParaFormat(0, 2, JSON.stringify({ pageBreakBefore: true }))
    ;(
      doc as unknown as {
        setPageNumberPos: (s: number, f: number, p: number, d: boolean) => string
      }
    ).setPageNumberPos(0, 2, 5, false)
    doc.insertNewNumber(0, 0, 0, 4)

    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 3 })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // After inserting TOC on page 1 (printed IV), 서문 stays on IV, 본문 시작 is V, 결론 is VI.
    expect(res.pages).toEqual([4, 5, 6])
    expect(res.pageLabels).toEqual(['IV', 'V', 'VI'])
    expect(paraText(doc, 0, 1)).toMatch(/\tIV$/)
    expect(paraText(doc, 0, 2)).toMatch(/\tV$/)
    expect(paraText(doc, 0, 3)).toMatch(/\tVI$/)
  })

  it('re-measures page numbers AFTER TOC insertion so a multi-page TOC shift is accurately reflected', () => {
    // Create 45 headings so the TOC itself spans more than 1 page and pushes headings to page 2+.
    const lines: string[] = []
    for (let i = 1; i <= 45; i++) {
      lines.push(`항목 ${i}`)
    }
    const doc = makeDoc(lines)
    const h1 = styleIdByName(doc, '개요 1')
    for (let i = 0; i < lines.length; i++) {
      doc.applyStyle(0, i, h1)
    }

    const beforeEntries = collectBodyTocEntries(doc, { maxLevel: 3 })
    expect(beforeEntries[0].page).toBe(1)

    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 3 })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // Because 45 TOC entries + title take > 1 page, the very first heading ("항목 1") moved past page 1!
    expect(res.pages[0]).toBeGreaterThan(1)
    expect(paraText(doc, 0, 1)).toBe(`1. 항목 1\t${res.pageLabels[0]}`)
    // Verify staleness immediately after insertion is false.
    expect(checkTocStaleness(doc).stale).toBe(false)
  })
})

describe('HWP and HWPX roundtrip + refreshTocBlock + manual edit protection', () => {
  it('survives HWP and HWPX export/reopen and refreshes updated page numbers cleanly', () => {
    const doc = makeHeadingDoc()
    const inserted = insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 3 })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    for (const [label, bytes] of [
      ['hwp', doc.exportHwp()],
      ['hwpx', doc.exportHwpx()],
    ] as const) {
      const reopened = new HwpDocument(bytes)
      const range = findTocRange(reopened, 'body')
      expect(range, label).not.toBeNull()
      expect(readTocMeta(reopened, 'body')?.layout, label).toBe('dotted-tab')

      // Tab stops and hyperlinks survived roundtrip.
      const props = JSON.parse(reopened.getParaPropertiesAt(0, 1))
      expect(props.tabStops, label).toHaveLength(1)
      expect(props.tabStops[0].type, label).toBe(1)
      expect(props.tabStops[0].fill, label).toBe(3)
      const fields = JSON.parse(reopened.getFieldList())
      expect(fields.filter(isAppTocHyperlinkField), label).toHaveLength(4)

      // Push the last heading ("결론") onto page 2 and verify staleness + refresh.
      const headingBefore = collectBodyTocEntries(reopened, { maxLevel: 3 })
      const lastHeading = headingBefore[headingBefore.length - 1]
      reopened.applyParaFormat(
        lastHeading.sec,
        lastHeading.para,
        JSON.stringify({ pageBreakBefore: true }),
      )

      const staleCheck = checkTocStaleness(reopened)
      expect(staleCheck.stale, label).toBe(true)
      expect(staleCheck.items[0].reason, label).toBe('pages_changed')

      const refreshed = refreshTocBlock(reopened)
      expect(refreshed.ok, label).toBe(true)
      if (!refreshed.ok) continue
      expect(refreshed.pages[refreshed.pages.length - 1], label).toBe(2)
      expect(paraText(reopened, 0, 4), label).toMatch(/\t2$/)
      expect(checkTocStaleness(reopened).stale, label).toBe(false)

      // Layout controls on para 0 and heading styles after the TOC stayed intact.
      const controls = JSON.parse(reopened.getControls()) as Array<{ para: number; ctrlId: string }>
      expect(
        controls.some((c) => c.para === 0 && c.ctrlId === 'secd'),
        label,
      ).toBe(true)
      expect(JSON.parse(reopened.getStyleAt(0, 5)).name, label).toBe('개요 1')
    }
  })

  it('detects manual edits inside the TOC range and refuses until allowOverwriteManual: true', () => {
    const doc = makeHeadingDoc()
    const inserted = insertTocBlock(doc, { sec: 0, para: 0 })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    // Manually edit the first TOC entry line.
    doc.insertText(0, 1, 0, '[수동편집] ')
    const editedLineBefore = paraText(doc, 0, 1)

    const refused = refreshTocBlock(doc)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('manual_edits')
    expect(refused.modifiedLines).toHaveLength(1)
    expect(refused.modifiedLines?.[0].index).toBe(1)
    expect(refused.modifiedLines?.[0].actual).toContain('[수동편집]')
    // Document must remain completely untouched on refusal.
    expect(paraText(doc, 0, 1)).toBe(editedLineBefore)

    // Forcing overwrite succeeds and restores the clean entry.
    const forced = refreshTocBlock(doc, { allowOverwriteManual: true })
    expect(forced.ok).toBe(true)
    expect(paraText(doc, 0, 1)).not.toContain('[수동편집]')
  })
})

describe('legacy unmarked TOC detection and replacement', () => {
  it('detects legacy dotted/tab TOC lines, refuses by default, and replaces when replaceLegacy: true', () => {
    const doc = makeDoc(['차례', '1. 서론\t1', '2. 결론\t2', '서론', '본문', '결론'])
    doc.applyStyle(0, 3, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 5, styleIdByName(doc, '개요 1'))

    const legacy = detectLegacyToc(doc)
    expect(legacy).toEqual({
      found: true,
      source: 'lines',
      sec: 0,
      startPara: 0,
      endPara: 2,
      title: '차례',
    })

    // Default insert & refresh refuse with legacy range without mutating.
    const refusedInsert = insertTocBlock(doc, { sec: 0, para: 0 })
    expect(refusedInsert.ok).toBe(false)
    if (!refusedInsert.ok) {
      expect(refusedInsert.reason).toBe('legacy_toc_found')
      expect(refusedInsert.legacy?.startPara).toBe(0)
      expect(refusedInsert.legacy?.endPara).toBe(2)
    }
    expect(findTocRange(doc, 'body')).toBeNull()

    const refusedRefresh = refreshTocBlock(doc)
    expect(refusedRefresh.ok).toBe(false)
    if (!refusedRefresh.ok) expect(refusedRefresh.reason).toBe('legacy_toc_found')

    // Replacing legacy TOC removes old lines and inserts a marked TOC in place.
    const replaced = refreshTocBlock(doc, { replaceLegacy: true })
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return
    expect(replaced.count).toBe(2)
    expect(findTocRange(doc, 'body')).not.toBeNull()
    expect(detectLegacyToc(doc)).toBeNull()
    // Original headings survived right after the replaced TOC.
    expect(paraText(doc, 0, 3)).toBe('서론')
    expect(JSON.parse(doc.getStyleAt(0, 3)).name).toBe('개요 1')
  })

  it('detects an unmarked 2-column TOC table and replaces it when replaceLegacy: true', () => {
    const doc = makeDoc(['목차', '', '서론', '결론'])
    doc.applyStyle(0, 2, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 3, styleIdByName(doc, '개요 1'))
    doc.pasteHtml(
      0,
      1,
      0,
      '<table><tr><td><p>서론</p></td><td><p>1</p></td></tr><tr><td><p>결론</p></td><td><p>2</p></td></tr></table>',
    )

    const legacy = detectLegacyToc(doc)
    expect(legacy).not.toBeNull()
    expect(legacy?.source).toBe('table')
    expect(legacy?.startPara).toBe(0)
    expect(legacy?.endPara).toBe(1)

    const refused = insertTocBlock(doc, { sec: 0, para: 0 })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toBe('legacy_toc_found')

    const replaced = insertTocBlock(doc, { sec: 0, para: 0 }, { replaceLegacy: true })
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return
    // Old 2-col table was removed and replaced by dotted-tab marked TOC.
    expect(tablesOf(doc).tables).toHaveLength(0)
    expect(findTocRange(doc, 'body')).not.toBeNull()
    expect(replaced.count).toBe(2)
  })
})

describe('refusals and staleness transitions', () => {
  it('refuses table cell, non-body, out-of-range, and headingless documents without mutation', () => {
    const doc = makeHeadingDoc()
    const paraCountBefore = doc.getParagraphCount(0)

    expect(
      insertTocBlock(doc, {
        sec: 0,
        para: 0,
        inTable: true,
        parentParaIndex: 0,
        cellIndex: 0,
      }),
    ).toEqual({ ok: false, reason: 'in_table' })

    expect(insertTocBlock(doc, { sec: 0, para: 0, inHeaderFooter: true })).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })

    expect(insertTocBlock(doc, { sec: 0, para: 99 })).toEqual({
      ok: false,
      reason: 'not_found',
    })

    expect(doc.getParagraphCount(0)).toBe(paraCountBefore)

    const plainDoc = makeDoc(['일반 문단 1', '일반 문단 2'])
    expect(insertTocBlock(plainDoc, { sec: 0, para: 0 })).toMatchObject({
      ok: false,
      reason: 'no_entries',
    })
  })

  it('reports entries_changed staleness when headings are renamed or added', () => {
    const doc = makeHeadingDoc()
    const inserted = insertTocBlock(doc, { sec: 0, para: 0 })
    expect(inserted.ok).toBe(true)
    expect(checkTocStaleness(doc)).toEqual({ stale: false, items: [] })

    // Rename the first heading paragraph ("서론" at para 5 -> "서론 수정").
    doc.insertText(0, 5, 2, ' 수정')
    const stale = checkTocStaleness(doc)
    expect(stale.stale).toBe(true)
    expect(stale.items).toHaveLength(1)
    expect(stale.items[0].reason).toBe('entries_changed')
    expect(stale.items[0].details.changedEntries[0].expectedText).toContain('서론 수정')

    // Refresh clears staleness.
    const refreshed = refreshTocBlock(doc)
    expect(refreshed.ok).toBe(true)
    expect(checkTocStaleness(doc)).toEqual({ stale: false, items: [] })
  })

  it('clears old hyperlinks via removeHyperlinkEx when refreshing a titleless TOC and resets direct para formatting when adding a title', () => {
    const doc = makeHeadingDoc()
    const inserted = insertTocBlock(doc, { sec: 0, para: 0 }, { title: null, links: true })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    expect(inserted.linksApplied).toBe(true)

    const refreshed = refreshTocBlock(doc)
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.linksApplied).toBe(true)

    const fields = JSON.parse(doc.getFieldList()) as Array<{
      fieldType?: string
      command?: string
      value?: string
      startCharIdx?: number
      endCharIdx?: number
    }>
    expect(fields).toHaveLength(4)
    for (const field of fields) {
      expect(isAppTocHyperlinkField(field)).toBe(true)
      expect((field.value ?? '').length).toBeGreaterThan(0)
      expect((field.endCharIdx ?? 0) - (field.startCharIdx ?? 0)).toBeGreaterThan(0)
    }

    // Refreshing from titleless -> titled resets stale tabStops and marginLeft on reused para 0.
    const titledRefresh = refreshTocBlock(doc, { title: '차례' })
    expect(titledRefresh.ok).toBe(true)
    if (!titledRefresh.ok) return
    expect(paraText(doc, 0, 0)).toBe('차례')
    const titleProps = JSON.parse(doc.getParaPropertiesAt(0, 0))
    expect(titleProps.tabStops).toEqual([])
    expect(titleProps.marginLeft).toBe(0)
  })

  it('pairs same-position range marks for a titleless table TOC across HWP/HWPX roundtrip and refresh', () => {
    const doc = makeHeadingDoc()
    const inserted = insertTocBlock(
      doc,
      { sec: 0, para: 0 },
      { layout: 'table', title: null, links: true },
    )
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    expect(inserted.range).toEqual({ sec: 0, startPara: 0, endPara: 0 })
    expect(findTocRange(doc, 'body')).not.toBeNull()
    expect(checkTocStaleness(doc)).toEqual({ stale: false, items: [] })

    for (const [label, bytes] of [
      ['hwp', doc.exportHwp()],
      ['hwpx', doc.exportHwpx()],
    ] as const) {
      const reopened = new HwpDocument(bytes)
      const range = findTocRange(reopened, 'body')
      expect(range, label).not.toBeNull()
      expect(range?.start.para, label).toBe(0)
      expect(range?.end.para, label).toBe(0)
      expect(checkTocStaleness(reopened), label).toEqual({ stale: false, items: [] })

      const refreshed = refreshTocBlock(reopened)
      expect(refreshed.ok, label).toBe(true)
      if (!refreshed.ok) continue
      expect(refreshed.layout, label).toBe('table')
      expect(refreshed.count, label).toBe(4)
      expect(findTocRange(reopened, 'body'), label).not.toBeNull()
    }
  })

  it('infers layout and title in checkTocStaleness after stripping 설정: submission marks', () => {
    // 1. Titled dotted-tab TOC without 설정: metadata
    const dottedDoc = makeHeadingDoc()
    expect(insertTocBlock(dottedDoc, { sec: 0, para: 0 }, { layout: 'dotted-tab' }).ok).toBe(true)
    stripMarks(dottedDoc, SUBMISSION_STRIP_PREFIXES)
    expect(readTocMeta(dottedDoc, 'body')).toBeNull()
    expect(checkTocStaleness(dottedDoc)).toEqual({ stale: false, items: [] })

    dottedDoc.insertText(0, 5, 2, ' 변경')
    const dottedStale = checkTocStaleness(dottedDoc)
    expect(dottedStale.stale).toBe(true)
    expect(dottedStale.items[0]?.reason).toBe('entries_changed')

    // 2. Titled table TOC without 설정: metadata
    const tableDoc = makeHeadingDoc()
    expect(insertTocBlock(tableDoc, { sec: 0, para: 0 }, { layout: 'table' }).ok).toBe(true)
    stripMarks(tableDoc, SUBMISSION_STRIP_PREFIXES)
    expect(readTocMeta(tableDoc, 'body')).toBeNull()
    expect(checkTocStaleness(tableDoc)).toEqual({ stale: false, items: [] })

    tableDoc.insertText(0, 2, 2, ' 변경')
    const tableStale = checkTocStaleness(tableDoc)
    expect(tableStale.stale).toBe(true)
    expect(tableStale.items[0]?.reason).toBe('entries_changed')
  })

  it('rescues non-setting bookmarks (색인: and user bookmarks) on insertPara so they move with the shifted paragraph and do not block links', () => {
    const doc = makeHeadingDoc()
    doc.addBookmark(0, 0, 0, '색인:서론:1')
    doc.addBookmark(0, 0, 1, '사용자북마크')

    const res = insertTocBlock(doc, { sec: 0, para: 0 }, { title: null, links: true })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.linksApplied).toBe(true)

    // Both bookmarks moved from para 0 to para 4 (the shifted first heading) rather than staying on para 0.
    const allBookmarks = JSON.parse(doc.getBookmarks()) as Array<{
      name: string
      para: number
      charPos: number
    }>
    const indexBm = allBookmarks.find((b) => b.name === '색인:서론:1')
    const userBm = allBookmarks.find((b) => b.name === '사용자북마크')
    expect(indexBm?.para).toBe(4)
    expect(userBm?.para).toBe(4)
    expect(userBm?.charPos).toBe(1)

    const p0Ctx = JSON.parse(
      doc.getHyperlinkContext(JSON.stringify({ section: 0, para: 0, cellPath: [] })),
    )
    expect(p0Ctx.links).toHaveLength(1)
  })

  it('follows 설정:개요수준 > appStyleMap > default style-map precedence during insertTocBlock', () => {
    const buildCustomStyleDoc = () => {
      const doc = makeDoc(['기본 제목', '앱 지정 장제목', '문서 지정 절제목'])
      const defaultH1 = ensureStyle(doc, '제목 1')
      const appStyle = ensureStyle(doc, '장제목')
      const docStyle = ensureStyle(doc, '절제목')
      doc.applyStyle(0, 0, defaultH1)
      doc.applyStyle(0, 1, appStyle)
      doc.applyStyle(0, 2, docStyle)
      return doc
    }

    // 1. Default style map collects only `제목 1`.
    const docDefault = buildCustomStyleDoc()
    const resDefault = insertTocBlock(docDefault, { sec: 0, para: 0 })
    expect(resDefault.ok).toBe(true)
    if (resDefault.ok) {
      expect(resDefault.entries.map((e) => e.text)).toEqual(['기본 제목'])
    }

    // 2. `appStyleMap` overrides default style map.
    const docApp = buildCustomStyleDoc()
    const resApp = insertTocBlock(docApp, { sec: 0, para: 0 }, { appStyleMap: { 장제목: 1 } })
    expect(resApp.ok).toBe(true)
    if (resApp.ok) {
      expect(resApp.entries.map((e) => e.text)).toEqual(['앱 지정 장제목'])
    }

    // 3. Per-document `설정:개요수준` overrides `appStyleMap`.
    const docPerDoc = buildCustomStyleDoc()
    expect(writeDocOutlineMap(docPerDoc, { 절제목: 1 }).ok).toBe(true)
    const resPerDoc = insertTocBlock(docPerDoc, { sec: 0, para: 0 }, { appStyleMap: { 장제목: 1 } })
    expect(resPerDoc.ok).toBe(true)
    if (resPerDoc.ok) {
      expect(resPerDoc.entries.map((e) => e.text)).toEqual(['문서 지정 절제목'])
    }
  })
})
