/**
 * Document-internal marks module and agent-plugin object-guard exemption tests
 * against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
  isAppTocHyperlinkField,
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

  it('deduplicates range marks before :시작/:끝, chunked marks via fresh chunkId, and settings without corrupting JSON', async () => {
    const doc = makeDoc([
      '원본 차례',
      '복사 차례',
      '원본 인용',
      '복사 인용',
      '원본 청크',
      '복사 청크',
      '원본 설정',
      '복사 설정',
    ])

    // Original + placeholder copies for unkeyed TOC range, keyed citation range, chunked citation, and setting
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.toc,
        '',
        { sec: 0, para: 0, offset: 0 },
        { sec: 0, para: 0, offset: 4 },
      ).ok,
    ).toBe(true)
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.toc,
        '임시차례',
        { sec: 0, para: 1, offset: 0 },
        { sec: 0, para: 1, offset: 4 },
      ).ok,
    ).toBe(true)

    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.citation,
        '홍길동2020',
        { sec: 0, para: 2, offset: 0 },
        { sec: 0, para: 2, offset: 4 },
      ).ok,
    ).toBe(true)
    expect(
      addRangeMark(
        doc,
        MARK_PREFIXES.citation,
        '임시인용',
        { sec: 0, para: 3, offset: 0 },
        { sec: 0, para: 3, offset: 4 },
      ).ok,
    ).toBe(true)

    const longCitationPayload = [
      '홍길동2020',
      '매우 긴 인용 메타데이터 문자열로 64자를 넘겨 청크 중복 복구를 검증합니다. 추가 본문 내용입니다.',
    ]
    const origChunks = encodeMarkChunks(MARK_PREFIXES.citation, longCitationPayload)
    const placeholderChunks = encodeMarkChunks(MARK_PREFIXES.citation, longCitationPayload, {
      chunkId: 'tmpdup',
    })
    expect(origChunks.length).toBeGreaterThan(1)
    for (const name of origChunks) {
      expect(addMark(doc, { sec: 0, para: 4, offset: 0 }, name).ok).toBe(true)
    }
    for (const name of placeholderChunks) {
      expect(addMark(doc, { sec: 0, para: 5, offset: 0 }, name).ok).toBe(true)
    }

    expect(addMark(doc, { sec: 0, para: 6, offset: 0 }, '설정:outline={"maxLevel"%3A3}').ok).toBe(
      true,
    )
    expect(addMark(doc, { sec: 0, para: 7, offset: 0 }, '설정:tmp={"maxLevel"%3A3}').ok).toBe(true)

    // Turn all placeholders into exact copy/paste duplicates in HWPX XML
    const zip = await JSZip.loadAsync(doc.exportHwpx())
    let sec0 = await zip.file('Contents/section0.xml')!.async('string')
    sec0 = sec0
      .replace('차례:임시차례:시작', '차례:시작')
      .replace('차례:임시차례:끝', '차례:끝')
      .replace('인용:임시인용:시작', '인용:홍길동2020:시작')
      .replace('인용:임시인용:끝', '인용:홍길동2020:끝')
      .replace('설정:tmp={&quot;maxLevel&quot;%3A3}', '설정:outline={&quot;maxLevel&quot;%3A3}')
      .replace('설정:tmp={"maxLevel"%3A3}', '설정:outline={"maxLevel"%3A3}')
    for (let i = 0; i < placeholderChunks.length; i++) {
      sec0 = sec0.replace(placeholderChunks[i]!, origChunks[i]!)
    }
    zip.file('Contents/section0.xml', sec0)
    const dupDoc = new HwpDocument(await zip.generateAsync({ type: 'uint8array' }))

    const res = deduplicateMarks(dupDoc)
    expect(res.renamed.length).toBeGreaterThanOrEqual(4 + origChunks.length)
    expect(res.removed).toHaveLength(1)
    expect(res.removed[0]).toMatchObject({
      name: '설정:outline={"maxLevel"%3A3}',
      para: 6,
    })

    // No duplicate bookmark names remain, and all stay <= 64 chars
    const allMarks = listMarks(dupDoc)
    const nameSet = new Set(allMarks.map((m) => m.name))
    expect(nameSet.size).toBe(allMarks.length)
    for (const m of allMarks) {
      expect(m.name.length).toBeLessThanOrEqual(MAX_MARK_NAME_LEN)
    }

    // 1. Both duplicated range pairs remain valid and paired
    const ranges = findRangeMarks(dupDoc)
    expect(ranges.broken).toEqual([])
    expect(ranges.ranges).toHaveLength(4)
    expect(ranges.ranges.map((r) => [r.start.name, r.end.name])).toEqual([
      ['차례:시작', '차례:끝'],
      ['차례:2:시작', '차례:2:끝'],
      ['인용:홍길동2020:시작', '인용:홍길동2020:끝'],
      ['인용:홍길동2020:2:시작', '인용:홍길동2020:2:끝'],
    ])

    // 2. Both duplicated chunked marks decode losslessly with no incomplete chunks
    const citationMarks = listMarks(dupDoc, [MARK_PREFIXES.citation]).filter((m) =>
      m.name.startsWith('인용:%c:'),
    )
    const decodedChunks = decodeMarkChunks(citationMarks)
    expect(decodedChunks.incomplete).toEqual([])
    expect(decodedChunks.entries).toHaveLength(2)
    expect(decodedChunks.entries[0]?.parts).toEqual(longCitationPayload)
    expect(decodedChunks.entries[1]?.parts).toEqual(longCitationPayload)
    expect(decodedChunks.entries[0]?.chunkId).not.toBe(decodedChunks.entries[1]?.chunkId)

    // 3. Setting JSON remained intact and readable
    expect(readDocSetting(dupDoc, 'outline')).toEqual({ maxLevel: 3 })
    expect(readAllDocSettings(dupDoc)).toEqual({ outline: { maxLevel: 3 } })
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
      { sec: 0, para: 0, offset: 0, inFootnote: true },
      { sec: 0, para: 0, offset: 0, inEndnote: true },
      { sec: 0, para: 0, offset: 0, inHeaderFooter: true },
      { sec: 0, para: 0, offset: 0, isHeader: true },
      { sec: 0, para: 0, offset: 0, isFooter: true },
      { sec: 0, para: 0, offset: 0, equationControl: { ctrlIdx: 0 } },
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

    // Real doc.searchAllText() hit inside a table cell (carries cellContext) must be refused
    const tableDoc = makeDoc(['본문', ''])
    tableDoc.pasteHtml(0, 1, 0, '<table><tr><td>표셀텍스트</td></tr></table>')
    const cellHits = JSON.parse(tableDoc.searchAllText('표셀텍스트', false, true)) as Array<
      Record<string, unknown>
    >
    expect(cellHits).toHaveLength(1)
    expect(cellHits[0]?.cellContext).toBeTruthy()
    expect(addMark(tableDoc, cellHits[0]!, '색인:셀금지:1')).toEqual({
      ok: false,
      reason: 'unsupported_place',
    })
    expect(JSON.parse(tableDoc.getBookmarks())).toEqual([])

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

    // Deleting paragraph with app marks succeeds without has_objects and reports removed marks
    const delAppMark = api.deleteParagraph('앱 표시가 있는 지울 문단', 1)
    expect(delAppMark).toMatchObject({
      ok: true,
      removedAppMarks: ['색인:교육학:1', '인용:홍길동2020:1'],
    })
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

  it('exempts app TOC hyperlinks targeting 제목: bookmarks while still protecting normal user hyperlinks', () => {
    const doc = makeDoc([
      '제1장 서론',
      '차례 북마크 링크',
      '차례 해시 링크',
      '외부 웹 링크',
      '사용자 북마크 링크',
      '꼬리 문단',
    ])
    expect(addMark(doc, { sec: 0, para: 0, offset: 0 }, '제목:서론').ok).toBe(true)
    doc.addBookmark(0, 0, 2, '사용자책갈피')

    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 1, cellPath: [] },
        start: 0,
        end: 8,
        bookmark: '제목:서론',
      }),
    )
    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 2, cellPath: [] },
        start: 0,
        end: 7,
        uri: '#제목:서론',
      }),
    )
    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 3, cellPath: [] },
        start: 0,
        end: 6,
        uri: 'https://example.com',
      }),
    )
    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 4, cellPath: [] },
        start: 0,
        end: 9,
        bookmark: '사용자책갈피',
      }),
    )

    const fields = JSON.parse(doc.getFieldList()) as Array<{ fieldType?: string; command?: string }>
    expect(fields.filter(isAppTocHyperlinkField)).toHaveLength(2)

    const { api } = makePluginHarness(doc)

    // Paragraphs containing app-owned TOC hyperlinks to 제목: bookmarks may be deleted freely
    // and report the removed TOC link targets for AI replies.
    expect(api.deleteParagraph('차례 북마크 링크', 1)).toMatchObject({
      ok: true,
      removedAppMarks: ['TOC link -> 제목:서론'],
    })
    expect(api.deleteParagraph('차례 해시 링크', 1)).toMatchObject({
      ok: true,
      removedAppMarks: ['TOC link -> 제목:서론'],
    })

    // Paragraphs containing regular user hyperlinks remain protected
    expect(api.deleteParagraph('외부 웹 링크', 1)).toMatchObject({
      ok: false,
      reason: 'has_objects',
    })
    expect(api.deleteParagraph('사용자 북마크 링크', 1)).toMatchObject({
      ok: false,
      reason: 'has_objects',
    })
  })
})

describe('robust deletion after hyperlinks, body-only filtering, and nested range deduplication', () => {
  it('deletes bookmarks after hyperlinks and TOC links via deleteControlAt fallback without throwing', () => {
    const doc = makeDoc(['링크텍스트 본문', '제1장 서론', '차례 링크 끝표시'])
    // Hyperlink starting at paragraph 0 offset 0 before a setting bookmark
    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 0, cellPath: [] },
        start: 0,
        end: 5,
        uri: 'https://example.com',
      }),
    )
    expect(addMark(doc, { sec: 0, para: 0, offset: 6 }, '설정:mode="v1"').ok).toBe(true)
    expect(readDocSetting(doc, 'mode')).toBe('v1')

    // Second writeDocSetting must cleanly delete the old setting bookmark after the hyperlink
    const secondWrite = writeDocSetting(doc, 'mode', 'v2')
    expect(secondWrite).toMatchObject({ ok: true })
    expect(readDocSetting(doc, 'mode')).toBe('v2')

    // TOC hyperlink followed by an unpaired 차례:끝 range mark in paragraph 2
    expect(addMark(doc, { sec: 0, para: 1, offset: 0 }, '제목:서론').ok).toBe(true)
    doc.insertHyperlinkEx(
      JSON.stringify({
        target: { section: 0, para: 2, cellPath: [] },
        start: 0,
        end: 5,
        bookmark: '제목:서론',
      }),
    )
    expect(addMark(doc, { sec: 0, para: 2, offset: 6 }, '차례:끝').ok).toBe(true)

    const cleaned = cleanupBrokenMarks(doc)
    expect(cleaned.removed.map((m) => m.name)).toContain('차례:끝')
    expect(cleaned.failed).toBeUndefined()

    // Re-add 차례:끝 after the TOC link and verify stripMarks deletes it cleanly while keeping the link
    expect(addMark(doc, { sec: 0, para: 2, offset: 6 }, '차례:끝').ok).toBe(true)
    const stripped = stripMarks(doc)
    expect(stripped.names).toContain('차례:끝')
    expect(stripped.failed).toBeUndefined()
    expect(listMarks(doc)).toEqual([])
    const fields = JSON.parse(doc.getFieldList()) as Array<{ fieldType?: string }>
    expect(fields.filter((f) => f.fieldType === 'hyperlink')).toHaveLength(2)
  })

  it('reports failed mark deletions gracefully without crashing when the engine refuses both delete paths', () => {
    const fakeDoc = {
      getSectionCount: () => 1,
      getParagraphCount: () => 1,
      getParagraphLength: () => 10,
      getBookmarks: () =>
        JSON.stringify([{ name: '차례:끝', sec: 0, para: 0, ctrlIdx: 2, charPos: 4 }]),
      getControls: () =>
        JSON.stringify([{ ctrlId: 'bokm', list: 0, para: 0, pos: 16, controlIndex: 2 }]),
      addBookmark: () => JSON.stringify({ ok: true }),
      deleteBookmark: () => {
        throw new Error('deleteBookmark unsupported')
      },
      deleteControlAt: () => {
        throw new Error('deleteControlAt unsupported')
      },
      renameBookmark: () => JSON.stringify({ ok: true }),
    }
    const stripped = stripMarks(fakeDoc)
    expect(stripped.removed).toBe(0)
    expect(stripped.failed).toHaveLength(1)
    expect(stripped.failed?.[0]?.name).toBe('차례:끝')

    const cleaned = cleanupBrokenMarks(fakeDoc)
    expect(cleaned.removed).toEqual([])
    expect(cleaned.failed).toHaveLength(1)
  })

  it('ignores non-body bookmarks whose ctrlIdx points to a non-bookmark outer control', () => {
    // Simulate bookmark_query returning a table-cell bookmark with outer (sec=0, para=1) + inner ctrlIdx=0,
    // while body paragraph 1 control 0 is actually the outer table ('tbl').
    const fakeDoc = {
      getSectionCount: () => 1,
      getParagraphCount: () => 2,
      getParagraphLength: () => 10,
      getBookmarks: () =>
        JSON.stringify([
          { name: '색인:본문:1', sec: 0, para: 0, ctrlIdx: 2, charPos: 0 },
          { name: '색인:표안:1', sec: 0, para: 1, ctrlIdx: 0, charPos: 0 },
        ]),
      getControls: () =>
        JSON.stringify([
          { ctrlId: 'bokm', list: 0, para: 0, pos: 0, controlIndex: 2 },
          { ctrlId: 'tbl', list: 0, para: 1, pos: 0, controlIndex: 0 },
          { ctrlId: 'bokm', list: 2, para: 0, pos: 0, controlIndex: 0 },
        ]),
      addBookmark: () => JSON.stringify({ ok: true }),
      deleteBookmark: vi.fn(() => JSON.stringify({ ok: true })),
      renameBookmark: vi.fn(() => JSON.stringify({ ok: true })),
    }

    const listed = listMarks(fakeDoc)
    expect(listed.map((m) => m.name)).toEqual(['색인:본문:1'])

    const stripped = stripMarks(fakeDoc)
    expect(stripped.names).toEqual(['색인:본문:1'])
    expect(fakeDoc.deleteBookmark).toHaveBeenCalledTimes(1)
    expect(fakeDoc.deleteBookmark).toHaveBeenCalledWith(0, 0, 2)
  })

  it('pairs nested pasted range marks in document order without crossing start and end', async () => {
    const doc = makeDoc(['바깥시작 안쪽시작 안쪽끝 바깥끝'])
    expect(addMark(doc, { sec: 0, para: 0, offset: 0 }, '인용:kim2024:시작').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 0, offset: 5 }, '인용:tmp:시작').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 0, offset: 10 }, '인용:tmp:끝').ok).toBe(true)
    expect(addMark(doc, { sec: 0, para: 0, offset: 14 }, '인용:kim2024:끝').ok).toBe(true)

    // Simulate pasting the same citation range inside the original range in HWPX
    const zip = await JSZip.loadAsync(doc.exportHwpx())
    const sec0 = (await zip.file('Contents/section0.xml')!.async('string'))
      .replace('인용:tmp:시작', '인용:kim2024:시작')
      .replace('인용:tmp:끝', '인용:kim2024:끝')
    zip.file('Contents/section0.xml', sec0)
    const nestedDoc = new HwpDocument(await zip.generateAsync({ type: 'uint8array' }))

    const res = deduplicateMarks(nestedDoc)
    expect(res.renamed).toHaveLength(2)

    const marks = listMarks(nestedDoc)
    expect(marks.map((m) => m.name)).toEqual([
      '인용:kim2024:시작',
      '인용:kim2024:2:시작',
      '인용:kim2024:2:끝',
      '인용:kim2024:끝',
    ])

    const { ranges, broken } = findRangeMarks(nestedDoc)
    expect(broken).toEqual([])
    expect(ranges).toHaveLength(2)
    // Outer range spans offset 0..14; inner range spans offset 5..10 (no crossing)
    expect(ranges[0].start.offset).toBe(0)
    expect(ranges[0].end.offset).toBe(14)
    expect(ranges[1].start.offset).toBe(5)
    expect(ranges[1].end.offset).toBe(10)
  })
})
