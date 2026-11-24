/**
 * Editing inside the HWP flow view (decision 0163, design system 5.3).
 *
 * The flow frame shows body paragraphs as `.flow-p[data-sec][data-para]`. Edits
 * are applied to the rhwp engine document at the same paragraph and character
 * offset (the engine counts only text; anchored tables and pictures take no
 * offset), then the paragraph is redrawn from the engine.
 *
 * - Typing, including Hangul composition, is reconciled after the browser has
 *   changed the paragraph: the paragraph text is compared with the engine's and
 *   the difference is inserted/deleted. Nothing is sent while composing.
 * - Enter, joining paragraphs, deleting across paragraphs, paste and undo are
 *   intercepted and done as engine operations.
 * - If a paragraph's text on screen ever disagrees with the engine before an
 *   edit, the paragraph is redrawn from the engine instead of being edited.
 *
 * Tables and pictures stay read-only here (`contenteditable=false`).
 */
import { stripClipboardFragment, type FlowSourceDocument } from './hwpFlow'

export interface FlowEditDocument extends FlowSourceDocument {
  insertText(sec: number, para: number, offset: number, text: string): string
  deleteText(sec: number, para: number, offset: number, count: number): string
  splitParagraph(sec: number, para: number, offset: number): string
  mergeParagraph(sec: number, para: number): string
  getTextRange(sec: number, para: number, offset: number, count: number): string
  applyCharFormat(sec: number, para: number, start: number, end: number, propsJson: string): string
  getCharPropertiesAt(sec: number, para: number, offset: number): string
}

export interface FlowPosition {
  readonly sec: number
  readonly para: number
  readonly offset: number
}

export type FlowCharToggle = 'bold' | 'italic' | 'underline' | 'strikethrough'
export type FlowFormatAction = FlowCharToggle | 'fontBigger' | 'fontSmaller'

/** Font size steps in the engine's unit (1/100 pt). */
const FONT_STEP = 100
const FONT_MIN = 600
const FONT_MAX = 7200

type UndoEntry =
  | { kind: 'text'; sec: number; para: number; offset: number; removed: string; inserted: string }
  | { kind: 'split'; sec: number; para: number; offset: number }
  | { kind: 'merge'; sec: number; para: number; joinOffset: number }
  | {
      kind: 'format'
      sec: number
      para: number
      start: number
      end: number
      before: string
      after: string
    }

export interface FlowEditorOptions {
  readonly doc: FlowEditDocument
  readonly frameDocument: Document
  /** Called after every change that reached the engine. */
  readonly onChange: () => void
}

export interface FlowEditor {
  setEditable(editable: boolean): void
  runFormat(action: FlowFormatAction): void
  undo(): void
  redo(): void
  canUndo(): boolean
  /** Index of the paragraph holding the caret, if any. */
  caret(): FlowPosition | null
  dispose(): void
}

// ---------- pure helpers (exported for tests) ----------

/** The smallest edit that turns `before` into `after`. */
export function textDiff(
  before: string,
  after: string,
): { offset: number; removed: string; inserted: string } {
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  return {
    offset: start,
    removed: before.slice(start, endBefore),
    inserted: after.slice(start, endAfter),
  }
}

/** Visible text of a paragraph element, as the engine counts it. */
export function paragraphText(el: Element): string {
  return (el.textContent ?? '').replace(/\u00a0/g, ' ')
}

export function paragraphAddress(el: Element): { sec: number; para: number } | null {
  const sec = Number(el.getAttribute('data-sec'))
  const para = Number(el.getAttribute('data-para'))
  return Number.isInteger(sec) && Number.isInteger(para) ? { sec, para } : null
}

/** Shifts `data-para` of every flow element in `sec` from `fromPara` on by `delta`. */
export function renumberParagraphs(root: ParentNode, sec: number, fromPara: number, delta: number) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-sec][data-para]')) {
    const addr = paragraphAddress(el)
    if (addr && addr.sec === sec && addr.para >= fromPara) {
      el.setAttribute('data-para', String(addr.para + delta))
    }
  }
}

export function renderParagraphHtml(doc: FlowSourceDocument, sec: number, para: number): string {
  const length = doc.getParagraphLength(sec, para)
  if (length === 0) return '<p><br></p>'
  return (
    stripClipboardFragment(doc.exportSelectionHtml(sec, para, 0, para, length)) || '<p><br></p>'
  )
}

function engineText(doc: FlowEditDocument, sec: number, para: number): string {
  const length = doc.getParagraphLength(sec, para)
  return length > 0 ? doc.getTextRange(sec, para, 0, length) : ''
}

/** Character offset of a DOM point inside a paragraph element. */
export function offsetInParagraph(pEl: Element, node: Node, nodeOffset: number): number {
  const range = pEl.ownerDocument.createRange()
  range.setStart(pEl, 0)
  range.setEnd(node, nodeOffset)
  return range.toString().length
}

/** Puts a collapsed caret at a character offset of a paragraph element. */
export function placeCaret(pEl: Element, offset: number): void {
  const doc = pEl.ownerDocument
  const sel = doc.getSelection()
  if (!sel) return
  const walker = doc.createTreeWalker(pEl, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  let last: Node | null = null
  while (node) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) {
      sel.collapse(node, remaining)
      return
    }
    remaining -= len
    last = node
    node = walker.nextNode()
  }
  if (last) sel.collapse(last, last.textContent?.length ?? 0)
  else {
    const p = pEl.querySelector('p') ?? pEl
    sel.collapse(p, 0)
  }
}

// ---------- the editor ----------

export function createFlowEditor({ doc, frameDocument, onChange }: FlowEditorOptions): FlowEditor {
  const body = frameDocument.body
  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []
  let composing = false
  let editable = false

  const paragraphEl = (sec: number, para: number): HTMLElement | null =>
    body.querySelector<HTMLElement>(`.flow-p[data-sec="${sec}"][data-para="${para}"]`)

  const redraw = (sec: number, para: number): HTMLElement | null => {
    const el = paragraphEl(sec, para)
    if (el) el.innerHTML = renderParagraphHtml(doc, sec, para)
    return el
  }

  const newParagraphEl = (sec: number, para: number): HTMLElement => {
    const el = frameDocument.createElement('div')
    el.className = 'flow-p'
    el.setAttribute('data-sec', String(sec))
    el.setAttribute('data-para', String(para))
    el.innerHTML = renderParagraphHtml(doc, sec, para)
    return el
  }

  /** The paragraph element and offset of a DOM point, or null outside body paragraphs. */
  const locate = (node: Node | null, nodeOffset: number) => {
    if (!node) return null
    const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const pEl = start?.closest('.flow-p') ?? null
    if (!pEl) return null
    const addr = paragraphAddress(pEl)
    if (!addr) return null
    return { el: pEl as HTMLElement, ...addr, offset: offsetInParagraph(pEl, node, nodeOffset) }
  }

  const selectionInfo = () => {
    const sel = frameDocument.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const a = locate(range.startContainer, range.startOffset)
    const b = locate(range.endContainer, range.endOffset)
    if (!a || !b) return null
    return { start: a, end: b, collapsed: range.collapsed }
  }

  // --- engine operations (each records its inverse) ---

  const applyText = (
    sec: number,
    para: number,
    offset: number,
    removed: string,
    inserted: string,
  ) => {
    if (removed) doc.deleteText(sec, para, offset, removed.length)
    if (inserted) doc.insertText(sec, para, offset, inserted)
  }

  const doSplit = (sec: number, para: number, offset: number) => {
    doc.splitParagraph(sec, para, offset)
    renumberParagraphs(body, sec, para + 1, 1)
    const current = redraw(sec, para)
    current?.after(newParagraphEl(sec, para + 1))
  }

  const doMerge = (sec: number, para: number): number => {
    // joins `para` into `para - 1`; returns the offset where they meet
    const joinOffset = doc.getParagraphLength(sec, para - 1)
    doc.mergeParagraph(sec, para)
    paragraphEl(sec, para)?.remove()
    renumberParagraphs(body, sec, para + 1, -1)
    redraw(sec, para - 1)
    return joinOffset
  }

  const record = (entry: UndoEntry) => {
    undoStack.push(entry)
    redoStack.length = 0
    onChange()
  }

  /** Reconciles one paragraph's on-screen text with the engine after typing. */
  const reconcile = (pEl: HTMLElement) => {
    const addr = paragraphAddress(pEl)
    if (!addr) return
    const before = engineText(doc, addr.sec, addr.para)
    const after = paragraphText(pEl)
    if (before === after) return
    const sel = frameDocument.getSelection()
    const caretOffset =
      sel && sel.rangeCount > 0 ? (locate(sel.focusNode, sel.focusOffset)?.offset ?? null) : null
    const diff = textDiff(before, after)
    applyText(addr.sec, addr.para, diff.offset, diff.removed, diff.inserted)
    record({ kind: 'text', sec: addr.sec, para: addr.para, ...diff })
    // redraw so new text takes the engine's formatting, then put the caret back
    const el = redraw(addr.sec, addr.para)
    if (el && caretOffset !== null) placeCaret(el, caretOffset)
  }

  /** Before an intercepted edit: make sure the paragraph on screen matches the engine. */
  const inSync = (pEl: HTMLElement): boolean => {
    const addr = paragraphAddress(pEl)
    if (!addr) return false
    if (paragraphText(pEl) === engineText(doc, addr.sec, addr.para)) return true
    reconcile(pEl)
    return paragraphText(pEl) === engineText(doc, addr.sec, addr.para)
  }

  const deleteSelection = (info: NonNullable<ReturnType<typeof selectionInfo>>) => {
    const { start, end } = info
    if (start.sec !== end.sec) return null
    if (start.para === end.para) {
      const removed = doc.getTextRange(
        start.sec,
        start.para,
        start.offset,
        end.offset - start.offset,
      )
      applyText(start.sec, start.para, start.offset, removed, '')
      record({
        kind: 'text',
        sec: start.sec,
        para: start.para,
        offset: start.offset,
        removed,
        inserted: '',
      })
      redraw(start.sec, start.para)
      return { sec: start.sec, para: start.para, offset: start.offset }
    }
    // across paragraphs: trim the tail of the first, the head of the last, join them
    for (let p = end.para; p > start.para; p -= 1) {
      if (!paragraphEl(start.sec, p)) return null // an object paragraph in between: leave it
    }
    const headRemoved = engineText(doc, start.sec, start.para).slice(start.offset)
    applyText(start.sec, start.para, start.offset, headRemoved, '')
    record({
      kind: 'text',
      sec: start.sec,
      para: start.para,
      offset: start.offset,
      removed: headRemoved,
      inserted: '',
    })
    const tailRemoved = engineText(doc, end.sec, end.para).slice(0, end.offset)
    applyText(end.sec, end.para, 0, tailRemoved, '')
    record({
      kind: 'text',
      sec: end.sec,
      para: end.para,
      offset: 0,
      removed: tailRemoved,
      inserted: '',
    })
    for (let p = start.para + 1; p < end.para; p += 1) {
      const middle = engineText(doc, start.sec, start.para + 1)
      applyText(start.sec, start.para + 1, 0, middle, '')
      record({
        kind: 'text',
        sec: start.sec,
        para: start.para + 1,
        offset: 0,
        removed: middle,
        inserted: '',
      })
      const join = doMerge(start.sec, start.para + 1)
      record({ kind: 'merge', sec: start.sec, para: start.para + 1, joinOffset: join })
    }
    const join = doMerge(start.sec, start.para + 1)
    record({ kind: 'merge', sec: start.sec, para: start.para + 1, joinOffset: join })
    return { sec: start.sec, para: start.para, offset: start.offset }
  }

  const insertPlain = (pos: FlowPosition, text: string): FlowPosition => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    let { para, offset } = pos
    lines.forEach((line, i) => {
      if (i > 0) {
        doSplit(pos.sec, para, offset)
        record({ kind: 'split', sec: pos.sec, para, offset })
        para += 1
        offset = 0
      }
      if (line) {
        applyText(pos.sec, para, offset, '', line)
        record({ kind: 'text', sec: pos.sec, para, offset, removed: '', inserted: line })
        offset += line.length
      }
    })
    redraw(pos.sec, para)
    return { sec: pos.sec, para, offset }
  }

  const caretTo = (pos: FlowPosition | null) => {
    if (!pos) return
    const el = paragraphEl(pos.sec, pos.para)
    if (el) placeCaret(el, pos.offset)
  }

  // --- events ---

  const onBeforeInput = (event: Event) => {
    const e = event as InputEvent
    if (!editable || composing || e.isComposing) return
    const type = e.inputType
    const info = selectionInfo()

    if (type === 'historyUndo' || type === 'historyRedo') {
      e.preventDefault()
      if (type === 'historyUndo') editor.undo()
      else editor.redo()
      return
    }
    if (type.startsWith('format')) {
      e.preventDefault()
      const map: Record<string, FlowFormatAction> = {
        formatBold: 'bold',
        formatItalic: 'italic',
        formatUnderline: 'underline',
        formatStrikeThrough: 'strikethrough',
      }
      if (map[type]) editor.runFormat(map[type])
      return
    }
    if (!info) {
      e.preventDefault() // outside body paragraphs (e.g. a table): read-only here
      return
    }
    if (!inSync(info.start.el) || !inSync(info.end.el)) {
      e.preventDefault()
      return
    }

    const crossParagraph = info.start.para !== info.end.para || info.start.sec !== info.end.sec
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      e.preventDefault()
      const at = info.collapsed ? info.start : deleteSelection(info)
      if (!at) return
      doSplit(at.sec, at.para, at.offset)
      record({ kind: 'split', sec: at.sec, para: at.para, offset: at.offset })
      caretTo({ sec: at.sec, para: at.para + 1, offset: 0 })
      return
    }
    if (
      type === 'insertFromPaste' ||
      type === 'insertFromDrop' ||
      type === 'insertReplacementText'
    ) {
      e.preventDefault()
      const text = e.dataTransfer?.getData('text/plain') ?? e.data ?? ''
      const at = info.collapsed ? info.start : deleteSelection(info)
      if (!at || !text) {
        caretTo(at)
        return
      }
      caretTo(insertPlain(at, text))
      return
    }
    if (type === 'deleteContentBackward' && info.collapsed && info.start.offset === 0) {
      e.preventDefault()
      const prev = paragraphEl(info.start.sec, info.start.para - 1)
      if (!prev) return // first paragraph, or an object paragraph before: nothing to join
      const join = doMerge(info.start.sec, info.start.para)
      record({ kind: 'merge', sec: info.start.sec, para: info.start.para, joinOffset: join })
      caretTo({ sec: info.start.sec, para: info.start.para - 1, offset: join })
      return
    }
    if (
      type === 'deleteContentForward' &&
      info.collapsed &&
      info.start.offset === engineText(doc, info.start.sec, info.start.para).length
    ) {
      e.preventDefault()
      if (!paragraphEl(info.start.sec, info.start.para + 1)) return
      const join = doMerge(info.start.sec, info.start.para + 1)
      record({ kind: 'merge', sec: info.start.sec, para: info.start.para + 1, joinOffset: join })
      caretTo({ sec: info.start.sec, para: info.start.para, offset: join })
      return
    }
    if (crossParagraph) {
      e.preventDefault()
      const at = deleteSelection(info)
      if (at && type === 'insertText' && e.data) caretTo(insertPlain(at, e.data))
      else caretTo(at)
      return
    }
    // everything else inside one paragraph (typing, deleting a character or a
    // selection): let the browser change the paragraph, then reconcile on input
  }

  const onInput = (event: Event) => {
    if (!editable || composing || (event as InputEvent).isComposing) return
    const info = selectionInfo()
    if (info) reconcile(info.start.el)
  }

  const onCompositionStart = () => {
    composing = true
  }
  const onCompositionEnd = () => {
    composing = false
    const info = selectionInfo()
    if (info) reconcile(info.start.el)
  }

  frameDocument.addEventListener('beforeinput', onBeforeInput)
  frameDocument.addEventListener('input', onInput)
  frameDocument.addEventListener('compositionstart', onCompositionStart)
  frameDocument.addEventListener('compositionend', onCompositionEnd)

  const applyUndo = (entry: UndoEntry, reverse: boolean) => {
    switch (entry.kind) {
      case 'text': {
        const removed = reverse ? entry.inserted : entry.removed
        const inserted = reverse ? entry.removed : entry.inserted
        applyText(entry.sec, entry.para, entry.offset, removed, inserted)
        redraw(entry.sec, entry.para)
        caretTo({ sec: entry.sec, para: entry.para, offset: entry.offset + inserted.length })
        break
      }
      case 'split':
        if (reverse) {
          doMerge(entry.sec, entry.para + 1)
          caretTo({ sec: entry.sec, para: entry.para, offset: entry.offset })
        } else {
          doSplit(entry.sec, entry.para, entry.offset)
          caretTo({ sec: entry.sec, para: entry.para + 1, offset: 0 })
        }
        break
      case 'merge':
        if (reverse) {
          doSplit(entry.sec, entry.para - 1, entry.joinOffset)
          caretTo({ sec: entry.sec, para: entry.para, offset: 0 })
        } else {
          doMerge(entry.sec, entry.para)
          caretTo({ sec: entry.sec, para: entry.para - 1, offset: entry.joinOffset })
        }
        break
      case 'format':
        doc.applyCharFormat(
          entry.sec,
          entry.para,
          entry.start,
          entry.end,
          reverse ? entry.before : entry.after,
        )
        redraw(entry.sec, entry.para)
        break
    }
  }

  const editor: FlowEditor = {
    setEditable(next) {
      editable = next
      body.contentEditable = next ? 'true' : 'false'
      body.setAttribute('spellcheck', 'false')
      for (const obj of body.querySelectorAll<HTMLElement>('.flow-obj')) {
        obj.contentEditable = 'false'
      }
    },
    runFormat(action) {
      const info = selectionInfo()
      if (!info || info.collapsed) return
      const { start, end } = info
      if (start.sec !== end.sec) return
      for (let p = start.para; p <= end.para; p += 1) {
        if (!paragraphEl(start.sec, p)) continue
        const from = p === start.para ? start.offset : 0
        const to = p === end.para ? end.offset : doc.getParagraphLength(start.sec, p)
        if (to <= from) continue
        const current = JSON.parse(doc.getCharPropertiesAt(start.sec, p, from)) as Record<
          string,
          unknown
        >
        let props: Record<string, unknown>
        let previous: Record<string, unknown>
        if (action === 'fontBigger' || action === 'fontSmaller') {
          const size = typeof current.fontSize === 'number' ? current.fontSize : 1000
          const next = Math.min(
            FONT_MAX,
            Math.max(FONT_MIN, size + (action === 'fontBigger' ? FONT_STEP : -FONT_STEP)),
          )
          props = { fontSize: next }
          previous = { fontSize: size }
        } else {
          props = { [action]: current[action] !== true }
          previous = { [action]: current[action] === true }
        }
        const after = JSON.stringify(props)
        const before = JSON.stringify(previous)
        doc.applyCharFormat(start.sec, p, from, to, after)
        record({ kind: 'format', sec: start.sec, para: p, start: from, end: to, before, after })
        redraw(start.sec, p)
      }
      // keep the selection where it was
      const sel = frameDocument.getSelection()
      const a = paragraphEl(start.sec, start.para)
      const b = paragraphEl(end.sec, end.para)
      if (sel && a && b) {
        placeCaret(a, start.offset)
        const anchor = sel.anchorNode
        const anchorOffset = sel.anchorOffset
        placeCaret(b, end.offset)
        const focus = sel.focusNode
        const focusOffset = sel.focusOffset
        if (anchor && focus) sel.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
      }
    },
    undo() {
      const entry = undoStack.pop()
      if (!entry) return
      applyUndo(entry, true)
      redoStack.push(entry)
      onChange()
    },
    redo() {
      const entry = redoStack.pop()
      if (!entry) return
      applyUndo(entry, false)
      undoStack.push(entry)
      onChange()
    },
    canUndo: () => undoStack.length > 0,
    caret() {
      const info = selectionInfo()
      return info ? { sec: info.start.sec, para: info.start.para, offset: info.start.offset } : null
    },
    dispose() {
      frameDocument.removeEventListener('beforeinput', onBeforeInput)
      frameDocument.removeEventListener('input', onInput)
      frameDocument.removeEventListener('compositionstart', onCompositionStart)
      frameDocument.removeEventListener('compositionend', onCompositionEnd)
    },
  }
  return editor
}
