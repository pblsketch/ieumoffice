/**
 * Staleness checker registry, non-mutating submission copy builder (HWP & HWPX),
 * and submission i18n shard tests against the real `@rhwp/core` engine.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { LANGS } from '@genoffice/i18n'
import {
  MARK_PREFIXES,
  SUBMISSION_STRIP_PREFIXES,
  addRangeMark,
  isAppTocHyperlinkField,
  listMarks,
  writeDocSetting,
} from '../studio-plugin/doc-marks.mjs'
import { insertTocBlock } from '../studio-plugin/toc.mjs'
import { addIndexMark, buildIndexBlock } from '../studio-plugin/index-marks.mjs'
import {
  buildSubmissionCopy,
  createDefaultStalenessRegistry,
  createStalenessRegistry,
  defaultStalenessRegistry,
  stripSubmissionMarksInPlace,
  type StalenessChecker,
} from '../studio-plugin/staleness.mjs'
import { submissionStrings } from '../src/renderer/i18n/submission'
import { tocDialogLabelsFor } from '../src/renderer/i18n/toc'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import { TOC_INDEX_MENU_ITEMS } from '../studio-plugin/toc-dialogs.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface StyleEntry {
  id: number
  name: string
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function makeRichDocument(): HwpDocument {
  const doc = makeDoc([
    '서론',
    '인공지능과 기계학습의 기초를 다룬다.',
    '연구 방법',
    '표 1 실험 데이터 요약',
    '데이터 분석 절차를 설명한다.',
    '결론',
    '최종 요약 문단이다.',
  ])
  doc.applyStyle(0, 0, styleIdByName(doc, '개요 1'))
  doc.applyStyle(0, 2, styleIdByName(doc, '개요 1'))
  doc.applyStyle(0, 5, styleIdByName(doc, '개요 1'))

  const tocRes = insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 3, links: true })
  expect(tocRes.ok).toBe(true)

  const tableTocRes = insertTocBlock(
    doc,
    { sec: 0, para: 0 },
    { kind: 'table', title: '표 차례', links: true },
  )
  expect(tableTocRes.ok).toBe(true)

  // Add index marks on body paragraphs after the TOC blocks.
  const paraCount = doc.getParagraphCount(0)
  const introBodyPara = paraCount - 6
  const methodBodyPara = paraCount - 3
  expect(
    addIndexMark(doc, { sec: 0, para: introBodyPara, offset: 0 }, { term: '인공지능' }).ok,
  ).toBe(true)
  expect(
    addIndexMark(doc, { sec: 0, para: methodBodyPara, offset: 0 }, { term: '데이터 분석' }).ok,
  ).toBe(true)

  const idxRes = buildIndexBlock(
    doc,
    { sec: 0, para: doc.getParagraphCount(0) - 1 },
    { where: 'after', columns: 1 },
  )
  expect(idxRes.ok).toBe(true)

  return doc
}

describe('staleness checker registry', () => {
  it('pre-registers toc, index, and bibliography checkers and keeps check() strictly read-only', () => {
    expect(defaultStalenessRegistry.listCheckers()).toEqual(['toc', 'index', 'bibliography'])

    const doc = makeRichDocument()
    try {
      const hwpBefore = doc.exportHwp()
      const hwpxBefore = doc.exportHwpx()

      const report = defaultStalenessRegistry.check(doc)
      expect(report.stale).toBe(false)
      expect(report.items).toEqual([])

      expect(bytesEqual(doc.exportHwp(), hwpBefore)).toBe(true)
      expect(bytesEqual(doc.exportHwpx(), hwpxBefore)).toBe(true)
    } finally {
      doc.free()
    }
  })

  it('detects stale TOC and index after document edits and refreshes both cleanly', () => {
    const doc = makeRichDocument()
    try {
      // Rename the last heading and add a new index mark to make both TOC and index stale.
      const totalParas = doc.getParagraphCount(0)
      let conclusionPara = -1
      for (let p = 0; p < totalParas; p++) {
        const len = doc.getParagraphLength(0, p)
        if (len > 0 && doc.getTextRange(0, p, 0, len) === '결론') {
          conclusionPara = p
          break
        }
      }
      expect(conclusionPara).toBeGreaterThan(-1)
      doc.insertText(0, conclusionPara, doc.getParagraphLength(0, conclusionPara), ' 및 제언')

      const added = addIndexMark(doc, { sec: 0, para: conclusionPara, offset: 0 }, { term: '제언' })
      expect(added.ok).toBe(true)

      const staleReport = defaultStalenessRegistry.check(doc)
      expect(staleReport.stale).toBe(true)
      const ids = staleReport.items.map((item) => item.id)
      expect(ids).toContain('toc:body')
      expect(ids).toContain('index')

      const refreshed = defaultStalenessRegistry.refreshAll(doc)
      expect(refreshed.ok).toBe(true)
      expect(refreshed.refreshed).toBeGreaterThanOrEqual(2)
      expect(refreshed.manualEdits).toEqual([])

      const afterRefresh = defaultStalenessRegistry.check(doc)
      expect(afterRefresh.stale).toBe(false)
      expect(afterRefresh.items).toEqual([])
    } finally {
      doc.free()
    }
  })

  it('reports manual edits without overwriting unless allowOverwriteManual is true', () => {
    const doc = makeRichDocument()
    try {
      // Edit a line inside the body TOC range so it has both a manual edit and stale entries.
      const tocMarks = listMarks(doc, [MARK_PREFIXES.toc])
      const bodyStart = tocMarks.find((m) => m.name === '차례:본문:시작')
      expect(bodyStart).toBeDefined()
      const tocEntryPara = bodyStart!.para + 1
      doc.insertText(0, tocEntryPara, 0, '[수동] ')

      // Read-only check() pre-reports manual edits before calling refreshAll.
      const hwpBeforeCheck = doc.exportHwp()
      const preCheck = defaultStalenessRegistry.check(doc)
      expect(preCheck.stale).toBe(true)
      expect(preCheck.manualEdits.some((m) => m.id === 'toc:body')).toBe(true)
      const tocItem = preCheck.items.find((i) => i.id === 'toc:body')
      expect(tocItem?.hasManualEdits).toBe(true)
      expect((tocItem?.modifiedLines ?? []).length).toBeGreaterThan(0)
      expect(bytesEqual(doc.exportHwp(), hwpBeforeCheck)).toBe(true)

      const blocked = defaultStalenessRegistry.refreshAll(doc)
      expect(blocked.ok).toBe(false)
      expect(blocked.reason).toBe('manual_edits')
      expect(blocked.refreshed).toBe(0)
      expect(blocked.manualEdits.length).toBeGreaterThan(0)
      expect(blocked.manualEdits.some((m) => m.id === 'toc:body')).toBe(true)

      // Manual edit is still intact before explicit overwrite permission.
      const len = doc.getParagraphLength(0, tocEntryPara)
      expect(doc.getTextRange(0, tocEntryPara, 0, len)).toContain('[수동]')

      const forced = defaultStalenessRegistry.refreshAll(doc, { allowOverwriteManual: true })
      expect(forced.ok).toBe(true)
      expect(forced.manualEdits).toEqual([])
      expect(defaultStalenessRegistry.check(doc).stale).toBe(false)
    } finally {
      doc.free()
    }
  })

  it('converges multi-pass page shifts in one refreshAll call and fails atomically when any checker fails', () => {
    // Build a document with a body TOC at the top and an index block at the end.
    const doc = makeDoc(['초기 제목', '색인 대상 본문 문단'])
    try {
      const h1 = styleIdByName(doc, '개요 1')
      doc.applyStyle(0, 0, h1)
      expect(insertTocBlock(doc, { sec: 0, para: 0 }, { maxLevel: 3 }).ok).toBe(true)

      const bodyPara = doc.getParagraphCount(0) - 1
      expect(
        addIndexMark(doc, { sec: 0, para: bodyPara, offset: 0 }, { term: '대상용어' }).ok,
      ).toBe(true)
      expect(
        buildIndexBlock(doc, { sec: 0, para: bodyPara }, { where: 'after', columns: 1 }).ok,
      ).toBe(true)
      expect(defaultStalenessRegistry.check(doc).stale).toBe(false)

      // Add 45 headings before the indexed paragraph so refreshing the TOC expands it onto
      // page 2 and shifts the indexed paragraph onto a later page.
      let insertAt = bodyPara
      for (let i = 1; i <= 45; i++) {
        doc.insertParagraph(0, insertAt)
        doc.insertText(0, insertAt, 0, `추가 장 ${i}`)
        doc.applyStyle(0, insertAt, h1)
        insertAt += 1
      }

      const refreshed = defaultStalenessRegistry.refreshAll(doc)
      expect(refreshed.ok).toBe(true)
      expect(refreshed.refreshed).toBeGreaterThanOrEqual(2)
      // Immediately converged after one refreshAll call!
      expect(defaultStalenessRegistry.check(doc).stale).toBe(false)
    } finally {
      doc.free()
    }

    // Atomic failure: if any checker fails during refreshAll, stop immediately and return ok: false, refreshed: 0.
    const registry = createStalenessRegistry()
    let thirdCalled = false
    registry.register({
      id: 'first',
      check: () => ({
        stale: true,
        items: [{ id: 'first', kind: 'first', reason: 'entries_changed' }],
      }),
      refresh: () => ({ ok: true, refreshed: 1 }),
    })
    registry.register({
      id: 'second',
      check: () => ({
        stale: true,
        items: [{ id: 'second', kind: 'second', reason: 'entries_changed' }],
      }),
      refresh: () => ({ ok: false, refreshed: 0, failed: 'has_objects' }),
    })
    registry.register({
      id: 'third',
      check: () => ({
        stale: true,
        items: [{ id: 'third', kind: 'third', reason: 'entries_changed' }],
      }),
      refresh: () => {
        thirdCalled = true
        return { ok: true, refreshed: 1 }
      },
    })

    const atomicFail = registry.refreshAll({})
    expect(atomicFail.ok).toBe(false)
    expect(atomicFail.reason).toBe('refresh_failed')
    expect(atomicFail.refreshed).toBe(0)
    expect(atomicFail.failed).toEqual([{ id: 'second', error: 'has_objects' }])
    expect(thirdCalled).toBe(false)
  })

  it('supports registering and unregistering custom checkers (e.g. bibliography)', () => {
    const registry = createDefaultStalenessRegistry()
    let bibStale = true
    const bibChecker: StalenessChecker = {
      id: 'bibliography',
      check: () =>
        bibStale
          ? {
              stale: true,
              items: [{ id: 'bibliography', kind: 'bibliography', reason: 'entries_changed' }],
            }
          : { stale: false, items: [] },
      refresh: () => {
        bibStale = false
        return { ok: true, refreshed: 1 }
      },
    }

    registry.register(bibChecker)
    expect(registry.listCheckers()).toEqual(['toc', 'index', 'bibliography'])

    const doc = makeDoc(['본문'])
    try {
      const checkBefore = registry.check(doc)
      expect(checkBefore.stale).toBe(true)
      expect(checkBefore.items.map((i) => i.id)).toEqual(['bibliography'])

      const refreshed = registry.refreshAll(doc)
      expect(refreshed.ok).toBe(true)
      expect(refreshed.refreshed).toBe(1)

      expect(registry.check(doc).stale).toBe(false)
      expect(registry.unregister('bibliography')).toBe(true)
      expect(registry.listCheckers()).toEqual(['toc', 'index'])
    } finally {
      doc.free()
    }
  })

  it('isolates failing checkers during check() without blocking other checkers', () => {
    const registry = createStalenessRegistry()
    registry.register({
      id: 'broken',
      check: () => {
        throw new Error('boom')
      },
      refresh: () => ({ ok: false, refreshed: 0 }),
    })
    registry.register({
      id: 'healthy',
      check: () => ({
        stale: true,
        items: [{ id: 'healthy:1', kind: 'custom', reason: 'entries_changed' }],
      }),
      refresh: () => ({ ok: true, refreshed: 1 }),
    })

    const res = registry.check({})
    expect(res.stale).toBe(true)
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.id).toBe('healthy:1')
    expect(res.errors).toEqual([{ id: 'broken', error: 'boom' }])
  })
})

describe('buildSubmissionCopy (HWP and HWPX)', () => {
  it('strips internal marks on an isolated clone while keeping TOC/heading marks and links intact, and leaves live doc byte-identical', () => {
    const doc = makeRichDocument()
    try {
      // Add citation, bibliography, and custom setting marks as well so every stripped prefix is covered.
      const lastPara = doc.getParagraphCount(0) - 1
      const lastLen = doc.getParagraphLength(0, lastPara)
      expect(
        addRangeMark(
          doc,
          MARK_PREFIXES.citation,
          'cite1',
          { sec: 0, para: lastPara, offset: 0 },
          { sec: 0, para: lastPara, offset: lastLen },
        ).ok,
      ).toBe(true)
      expect(
        addRangeMark(
          doc,
          MARK_PREFIXES.bibliography,
          'default',
          { sec: 0, para: lastPara, offset: 0 },
          { sec: 0, para: lastPara, offset: lastLen },
        ).ok,
      ).toBe(true)
      expect(writeDocSetting(doc, '사용자설정', { style: 'ieee' }).ok).toBe(true)

      // Confirm live doc currently contains all mark categories.
      expect(listMarks(doc, SUBMISSION_STRIP_PREFIXES).length).toBeGreaterThan(0)
      expect(listMarks(doc, [MARK_PREFIXES.toc]).length).toBeGreaterThan(0)
      expect(listMarks(doc, [MARK_PREFIXES.heading]).length).toBeGreaterThan(0)

      const liveHwpBefore = doc.exportHwp()
      const liveHwpxBefore = doc.exportHwpx()

      for (const format of ['hwpx', 'hwp'] as const) {
        const result = buildSubmissionCopy(doc, format, HwpDocument)
        expect(result.ok).toBe(true)
        if (!result.ok) continue
        expect(result.format).toBe(format)
        expect(result.bytes).toBeInstanceOf(Uint8Array)
        expect(result.bytes.length).toBeGreaterThan(0)
        expect(result.removed).toBeGreaterThan(0)

        if (format === 'hwp') {
          expect(result.verify).toBeDefined()
          expect(result.verify?.recovered).toBe(true)
          expect(result.verify?.pageCountAfter).toBe(result.verify?.pageCountBefore)
        } else {
          expect(result.verify).toBeUndefined()
        }

        const reloaded = new HwpDocument(result.bytes)
        try {
          // Zero stripped marks remain in the submission copy.
          expect(listMarks(reloaded, SUBMISSION_STRIP_PREFIXES)).toEqual([])

          // TOC range marks, heading anchors, and TOC hyperlinks remain intact.
          expect(listMarks(reloaded, [MARK_PREFIXES.toc]).length).toBeGreaterThan(0)
          expect(listMarks(reloaded, [MARK_PREFIXES.heading]).length).toBeGreaterThan(0)

          const fields = JSON.parse(reloaded.getFieldList()) as Array<{
            fieldType?: string
            command?: string
          }>
          const tocLinks = fields.filter((f) => isAppTocHyperlinkField(f))
          expect(tocLinks.length).toBeGreaterThan(0)
        } finally {
          reloaded.free()
        }
      }

      // Live doc exported bytes remain byte-identical before and after both submission exports.
      expect(bytesEqual(doc.exportHwp(), liveHwpBefore)).toBe(true)
      expect(bytesEqual(doc.exportHwpx(), liveHwpxBefore)).toBe(true)
    } finally {
      doc.free()
    }
  })

  it('stripSubmissionMarksInPlace removes only SUBMISSION_STRIP_PREFIXES', () => {
    const doc = makeRichDocument()
    try {
      const beforeStripped = listMarks(doc, SUBMISSION_STRIP_PREFIXES).length
      const beforeKept = listMarks(doc, [MARK_PREFIXES.toc, MARK_PREFIXES.heading]).length
      expect(beforeStripped).toBeGreaterThan(0)
      expect(beforeKept).toBeGreaterThan(0)

      const res = stripSubmissionMarksInPlace(doc)
      expect(res.removed).toBe(beforeStripped)
      expect(listMarks(doc, SUBMISSION_STRIP_PREFIXES)).toEqual([])
      expect(listMarks(doc, [MARK_PREFIXES.toc, MARK_PREFIXES.heading]).length).toBe(beforeKept)
    } finally {
      doc.free()
    }
  })

  it('refuses submission copy with strip_failed when any mark fails to strip on the clone', () => {
    const doc = makeRichDocument()
    try {
      class FailingStripDoc {
        inner: HwpDocument
        constructor(bytes: Uint8Array) {
          this.inner = new HwpDocument(bytes)
        }
        getSectionCount() {
          return this.inner.getSectionCount()
        }
        getParagraphCount(sec: number) {
          return this.inner.getParagraphCount(sec)
        }
        getBookmarks() {
          return this.inner.getBookmarks()
        }
        addBookmark(sec: number, para: number, offset: number, name: string) {
          return this.inner.addBookmark(sec, para, offset, name)
        }
        removeBookmark() {
          return JSON.stringify({ ok: false, error: 'simulated bookmark removal failure' })
        }
        exportHwp() {
          return this.inner.exportHwp()
        }
        exportHwpx() {
          return this.inner.exportHwpx()
        }
        pageCount() {
          return this.inner.pageCount()
        }
        free() {
          this.inner.free()
        }
      }

      const result = buildSubmissionCopy(
        doc,
        'hwpx',
        FailingStripDoc as unknown as typeof HwpDocument,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('strip_failed')
        expect(result.format).toBe('hwpx')
        expect(result.failed.length).toBeGreaterThan(0)
        expect('bytes' in result).toBe(false)
      }
    } finally {
      doc.free()
    }
  })

  it('measures HWP verification pageCountBefore on the pre-strip portable clone rather than mismatched live canvas metrics', () => {
    const doc = makeRichDocument()
    try {
      // Simulate live editor having different canvas-metrics pagination than portable default metrics.
      const liveProxy = Object.create(doc) as HwpDocument
      liveProxy.pageCount = () => 99

      const result = buildSubmissionCopy(liveProxy, 'hwp', HwpDocument)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.verify).toBeDefined()
      expect(result.verify?.recovered).toBe(true)
      expect(result.verify?.pageCountBefore).toBe(result.verify?.pageCountAfter)
      expect(result.verify?.pageCountBefore).not.toBe(99)
    } finally {
      doc.free()
    }
  })
})

describe('submission i18n shard', () => {
  it('covers every UI language with preserved placeholders and translated copy', () => {
    expect(Object.keys(submissionStrings).sort()).toEqual([...LANGS].sort())

    const requiredPlaceholders = {
      staleManualConfirmBody: ['{items}'],
      staleRefreshDone: ['{count}'],
      staleRefreshFailed: ['{error}'],
      submissionSaved: ['{name}'],
      submissionSavedTailsLost: ['{name}'],
      submissionFailedVerify: ['{before}', '{after}'],
      submissionFailedExport: ['{error}'],
      submissionFailedWrite: ['{error}'],
    } as const

    for (const lang of LANGS) {
      for (const [key, tokens] of Object.entries(requiredPlaceholders)) {
        const value = submissionStrings[lang][key as keyof typeof requiredPlaceholders]
        for (const token of tokens) {
          expect(value, `${lang}.${key}`).toContain(token)
        }
      }
      if (lang !== 'en') {
        expect(submissionStrings[lang].staleDialogTitle, lang).not.toBe(
          submissionStrings.en.staleDialogTitle,
        )
        expect(submissionStrings[lang].submissionMenuLabel, lang).not.toBe(
          submissionStrings.en.submissionMenuLabel,
        )
      }
    }
  })
})

function openPluginHost(start: HwpDocument) {
  let doc = start
  const history: Uint8Array[] = []
  const commands = new Map<
    string,
    { id: string; label: string; execute: (...args: unknown[]) => void }
  >()
  const toolMenu: string[] = []
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
        execute: (...args: unknown[]) => void
      }) => {
        commands.set(cmd.id, cmd)
      },
      unregisterCommand: (id: string) => {
        commands.delete(id)
      },
      addMenuItem: (spec: { menuId: string; commandId: string }) => {
        if (spec.menuId === 'tool') toolMenu.push(spec.commandId)
      },
      execute: () => ({ ok: false }),
    },
  } as unknown as AgentPluginHost

  return {
    plugin: agentPlugin.activate(host),
    doc: () => doc,
    steps: () => history.length,
    commands,
    toolMenu,
  }
}

describe('agent-plugin Bundle 2 wiring (checkStaleItems, refreshAllStale, exportSubmissionCopy, installTocIndexMenu)', () => {
  it('checks staleness read-only and refreshes both TOC and index in exactly 1 undo step', () => {
    const start = makeRichDocument()
    const { plugin, doc, steps } = openPluginHost(start)
    try {
      // Fresh document is not stale and refreshAllStale creates 0 undo steps.
      expect(plugin.checkStaleItems().stale).toBe(false)
      const noop = plugin.refreshAllStale()
      expect(noop.ok).toBe(true)
      expect(noop.refreshed).toBe(0)
      expect(steps()).toBe(0)

      // Edit a heading and add a new index mark to make both TOC and index stale.
      const totalParas = doc().getParagraphCount(0)
      let conclusionPara = -1
      for (let p = 0; p < totalParas; p++) {
        const len = doc().getParagraphLength(0, p)
        if (len > 0 && doc().getTextRange(0, p, 0, len) === '결론') {
          conclusionPara = p
          break
        }
      }
      expect(conclusionPara).toBeGreaterThan(-1)
      doc().insertText(0, conclusionPara, doc().getParagraphLength(0, conclusionPara), ' 보완')
      expect(
        addIndexMark(doc(), { sec: 0, para: conclusionPara, offset: 0 }, { term: '보완' }).ok,
      ).toBe(true)

      const hwpBeforeCheck = doc().exportHwp()
      const stale = plugin.checkStaleItems()
      expect(stale.stale).toBe(true)
      expect(stale.items.map((i) => i.id)).toEqual(expect.arrayContaining(['toc:body', 'index']))
      expect(bytesEqual(doc().exportHwp(), hwpBeforeCheck)).toBe(true)
      expect(steps()).toBe(0)

      // Refresh both stale blocks in ONE undo step.
      const refreshed = plugin.refreshAllStale()
      expect(refreshed.ok).toBe(true)
      expect(refreshed.refreshed).toBeGreaterThanOrEqual(2)
      expect(steps()).toBe(1)
      expect(plugin.checkStaleItems().stale).toBe(false)
    } finally {
      doc().free()
    }
  })

  it('rolls back refreshAllStale without creating an undo step when blocked by manual_edits', () => {
    const start = makeRichDocument()
    const { plugin, doc, steps } = openPluginHost(start)
    try {
      const tocMarks = listMarks(doc(), [MARK_PREFIXES.toc])
      const bodyStart = tocMarks.find((m) => m.name === '차례:본문:시작')
      expect(bodyStart).toBeDefined()
      doc().insertText(0, bodyStart!.para + 1, 0, '[편집] ')

      const blocked = plugin.refreshAllStale()
      expect(blocked.ok).toBe(false)
      expect(blocked.reason).toBe('manual_edits')
      expect(blocked.refreshed).toBe(0)
      expect(steps()).toBe(0)

      const forced = plugin.refreshAllStale({ allowOverwriteManual: true })
      expect(forced.ok).toBe(true)
      expect(forced.refreshed).toBeGreaterThanOrEqual(1)
      expect(steps()).toBe(1)
    } finally {
      doc().free()
    }
  })

  it('rolls back refreshAllStale atomically with has_objects and 0 undo steps when a footnote sits inside a TOC line', () => {
    const start = makeRichDocument()
    const { plugin, doc, steps } = openPluginHost(start)
    try {
      // Make both TOC and index stale, and place a real footnote inside the body TOC line.
      const totalParas = doc().getParagraphCount(0)
      let conclusionPara = -1
      for (let p = 0; p < totalParas; p++) {
        const len = doc().getParagraphLength(0, p)
        if (len > 0 && doc().getTextRange(0, p, 0, len) === '결론') {
          conclusionPara = p
          break
        }
      }
      expect(conclusionPara).toBeGreaterThan(-1)
      doc().insertText(0, conclusionPara, doc().getParagraphLength(0, conclusionPara), ' 보완')
      expect(
        addIndexMark(doc(), { sec: 0, para: conclusionPara, offset: 0 }, { term: '보완' }).ok,
      ).toBe(true)

      const tocMarks = listMarks(doc(), [MARK_PREFIXES.toc])
      const bodyStart = tocMarks.find((m) => m.name === '차례:본문:시작')
      expect(bodyStart).toBeDefined()
      const fnRes = JSON.parse(doc().insertFootnote(0, bodyStart!.para + 1, 0)) as { ok: boolean }
      expect(fnRes.ok).toBe(true)

      const countFootnotes = (d: HwpDocument) =>
        (JSON.parse(d.getControls()) as Array<{ ctrlId: string }>).filter((c) => c.ctrlId === 'fn')
          .length
      expect(countFootnotes(doc())).toBe(1)

      const bytesBefore = doc().exportHwp()
      const blocked = plugin.refreshAllStale({ allowOverwriteManual: true })
      expect(blocked.ok).toBe(false)
      expect(blocked.reason).toBe('has_objects')
      expect(blocked.refreshed).toBe(0)
      expect(steps()).toBe(0)
      expect(countFootnotes(doc())).toBe(1)
      expect(bytesEqual(doc().exportHwp(), bytesBefore)).toBe(true)
    } finally {
      doc().free()
    }
  })

  it('exports a clean submission copy via exportSubmissionCopy without mutating live doc or undo stack', () => {
    const start = makeRichDocument()
    const { plugin, doc, steps } = openPluginHost(start)
    try {
      const liveHwp = doc().exportHwp()
      const liveHwpx = doc().exportHwpx()

      const hwpxCopy = plugin.exportSubmissionCopy('hwpx')
      expect(hwpxCopy.ok).toBe(true)
      if (!hwpxCopy.ok) return
      expect(hwpxCopy.format).toBe('hwpx')
      expect(hwpxCopy.removed).toBeGreaterThan(0)
      expect(steps()).toBe(0)

      const hwpCopy = plugin.exportSubmissionCopy('hwp')
      expect(hwpCopy.ok).toBe(true)
      if (!hwpCopy.ok) return
      expect(hwpCopy.format).toBe('hwp')
      expect(hwpCopy.removed).toBeGreaterThan(0)
      expect(hwpCopy.verify?.recovered).toBe(true)
      expect(hwpCopy.verify?.pageCountAfter).toBe(hwpCopy.verify?.pageCountBefore)
      expect(steps()).toBe(0)

      // Live document remains byte-identical.
      expect(bytesEqual(doc().exportHwp(), liveHwp)).toBe(true)
      expect(bytesEqual(doc().exportHwpx(), liveHwpx)).toBe(true)

      const reloaded = new HwpDocument(hwpxCopy.bytes)
      try {
        expect(listMarks(reloaded, SUBMISSION_STRIP_PREFIXES)).toEqual([])
        expect(listMarks(reloaded, [MARK_PREFIXES.toc]).length).toBeGreaterThan(0)
      } finally {
        reloaded.free()
      }
    } finally {
      doc().free()
    }
  })

  it('registers all 5 Tool menu items via installTocIndexMenu cleanly', () => {
    const start = makeDoc(['제목'])
    const { plugin, doc, commands, toolMenu } = openPluginHost(start)
    try {
      const res = plugin.installTocIndexMenu(tocDialogLabelsFor('ko'), {
        appStyleMap: { 제목1: 1 },
      })
      expect(res).toEqual({ ok: true })
      expect(toolMenu).toEqual(TOC_INDEX_MENU_ITEMS.map((item) => item.id))
      for (const item of TOC_INDEX_MENU_ITEMS) {
        expect(commands.has(item.id)).toBe(true)
      }
    } finally {
      doc().free()
    }
  })
})
