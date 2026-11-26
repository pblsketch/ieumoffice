/**
 * Document-internal marks module and agent-plugin object-guard exemption tests
 * against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import {
  APP_MARK_PREFIXES,
  MARK_PREFIXES,
  MAX_MARK_NAME_LEN,
  SUBMISSION_STRIP_PREFIXES,
  addMark,
  addRangeMark,
  cleanupBrokenMarks,
  decodeMarkChunks,
  decodeMarkName,
  deduplicateMarks,
  encodeMarkChunks,
  encodeMarkName,
  findRangeMarks,
  isAppMarkName,
  listMarks,
  readAllDocSettings,
  readDocSetting,
  removeMark,
  stripMarks,
  uniqueMarkName,
  writeDocSetting,
} from '../studio-plugin/doc-marks.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

function makeDoc(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, index) => {
    if (index > 0) doc.splitParagraph(0, index - 1, doc.getParagraphLength(0, index - 1))
    if (line) doc.insertText(0, index, 0, line)
  })
  return doc
}

function makePluginHarness(doc: HwpDocument) {
  let current = doc
  const host = {
    read(fn: (d: never) => unknown) {
      return fn(current as never)
    },
    transaction(_label: string, fn: (tx: never) => unknown) {
      const snap = current.exportHwpx()
      try {
        return fn({ doc: () => current, deferPagination: () => {} } as never)
      } catch (err) {
        current = new HwpDocument(snap)
        throw err
      }
    },
    events: { on: () => 0 },
  } as unknown as AgentPluginHost
  const api = agentPlugin.activate(host)
  return { api, doc: () => current }
}

describe('doc-marks prefixes and name encoding', () => {
  it('defines the exact 7 Korean app-mark prefixes and recognizes them', () => {
    expect(APP_MARK_PREFIXES).toEqual([
      '차례:',
      '제목:',
      '색인:',
      '색인블록:',
      '인용:',
      '참고문헌:',
      '설정:',
    ])
    expect(MARK_PREFIXES).toEqual({
      toc: '차례:',
      heading: '제목:',
      index: '색인:',
      indexBlock: '색인블록:',
      citation: '인용:',
      bibliography: '참고문헌:',
      setting: '설정:',
    })
    for (const prefix of APP_MARK_PREFIXES) {
      expect(isAppMarkName(`${prefix}테스트`)).toBe(true)
    }
    expect(isAppMarkName('사용자책갈피')).toBe(false)
    expect(isAppMarkName('차례')).toBe(false)
    expect(isAppMarkName('')).toBe(false)
    expect(isAppMarkName(null as unknown as string)).toBe(false)
  })

  it('round-trips short human-readable names with Korean, colons, percent signs, and punctuation', () => {
    const simple = encodeMarkName(MARK_PREFIXES.index, ['교육학', '3'])
    expect(simple).toBe('색인:교육학:3')
    expect(simple.length).toBeLessThanOrEqual(MAX_MARK_NAME_LEN)
    expect(decodeMarkName(simple)).toEqual({
      prefix: '색인:',
      parts: ['교육학', '3'],
      isChunk: false,
    })

    const special = encodeMarkName(MARK_PREFIXES.citation, [
      '홍길동:2020',
      'p.10%3A%25 "주석"',
      '1',
    ])
    expect(decodeMarkName(special)).toEqual({
      prefix: '인용:',
      parts: ['홍길동:2020', 'p.10%3A%25 "주석"', '1'],
      isChunk: false,
    })
  })

  it('chunks payloads longer than 64 chars into <=64-char bookmarks and decodes them losslessly', () => {
    const shortChunks = encodeMarkChunks(MARK_PREFIXES.index, ['교육학', '1'])
    expect(shortChunks).toEqual(['색인:교육학:1'])

    const longPayload = [
      '긴키:콜론포함',
      JSON.stringify({
        title: '한국어 논문 설정 테스트 데이터입니다 아주 긴 문장을 넣습니다',
        emoji: '📘📘📘📘📘📘📘📘📘📘',
        levels: [1, 2, 3, 4],
        colon: 'a:b%c%3Ad',
      }),
    ]
    const chunks = encodeMarkChunks(MARK_PREFIXES.setting, longPayload)
    expect(chunks.length).toBeGreaterThan(2)
    for (const name of chunks) {
      expect(name.length).toBeLessThanOrEqual(MAX_MARK_NAME_LEN)
      expect(isAppMarkName(name)).toBe(true)
      // no lone UTF-16 surrogates
      expect(name.isWellFormed()).toBe(true)
    }

    const decoded = decodeMarkChunks(chunks)
    expect(decoded.incomplete).toEqual([])
    expect(decoded.entries).toHaveLength(1)
    expect(decoded.entries[0]?.prefix).toBe(MARK_PREFIXES.setting)
    expect(decoded.entries[0]?.parts).toEqual(longPayload)
  })
})

describe('uniqueMarkName and deduplicateMarks', () => {
  it('generates unique names within maxLen by appending :2, :3 and truncating middle if needed', () => {
    const used = new Set<string>(['색인:교육학:1', '색인:교육학:1:2'])
    expect(uniqueMarkName(used, '색인:사회학:1')).toBe('색인:사회학:1')
    expect(uniqueMarkName(used, '색인:교육학:1')).toBe('색인:교육학:1:3')

    const maxBase = '색인:' + '가'.repeat(MAX_MARK_NAME_LEN - 3)
    expect(maxBase.length).toBe(MAX_MARK_NAME_LEN)
    const usedMax = new Set<string>([maxBase])
    const next = uniqueMarkName(usedMax, maxBase)
    expect(next.length).toBeLessThanOrEqual(MAX_MARK_NAME_LEN)
    expect(next.startsWith('색인:')).toBe(true)
    expect(next.endsWith(':2')).toBe(true)
    expect(usedMax.has(next)).toBe(false)
  })

  it('repairs copy/paste duplicate app-mark bookmarks while keeping first occurrence and user marks intact', async () => {
    const doc = makeDoc(['첫 번째 문단', '복사된 문단'])
    expect(addMark(doc, { sec: 0, para: 0, offset: 0 }, '색인:교육학:1').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 0 }, '색인:임시:9').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 2 }, '사용자책갈피').ok).toBe(true)

    // Simulate copy/paste duplicating bookmark name in HWPX
    const zip = await JSZip.loadAsync(doc.exportHwpx())
    const sec0 = await zip.file('Contents/section0.xml')!.async('string')
    zip.file('Contents/section0.xml', sec0.replace('색인:임시:9', '색인:교육학:1'))
    const dupDoc = new HwpDocument(await zip.generateAsync({ type: 'uint8array' }))

    expect(listMarks(dupDoc).map((m) => m.name)).toEqual(['색인:교육학:1', '색인:교육학:1'])

    const res = deduplicateMarks(dupDoc)
    expect(res.renamed).toHaveLength(1)
    expect(res.renamed[0]).toMatchObject({
      from: '색인:교육학:1',
      to: '색인:교육학:1:2',
      sec: 0,
      para: 1,
    })

    expect(listMarks(dupDoc).map((m) => m.name)).toEqual(['색인:교육학:1', '색인:교육학:1:2'])
    const allNames = JSON.parse(dupDoc.getBookmarks()).map((b: { name: string }) => b.name)
    expect(allNames).toContain('사용자책갈피')
  })
})

describe('range marks and broken mark cleanup', () => {
  it('creates, finds, and cleans up range marks across TOC, citations, index blocks, and bibliography', () => {
    const doc = makeDoc([
      '차례 제목',
      '제1장 서론',
      '본문 인용(홍길동, 2020)입니다.',
      '참고문헌 목록',
      '색인 목록',
    ])

    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.toc,
        '',
        { sec: 0, para: 0, offset: 0 },
        { sec: 0, para: 0, offset: 5 },
      ).ok,
    ).toBe(true)
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.citation,
        '홍길동2020:1',
        { sec: 0, para: 2, offset: 3 },
        { sec: 0, para: 2, offset: 14 },
      ).ok,
    ).toBe(true)
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.bibliography,
        '',
        { sec: 0, para: 3, offset: 0 },
        { sec: 0, para: 3, offset: 7 },
      ).ok,
    ).toBe(true)
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.indexBlock,
        '',
        { sec: 0, para: 4, offset: 0 },
        { sec: 0, para: 4, offset: 5 },
      ).ok,
    ).toBe(true)

    const found = findRangeMarks(doc)
    expect(found.broken).toEqual([])
    expect(found.ranges).toHaveLength(4)
    expect(found.ranges.map((r) => [r.prefix, r.id, r.start.name, r.end.name])).toEqual([
      ['차례:', '', '차례:시작', '차례:끝'],
      ['인용:', '홍길동2020:1', '인용:홍길동2020%3A1:시작', '인용:홍길동2020%3A1:끝'],
      ['참고문헌:', '', '참고문헌:시작', '참고문헌:끝'],
      ['색인블록:', '', '색인블록:시작', '색인블록:끝'],
    ])

    // Add orphaned start, orphaned end, and an incomplete chunk set
    expect(addMark(doc, { sec: 0, para: 1, offset: 0 }, '차례:고아:시작').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 3 }, '인용:고아2:끝').ok).toBe(true)
    const chunks = encodeMarkChunks(MARK_PREFIXES.setting, ['broken', '가'.repeat(80)])
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // Add only the first chunk, leaving the rest missing
    expect(addMark(doc, { sec: 0, para: 1, offset: 0 }, chunks[0]!).ok).toBe(true)

    const beforeCleanup = findRangeMarks(doc)
    expect(beforeCleanup.broken).toHaveLength(2)

    const cleaned = cleanupBrokenMarks(doc)
    expect(cleaned.removed.map((m) => m.name)).toEqual([
      '차례:고아:시작',
      chunks[0],
      '인용:고아2:끝',
    ])

    // Valid ranges remain untouched
    const afterCleanup = findRangeMarks(doc)
    expect(afterCleanup.broken).toEqual([])
    expect(afterCleanup.ranges).toHaveLength(4)
  })
})

describe('per-document settings', () => {
  it('writes at (0,0,0), survives paragraph shifts, supports chunking, and last-in-document-order wins', () => {
    const doc = makeDoc(['첫 문단입니다.', '둘째 문단입니다.'])

    const longSetting = {
      style: 'APA7',
      tocLevels: [1, 2, 3],
      note: '아주 긴 한국어 설정 값으로 64자를 넘겨 청크 분할 저장을 검증합니다. 추가 문구.',
    }
    const w1 = writeDocSetting(doc, 'outline', { maxLevel: 3 })
    const w2 = writeDocSetting(doc, 'citation', longSetting)
    expect(w1.ok).toBe(true)
    expect(w2.ok).toBe(true)
    expect(w2.names.length).toBeGreaterThan(1)
    for (const name of [...w1.names, ...w2.names]) {
      expect(name.length).toBeLessThanOrEqual(MAX_MARK_NAME_LEN)
    }

    // All setting bookmarks sit at (0, 0, 0)
    const initialSettingMarks = listMarks(doc, [MARK_PREFIXES.setting])
    expect(initialSettingMarks.every((m) => m.sec === 0 && m.para === 0 && m.offset === 0)).toBe(
      true,
    )

    // Insert two paragraphs before paragraph 0, shifting settings down to para 2
    doc.insertParagraph(0, 0)
    doc.insertText(0, 0, 0, '새 표지')
    doc.insertParagraph(0, 1)
    doc.insertText(0, 1, 0, '새 차례')

    const shiftedMarks = listMarks(doc, [MARK_PREFIXES.setting])
    expect(shiftedMarks.every((m) => m.para === 2)).toBe(true)
    expect(readDocSetting(doc, 'outline')).toEqual({ maxLevel: 3 })
    expect(readDocSetting(doc, 'citation')).toEqual(longSetting)

    // Add a later duplicate setting for 'outline' in para 3 -> last in document order wins
    expect(addMark(doc, { sec: 0, para: 3, offset: 0 }, '설정:outline={"maxLevel"%3A5}').ok).toBe(
      true,
    )
    expect(readDocSetting(doc, 'outline')).toEqual({ maxLevel: 5 })
    expect(readAllDocSettings(doc)).toEqual({
      outline: { maxLevel: 5 },
      citation: longSetting,
    })

    // Rewriting 'outline' clears ALL old entries anywhere in the doc and writes fresh at (0,0,0)
    const w3 = writeDocSetting(doc, 'outline', { maxLevel: 2 })
    expect(w3.ok).toBe(true)
    expect(readDocSetting(doc, 'outline')).toEqual({ maxLevel: 2 })
    const outlineMarks = listMarks(doc, [MARK_PREFIXES.setting]).filter((m) =>
      m.name.includes('outline'),
    )
    expect(outlineMarks).toHaveLength(1)
    expect(outlineMarks[0]).toMatchObject({ sec: 0, para: 0, offset: 0 })
  })
})

describe('stripMarks and HWP/HWPX round-trip', () => {
  it('strips submission prefixes while preserving 차례:, 제목:, and user bookmarks', () => {
    const doc = makeDoc(['차례', '1. 서론', '본문 내용', '참고문헌', '색인'])
    expect(addMark(doc, { sec: 0, para: 0, offset: 0 }, '차례:시작').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 0, offset: 2 }, '차례:끝').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 0 }, '제목:1').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 2 }, '사용자북마크').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 2, offset: 0 }, '색인:교육학:1').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 2, offset: 0 }, '색인:사회학:1').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 2, offset: 2 }, '인용:홍길동2020:1').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 3, offset: 0 }, '참고문헌:시작').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 3, offset: 4 }, '참고문헌:끝').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 4, offset: 0 }, '색인블록:시작').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 4, offset: 2 }, '색인블록:끝').ok).toBe(true)
    expect(writeDocSetting(doc, 'outline', { maxLevel: 3 }).ok).toBe(true)

    const stripped = stripMarks(doc, SUBMISSION_STRIP_PREFIXES)
    expect(stripped.removed).toBe(8)
    expect(stripped.names).toContain('색인:교육학:1')
    expect(stripped.names).toContain('인용:홍길동2020:1')
    expect(stripped.names).toContain('참고문헌:시작')
    expect(stripped.names).toContain('색인블록:시작')

    const remainingApp = listMarks(doc).map((m) => m.name)
    expect(remainingApp).toEqual(['차례:시작', '차례:끝', '제목:1'])
    const allRemaining = JSON.parse(doc.getBookmarks()).map((b: { name: string }) => b.name)
    expect(allRemaining).toContain('사용자북마크')
  })

  it('preserves marks, range marks, and chunked settings across real HWP and HWPX export/reload', () => {
    const doc = makeDoc(['차례', '제1장 서론', '인용 문장입니다.'])
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.toc,
        '',
        { sec: 0, para: 0, offset: 0 },
        { sec: 0, para: 0, offset: 2 },
      ).ok,
    ).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 0 }, '제목:서론').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 2, offset: 0 }, '색인:교육학:1').ok).toBe(true)
    const bigSetting = {
      style: 'KCI',
      fields: ['저자', '연도', '제목', '학술지', '권', '호', '쪽수'],
      extra: '긴 설정 데이터로 청크가 HWP와 HWPX 양쪽 모두에서 온전히 보존되는지 확인합니다.',
    }
    expect(writeDocSetting(doc, 'thesis', bigSetting).ok).toBe(true)

    const expectedNames = listMarks(doc).map((m) => m.name)

    const reloadedHwp = new HwpDocument(doc.exportHwp())
    expect(listMarks(reloadedHwp).map((m) => m.name)).toEqual(expectedNames)
    expect(readDocSetting(reloadedHwp, 'thesis')).toEqual(bigSetting)
    expect(findRangeMarks(reloadedHwp).ranges).toHaveLength(1)

    const reloadedHwpx = new HwpDocument(doc.exportHwpx())
    expect(listMarks(reloadedHwpx).map((m) => m.name)).toEqual(expectedNames)
    expect(readDocSetting(reloadedHwpx, 'thesis')).toEqual(bigSetting)
    expect(findRangeMarks(reloadedHwpx).ranges).toHaveLength(1)
  })
})

describe('unsupported placement and validation', () => {
  it('refuses non-body places and overly long names without mutating the document', () => {
    const doc = makeDoc(['본문'])
    const badPlaces = [
      { sec: 0, para: 0, offset: 0, inTable: true },
      { sec: 0, para: 0, offset: 0, path: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }] },
      { sec: 0, para: 0, offset: 0, cellPath: '[{"controlIndex":0}]' },
      { sec: 0, para: 0, offset: 0, inTextBox: true },
      { sec: 0, para: 0, offset: 0, isTextBox: true },
      { sec: 0, para: 0, offset: 0, inNote: true },
      { sec: 0, para: 0, offset: 0, inHeaderFooter: true },
      { sec: 0, para: 0, offset: 0, parentParaIndex: 0, cellIndex: 0, cellParaIndex: 0 },
      { sec: 5, para: 0, offset: 0 },
      { sec: 0, para: 99, offset: 0 },
      { sec: 0, para: 0, offset: -1 },
    ]
    for (const place of badPlaces) {
      expect(addMark(doc, place, '색인:금지:1')).toEqual({
        ok: false,
        reason: 'unsupported_place',
      })
    }

    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.citation,
        'id1',
        { sec: 0, para: 0, offset: 0 },
        { sec: 0, para: 0, offset: 1, inTable: true },
      ),
    ).toEqual({ ok: false, reason: 'unsupported_place' })

    expect(addMark(doc, { sec: 0, para: 0, offset: 0 }, '색인:' + '가'.repeat(65))).toMatchObject({
      ok: false,
      reason: 'name_too_long',
    })

    // Document was never mutated
    expect(JSON.parse(doc.getBookmarks())).toEqual([])

    // removeMark on missing mark returns not_found
    expect(removeMark(doc, '색인:없는항목:1')).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('agent-plugin object-guard exemption for app marks', () => {
  it('allows deleting a paragraph containing app marks while still refusing tables and user bookmarks', () => {
    const doc = makeDoc([
      '머리 문단',
      '앱 표시가 있는 지울 문단',
      '',
      '사용자 책갈피 문단',
      '꼬리 문단',
    ])
    expect(writeDocSetting(doc, 'outline', { maxLevel: 3 }).ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 2 }, '색인:교육학:1').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 1, offset: 5 }, '인용:홍길동2020:1').ok).toBe(true)
    doc.addBookmark(0, 3, 2, '사용자책갈피')
    doc.pasteHtml(0, 2, 0, '<table><tr><td>셀</td></tr></table>')
    doc.insertText(0, 2, 0, '표가 들어갈 문단')

    const { api, doc: getDoc } = makePluginHarness(doc)

    // Deleting paragraph with app marks succeeds without has_objects
    const delAppMark = api.deleteParagraph('앱 표시가 있는 지울 문단', 1)
    expect(delAppMark).toMatchObject({ ok: true })
    expect(listMarks(getDoc()).map((m) => m.name)).not.toContain('색인:교육학:1')
    expect(listMarks(getDoc()).map((m) => m.name)).not.toContain('인용:홍길동2020:1')

    // Inserting before paragraph 0 (which carries 설정: mark) succeeds without has_objects
    const insBeforeFirst = api.insertParagraphs('머리 문단', 1, 'before', ['새 첫 문단'])
    expect(insBeforeFirst).toMatchObject({ ok: true })

    // Deleting paragraph with a real table is still refused
    const delTable = api.deleteParagraph('표가 들어갈 문단', 1)
    expect(delTable).toMatchObject({ ok: false, reason: 'has_objects' })

    // Deleting paragraph with a non-app user bookmark is still refused
    const delUserBookmark = api.deleteParagraph('사용자 책갈피 문단', 1)
    expect(delUserBookmark).toMatchObject({ ok: false, reason: 'has_objects' })
  })
})
