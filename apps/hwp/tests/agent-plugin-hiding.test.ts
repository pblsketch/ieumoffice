// @vitest-environment jsdom
/**
 * 민감정보 가리기 in the Hangul editor, against the real rhwp engine: a hidden span is a memo
 * `[<prefix>] <label>` on the words; everything the AI panel reads through aiCall has the
 * span as `{{label}}`, its finds do not see it, its edits may not touch it, and a document
 * whose spans cannot all be placed answers the AI nothing. The spans survive HWP and HWPX.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { buildHidingMemoText } from '@genoffice/agent-core/hiding-memo'
import { PRODUCT_NAME } from '@genoffice/i18n'
import {
  HIDING_COMMAND,
  HIDING_EVENT,
  agentPlugin,
  type AgentPluginHost,
} from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface Position {
  sectionIndex: number
  paragraphIndex: number
  charOffset: number
  parentParaIndex?: number
  controlIndex?: number
  cellIndex?: number
  cellParaIndex?: number
}

function blank(lines: string[]): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  lines.forEach((line, k) => {
    if (k > 0) doc.splitParagraph(0, k - 1, doc.getParagraphLength(0, k - 1))
    if (line) doc.insertText(0, k, 0, line)
  })
  return doc
}

const hidingText = (label: string) => buildHidingMemoText(label, 'ko')

/** A hidden span put in straight through the engine, as a file from elsewhere would hold it. */
const hideInBody = (doc: HwpDocument, para: number, start: number, end: number, label: string) =>
  JSON.parse(
    doc.insertMemo(
      0,
      para,
      start,
      end,
      JSON.stringify({ author: PRODUCT_NAME, text: hidingText(label) }),
    ),
  ) as { ok: true; id: number }

function openEditor(doc: HwpDocument) {
  document.body.innerHTML = '<div id="scroll-container"><div id="scroll-content"></div></div>'
  let current = doc
  const history: Uint8Array[] = []
  const listeners: (() => void)[] = []
  const commands = new Map<string, (services: unknown, params?: unknown) => unknown>()
  const registered = new Map<string, { canExecute?: (ctx: unknown) => boolean }>()
  const cursor = {
    position: null as Position | null,
    selection: null as { start: Position; end: Position } | null,
    header: false,
    isInCellSelectionMode: () => false,
    isInHeaderFooter: () => cursor.header,
    isInFootnote: () => false,
    isInPictureObjectSelection: () => false,
    isInTableObjectSelection: () => false,
    hasSelection: () => cursor.selection !== null,
    getSelectionOrdered: () => cursor.selection,
    getPosition: () => cursor.position,
  }
  const services = {
    getInputHandler: () => ({ cursor }),
    getViewportManager: () => ({ getZoom: () => 2 }),
  }
  const emit = () => listeners.forEach((listener) => listener())
  const host = {
    read: (fn: (d: never) => unknown) => fn(current as never),
    transaction: (_label: string, fn: (tx: never) => unknown) => {
      const before = current.exportHwp()
      try {
        const result = fn({ doc: () => current, deferPagination: () => {} } as never)
        history.push(before)
        emit()
        return result
      } catch (thrown) {
        current = new HwpDocument(before)
        throw thrown
      }
    },
    events: { on: (_name: string, handler: () => void) => listeners.push(handler) },
    automation: {
      registerCommand: (def: {
        id: string
        execute: (s: unknown, p?: unknown) => unknown
        canExecute?: (ctx: unknown) => boolean
      }) => {
        commands.set(def.id, def.execute)
        registered.set(def.id, def)
      },
      unregisterCommand: (id: string) => {
        commands.delete(id)
        registered.delete(id)
      },
      execute: (command: string, params?: unknown) => {
        if (command === 'edit:undo') {
          const before = history.pop()
          if (!before) return { ok: false }
          current = new HwpDocument(before)
          emit()
          return { ok: true }
        }
        const run = commands.get(command)
        return run ? run(services, params) : null
      },
    },
  } as unknown as AgentPluginHost
  const plugin = agentPlugin.activate(host)
  const select = (start: Position, end: Position) => {
    cursor.selection = { start, end }
  }
  return {
    plugin,
    ai: <T>(method: string, ...args: unknown[]) => plugin.aiCall(method as never, args) as T,
    doc: () => current,
    cursor,
    select,
    registered,
    run: (id: string) => commands.get(id)?.(services),
    steps: () => history.length,
  }
}

const body = (para: number, offset: number): Position => ({
  sectionIndex: 0,
  paragraphIndex: para,
  charOffset: offset,
})

afterEach(() => {
  agentPlugin.deactivate?.()
  document.body.innerHTML = ''
})

describe('hiding a selection', () => {
  it('puts one memo per paragraph, by the product, with the hiding text, in one undo step', () => {
    const doc = blank(['학생 홍길동 입니다', '주소 서울시 종로구', '끝'])
    const editor = openEditor(doc)
    // from the middle of the first paragraph to the middle of the second, blanks at the ends
    editor.select(body(0, 3), body(1, 2))

    const where = editor.plugin.hidingSelection()
    expect(where).toMatchObject({ ok: true })
    if (!where.ok) return
    expect(where.anchors).toEqual([
      expect.objectContaining({ sectionIndex: 0, paraIndex: 0, startCharIdx: 3, endCharIdx: 10 }),
      expect.objectContaining({ sectionIndex: 0, paraIndex: 1, startCharIdx: 0, endCharIdx: 2 }),
    ])

    const made = editor.plugin.hideRanges(where.anchors, PRODUCT_NAME, hidingText('학생'))
    expect(made).toMatchObject({ ok: true, count: 2 })
    expect(editor.steps()).toBe(1)

    const memos = editor.plugin.listMemos().memos
    expect(memos).toHaveLength(2)
    for (const memo of memos) {
      expect(memo.author).toBe(PRODUCT_NAME)
      expect(memo.text).toBe('[민감정보 가리기] 학생')
    }
    expect(editor.plugin.hidingState()).toMatchObject({ ok: true, count: 2, labels: ['학생'] })
  })

  it('puts several spans of one paragraph where they were asked for', () => {
    const doc = blank(['전화 010-1234-5678 또는 010-9999-0000'])
    const editor = openEditor(doc)
    const anchor = (start: number, end: number) => ({
      place: 'body' as const,
      sectionIndex: 0,
      paraIndex: 0,
      startCharIdx: start,
      endCharIdx: end,
      path: null,
    })
    expect(
      editor.plugin.hideRanges([anchor(3, 16), anchor(20, 33)], PRODUCT_NAME, hidingText('전화')),
    ).toMatchObject({ ok: true, count: 2 })
    const state = editor.plugin.hidingState()
    expect(state.ok && state.marks.map((mark) => mark.value)).toEqual([
      '010-1234-5678',
      '010-9999-0000',
    ])
  })

  it('refuses a selection on an ordinary memo, and one in a header', () => {
    const doc = blank(['메모가 있는 글'])
    doc.insertMemo(0, 0, 0, 3, JSON.stringify({ author: 'a', text: '보통 메모' }))
    const editor = openEditor(doc)
    editor.select(body(0, 1), body(0, 5))
    expect(editor.plugin.hidingSelection()).toEqual({ ok: false, reason: 'overlap' })

    editor.cursor.header = true
    expect(editor.plugin.hidingSelection()).toEqual({ ok: false, reason: 'unsupported_place' })
  })

  it('hides a span in a table cell', () => {
    const doc = blank(['표', ''])
    doc.pasteHtml(0, 1, 0, '<table><tr><td>이름</td><td>김철수</td></tr></table>')
    const editor = openEditor(doc)
    const path = [{ controlIndex: 0, cellIndex: 1, cellParaIndex: 0 }]
    const made = editor.plugin.hideRanges(
      [{ place: 'tableCell', sectionIndex: 0, paraIndex: 1, startCharIdx: 0, endCharIdx: 3, path }],
      PRODUCT_NAME,
      hidingText('이름-01'),
    )
    expect(made).toMatchObject({ ok: true })
    const text = editor.ai<string>('readText')
    expect(text).toContain('{{이름-01}}')
    expect(text).not.toContain('김철수')
    const table = editor.ai<{ ok: boolean; rows?: unknown }>('readTable', 1)
    expect(JSON.stringify(table)).not.toContain('김철수')
    expect(JSON.stringify(table)).toContain('{{이름-01}}')
  })

  it('names the right-click item in the app language and tells the app when it is pressed', () => {
    const editor = openEditor(blank(['글']))
    expect(editor.plugin.installHiding('민감정보 가리기')).toEqual({ ok: true })
    const item = editor.registered.get(HIDING_COMMAND)
    expect(item?.canExecute?.({ hasDocument: true, hasSelection: false })).toBe(false)
    expect(item?.canExecute?.({ hasDocument: true, hasSelection: true })).toBe(true)
    let heard = 0
    const listen = () => (heard += 1)
    globalThis.addEventListener(HIDING_EVENT, listen)
    editor.run(HIDING_COMMAND)
    globalThis.removeEventListener(HIDING_EVENT, listen)
    expect(heard).toBe(1)
  })
})

describe('what the AI reads', () => {
  const sample = () => {
    const doc = blank(['담임 의견', '학생 홍길동은 성실하다', '홍길동의 보호자 연락처'])
    hideInBody(doc, 1, 3, 6, '이름')
    return doc
  }

  it('reads the document with the span as its label, the file untouched', () => {
    const editor = openEditor(sample())
    const text = editor.ai<string>('readText')
    expect(text).toContain('학생 {{이름}}은 성실하다')
    // the same words outside the span are not hidden by it, but never more than once
    expect(text).toContain('홍길동의 보호자 연락처')
    expect(editor.plugin.readText()).toContain('학생 홍길동은 성실하다')
    expect(editor.doc().getTextRange(0, 1, 0, 13)).toBe('학생 홍길동은 성실하다')
  })

  it('does not find the hidden words, but finds the same words elsewhere', () => {
    const editor = openEditor(sample())
    const found = editor.ai<{ count: number; matches: { context?: string }[] }>(
      'findText',
      '홍길동',
    )
    expect(found.count).toBe(1)
    expect(found.matches[0].context).toContain('보호자')
    // a find over part of the span answers as if it were not there
    expect(editor.ai<{ count: number }>('findText', '생 홍').count).toBe(0)
  })

  it('shows a match beside a span with the span as its label', () => {
    const editor = openEditor(sample())
    const found = editor.ai<{ matches: { context?: string; before?: string }[] }>(
      'findText',
      '성실',
    )
    expect(found.matches[0].context).toContain('{{이름}}')
    expect(JSON.stringify(found)).not.toContain('홍길동')
    const deleted = editor.ai<{ ok: boolean; reason?: string }>('deleteParagraph', '성실', null)
    expect(deleted).toMatchObject({ ok: false, reason: 'hidden_content' })
  })

  it('shows a hiding memo by its own words only', () => {
    const doc = sample()
    doc.insertMemo(0, 2, 0, 3, JSON.stringify({ author: 'a', text: '홍길동 확인' }))
    const editor = openEditor(doc)
    const listed = editor.ai<{
      memos: { text: string; anchor: unknown; page: number; startCharIdx: number | null }[]
    }>('listMemos')
    const hiding = listed.memos.find((memo) => memo.text.startsWith('[민감정보 가리기]'))
    expect(hiding).toMatchObject({ anchor: null, page: 0, startCharIdx: null })
    // an ordinary memo's words are document text too
    expect(JSON.stringify(listed)).not.toContain('홍길동')
  })

  it('quotes a selection with the span as its label, and keeps it whole when the AI rewrites around it', () => {
    const editor = openEditor(sample())
    editor.select(body(1, 0), body(1, 13))
    const read = editor.ai<{ ok: true; segments: { text: string }[] }>('selection')
    expect(read.segments.map((segment) => segment.text)).toEqual(['학생 {{이름}}은 성실하다'])
    // a rewrite that keeps the label is still a change of the hidden words: refused
    const rewritten = editor.ai<{ ok: boolean; reason?: string }>(
      'replaceSelection',
      read.segments,
      ['학생 {{이름}}은 정말 성실하다'],
    )
    expect(rewritten).toMatchObject({ ok: false, reason: 'hidden_content' })
    expect(editor.doc().getTextRange(0, 1, 0, 13)).toBe('학생 홍길동은 성실하다')
    // formatting it changes no words: it goes through
    expect(
      editor.ai<{ ok: boolean }>('formatSelection', read.segments, { bold: true }),
    ).toMatchObject({ ok: true })
  })
})

describe('edits the AI may not make', () => {
  it('refuses to remove a hidden span even with the memo approval', () => {
    const doc = blank(['첫 줄', '가린 문단', '셋째'])
    const made = hideInBody(doc, 1, 0, 2, '비밀')
    const editor = openEditor(doc)
    const result = editor.ai<{ ok: boolean; reason?: string; labels?: string[] }>(
      'deleteParagraph',
      '문단',
      null,
      { allowMemoRemoval: true, approvedMemoIds: [made.id] },
    )
    expect(result).toMatchObject({ ok: false, reason: 'hidden_content', labels: ['비밀'] })
    expect(editor.plugin.listMemos().count).toBe(1)
    expect(editor.steps()).toBe(0)
  })

  it('refuses a replace that would cut into a span from outside', () => {
    const doc = blank(['가나다라마바사'])
    hideInBody(doc, 0, 2, 5, '비밀')
    const editor = openEditor(doc)
    // the raw call (a caller without aiCall, the command line) is held to the same rule
    expect(editor.plugin.replaceText('나다', 'XX')).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
    expect(editor.plugin.replaceAllText('가', 'Z')).toMatchObject({ ok: true })
    expect(editor.plugin.insertParagraphs('사', null, 'after', ['새 문단'])).toMatchObject({
      ok: true,
    })
    expect(editor.plugin.listMemos().count).toBe(1)
  })
})

describe('a document whose spans cannot be placed', () => {
  it('answers the AI nothing and says why', () => {
    const doc = blank(['본문'])
    const editor = openEditor(doc)
    const real = editor.doc()
    const list = real.getMemoList.bind(real)
    real.getMemoList = () =>
      JSON.stringify([
        ...JSON.parse(list()),
        { id: 99, index: 1, text: hidingText('머리말 이름'), place: 'header' },
      ])
    expect(editor.plugin.hidingState()).toEqual({ ok: false, reason: 'unplaced', count: 1 })
    expect(() => editor.ai('readText')).toThrow(/cannot be placed/)
    expect(() => editor.ai('findText', '본문')).toThrow(/cannot be placed/)
  })
})

describe('the file', () => {
  it('keeps the spans through HWP and HWPX', () => {
    const doc = blank(['학생 홍길동', '끝'])
    hideInBody(doc, 0, 3, 6, '이름')
    for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
      const editor = openEditor(new HwpDocument(bytes))
      expect(editor.plugin.hidingState()).toMatchObject({ ok: true, count: 1, labels: ['이름'] })
      expect(editor.ai<string>('readText')).toContain('학생 {{이름}}')
      agentPlugin.deactivate?.()
    }
  })
})

describe('finding what may be sensitive', () => {
  it('lists candidates with their anchors, leaves hidden ones out, and marks memo overlaps', () => {
    const doc = blank([
      '연락처: 010-1234-5678',
      '이메일 test@example.com',
      '다른 번호 010-2222-3333',
    ])
    hideInBody(doc, 2, 6, 19, '전화')
    doc.insertMemo(0, 1, 4, 10, JSON.stringify({ author: 'a', text: '확인' }))
    const editor = openEditor(doc)
    const { candidates } = editor.plugin.sensitiveCandidates()
    const phone = candidates.find((one) => one.kind === 'phone')
    expect(phone).toMatchObject({
      value: '010-1234-5678',
      hideable: true,
      anchor: { sectionIndex: 0, paraIndex: 0, startCharIdx: 5, endCharIdx: 18 },
    })
    const email = candidates.find((one) => one.kind === 'email')
    expect(email).toMatchObject({ hideable: false, reason: 'memo-overlap' })
    expect(candidates.some((one) => one.value === '010-2222-3333')).toBe(false)
  })
})

describe('an attached Hangul document read for its formatting', () => {
  it('has its own hidden spans hidden from what is read of it', () => {
    const attached = blank(['학생 홍길동은 성실하다', '둘째 문단'])
    hideInBody(attached, 0, 3, 6, '이름')
    const bytes = attached.exportHwp()
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const editor = openEditor(blank(['열린 문서']))
    const read = editor.ai<{ ok: boolean }>('formatting', btoa(binary))
    expect(read).toMatchObject({ ok: true })
    expect(JSON.stringify(read)).not.toContain('홍길동')
    expect(JSON.stringify(read)).toContain('{{이름}}')
  })
})

describe('a picture inside a hidden span', () => {
  it('is not listed for the AI nor handed to it', () => {
    const doc = new HwpDocument(
      new Uint8Array(
        readFileSync(join(__dirname, 'fixtures', 'square-picture-after-page-reset.hwpx')),
      ),
    )
    // the picture sits at the end of paragraph 11 (offset 178 of 179)
    hideInBody(doc, 10, 170, 179, '사진')
    const editor = openEditor(doc)
    const raw = editor.plugin.listPictures()
    expect(raw.count).toBe(1)
    const seen = editor.ai<{ count: number }>('listPictures')
    expect(seen.count).toBe(0)
    expect(editor.ai<{ ok: boolean; reason?: string }>('readPicture', 1)).toMatchObject({
      ok: false,
      reason: 'no_such_picture',
    })
  })
})
