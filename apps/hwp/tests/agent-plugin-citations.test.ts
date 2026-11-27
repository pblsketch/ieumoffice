/**
 * Real `@rhwp/core` engine tests for citation & bibliography plugin wiring (T20),
 * object/memo protection (`keepingObjects`), single-transaction rollback guarantees,
 * staleness integration (`checkStaleItems` / `refreshAllStale`), and menu registration.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import type { BibEntry } from '../studio-plugin/citation-styles.mjs'
import {
  BIBLIOGRAPHY_COMMAND_EVENT,
  BIBLIOGRAPHY_MENU_ITEMS,
  WORKPANE_BIBLIOGRAPHY_MENU_ITEM,
  WORKPANE_COMMAND_EVENT,
  WORKPANE_MENU_ITEMS,
  installBibliographyMenu,
  installWorkpaneMenu,
} from '../studio-plugin/workpane-menu.mjs'

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function countFootnotes(doc: HwpDocument): number {
  const controls = JSON.parse(doc.getControls()) as Array<{ ctrlId: string }>
  return controls.filter((c) => c.ctrlId === 'fn' || c.ctrlId === 'en').length
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

function makeEntries(): BibEntry[] {
  return [
    {
      id: 'e-kim-2024',
      key: 'kim2024',
      oldKeys: [],
      type: 'article',
      authors: [{ family: '김', given: '철수' }],
      year: '2024',
      title: '인공지능 문서 분석 방법론',
      journal: '정보과학회논문지',
      volume: '51',
      issue: '3',
      pages: '101-115',
      language: 'ko',
      tags: [],
      verified: true,
    },
    {
      id: 'e-lee-2023',
      key: 'lee2023',
      oldKeys: [],
      type: 'article',
      authors: [{ family: '이', given: '영희' }],
      year: '2023',
      title: '딥러닝 기반 텍스트 요약 연구',
      journal: '한국컴퓨터정보학회논문지',
      volume: '28',
      issue: '2',
      pages: '45-58',
      language: 'ko',
      tags: [],
      verified: true,
    },
    {
      id: 'e-smith-2022',
      key: 'smith2022',
      oldKeys: [],
      type: 'article',
      authors: [{ family: 'Smith', given: 'Alice' }],
      year: '2022',
      title: 'Structured Document Analysis',
      journal: 'Journal of Computing',
      volume: '14',
      issue: '1',
      pages: '12-29',
      language: 'en',
      tags: [],
      verified: true,
    },
    {
      id: 'e-unverified',
      key: 'draft2025',
      oldKeys: [],
      type: 'article',
      authors: [{ family: '박', given: '미확인' }],
      year: '2025',
      title: '미확인 참고문헌 초안',
      language: 'ko',
      tags: [],
      verified: false,
    },
  ]
}

interface MockCursor {
  position: Record<string, unknown> | null
  inFootnote?: boolean
  fnSectionIdx?: number
  fnParaIdx?: number
  fnControlIdx?: number
  fnInnerParaIdx?: number
  fnCharOffset?: number
  inHeaderFooter?: boolean
  selectedRange?: { start: unknown; end: unknown } | null
}

function openHost(start: HwpDocument, mockCursor?: MockCursor) {
  let doc = start
  const history: Uint8Array[] = []
  const commands = new Map<
    string,
    { id: string; label: string; shortcutLabel?: string; execute: (...args: unknown[]) => void }
  >()
  const menuItems: Array<{ menuId: string; commandId: string; position?: string }> = []

  const cursorObj = mockCursor
    ? {
        getPosition: () => mockCursor.position,
        isInFootnote: () => Boolean(mockCursor.inFootnote),
        isInHeaderFooter: () => Boolean(mockCursor.inHeaderFooter),
        get fnSectionIdx() {
          return mockCursor.fnSectionIdx
        },
        get fnParaIdx() {
          return mockCursor.fnParaIdx
        },
        get fnControlIdx() {
          return mockCursor.fnControlIdx
        },
        get fnInnerParaIdx() {
          return mockCursor.fnInnerParaIdx
        },
        get fnCharOffset() {
          return mockCursor.fnCharOffset
        },
        clearSelection: () => {
          mockCursor.selectedRange = null
        },
        moveTo: (pos: unknown) => {
          if (!mockCursor.selectedRange) {
            mockCursor.selectedRange = { start: pos, end: pos }
          } else {
            mockCursor.selectedRange.end = pos
          }
        },
        setAnchor: () => {},
      }
    : null

  const services = cursorObj
    ? {
        getInputHandler: () => ({
          cursor: cursorObj,
          updateCaret: () => {},
        }),
      }
    : null

  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = doc.exportHwp()
      try {
        const result = fn({ doc: () => doc, deferPagination: () => {} } as never)
        history.push(before)
        return result
      } catch (thrown) {
        doc.free()
        doc = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: () => 0 },
    automation: {
      registerCommand: (cmd: {
        id: string
        label: string
        shortcutLabel?: string
        execute: (...args: unknown[]) => void
      }) => {
        commands.set(cmd.id, cmd)
      },
      unregisterCommand: (id: string) => {
        commands.delete(id)
      },
      addMenuItem: (item: { menuId: string; commandId: string; position?: string }) => {
        menuItems.push(item)
      },
      execute: (id: string, params?: unknown) => {
        const cmd = commands.get(id)
        if (!cmd || !services) return { ok: false }
        cmd.execute(services, params)
        return { ok: true }
      },
    },
  } as unknown as AgentPluginHost

  return {
    plugin: agentPlugin.activate(host),
    doc: () => doc,
    steps: () => history.length,
    commands,
    menuItems,
  }
}

describe('agent-plugin citation & bibliography surface (T20)', () => {
  it('inserts citations (human foreign and AI) in 1 undo step, creates marks, and refuses unverified with 0 undo steps', () => {
    const entries = makeEntries()
    const { plugin, doc, steps } = openHost(
      makeDoc(['첫 번째 본문 문장입니다.', '두 번째 문장입니다.']),
    )
    try {
      expect(plugin.getCitationStyle()).toEqual({ ok: true, style: 'apa' })

      // Human UI insertion (foreign: true)
      const human = plugin.insertCitation({
        entries,
        key: 'kim2024',
        place: { sec: 0, para: 0, offset: doc().getParagraphLength(0, 0) },
        foreign: true,
      })
      expect(human.ok).toBe(true)
      if (!human.ok) return
      expect(human.marked).toBe(true)
      expect(human.placeKind).toBe('body')
      expect(steps()).toBe(1)
      expect(plugin.foreignChanges()).toBe(1)

      // AI insertion (foreign omitted/false)
      const ai = plugin.insertCitation({
        entries,
        key: 'smith2022',
        place: { sec: 0, para: 1, offset: doc().getParagraphLength(0, 1) },
      })
      expect(ai.ok).toBe(true)
      if (!ai.ok) return
      expect(ai.marked).toBe(true)
      expect(steps()).toBe(2)
      expect(plugin.foreignChanges()).toBe(1)

      const listed = plugin.listCitationMarks(entries)
      expect(listed.ok).toBe(true)
      expect(listed.marks).toHaveLength(2)
      expect(listed.marks.map((m) => m.keys)).toEqual([['kim2024'], ['smith2022']])

      // Unverified reference is strictly refused with 0 additional undo steps
      const bytesBefore = doc().exportHwp()
      const refused = plugin.insertCitation({
        entries,
        key: 'draft2025',
        place: { sec: 0, para: 1, offset: 0 },
        foreign: true,
      })
      expect(refused).toMatchObject({
        ok: false,
        reason: 'unverified_entry',
        unverifiedKeys: ['draft2025'],
      })
      expect(steps()).toBe(2)
      expect(bytesEqual(doc().exportHwp(), bytesBefore)).toBe(true)
    } finally {
      doc().free()
    }
  })

  it('uses editor caret when place is omitted (plain text in footnote, refuses bibliography in table/note)', () => {
    const entries = makeEntries()
    const docStart = makeDoc(['본문 문단입니다.'])
    const fnRes = JSON.parse(docStart.insertFootnote(0, 0, 4)) as {
      ok: boolean
      controlIndex?: number
    }
    expect(fnRes.ok).toBe(true)
    const controls = JSON.parse(docStart.getControls()) as Array<{
      ctrlId: string
      controlIndex: number
    }>
    const fnCtrl = controls.find((c) => c.ctrlId === 'fn')
    expect(fnCtrl).toBeDefined()

    const mockCursor: MockCursor = {
      position: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      inFootnote: true,
      fnSectionIdx: 0,
      fnParaIdx: 0,
      fnControlIdx: fnCtrl!.controlIndex,
      fnInnerParaIdx: 0,
      fnCharOffset: 2,
    }
    const { plugin, doc, steps } = openHost(docStart, mockCursor)
    try {
      const inserted = plugin.insertCitation({
        entries,
        key: 'kim2024',
        foreign: true,
      })
      expect(inserted.ok).toBe(true)
      if (!inserted.ok) return
      expect(inserted.marked).toBe(false)
      expect(inserted.placeKind).toBe('footnote')
      expect(steps()).toBe(1)

      // Inserting a bibliography block while caret is inside a footnote refuses unsupported_place with 0 undo steps.
      const bibRefused = plugin.insertBibliographyBlock(entries, { foreign: true })
      expect(bibRefused).toMatchObject({ ok: false, reason: 'unsupported_place' })
      expect(steps()).toBe(1)
    } finally {
      doc().free()
    }
  })

  it('switches styles APA -> IEEE -> Chicago -> APA atomically in 1 undo step, skips manual citation edit, and rolls back on unapproved bibliography edits or footnote', () => {
    const entries = makeEntries()
    const { plugin, doc, steps } = openHost(
      makeDoc(['첫 번째 연구를 참고하였다.', '두 번째 연구를 참고하였다.']),
    )
    try {
      expect(
        plugin.insertCitation({
          entries,
          key: 'smith2022',
          place: { sec: 0, para: 0, offset: doc().getParagraphLength(0, 0) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })
      expect(
        plugin.insertCitation({
          entries,
          key: 'kim2024',
          place: { sec: 0, para: 1, offset: doc().getParagraphLength(0, 1) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })

      const bibInserted = plugin.insertBibliographyBlock(entries, { foreign: true })
      expect(bibInserted.ok).toBe(true)
      if (!bibInserted.ok) return
      expect(steps()).toBe(3)

      // Manually edit the second citation mark text so switchCitationStyle skips it.
      const marksBefore = plugin.listCitationMarks(entries).marks
      const secondMark = marksBefore[1]!
      doc().insertText(secondMark.sec, secondMark.para, secondMark.startOffset + 1, '수동 ')

      // Switch APA -> IEEE in 1 undo step.
      const toIeee = plugin.switchCitationStyle('ieee', entries, { foreign: true })
      expect(toIeee.ok).toBe(true)
      if (!toIeee.ok) return
      expect(toIeee.style).toBe('ieee')
      expect(toIeee.updatedCitations).toBe(1)
      expect(toIeee.skippedManual).toHaveLength(1)
      expect(toIeee.bibliographyRefreshed).toBe(true)
      expect(plugin.getCitationStyle()).toEqual({ ok: true, style: 'ieee' })
      expect(steps()).toBe(4)

      // Switch IEEE -> Chicago in 1 undo step.
      const toChicago = plugin.switchCitationStyle('chicago', entries, { foreign: true })
      expect(toChicago.ok).toBe(true)
      if (!toChicago.ok) return
      expect(toChicago.style).toBe('chicago')
      expect(toChicago.bibliographyRefreshed).toBe(true)
      expect(steps()).toBe(5)

      // Switch Chicago -> APA in 1 undo step.
      const toApa = plugin.switchCitationStyle('apa', entries, { foreign: true })
      expect(toApa.ok).toBe(true)
      if (!toApa.ok) return
      expect(toApa.style).toBe('apa')
      expect(toApa.bibliographyRefreshed).toBe(true)
      expect(steps()).toBe(6)

      // Manually edit a line in the bibliography block -> switchCitationStyle MUST roll back completely (0 undo steps)!
      const bibRange = plugin.detectBibliographyManualEdits().range
      expect(bibRange).not.toBeNull()
      const firstBibEntryPara = bibRange!.start.para + 1
      doc().insertText(bibRange!.start.sec, firstBibEntryPara, 0, '[수동편집] ')
      expect(plugin.detectBibliographyManualEdits().hasManualEdits).toBe(true)

      const bytesBeforeManualSwitch = doc().exportHwp()
      const blockedManual = plugin.switchCitationStyle('ieee', entries, { foreign: true })
      expect(blockedManual).toMatchObject({ ok: false, reason: 'manual_edits' })
      expect(steps()).toBe(6)
      expect(plugin.getCitationStyle()).toEqual({ ok: true, style: 'apa' })
      expect(bytesEqual(doc().exportHwp(), bytesBeforeManualSwitch)).toBe(true)

      // Insert a real footnote inside the bibliography line -> switchCitationStyle MUST roll back with has_objects (0 undo steps)!
      const fnInserted = JSON.parse(
        doc().insertFootnote(bibRange!.start.sec, firstBibEntryPara, 0),
      ) as {
        ok: boolean
      }
      expect(fnInserted.ok).toBe(true)
      expect(countFootnotes(doc())).toBe(1)

      const bytesBeforeFnSwitch = doc().exportHwp()
      const blockedFn = plugin.switchCitationStyle('ieee', entries, {
        foreign: true,
        allowOverwriteManual: true,
      })
      expect(blockedFn).toMatchObject({ ok: false, reason: 'has_objects' })
      expect(steps()).toBe(6)
      expect(countFootnotes(doc())).toBe(1)
      expect(plugin.getCitationStyle()).toEqual({ ok: true, style: 'apa' })
      expect(bytesEqual(doc().exportHwp(), bytesBeforeFnSwitch)).toBe(true)
    } finally {
      doc().free()
    }
  })

  it('BLOCKER object protection: rolls back refreshBibliographyBlock and refreshAllStale with has_objects, 0 undo steps, and exact bytes when a footnote sits inside the bibliography range', () => {
    const entries = makeEntries()
    const { plugin, doc, steps } = openHost(makeDoc(['첫 번째 문단입니다.', '두 번째 문단입니다.']))
    try {
      expect(
        plugin.insertCitation({
          entries,
          key: 'kim2024',
          place: { sec: 0, para: 0, offset: doc().getParagraphLength(0, 0) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })

      const bib = plugin.insertBibliographyBlock(entries, { foreign: true })
      expect(bib.ok).toBe(true)
      if (!bib.ok) return

      // Add a second citation so the bibliography block is genuinely stale.
      expect(
        plugin.insertCitation({
          entries,
          key: 'lee2023',
          place: { sec: 0, para: 1, offset: doc().getParagraphLength(0, 1) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })

      const staleCheck = plugin.checkStaleItems({ bibEntries: entries })
      expect(staleCheck.stale).toBe(true)
      expect(staleCheck.items.some((item) => item.id === 'bibliography')).toBe(true)

      // Insert a real footnote inside the first bibliography entry line.
      const bibEntryPara = bib.startPara + 1
      const fnRes = JSON.parse(doc().insertFootnote(bib.sec, bibEntryPara, 0)) as { ok: boolean }
      expect(fnRes.ok).toBe(true)
      expect(countFootnotes(doc())).toBe(1)

      const stepsBefore = steps()
      const bytesBefore = doc().exportHwp()

      // 1) refreshBibliographyBlock MUST refuse with has_objects, keep footnote === 1, preserve exact bytes, 0 undo steps.
      const refusedBib = plugin.refreshBibliographyBlock(entries, {
        foreign: true,
        allowOverwriteManual: true,
      })
      expect(refusedBib).toMatchObject({ ok: false, reason: 'has_objects' })
      expect(countFootnotes(doc())).toBe(1)
      expect(steps()).toBe(stepsBefore)
      expect(bytesEqual(doc().exportHwp(), bytesBefore)).toBe(true)

      // 2) refreshAllStale MUST refuse with has_objects & refreshed: 0, keep footnote === 1, preserve exact bytes, 0 undo steps.
      const refusedAll = plugin.refreshAllStale({
        bibEntries: entries,
        allowOverwriteManual: true,
      })
      expect(refusedAll).toMatchObject({
        ok: false,
        reason: 'has_objects',
        refreshed: 0,
      })
      expect(countFootnotes(doc())).toBe(1)
      expect(steps()).toBe(stepsBefore)
      expect(bytesEqual(doc().exportHwp(), bytesBefore)).toBe(true)
    } finally {
      doc().free()
    }
  })

  it('protects user memos inside a bibliography range on both human (foreign: true) and AI paths unless explicitly approved', () => {
    const entries = makeEntries()
    const { plugin, doc, steps } = openHost(makeDoc(['서론 문단입니다.', '본론 문단입니다.']))
    try {
      expect(
        plugin.insertCitation({
          entries,
          key: 'kim2024',
          place: { sec: 0, para: 0, offset: doc().getParagraphLength(0, 0) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })
      const bib = plugin.insertBibliographyBlock(entries, { foreign: true })
      expect(bib.ok).toBe(true)
      if (!bib.ok) return

      // Attach a user memo onto the bibliography entry paragraph.
      const bibEntryPara = bib.startPara + 1
      const memoRes = plugin.insertMemo(
        {
          place: 'body',
          sectionIndex: bib.sec,
          paraIndex: bibEntryPara,
          startCharIdx: 0,
          endCharIdx: 2,
          path: null,
        },
        'Tester',
        '보존할 메모',
      )
      expect(memoRes.ok).toBe(true)
      expect(plugin.listMemos().count).toBe(1)

      // Add a second citation so bibliography refresh would rewrite the block.
      expect(
        plugin.insertCitation({
          entries,
          key: 'lee2023',
          place: { sec: 0, para: 1, offset: doc().getParagraphLength(0, 1) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })

      const stepsBefore = steps()
      const bytesBefore = doc().exportHwp()

      // Human UI path (foreign: true) without allowMemoRemoval MUST roll back with memo_removal_requires_approval.
      const blockedHuman = plugin.refreshBibliographyBlock(entries, {
        foreign: true,
        allowOverwriteManual: true,
      })
      expect(blockedHuman).toMatchObject({
        ok: false,
        reason: 'memo_removal_requires_approval',
        count: 1,
      })
      expect(steps()).toBe(stepsBefore)
      expect(plugin.listMemos().count).toBe(1)
      expect(bytesEqual(doc().exportHwp(), bytesBefore)).toBe(true)

      // Explicit approval allows refresh in 1 undo step.
      const approved = plugin.refreshBibliographyBlock(entries, {
        foreign: true,
        allowOverwriteManual: true,
        allowMemoRemoval: true,
      })
      expect(approved.ok).toBe(true)
      expect(steps()).toBe(stepsBefore + 1)
    } finally {
      doc().free()
    }
  })

  it('rewrites renamed citation keys in 1 undo step and updates marks and bibliography metadata', () => {
    const entries = makeEntries()
    const { plugin, doc, steps } = openHost(makeDoc(['본문 인용 테스트 문장입니다.']))
    try {
      expect(
        plugin.insertCitation({
          entries,
          key: 'kim2024',
          place: { sec: 0, para: 0, offset: doc().getParagraphLength(0, 0) },
          foreign: true,
        }),
      ).toMatchObject({ ok: true })
      expect(plugin.insertBibliographyBlock(entries, { foreign: true })).toMatchObject({ ok: true })
      expect(steps()).toBe(2)

      const renamed = plugin.rewriteCitationKeys({ kim2024: 'kim2024revised' }, entries, {
        foreign: true,
      })
      expect(renamed).toEqual({ ok: true, updated: 1 })
      expect(steps()).toBe(3)

      const marks = plugin.listCitationMarks().marks
      expect(marks).toHaveLength(1)
      expect(marks[0]?.keys).toEqual(['kim2024revised'])
    } finally {
      doc().free()
    }
  })

  it('runs auditCitations, detectUnmarkedBibliography, findPatternCitations, setCitationStyle, and highlightBibliographyRange', () => {
    const entries = makeEntries()
    const mockCursor: MockCursor = {
      position: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
    }
    const { plugin, doc, steps } = openHost(
      makeDoc([
        '선행 연구에 따르면 (Smith, 2022) 모델 성능이 향상된다.',
        '참고문헌',
        '이영희. (2023). 딥러닝 기반 텍스트 요약 연구. 한국컴퓨터정보학회논문지, 28(2), 45-58.',
      ]),
      mockCursor,
    )
    try {
      // Detect unmarked bibliography range read-only.
      const unmarked = plugin.detectUnmarkedBibliography()
      expect(unmarked.found).toBe(true)
      if (!unmarked.found) return
      expect(unmarked.range).toEqual({ sec: 0, startPara: 1, endPara: 2 })
      expect(unmarked.lines).toHaveLength(1)
      expect(steps()).toBe(0)

      // Highlight range moves editor selection across startPara..endPara.
      const highlighted = plugin.highlightBibliographyRange(unmarked.range)
      expect(highlighted).toEqual({ ok: true })
      expect(mockCursor.selectedRange).toBeDefined()

      // Find unmarked pattern citations read-only.
      const patterns = plugin.findPatternCitations(entries)
      expect(patterns.ok).toBe(true)
      expect(patterns.citations.some((c) => c.text.includes('Smith, 2022'))).toBe(true)

      // Audit detects missing_from_bibliography (smith2022) and uncited_in_bibliography (lee2023).
      const audit = plugin.auditCitations(entries)
      expect(audit.ok).toBe(true)
      expect(audit.counts.missing_from_bibliography).toBeGreaterThanOrEqual(1)
      expect(audit.counts.uncited_in_bibliography).toBeGreaterThanOrEqual(1)

      // setCitationStyle persists style in 1 undo step.
      const setRes = plugin.setCitationStyle('mla', { foreign: true })
      expect(setRes).toEqual({ ok: true, style: 'mla' })
      expect(plugin.getCitationStyle()).toEqual({ ok: true, style: 'mla' })
      expect(steps()).toBe(1)

      // Verify body text was untouched by read-only checks.
      expect(bodyLines(doc())[1]).toBe('참고문헌')
    } finally {
      doc().free()
    }
  })

  it('registers workpane menu (with and without bibliography label) and bibliography Tool menu cleanly', () => {
    const { plugin, doc, commands, menuItems } = openHost(makeDoc(['문서']))
    try {
      // 1. installWorkpaneMenu without bibliography label registers only outline & find.
      expect(
        plugin.installWorkpaneMenu({
          outline: '작업창 › 개요',
          find: '작업창 › 찾기',
        }),
      ).toEqual({ ok: true })
      expect(menuItems.filter((m) => m.menuId === 'view').map((m) => m.commandId)).toEqual(
        WORKPANE_MENU_ITEMS.map((item) => item.id),
      )

      // 2. installWorkpaneMenu with bibliography label also registers bibliography tab command.
      menuItems.length = 0
      expect(
        installWorkpaneMenu(
          {
            automation: {
              registerCommand: (def) => {
                commands.set(def.id, def)
              },
              unregisterCommand: (id) => {
                commands.delete(id)
              },
              addMenuItem: (item) => {
                menuItems.push(item)
              },
            },
          },
          {
            outline: '작업창 › 개요',
            find: '작업창 › 찾기',
            bibliography: '작업창 › 참고문헌',
          },
        ),
      ).toEqual({ ok: true })
      expect(menuItems.filter((m) => m.menuId === 'view').map((m) => m.commandId)).toEqual([
        ...WORKPANE_MENU_ITEMS.map((item) => item.id),
        WORKPANE_BIBLIOGRAPHY_MENU_ITEM.id,
      ])

      const workpaneEvents: unknown[] = []
      const onWorkpane = (e: Event) => workpaneEvents.push((e as CustomEvent).detail)
      globalThis.addEventListener?.(WORKPANE_COMMAND_EVENT, onWorkpane)
      try {
        commands.get(WORKPANE_BIBLIOGRAPHY_MENU_ITEM.id)!.execute()
      } finally {
        globalThis.removeEventListener?.(WORKPANE_COMMAND_EVENT, onWorkpane)
      }
      if (typeof globalThis.addEventListener === 'function') {
        expect(workpaneEvents).toEqual([{ action: 'open', tab: 'bibliography', focus: true }])
      }

      // 3. installBibliographyMenu registers all 4 Tool-menu commands idempotently.
      menuItems.length = 0
      const bibLabels = {
        insertCitation: '참고문헌 › 인용 넣기',
        insertBibliography: '참고문헌 › 참고문헌 넣기',
        refreshBibliography: '참고문헌 › 참고문헌 새로고침',
        openTab: '참고문헌 › 참고문헌 패널 열기',
      }
      expect(plugin.installBibliographyMenu(bibLabels)).toEqual({ ok: true })
      expect(menuItems.filter((m) => m.menuId === 'tool').map((m) => m.commandId)).toEqual(
        BIBLIOGRAPHY_MENU_ITEMS.map((item) => item.id),
      )

      const bibEvents: unknown[] = []
      const onBib = (e: Event) => bibEvents.push((e as CustomEvent).detail)
      globalThis.addEventListener?.(BIBLIOGRAPHY_COMMAND_EVENT, onBib)
      try {
        for (const item of BIBLIOGRAPHY_MENU_ITEMS) {
          commands.get(item.id)!.execute()
        }
      } finally {
        globalThis.removeEventListener?.(BIBLIOGRAPHY_COMMAND_EVENT, onBib)
      }
      if (typeof globalThis.addEventListener === 'function') {
        expect(bibEvents).toEqual(BIBLIOGRAPHY_MENU_ITEMS.map((item) => ({ action: item.action })))
      }

      // 4. Rejects empty labels and returns ok: false when automation is absent.
      expect(() => installBibliographyMenu({}, { ...bibLabels, insertCitation: '' })).toThrow(
        /labels\.insertCitation/,
      )
      expect(installBibliographyMenu({}, bibLabels)).toEqual({ ok: false })
    } finally {
      doc().free()
    }
  })
})
