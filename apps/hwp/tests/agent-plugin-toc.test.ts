/**
 * The plugin's migrated TOC (T10/T11) and Index (T12) methods against the real rhwp engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

const CHAPTERS = 3
const BODY_LINES = 25

function styleIdOf(doc: HwpDocument, name: string): number {
  const list = JSON.parse(doc.getStyleList()) as Array<{ id: number; name: string }>
  const found = list.find((s) => s.name === name)
  if (!found) throw new Error(`missing style: ${name}`)
  return found.id
}

/** Report with real outline headings (`개요 1`, `개요 2`) spanning multiple pages. */
function reportWithOutline() {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const h1 = styleIdOf(doc, '개요 1')
  const h2 = styleIdOf(doc, '개요 2')
  const body = styleIdOf(doc, '바탕글')

  const lines: Array<[string, number]> = [['보고서 제목', body]]
  for (let i = 1; i <= CHAPTERS; i++) {
    lines.push([`장 제목 ${i}`, h1], [`절 제목 ${i}`, h2])
    for (let j = 0; j < BODY_LINES; j++) {
      lines.push([`본문 ${i}-${j} 문장입니다. 핵심 용어 알고리즘 및 데이터 분석을 다룹니다.`, body])
    }
  }
  lines.forEach(([line, styleId], k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    doc.insertText(0, k, 0, line)
    doc.applyStyle(0, k, styleId)
  })
  return doc
}

function open(
  start: HwpDocument = reportWithOutline(),
  on: (event: string, fn: () => void) => number = () => 0,
) {
  let doc = start
  const history: Uint8Array[] = []
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        return result
      } catch (thrown) {
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on },
    automation: { registerCommand: () => {}, execute: () => ({ ok: false }) },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc: () => doc, steps: () => history.length }
}

function bodyLines(doc: HwpDocument): string[] {
  const lines: string[] = []
  for (let s = 0; s < doc.getSectionCount(); s++) {
    for (let p = 0; p < doc.getParagraphCount(s); p++) {
      lines.push(doc.getTextRange(s, p, 0, doc.getParagraphLength(s, p)))
    }
  }
  return lines
}

describe('plugin TOC methods (T10/T11)', () => {
  it('inserts a dotted-tab body TOC by anchor with links, tracks range, and refreshes in place', () => {
    const { plugin, doc, steps } = open()
    const inserted = plugin.insertToc({
      anchor: '보고서 제목',
      where: 'after',
      layout: 'dotted-tab',
      maxLevel: 2,
      links: true,
      title: '차 례',
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    expect(inserted.kind).toBe('body')
    expect(inserted.layout).toBe('dotted-tab')
    expect(inserted.count).toBe(CHAPTERS * 2)
    expect(inserted.linksApplied).toBe(true)
    expect(inserted.pages.at(-1)).toBeGreaterThan(1)
    expect(steps()).toBe(1)
    expect(plugin.foreignChanges()).toBe(0)

    const ranges = plugin.listTocRanges()
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.kind).toBe('body')

    // Refuses a second body TOC without replaceExisting.
    const dup = plugin.insertToc({ sec: 0, para: 0, kind: 'body' })
    expect(dup).toMatchObject({ ok: false, reason: 'toc_exists' })
    expect(steps()).toBe(1)

    // Pushing later chapters down (inserting body paragraphs after chapter 1's first body line) updates printed pages in place.
    const bodyId = styleIdOf(doc(), '바탕글')
    const pushAt = inserted.range.endPara + 3
    for (let i = 0; i < 40; i++) {
      doc().splitParagraph(0, pushAt, doc().getParagraphLength(0, pushAt))
      doc().insertText(0, pushAt + 1, 0, '추가 여백 문단입니다.')
      doc().applyStyle(0, pushAt + 1, bodyId)
    }
    const refreshed = plugin.refreshToc({ kind: 'body' })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.count).toBe(CHAPTERS * 2)
    expect(refreshed.pages.at(-1)).toBeGreaterThan(inserted.pages.at(-1)!)
  })

  it('inserts a table-layout body TOC and reports its 1-based table number', () => {
    const { plugin, steps } = open()
    const inserted = plugin.insertToc({
      sec: 0,
      para: 1,
      layout: 'table',
      maxLevel: 1,
      title: '목차',
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    expect(inserted.layout).toBe('table')
    expect(inserted.count).toBe(CHAPTERS)
    expect(inserted.table).toBe(1)
    expect(inserted.tables).toBe(1)
    expect(steps()).toBe(1)
    const tbl = plugin.readTable(1)
    expect(tbl.ok && tbl.rows).toBe(CHAPTERS)
    expect(tbl.ok && tbl.cols).toBe(2)
  })

  it('supports table, figure, and equation caption TOCs independently of body TOC', () => {
    const doc = HwpDocument.createEmpty()
    doc.createBlankDocument()
    const lines = [
      '논문 제목',
      '<표 1> 실험 결과 요약',
      '본문 설명입니다.',
      '<그림 1> 시스템 구성도',
      '수식 설명입니다.',
      '수식 1. 오차 함수 정의',
    ]
    lines.forEach((line, k) => {
      if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
      doc.insertText(0, k, 0, line)
    })
    const { plugin } = open(doc)
    const tableToc = plugin.insertToc({ sec: 0, para: 1, kind: 'table', title: '표 차례' })
    expect(tableToc).toMatchObject({ ok: true, kind: 'table', count: 1 })
    const figToc = plugin.insertToc({ sec: 0, para: 1, kind: 'figure', title: '그림 차례' })
    expect(figToc).toMatchObject({ ok: true, kind: 'figure', count: 1 })
    const eqToc = plugin.insertToc({ sec: 0, para: 1, kind: 'equation', title: '수식 차례' })
    expect(eqToc).toMatchObject({ ok: true, kind: 'equation', count: 1 })
    expect(plugin.listTocRanges().map((r) => r.kind)).toEqual(
      expect.arrayContaining(['table', 'figure', 'equation']),
    )
  })

  it('detects legacy unmarked TOC, refuses without replaceLegacy, and replaces when allowed', () => {
    const { plugin, doc, steps } = open()
    doc().splitParagraph(0, 0, doc().getParagraphLength(0, 0))
    doc().insertText(0, 1, 0, '차 례')
    doc().splitParagraph(0, 1, doc().getParagraphLength(0, 1))
    doc().insertText(0, 2, 0, '장 제목 1\t1')
    const legacy = plugin.detectLegacyToc()
    expect(legacy).toMatchObject({ found: true, source: 'lines', sec: 0, startPara: 1, endPara: 2 })

    const refused = plugin.insertToc({ sec: 0, para: 1 })
    expect(refused).toMatchObject({ ok: false, reason: 'legacy_toc_found' })
    expect(steps()).toBe(0)

    const replaced = plugin.insertToc({ sec: 0, para: 1, replaceLegacy: true })
    expect(replaced).toMatchObject({ ok: true, kind: 'body', count: CHAPTERS * 2 })
    expect(plugin.detectLegacyToc()).toBeNull()
    expect(steps()).toBe(1)
  })

  it('refuses refreshToc on manual edits unless allowOverwriteManual is true, and respects foreign flag', () => {
    const { plugin, doc, steps } = open()
    const inserted = plugin.insertToc({ sec: 0, para: 1, layout: 'dotted-tab', maxLevel: 1 })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    // Manually modify the first TOC entry paragraph.
    const entryPara = inserted.range.startPara + 1
    doc().insertText(0, entryPara, 0, '수동수정 ')

    const refused = plugin.refreshToc({ kind: 'body' })
    expect(refused).toMatchObject({ ok: false, reason: 'manual_edits' })
    expect(steps()).toBe(1)

    const forced = plugin.refreshToc(
      { kind: 'body', allowOverwriteManual: true },
      { foreign: true, allowMemoRemoval: true },
    )
    expect(forced).toMatchObject({ ok: true, kind: 'body', count: CHAPTERS })
    expect(plugin.foreignChanges()).toBe(1)
    expect(steps()).toBe(2)
  })
})

describe('plugin Index methods (T12)', () => {
  it('marks single and all body occurrences, lists, removes, builds and refreshes an index block', () => {
    const { plugin, doc, steps } = open()

    // Single mark by find
    const single = plugin.addIndexMark({ find: '보고서 제목', term: '보고서', subTerm: '표지' })
    expect(single.ok).toBe(true)
    if (!single.ok) return
    expect(single.sec).toBe(0)
    expect(single.para).toBe(0)

    // Bulk mark all body occurrences of '알고리즘'
    const bulk = plugin.addIndexMarksAll({ term: '알고리즘' })
    expect(bulk.ok).toBe(true)
    if (!bulk.ok) return
    expect(bulk.added).toBe(CHAPTERS * BODY_LINES)
    expect(bulk.skippedNonBody).toBe(0)

    const marks = plugin.listIndexMarks()
    expect(marks).toHaveLength(1 + CHAPTERS * BODY_LINES)
    expect(marks[0]).toMatchObject({ term: '보고서', subTerm: '표지', sec: 0, para: 0 })

    // Remove the single mark by id
    const removed = plugin.removeIndexMark({ id: single.id })
    expect(removed).toMatchObject({ ok: true, removedMarks: 1 })
    expect(plugin.listIndexMarks()).toHaveLength(CHAPTERS * BODY_LINES)

    // Build a 2-column dotted-tab index block at the end of the document
    const built = plugin.buildIndexBlock({
      where: 'end',
      title: '찾아보기',
      columns: 2,
      groupHeadings: true,
      layout: 'dotted-tab',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.entryCount).toBe(1)
    expect(built.columns).toBe(2)
    expect(bodyLines(doc())).toContain('찾아보기')
    expect(bodyLines(doc())).toContain('ㅇ')

    // Manual edit inside index refuses refresh until allowOverwriteManual: true
    doc().insertText(built.sec, built.startPara, 0, '수정 ')
    const beforeSteps = steps()
    const refused = plugin.refreshIndexBlock()
    expect(refused).toMatchObject({ ok: false, reason: 'manual_edits' })
    expect(steps()).toBe(beforeSteps)

    const refreshed = plugin.refreshIndexBlock({
      columns: 1,
      layout: 'table',
      allowOverwriteManual: true,
    })
    expect(refreshed).toMatchObject({ ok: true, refreshed: true, columns: 1, layout: 'table' })
    expect(steps()).toBe(beforeSteps + 1)
  })

  it('rolls back refreshIndexBlock with has_objects when a non-index table sits inside the index block', () => {
    const { plugin, doc, steps } = open()
    expect(plugin.addIndexMarksAll({ term: '알고리즘' })).toMatchObject({ ok: true })
    const built = plugin.buildIndexBlock({
      where: 'end',
      title: '찾아보기',
      columns: 1,
      groupHeadings: true,
      layout: 'dotted-tab',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Paste a user (non-index) table inside the dotted-tab index block range.
    const innerPara = built.startPara + 1
    doc().pasteHtml(built.sec, innerPara, 0, '<table><tr><td>보존할 표</td></tr></table>')
    const tablesBefore = plugin.listTables().count
    expect(tablesBefore).toBe(1)

    const stepsBefore = steps()
    const refused = plugin.refreshIndexBlock({ allowOverwriteManual: true })
    expect(refused).toMatchObject({ ok: false, reason: 'has_objects' })
    expect(steps()).toBe(stepsBefore)
    expect(plugin.listTables().count).toBe(tablesBefore)
  })
})
