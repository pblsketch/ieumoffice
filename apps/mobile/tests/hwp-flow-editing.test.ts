import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'
import {
  createFlowEditor,
  keepSpacesVisible,
  memoFromEngine,
  offsetInParagraph,
  paragraphText,
  placeCaret,
  renumberParagraphs,
  textDiff,
  textRange,
  type FlowEditDocument,
  type FlowEditor,
} from '../src/renderer/editors/flowEditing'
import { buildFlowHtml } from '../src/renderer/editors/hwpFlow'

const require = createRequire(import.meta.url)
const fixture = join(__dirname, '../../hwp/tests/fixtures/nested-form.hwp')

beforeAll(() => {
  initSync({ module: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) })
})

describe('flow editing helpers', () => {
  it('finds the smallest edit between two texts', () => {
    expect(textDiff('교과협의록', '교과 협의록')).toEqual({ offset: 2, removed: '', inserted: ' ' })
    expect(textDiff('가나다', '가다')).toEqual({ offset: 1, removed: '나', inserted: '' })
    expect(textDiff('abc', 'abc')).toEqual({ offset: 3, removed: '', inserted: '' })
  })

  it('renumbers paragraphs after a split', () => {
    document.body.innerHTML =
      '<div class="flow-p" data-sec="0" data-para="0"></div><div class="flow-obj" data-sec="0" data-para="1"></div><div class="flow-p" data-sec="0" data-para="2"></div>'
    renumberParagraphs(document.body, 0, 1, 1)
    expect([...document.body.children].map((el) => el.getAttribute('data-para'))).toEqual([
      '0',
      '2',
      '3',
    ])
  })

  it('keeps spaces that HTML would collapse visible without changing the text', () => {
    document.body.innerHTML =
      '<div class="flow-p" data-sec="0" data-para="0"><p><span> 가 </span><span>나  다 </span></p></div>'
    const p = document.querySelector('.flow-p')!
    keepSpacesVisible(p)
    const nbsp = String.fromCharCode(0xa0)
    expect(p.textContent).toBe(`${nbsp}가 나${nbsp}${nbsp}다${nbsp}`)
    expect(paragraphText(p)).toBe(' 가 나  다 ')
  })

  it('turns engine memo locations into flow block addresses', () => {
    const base = {
      id: 1,
      parentId: null,
      sectionIndex: 0,
      paraIndex: 2,
      startCharIdx: 0,
      endCharIdx: 2,
    }
    expect(memoFromEngine({ ...base, path: null }).at).toEqual({ sec: 0, para: 2, path: null })
    expect(
      memoFromEngine({
        ...base,
        path: [{ type: 'cell', controlIndex: 0, cellIndex: 3, paraIndex: 1 }],
      }).at?.path,
    ).toEqual([{ controlIndex: 0, cellIndex: 3, cellParaIndex: 1 }])
    // a text box is cell 0 of its control
    expect(
      memoFromEngine({ ...base, path: [{ type: 'textbox', controlIndex: 3, paraIndex: 0 }] }).at
        ?.path,
    ).toEqual([{ controlIndex: 3, cellIndex: 0, cellParaIndex: 0 }])
  })

  it('builds a DOM range over character offsets across text nodes', () => {
    document.body.innerHTML =
      '<div class="flow-p" data-sec="0" data-para="0"><p><span>가나</span><span>다라</span></p></div>'
    const range = textRange(document.querySelector('.flow-p')!, 1, 3)!
    expect(range.toString()).toBe('나다')
    expect(textRange(document.querySelector('.flow-p')!, 1, 9)).toBeNull()
  })

  it('maps DOM points to character offsets and back', () => {
    document.body.innerHTML =
      '<div class="flow-p" data-sec="0" data-para="0"><p><span>가나</span><span>다라</span></p></div>'
    const p = document.querySelector('.flow-p')!
    const second = p.querySelectorAll('span')[1]!.firstChild!
    expect(offsetInParagraph(p, second, 1)).toBe(3)
    placeCaret(p, 3)
    const sel = document.getSelection()!
    expect(sel.anchorNode).toBe(second)
    expect(sel.anchorOffset).toBe(1)
  })
})

describe('editing in the flow view (real rhwp engine)', () => {
  let doc: HwpDocument
  let editor: FlowEditor
  let onChange: ReturnType<typeof vi.fn<() => void>>

  const engineText = (para: number) => {
    const len = doc.getParagraphLength(0, para)
    return len ? doc.getTextRange(0, para, 0, len) : ''
  }
  const pEl = (para: number) =>
    document.querySelector<HTMLElement>(
      `.flow-p[data-sec="0"][data-para="${para}"]:not([data-path])`,
    )!
  /** Cell block of the top table (body paragraph 2), or of the table nested in cell 9. */
  const cellPath = (cellIndex: number, cellParaIndex = 0, nested = false) =>
    nested
      ? [
          { controlIndex: 0, cellIndex: 9, cellParaIndex: 3 },
          { controlIndex: 0, cellIndex, cellParaIndex },
        ]
      : [{ controlIndex: 0, cellIndex, cellParaIndex }]
  const cellEl = (path: unknown) =>
    [...document.querySelectorAll<HTMLElement>('.flow-p[data-path]')].find(
      (el) => el.getAttribute('data-path') === JSON.stringify(path),
    )!
  const cellText = (path: unknown) => {
    const json = JSON.stringify(path)
    const len = doc.getCellParagraphLengthByPath(0, 2, json)
    return len ? doc.getTextInCellByPath(0, 2, json, 0, len) : ''
  }
  const cellCount = (cellIndex: number) =>
    doc.getCellParagraphCountByPath(0, 2, JSON.stringify(cellPath(cellIndex)))
  const typeAt = (el: HTMLElement, offset: number, text: string) => {
    const textNode = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text
    textNode.insertData(offset, text)
    placeCaret(el, offset + text.length)
    document.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }),
    )
  }
  const beforeInput = (inputType: string, init: InputEventInit = {}) => {
    const event = new InputEvent('beforeinput', {
      inputType,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    document.dispatchEvent(event)
    return event.defaultPrevented
  }
  /** What the browser does when typing: change the paragraph text, then fire input. */
  const typeInto = (para: number, offset: number, text: string, composing = false) => {
    const el = pEl(para)
    const textNode = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text
    textNode.insertData(offset, text)
    placeCaret(el, offset + text.length)
    document.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertText',
        data: text,
        isComposing: composing,
        bubbles: true,
      }),
    )
  }

  beforeEach(() => {
    doc = new HwpDocument(new Uint8Array(readFileSync(fixture)))
    document.body.innerHTML = buildFlowHtml(doc as unknown as FlowEditDocument)
    onChange = vi.fn<() => void>()
    editor = createFlowEditor({
      doc: doc as unknown as FlowEditDocument,
      frameDocument: document,
      onChange,
    })
    editor.setEditable(true)
  })
  afterEach(() => {
    editor.dispose()
    doc.free()
  })

  it('types into a paragraph and undoes it', () => {
    typeInto(0, 2, 'XY')
    expect(engineText(0)).toBe('(과XY목명) 교과협의록')
    expect(pEl(0).textContent).toBe('(과XY목명) 교과협의록')
    expect(onChange).toHaveBeenCalled()
    editor.undo()
    expect(engineText(0)).toBe('(과목명) 교과협의록')
    expect(pEl(0).textContent).toBe('(과목명) 교과협의록')
  })

  it('waits for Hangul composition to end before writing to the engine', () => {
    const el = pEl(1)
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    typeInto(1, 0, 'ㅎ', true)
    expect(engineText(1)).toBe('작성자 : ○○○ (서명)')
    const textNode = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text
    textNode.replaceData(0, 1, '한')
    placeCaret(el, 1)
    document.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }))
    expect(engineText(1)).toBe('한작성자 : ○○○ (서명)')
  })

  it('splits a paragraph on Enter, renumbers the rest, and joins it back with Backspace', () => {
    const before = doc.getParagraphCount(0)
    placeCaret(pEl(0), 3)
    expect(beforeInput('insertParagraph')).toBe(true)
    expect(doc.getParagraphCount(0)).toBe(before + 1)
    expect(engineText(0)).toBe('(과목')
    expect(engineText(1)).toBe('명) 교과협의록')
    expect(pEl(1).textContent).toBe('명) 교과협의록')
    expect(pEl(2).textContent).toBe('작성자 : ○○○ (서명)')
    // caret is at the start of the new paragraph; Backspace joins them again
    expect(beforeInput('deleteContentBackward')).toBe(true)
    expect(doc.getParagraphCount(0)).toBe(before)
    expect(engineText(0)).toBe('(과목명) 교과협의록')
    expect(pEl(1).textContent).toBe('작성자 : ○○○ (서명)')
  })

  it('applies bold to the selection and toggles it off again', () => {
    const el = pEl(0)
    placeCaret(el, 1)
    const sel = document.getSelection()!
    const anchor = sel.anchorNode!
    const anchorOffset = sel.anchorOffset
    placeCaret(el, 4)
    sel.setBaseAndExtent(anchor, anchorOffset, sel.focusNode!, sel.focusOffset)
    editor.runFormat('bold')
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 2)).bold).toBe(true)
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 0)).bold).toBe(false)
    expect(pEl(0).innerHTML).toContain('font-weight:bold')
    editor.undo()
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 2)).bold).toBe(false)
  })

  it('changes paragraph alignment at the caret and undoes it', () => {
    const align = () => JSON.parse(doc.getParaPropertiesAt(0, 1)).alignment
    const before = align()
    placeCaret(pEl(1), 2)
    editor.runFormat('alignCenter')
    expect(align()).toBe('center')
    expect(pEl(1).innerHTML).toContain('text-align:center')
    editor.undo()
    expect(align()).toBe(before)
  })

  it('toggles a bulleted list on and off, drawn outside the text', () => {
    placeCaret(pEl(1), 0)
    editor.runFormat('bulletList')
    expect(JSON.parse(doc.getParaPropertiesAt(0, 1)).headType).toBe('Bullet')
    expect(pEl(1).querySelector('p[data-marker]')).not.toBeNull()
    expect(engineText(1)).toBe('작성자 : ○○○ (서명)')
    placeCaret(pEl(1), 0)
    editor.runFormat('bulletList')
    expect(JSON.parse(doc.getParaPropertiesAt(0, 1)).headType).toBe('None')
    expect(pEl(1).querySelector('p[data-marker]')).toBeNull()
  })

  it('aligns a paragraph inside a table cell', () => {
    placeCaret(cellEl(cellPath(3)), 1)
    editor.runFormat('alignRight')
    expect(JSON.parse(doc.getCellParaPropertiesAt(0, 2, 0, 3, 0)).alignment).toBe('right')
  })

  // a 2x1 PNG
  const picture = {
    bytes: Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGAEAD5wB/6vGcBwAAAAASUVORK5CYII=',
      ),
      (ch) => ch.charCodeAt(0),
    ),
    widthPx: 2,
    heightPx: 1,
    extension: 'png',
    description: '시험 그림',
  }

  it('puts a picture in line at the end of the body paragraph with the caret, with undo and redo', () => {
    placeCaret(pEl(1), 3)
    expect(editor.insertPicture(picture)).toBe(true)
    const end = engineText(1).length
    expect(JSON.parse(doc.getControlTextPositions(0, 1))).toEqual([end])
    expect(JSON.parse(doc.getPictureProperties(0, 1, 0)).treatAsChar).toBe(true)
    expect(document.querySelector('.flow-obj[data-para="1"] img')).not.toBeNull()
    // the text block is still there and the text is unchanged
    expect(engineText(1)).toBe('작성자 : ○○○ (서명)')
    expect(pEl(1)).not.toBeNull()
    editor.undo()
    expect(JSON.parse(doc.getControlTextPositions(0, 1))).toEqual([])
    expect(document.querySelector('.flow-obj[data-para="1"]')).toBeNull()
    editor.redo()
    expect(JSON.parse(doc.getControlTextPositions(0, 1))).toEqual([end])
  })

  it('puts a picture in line inside a table cell', () => {
    placeCaret(cellEl(cellPath(3)), 2)
    expect(editor.insertPicture(picture)).toBe(true)
    const json = JSON.stringify(cellPath(3))
    expect(JSON.parse(doc.getCellPicturePropertiesByPath(0, 2, json, 0)).treatAsChar).toBe(true)
    const td = document.querySelector(
      `td[data-cell-path='${JSON.stringify([{ controlIndex: 0, cellIndex: 3 }])}']`,
    )!
    expect(td.querySelector('img')).not.toBeNull()
    editor.undo()
    expect(() => doc.getCellPicturePropertiesByPath(0, 2, json, 0)).toThrow()
  })

  it('shrinks a tall picture to half the text height', () => {
    placeCaret(pEl(1), 0)
    expect(editor.insertPicture({ ...picture, widthPx: 1000, heightPx: 4000 })).toBe(true)
    const page = JSON.parse(doc.getPageDef(0))
    const textHeight =
      page.height - page.marginTop - page.marginBottom - page.marginHeader - page.marginFooter
    const props = JSON.parse(doc.getPictureProperties(0, 1, 0))
    expect(props.height).toBeLessThanOrEqual(Math.round(textHeight / 2))
    expect(props.width / props.height).toBeCloseTo(0.25, 2)
  })

  it('refuses a picture without a caret in text', () => {
    document.getSelection()!.removeAllRanges()
    expect(editor.insertPicture(picture)).toBe(false)
  })

  const selectIn = (el: HTMLElement, start: number, end: number) => {
    placeCaret(el, start)
    const sel = document.getSelection()!
    const anchor = sel.anchorNode!
    const anchorOffset = sel.anchorOffset
    placeCaret(el, end)
    sel.setBaseAndExtent(anchor, anchorOffset, sel.focusNode!, sel.focusOffset)
  }

  it('adds, answers, changes and removes memos on the selection', () => {
    selectIn(pEl(1), 0, 3)
    expect(editor.addMemo('이름 확인', '홍길동')).toBe(true)
    const [memo] = editor.memos()
    expect(memo).toMatchObject({
      author: '홍길동',
      text: '이름 확인',
      parentId: null,
      at: { sec: 0, para: 1, path: null },
      start: 0,
      end: 3,
    })
    expect(onChange).toHaveBeenCalled()
    expect(editor.replyMemo(memo.id, '확인함', '김철수')).toBe(true)
    expect(editor.memos().find((m) => m.parentId === memo.id)?.text).toBe('확인함')
    expect(editor.editMemo(memo.id, '이름 다시 확인')).toBe(true)
    expect(editor.memos()[0].text).toBe('이름 다시 확인')
    // removing a memo removes its replies; the text stays
    expect(editor.removeMemo(memo.id)).toBe(true)
    expect(editor.memos()).toEqual([])
    expect(engineText(1)).toBe('작성자 : ○○○ (서명)')
  })

  it('adds a memo inside a table cell, located by the cell path', () => {
    selectIn(cellEl(cellPath(3)), 0, 2)
    expect(editor.addMemo('장소?', '홍길동')).toBe(true)
    expect(editor.memos()[0].at).toEqual({ sec: 0, para: 2, path: cellPath(3) })
  })

  it('refuses a memo without a selection', () => {
    document.getSelection()!.removeAllRanges()
    expect(editor.addMemo('x', 'y')).toBe(false)
  })

  it('shows every cell paragraph, empty ones included, at its engine path', () => {
    expect(cellEl(cellPath(0)).textContent).toBe('일 시')
    expect(cellEl(cellPath(9, 1)).textContent).toBe('')
    expect(cellEl(cellPath(9, 2)).textContent).toBe('2. 2학기 정기시험 및 수행평가 계획(0학년)')
    expect(cellEl(cellPath(1, 0, true)).textContent).toBe('정기시험')
  })

  it('types into a table cell and a nested table cell, and undoes it', () => {
    typeAt(cellEl(cellPath(3)), 0, '본관 ')
    expect(cellText(cellPath(3))).toBe('본관 ○○○○○○')
    typeAt(cellEl(cellPath(1, 0, true)), 4, '!')
    expect(cellText(cellPath(1, 0, true))).toBe('정기시험!')
    expect(cellEl(cellPath(1, 0, true)).textContent).toBe('정기시험!')
    editor.undo()
    expect(cellText(cellPath(1, 0, true))).toBe('정기시험')
    editor.undo()
    expect(cellText(cellPath(3))).toBe('○○○○○○')
  })

  it('splits and joins paragraphs inside a cell', () => {
    const before = cellCount(0)
    placeCaret(cellEl(cellPath(0)), 1)
    expect(beforeInput('insertParagraph')).toBe(true)
    expect(cellCount(0)).toBe(before + 1)
    expect(cellText(cellPath(0, 0))).toBe('일')
    expect(cellText(cellPath(0, 1))).toBe(' 시')
    expect(paragraphText(cellEl(cellPath(0, 1)))).toBe(' 시')
    // the caret is at the start of the new cell paragraph; Backspace joins them
    expect(beforeInput('deleteContentBackward')).toBe(true)
    expect(cellCount(0)).toBe(before)
    expect(cellEl(cellPath(0)).textContent).toBe('일 시')
    // Backspace at the start of the first cell paragraph does nothing
    placeCaret(cellEl(cellPath(0)), 0)
    expect(beforeInput('deleteContentBackward')).toBe(true)
    expect(cellCount(0)).toBe(before)
  })

  it('makes cell text bold', () => {
    const el = cellEl(cellPath(2))
    placeCaret(el, 0)
    const sel = document.getSelection()!
    const anchor = sel.anchorNode!
    placeCaret(el, 1)
    sel.setBaseAndExtent(anchor, 0, sel.focusNode!, sel.focusOffset)
    editor.runFormat('bold')
    const json = JSON.stringify(cellPath(2))
    expect(JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json, 0)).bold).toBe(true)
    editor.undo()
    expect(JSON.parse(doc.getCellCharPropertiesAtByPath(0, 2, json, 0)).bold).toBe(false)
  })

  it('does not write outside text blocks', () => {
    const td = document.querySelector<HTMLElement>('td[data-cell-path]')!
    document.getSelection()!.collapse(td, 0)
    expect(beforeInput('insertText', { data: 'x' })).toBe(true)
  })

  it('renumbers cells when a body paragraph above the table splits', () => {
    placeCaret(pEl(0), 2)
    beforeInput('insertParagraph')
    // the table now hangs on body paragraph 3
    const block = [...document.querySelectorAll<HTMLElement>('.flow-p[data-path]')][0]
    expect(block.getAttribute('data-para')).toBe('3')
    typeAt(block, 0, '*')
    const json = JSON.stringify(cellPath(0))
    const len = doc.getCellParagraphLengthByPath(0, 3, json)
    expect(doc.getTextInCellByPath(0, 3, json, 0, len)).toBe('*일 시')
  })

  it('hands over cell edits the page editor can open', () => {
    typeAt(cellEl(cellPath(3)), 0, '본관 ')
    const reopened = new HwpDocument(doc.exportHwp())
    try {
      const json = JSON.stringify(cellPath(3))
      const len = reopened.getCellParagraphLengthByPath(0, 2, json)
      expect(reopened.getTextInCellByPath(0, 2, json, 0, len)).toBe('본관 ○○○○○○')
    } finally {
      reopened.free()
    }
  })

  it('hands over edits the page editor can open', () => {
    typeInto(1, 0, '수정 ')
    const bytes = doc.exportHwp()
    const reopened = new HwpDocument(bytes)
    try {
      const len = reopened.getParagraphLength(0, 1)
      expect(reopened.getTextRange(0, 1, 0, len)).toBe('수정 작성자 : ○○○ (서명)')
    } finally {
      reopened.free()
    }
  })
})

describe('editing captions, text boxes and bulleted paragraphs (real rhwp engine)', () => {
  const fixtures = join(__dirname, '../../hwp/tests/fixtures')
  let doc: HwpDocument | null = null
  let editor: FlowEditor | null = null

  const open = (name: string) => {
    doc = new HwpDocument(new Uint8Array(readFileSync(join(fixtures, name))))
    document.body.innerHTML = buildFlowHtml(doc as unknown as FlowEditDocument)
    editor = createFlowEditor({
      doc: doc as unknown as FlowEditDocument,
      frameDocument: document,
      onChange: () => {},
    })
    editor.setEditable(true)
    return doc
  }
  afterEach(() => {
    editor?.dispose()
    doc?.free()
    editor = null
    doc = null
  })
  const typeAt = (el: HTMLElement, offset: number, text: string) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    let rest = offset
    while (node && rest > node.length) {
      rest -= node.length
      node = walker.nextNode() as Text | null
    }
    node!.insertData(rest, text)
    placeCaret(el, offset + text.length)
    document.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }),
    )
  }
  const pathText = (d: HwpDocument, para: number, path: unknown) => {
    const json = JSON.stringify(path)
    const len = d.getCellParagraphLengthByPath(0, para, json)
    return len ? d.getTextInCellByPath(0, para, json, 0, len) : ''
  }

  it('types into a picture caption and splits it with Enter', () => {
    const d = open('caption-footnote-flow.hwpx')
    const el = document.querySelector<HTMLElement>('.flow-caption .flow-p')!
    const path = JSON.parse(el.getAttribute('data-path')!) as unknown[]
    const para = Number(el.getAttribute('data-para'))
    const before = pathText(d, para, path)
    typeAt(el, 0, '★')
    expect(pathText(d, para, path)).toBe(`★${before}`)
    placeCaret(el, 1)
    const enter = new InputEvent('beforeinput', {
      inputType: 'insertParagraph',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    const captions = document.querySelectorAll('.flow-caption .flow-p')
    expect(captions[0].textContent).toBe('★')
    expect(captions[1].textContent).toBe(before)
  })

  it('edits a table caption and undoes it', () => {
    const d = open('caption-footnote-flow.hwpx')
    const el = [...document.querySelectorAll<HTMLElement>('.flow-caption .flow-p')].find((p) =>
      p.textContent?.startsWith('[표 1]'),
    )!
    const para = Number(el.getAttribute('data-para'))
    const capText = () => {
      const len = d.getCellParagraphLength(0, para, 0, 65534, 0)
      return d.getTextInCell(0, para, 0, 65534, 0, 0, len)
    }
    const before = capText()
    typeAt(el, 0, '★')
    expect(capText()).toBe(`★${before}`)
    expect(el.textContent).toBe(`★${before}`)
    editor!.undo()
    expect(capText()).toBe(before)
  })

  it('types into a table inside a text box', () => {
    const d = open('textbox-table.hwp')
    const el = document.querySelector<HTMLElement>('.flow-box td .flow-p')!
    const path = JSON.parse(el.getAttribute('data-path')!) as unknown[]
    const para = Number(el.getAttribute('data-para'))
    const before = pathText(d, para, path)
    typeAt(el, before.length, '!')
    expect(pathText(d, para, path)).toBe(`${before}!`)
    expect(el.textContent).toBe(`${before}!`)
  })

  it('shows automatic numbers and shifts them after Enter (engine patch 0057)', () => {
    const d = HwpDocument.createEmpty()
    d.createBlankDocument()
    d.insertText(0, 0, 0, '첫째')
    d.splitParagraph(0, 0, 2)
    d.insertText(0, 1, 0, '둘째')
    d.splitParagraph(0, 1, 2)
    d.insertText(0, 2, 0, '셋째')
    const id = d.ensureDefaultNumbering()
    for (const p of [0, 1, 2]) {
      d.applyParaFormat(0, p, JSON.stringify({ headType: 'Number', numberingId: id, paraLevel: 0 }))
    }
    doc = d
    document.body.innerHTML = buildFlowHtml(d as unknown as FlowEditDocument)
    editor = createFlowEditor({
      doc: d as unknown as FlowEditDocument,
      frameDocument: document,
      onChange: () => {},
    })
    editor.setEditable(true)
    const markers = () =>
      [...document.querySelectorAll('.flow-p:not([data-path]) p[data-number]')].map((p) =>
        p.getAttribute('data-marker'),
      )
    expect(markers()).toEqual(['1.', '2.', '3.'])
    // the number is drawn by CSS, not part of the text
    expect(document.querySelector('.flow-p')?.textContent).toBe('첫째')
    placeCaret(document.querySelector<HTMLElement>('.flow-p')!, 2)
    document.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertParagraph',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(markers()).toEqual(['1.', '2.', '3.', '4.'])
    editor.undo()
    expect(markers()).toEqual(['1.', '2.', '3.'])
  })

  it('keeps the bullet out of the text when typing into a bulleted paragraph', () => {
    const d = open('title-table-zone-fill.hwpx')
    const el = document.querySelector<HTMLElement>(
      '.flow-p:not([data-path]) p[data-marker]',
    )!.parentElement!
    const para = Number(el.getAttribute('data-para'))
    const before = d.getTextRange(0, para, 0, d.getParagraphLength(0, para))
    typeAt(el, 0, '※')
    expect(d.getTextRange(0, para, 0, d.getParagraphLength(0, para))).toBe(`※${before}`)
    // the bullet is still drawn after the paragraph is redrawn from the engine
    expect(el.querySelector('p[data-marker]')).not.toBeNull()
  })
})
