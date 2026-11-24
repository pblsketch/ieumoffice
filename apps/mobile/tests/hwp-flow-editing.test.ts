import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HwpDocument, initSync } from '@rhwp/core'
import {
  createFlowEditor,
  offsetInParagraph,
  placeCaret,
  renumberParagraphs,
  textDiff,
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
    document.querySelector<HTMLElement>(`.flow-p[data-sec="0"][data-para="${para}"]`)!
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

  it('keeps tables read-only', () => {
    const obj = document.querySelector<HTMLElement>('.flow-obj')!
    expect(obj.contentEditable).toBe('false')
    const cellText = document.createTreeWalker(obj, NodeFilter.SHOW_TEXT).nextNode() as Text
    document.getSelection()!.collapse(cellText, 0)
    expect(beforeInput('insertText', { data: 'x' })).toBe(true)
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
