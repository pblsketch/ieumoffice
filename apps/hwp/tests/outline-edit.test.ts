/**
 * Real `@rhwp/core` tests for outline editing:
 * - `changeOutlineLevel` (promote/demote subtree and single-only, outline & style-mapped,
 *   tie-breaking, direct character formatting preservation, atomic refusals)
 * - `moveOutlineSection` (move down/up, before/after, rich object & bookmark preservation,
 *   HWP/HWPX round-trip, layout & boundary refusals, post-check guards, single-step undo)
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  DEFAULT_OUTLINE_STYLE_MAP,
  changeOutlineLevel,
  moveOutlineSection,
  readOutline,
  writeDocOutlineMap,
  type OutlineDoc,
} from '../studio-plugin/outline.mjs'

const require = createRequire(import.meta.url)

// 1x1 transparent PNG bytes for real picture insertion tests.
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface StyleEntry {
  id: number
  name: string
  englishName?: string
  type?: number
}

interface ControlEntry {
  ctrlId: string
  list: number
  para: number
  controlIndex: number
}

interface BookmarkEntry {
  name: string
  sec: number
  para: number
  ctrlIdx: number
  charPos: number
}

function makeBlankDoc(lines: string[] = []): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  if (lines.length > 0 && lines[0]) {
    doc.insertText(0, 0, 0, lines[0])
  }
  for (let i = 1; i < lines.length; i++) {
    const idx = doc.getParagraphCount(0)
    doc.insertParagraph(0, idx)
    if (lines[i]) doc.insertText(0, idx, 0, lines[i]!)
  }
  return doc
}

function appendPara(doc: HwpDocument, sec: number, text = '', styleId?: number): number {
  const idx = doc.getParagraphCount(sec)
  doc.insertParagraph(sec, idx)
  if (text) doc.insertText(sec, idx, 0, text)
  if (styleId !== undefined) doc.applyStyle(sec, idx, styleId)
  return idx
}

function styleIdByName(doc: HwpDocument, name: string): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const found = styles.find((s) => s.name === name)
  if (!found) throw new Error(`Style not found: ${name}`)
  return found.id
}

function ensureStyle(doc: HwpDocument, name: string, englishName = ''): number {
  const styles = JSON.parse(doc.getStyleList()) as StyleEntry[]
  const existing = styles.find((s) => s.name === name)
  if (existing) return existing.id
  return doc.createStyle(
    JSON.stringify({
      name,
      englishName: englishName || name,
      type: 0,
      nextStyleId: 0,
    }),
  )
}

function readAllParagraphs(doc: HwpDocument, sec = 0): Array<{ text: string; style: string }> {
  const count = doc.getParagraphCount(sec)
  const out: Array<{ text: string; style: string }> = []
  for (let p = 0; p < count; p++) {
    const len = doc.getParagraphLength(sec, p)
    const text = doc.getTextRange(sec, p, 0, len)
    const style = (JSON.parse(doc.getStyleAt(sec, p)) as { name: string }).name
    out.push({ text, style })
  }
  return out
}

function snapshotParagraphsAndOutline(doc: HwpDocument) {
  return {
    paras: readAllParagraphs(doc, 0),
    outline: readOutline(doc).items.map((item) => ({
      sec: item.sec,
      para: item.para,
      level: item.level,
      title: item.title,
      styleName: item.styleName,
      source: item.source,
    })),
    bookmarks: JSON.parse(doc.getBookmarks()) as BookmarkEntry[],
  }
}

describe('changeOutlineLevel against real @rhwp/core documents', () => {
  it('promotes and demotes native outline headings with subtree by default and single-only when requested', () => {
    const doc = makeBlankDoc([
      '표지',
      '제1장 서론',
      '1.1 배경',
      '1.1.1 세부',
      '본문 문단',
      '제2장 결론',
    ])
    doc.applyStyle(0, 1, styleIdByName(doc, '개요 1'))
    doc.applyStyle(0, 2, styleIdByName(doc, '개요 2'))
    doc.applyStyle(0, 3, styleIdByName(doc, '개요 3'))
    doc.applyStyle(0, 5, styleIdByName(doc, '개요 1'))

    // Demote para 1 with subtree: paras 1, 2, 3 shift +1 (1->2, 2->3, 3->4); para 5 stays 1
    const demote = changeOutlineLevel(doc, { sec: 0, para: 1, delta: 1 })
    expect(demote.ok).toBe(true)
    if (!demote.ok) return
    expect(demote.changed).toEqual([
      { sec: 0, para: 1, fromLevel: 1, toLevel: 2, styleName: '개요 2' },
      { sec: 0, para: 2, fromLevel: 2, toLevel: 3, styleName: '개요 3' },
      { sec: 0, para: 3, fromLevel: 3, toLevel: 4, styleName: '개요 4' },
    ])
    expect(demote.place).toMatchObject({ sec: 0, para: 1, offset: 0 })

    const afterDemote = readOutline(doc)
    expect(afterDemote.items.map((i) => [i.para, i.level, i.styleName])).toEqual([
      [1, 2, '개요 2'],
      [2, 3, '개요 3'],
      [3, 4, '개요 4'],
      [5, 1, '개요 1'],
    ])

    // Promote para 1 singleOnly: ONLY para 1 moves 2->1; children paras 2 & 3 remain 3 & 4
    const singlePromote = changeOutlineLevel(doc, {
      sec: 0,
      para: 1,
      delta: -1,
      singleOnly: true,
    })
    expect(singlePromote.ok).toBe(true)
    if (!singlePromote.ok) return
    expect(singlePromote.changed).toEqual([
      { sec: 0, para: 1, fromLevel: 2, toLevel: 1, styleName: '개요 1' },
    ])
    expect(readOutline(doc).items.map((i) => [i.para, i.level])).toEqual([
      [1, 1],
      [2, 3],
      [3, 4],
      [5, 1],
    ])

    // Promote para 2 with subtree: paras 2 & 3 move 3->2 and 4->3
    const promoteSubtree = changeOutlineLevel(doc, { sec: 0, para: 2, delta: -1 })
    expect(promoteSubtree.ok).toBe(true)
    expect(readOutline(doc).items.map((i) => [i.para, i.level])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [5, 1],
    ])
  })

  it('promotes and demotes style-mapped headings and breaks ties using app-wide default order', () => {
    const doc = makeBlankDoc(['제1장 서론', '1.1 세부 내용', '제2장 본론'])
    const title1Id = ensureStyle(doc, '제목 1', 'Heading 1')
    const title2Id = ensureStyle(doc, '제목 2', 'Heading 2')
    ensureStyle(doc, 'Heading 2', 'Heading 2')
    const customSubId = ensureStyle(doc, '소제목', 'SubTitle')
    const customSecId = ensureStyle(doc, '절제목', 'SectionTitle')
    doc.applyStyle(0, 0, title1Id)
    doc.applyStyle(0, 1, title2Id)
    doc.applyStyle(0, 2, title1Id)

    // With default map (Korean title styles before Heading N), demoting para 0 (level 1 -> 2)
    // and para 1 (level 2 -> 3) falls back to Heading 3 when only Heading 3 exists in the doc.
    ensureStyle(doc, 'Heading 3', 'Heading 3')
    const res1 = changeOutlineLevel(doc, { sec: 0, para: 0, delta: 1 })
    expect(res1.ok).toBe(true)
    if (!res1.ok) return
    expect(res1.changed).toEqual([
      { sec: 0, para: 0, fromLevel: 1, toLevel: 2, styleName: '제목 2' },
      { sec: 0, para: 1, fromLevel: 2, toLevel: 3, styleName: 'Heading 3' },
    ])

    // Tie-breaker test: docStyleMap lists customSecId before customSubId at level 2,
    // while appStyleMap lists customSubId before customSecId at level 2 -> app-wide order wins.
    expect(
      writeDocOutlineMap(doc, {
        '제목 1': 1,
        절제목: 2,
        소제목: 2,
      }).ok,
    ).toBe(true)
    const appStyleMap = {
      '제목 1': 1,
      소제목: 2,
      절제목: 2,
    }
    const resTie = changeOutlineLevel(doc, {
      sec: 0,
      para: 2,
      delta: 1,
      singleOnly: true,
      appStyleMap,
    })
    expect(resTie.ok).toBe(true)
    if (!resTie.ok) return
    expect(resTie.changed).toEqual([
      { sec: 0, para: 2, fromLevel: 1, toLevel: 2, styleName: '소제목' },
    ])
    expect((JSON.parse(doc.getStyleAt(0, 2)) as { id: number }).id).toBe(customSubId)
    expect(customSecId).not.toBe(customSubId)
  })

  it('preserves direct character formatting when changing outline level via applyStyle', () => {
    const doc = makeBlankDoc(['강조된 제목 문단'])
    doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))
    doc.applyCharFormat(0, 0, 0, 3, JSON.stringify({ bold: true, textColor: '#cc0000' }))

    const beforeBold = JSON.parse(doc.getCharPropertiesAt(0, 0, 0)) as {
      bold: boolean
      textColor: string
    }
    expect(beforeBold.bold).toBe(true)
    expect(beforeBold.textColor.toLowerCase()).toBe('#cc0000')

    const res = changeOutlineLevel(doc, { sec: 0, para: 0, delta: 1 })
    expect(res.ok).toBe(true)

    const afterBold = JSON.parse(doc.getCharPropertiesAt(0, 0, 0)) as {
      bold: boolean
      textColor: string
    }
    const afterPlain = JSON.parse(doc.getCharPropertiesAt(0, 0, 4)) as { bold: boolean }
    expect(afterBold.bold).toBe(true)
    expect(afterBold.textColor.toLowerCase()).toBe('#cc0000')
    expect(afterPlain.bold).toBe(false)
    expect(readOutline(doc).items[0]).toMatchObject({ level: 2, styleName: '개요 2' })
  })

  it('atomically refuses level < 1, level > 10 (including descendant), and unmapped target level without mutating', () => {
    // 1. Promoting level 1 -> refused atomically
    const doc1 = makeBlankDoc(['장', '절'])
    doc1.applyStyle(0, 0, styleIdByName(doc1, '개요 1'))
    doc1.applyStyle(0, 1, styleIdByName(doc1, '개요 2'))
    const snap1 = snapshotParagraphsAndOutline(doc1)
    const r1 = changeOutlineLevel(doc1, { sec: 0, para: 0, delta: -1 })
    expect(r1).toMatchObject({
      ok: false,
      reason: 'level_out_of_range',
      fromLevel: 1,
      targetLevel: 0,
    })
    expect(snapshotParagraphsAndOutline(doc1)).toEqual(snap1)

    // 2. Demoting a heading whose descendant is at level 10 -> entire subtree refused atomically
    const doc2 = makeBlankDoc(['상위 개요', '최하위 개요'])
    doc2.applyStyle(0, 0, styleIdByName(doc2, '개요 9'))
    doc2.applyStyle(0, 1, styleIdByName(doc2, '개요 10'))
    const snap2 = snapshotParagraphsAndOutline(doc2)
    const r2 = changeOutlineLevel(doc2, { sec: 0, para: 0, delta: 1 })
    expect(r2).toMatchObject({
      ok: false,
      reason: 'level_out_of_range',
      para: 1,
      fromLevel: 10,
      targetLevel: 11,
    })
    // Parent at para 0 must NOT have been mutated before failing on descendant para 1!
    expect(snapshotParagraphsAndOutline(doc2)).toEqual(snap2)

    // 3. No mapped style at target level for descendant -> entire subtree refused atomically
    const doc3 = makeBlankDoc(['제1장 서론', '1.1 절'])
    const h1 = ensureStyle(doc3, '장제목')
    const h2 = ensureStyle(doc3, '절제목')
    doc3.applyStyle(0, 0, h1)
    doc3.applyStyle(0, 1, h2)
    const customMap = { 장제목: 1, 절제목: 2 } // no level 3 mapped
    const snap3Before = readAllParagraphs(doc3, 0)
    const r3 = changeOutlineLevel(doc3, { sec: 0, para: 0, delta: 1, appStyleMap: customMap })
    expect(r3).toMatchObject({
      ok: false,
      reason: 'no_mapped_style',
      para: 1,
      fromLevel: 2,
      targetLevel: 3,
    })
    expect(readAllParagraphs(doc3, 0)).toEqual(snap3Before)

    // 4. Non-heading paragraph -> not_found
    const doc4 = makeBlankDoc(['일반 문단'])
    expect(changeOutlineLevel(doc4, { sec: 0, para: 0, delta: 1 })).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('moveOutlineSection against real @rhwp/core documents', () => {
  it('moves sections down and up (before and after) preserving heading levels, styles, and body paragraphs', () => {
    const doc = makeBlankDoc(['표지 문단'])
    const sBody = styleIdByName(doc, '바탕글')
    const s1 = styleIdByName(doc, '개요 1')
    const s2 = styleIdByName(doc, '개요 2')

    const pA = appendPara(doc, 0, '장 A', s1)
    appendPara(doc, 0, '절 A.1', s2)
    appendPara(doc, 0, 'A 본문', sBody)
    const pB = appendPara(doc, 0, '장 B', s1)
    appendPara(doc, 0, 'B 본문', sBody)
    const pC = appendPara(doc, 0, '장 C', s1)
    appendPara(doc, 0, 'C 본문', sBody)

    // Move section A (paras 1..3) AFTER section B (paras 4..5)
    const downRes = moveOutlineSection(doc, {
      source: { sec: 0, para: pA },
      target: { sec: 0, para: pB },
      position: 'after',
    })
    expect(downRes).toMatchObject({
      ok: true,
      movedParagraphs: 3,
      newStart: { sec: 0, para: 3 },
      place: { sec: 0, para: 3, offset: 0 },
    })
    expect(readAllParagraphs(doc, 0)).toEqual([
      { text: '표지 문단', style: '바탕글' },
      { text: '장 B', style: '개요 1' },
      { text: 'B 본문', style: '바탕글' },
      { text: '장 A', style: '개요 1' },
      { text: '절 A.1', style: '개요 2' },
      { text: 'A 본문', style: '바탕글' },
      { text: '장 C', style: '개요 1' },
      { text: 'C 본문', style: '바탕글' },
    ])
    expect(readOutline(doc).items.map((i) => [i.title, i.level, i.para])).toEqual([
      ['장 B', 1, 1],
      ['장 A', 1, 3],
      ['절 A.1', 2, 4],
      ['장 C', 1, 6],
    ])

    // Move section C (now at para 6..7) BEFORE section B (para 1)
    const upRes = moveOutlineSection(doc, {
      source: { sec: 0, para: pC },
      target: { sec: 0, para: 1 },
      position: 'before',
    })
    expect(upRes).toMatchObject({
      ok: true,
      movedParagraphs: 2,
      newStart: { sec: 0, para: 1 },
      place: { sec: 0, para: 1, offset: 0 },
    })
    expect(readAllParagraphs(doc, 0)).toEqual([
      { text: '표지 문단', style: '바탕글' },
      { text: '장 C', style: '개요 1' },
      { text: 'C 본문', style: '바탕글' },
      { text: '장 B', style: '개요 1' },
      { text: 'B 본문', style: '바탕글' },
      { text: '장 A', style: '개요 1' },
      { text: '절 A.1', style: '개요 2' },
      { text: 'A 본문', style: '바탕글' },
    ])
    expect(readOutline(doc).items.map((i) => [i.title, i.level, i.para])).toEqual([
      ['장 C', 1, 1],
      ['장 B', 1, 3],
      ['장 A', 1, 5],
      ['절 A.1', 2, 6],
    ])
  })

  it('moves a rich section (table + picture + footnote + app/user bookmarks) intact across HWP and HWPX round-trips', () => {
    const doc = makeBlankDoc(['표지'])
    const sBody = styleIdByName(doc, '바탕글')
    const s1 = styleIdByName(doc, '개요 1')
    const s2 = styleIdByName(doc, '개요 2')

    const pH1 = appendPara(doc, 0, '연구 방법', s1)
    doc.addBookmark(0, pH1, 0, '제목:method')
    appendPara(doc, 0, '실험 설계', s2)

    const pPic = appendPara(doc, 0, '그림 설명: ', sBody)
    doc.insertPictureEx(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: pPic,
        charOffset: 7,
        width: 2400,
        height: 2400,
        naturalWidthPx: 1,
        naturalHeightPx: 1,
        extension: 'png',
        description: 'diagram',
      }),
      PNG_1X1,
    )

    const pTbl = appendPara(doc, 0, '', sBody)
    const tblRes = JSON.parse(
      doc.createTableEx(
        JSON.stringify({
          sectionIdx: 0,
          paraIdx: pTbl,
          charOffset: 0,
          rowCount: 2,
          colCount: 2,
          treatAsChar: true,
        }),
      ),
    ) as { paraIdx: number; controlIdx: number }
    doc.insertTextInCell(0, tblRes.paraIdx, tblRes.controlIdx, 0, 0, 0, '표셀값')

    const pFn = appendPara(doc, 0, '각주가 붙은 문장', sBody)
    const fnRes = JSON.parse(doc.insertFootnote(0, pFn, 8)) as { controlIdx: number }
    doc.insertTextInFootnote(0, pFn, fnRes.controlIdx, 0, 0, '각주 본문 내용')
    doc.addBookmark(0, pFn, 0, '인용:park2025')
    doc.addBookmark(0, pFn, 4, '색인:실험')
    doc.addBookmark(0, pFn, 8, '사용자책갈피')

    const pH2 = appendPara(doc, 0, '연구 결과', s1)
    appendPara(doc, 0, '결과 요약', sBody)

    // Move first section (with subheading, picture, table, footnote, 4 bookmarks) after second section
    const moveRes = moveOutlineSection(doc, {
      source: { sec: 0, para: pH1 },
      target: { sec: 0, para: pH2 },
      position: 'after',
    })
    expect(moveRes.ok).toBe(true)
    if (!moveRes.ok) return
    expect(moveRes.movedParagraphs).toBe(5)
    expect(moveRes.newStart).toEqual({ sec: 0, para: 3 })

    // Verify in live doc AND after both HWP and HWPX export/reload round-trips
    const docsToCheck: HwpDocument[] = [
      doc,
      new HwpDocument(doc.exportHwp()),
      new HwpDocument(doc.exportHwpx()),
    ]
    for (const candidate of docsToCheck) {
      expect(readOutline(candidate).items.map((i) => [i.title, i.level])).toEqual([
        ['연구 결과', 1],
        ['연구 방법', 1],
        ['실험 설계', 2],
      ])

      const controls = JSON.parse(candidate.getControls()) as ControlEntry[]
      const tbl = controls.find((c) => c.ctrlId === 'tbl')
      const pic = controls.find((c) => c.ctrlId === 'gso')
      const fn = controls.find((c) => c.ctrlId === 'fn')
      expect(tbl).toBeDefined()
      expect(pic).toBeDefined()
      expect(fn).toBeDefined()

      expect(candidate.getTextInCell(0, tbl!.para, tbl!.controlIndex, 0, 0, 0, 10)).toBe('표셀값')
      const fnInfo = JSON.parse(candidate.getFootnoteInfo(0, fn!.para, fn!.controlIndex)) as {
        ok: boolean
        texts: string[]
      }
      expect(fnInfo.ok).toBe(true)
      expect(fnInfo.texts.join('')).toContain('각주 본문 내용')

      const bmNames = (JSON.parse(candidate.getBookmarks()) as BookmarkEntry[])
        .map((b) => b.name)
        .sort()
      expect(bmNames).toEqual(['사용자책갈피', '색인:실험', '인용:park2025', '제목:method'])
    }
  })

  it('refuses cross-section moves, first-paragraph layout controls, target inside source, and no-op drops', () => {
    const doc = makeBlankDoc(['첫 문단 개요'])
    const s1 = styleIdByName(doc, '개요 1')
    const s2 = styleIdByName(doc, '개요 2')
    doc.applyStyle(0, 0, s1)
    const p1 = appendPara(doc, 0, '둘째 개요', s1)
    const p2 = appendPara(doc, 0, '둘째 하위', s2)
    const p3 = appendPara(doc, 0, '셋째 개요', s1)

    // 1. Moving paragraph 0 (which carries secd/cold) -> first_para_layout
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: 0 },
        target: { sec: 0, para: p3 },
        position: 'after',
      }),
    ).toMatchObject({ ok: false, reason: 'first_para_layout' })

    // 2. Moving another heading BEFORE paragraph 0 (which carries secd/cold) -> first_para_layout
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: p3 },
        target: { sec: 0, para: 0 },
        position: 'before',
      }),
    ).toMatchObject({ ok: false, reason: 'first_para_layout' })

    // 3. Target inside source subtree (self or descendant) -> target_inside_source
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: p1 },
        target: { sec: 0, para: p2 },
        position: 'after',
      }),
    ).toMatchObject({ ok: false, reason: 'target_inside_source' })
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: p1 },
        target: { sec: 0, para: p1 },
        position: 'before',
      }),
    ).toMatchObject({ ok: false, reason: 'target_inside_source' })

    // 4. No-op drop (already immediately before p3) -> no_change
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: p1 },
        target: { sec: 0, para: p3 },
        position: 'before',
      }),
    ).toMatchObject({ ok: false, reason: 'no_change' })

    // 5. Cross-section move -> cross_section
    doc.splitSection(0, p3, doc.getParagraphLength(0, p3))
    doc.insertText(1, 0, 0, '둘째 구역 개요')
    doc.applyStyle(1, 0, s1)
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: p1 },
        target: { sec: 1, para: 0 },
        position: 'after',
      }),
    ).toMatchObject({ ok: false, reason: 'cross_section' })

    // 6. Source heading whose descendant lives in the next section -> cross_section
    doc.applyStyle(1, 0, s2)
    expect(
      moveOutlineSection(doc, {
        source: { sec: 0, para: p3 },
        target: { sec: 0, para: p1 },
        position: 'before',
      }),
    ).toMatchObject({ ok: false, reason: 'cross_section' })
  })

  it('detects simulated object loss and bookmark loss cleanly', () => {
    // Simulated object loss: proxy getControls to drop a table after pasteInternal runs
    const docObj = makeBlankDoc(['표지'])
    const s1 = styleIdByName(docObj, '개요 1')
    const p1 = appendPara(docObj, 0, '섹션 1', s1)
    const pTbl = appendPara(docObj, 0, '')
    docObj.createTableEx(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: pTbl,
        charOffset: 0,
        rowCount: 1,
        colCount: 2,
        treatAsChar: true,
      }),
    )
    const p2 = appendPara(docObj, 0, '섹션 2', s1)

    let pasted = false
    const proxyObj = new Proxy(docObj, {
      get(target, prop, receiver) {
        if (prop === 'pasteInternal') {
          return (...args: [number, number, number]) => {
            pasted = true
            return target.pasteInternal(...args)
          }
        }
        if (prop === 'getControls') {
          return () => {
            const raw = JSON.parse(target.getControls()) as ControlEntry[]
            return JSON.stringify(pasted ? raw.filter((c) => c.ctrlId !== 'tbl') : raw)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as unknown as OutlineDoc

    const objLoss = moveOutlineSection(proxyObj, {
      source: { sec: 0, para: p1 },
      target: { sec: 0, para: p2 },
      position: 'after',
    })
    expect(objLoss).toMatchObject({ ok: false, reason: 'objects_changed', mutated: true })

    // Simulated bookmark loss: proxy pasteInternal & addBookmark so bookmark disappears
    const docBm = makeBlankDoc(['표지'])
    const s1Bm = styleIdByName(docBm, '개요 1')
    const b1 = appendPara(docBm, 0, '섹션 1', s1Bm)
    docBm.addBookmark(0, b1, 0, '인용:lost2025')
    const b2 = appendPara(docBm, 0, '섹션 2', s1Bm)

    let bmPasted = false
    const proxyBm = new Proxy(docBm, {
      get(target, prop, receiver) {
        if (prop === 'pasteInternal') {
          return (...args: [number, number, number]) => {
            bmPasted = true
            return target.pasteInternal(...args)
          }
        }
        if (prop === 'getBookmarks') {
          return () => {
            if (!bmPasted) return target.getBookmarks()
            return '[]'
          }
        }
        if (prop === 'addBookmark') {
          return () => JSON.stringify({ ok: false, error: 'simulated failure' })
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as unknown as OutlineDoc

    const bmLoss = moveOutlineSection(proxyBm, {
      source: { sec: 0, para: b1 },
      target: { sec: 0, para: b2 },
      position: 'after',
    })
    expect(bmLoss).toMatchObject({ ok: false, reason: 'bookmarks_lost', mutated: true })
  })

  it('composes promote/demote and section move as single undoable snapshot transactions', () => {
    const doc = makeBlankDoc(['표지'])
    const sBody = styleIdByName(doc, '바탕글')
    const s1 = styleIdByName(doc, '개요 1')
    const s2 = styleIdByName(doc, '개요 2')

    const p1 = appendPara(doc, 0, '제1장', s1)
    appendPara(doc, 0, '1.1 절', s2)
    appendPara(doc, 0, '본문 1', sBody)
    doc.addBookmark(0, p1, 0, '제목:ch1')
    const p2 = appendPara(doc, 0, '제2장', s1)
    appendPara(doc, 0, '본문 2', sBody)

    // 1. Single undo step for subtree demote
    const beforeDemote = snapshotParagraphsAndOutline(doc)
    const snapDemote = doc.saveSnapshot()
    const demoteRes = changeOutlineLevel(doc, {
      sec: 0,
      para: p1,
      delta: 1,
      appStyleMap: DEFAULT_OUTLINE_STYLE_MAP,
    })
    expect(demoteRes.ok).toBe(true)
    expect(readOutline(doc).items[0]!.level).toBe(2)
    expect(readOutline(doc).items[1]!.level).toBe(3)

    doc.restoreSnapshot(snapDemote)
    doc.discardSnapshot(snapDemote)
    expect(snapshotParagraphsAndOutline(doc)).toEqual(beforeDemote)

    // 2. Single undo step for section move
    const beforeMove = snapshotParagraphsAndOutline(doc)
    const snapMove = doc.saveSnapshot()
    const moveRes = moveOutlineSection(doc, {
      source: { sec: 0, para: p1 },
      target: { sec: 0, para: p2 },
      position: 'after',
    })
    expect(moveRes.ok).toBe(true)
    expect(readOutline(doc).items[0]!.title).toBe('제2장')

    doc.restoreSnapshot(snapMove)
    doc.discardSnapshot(snapMove)
    expect(snapshotParagraphsAndOutline(doc)).toEqual(beforeMove)
  })
})
