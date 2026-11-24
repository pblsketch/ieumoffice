/**
 * Editing inside the HWP flow view (decision 0165, design system 5.3).
 *
 * The flow frame shows text blocks: body paragraphs (`.flow-p[data-sec][data-para]`)
 * and paragraphs inside table cells at any depth (the same plus `data-path`, the
 * engine's cell path). Edits are applied to the rhwp engine document at the same
 * block and character offset (the engine counts only text; anchored tables and
 * pictures take no offset), then the block is redrawn from the engine.
 *
 * - Typing, including Hangul composition, is reconciled after the browser has
 *   changed the block: its text is compared with the engine's and only the
 *   difference is inserted/deleted. Nothing is sent while composing.
 * - Enter, joining blocks, deleting across blocks, paste and undo are
 *   intercepted and done as engine operations. Inside a cell, a split or join
 *   redraws the whole cell (its paragraphs renumber).
 * - If a block's text on screen ever disagrees with the engine before an edit,
 *   the block is redrawn from the engine instead of being edited.
 *
 * Pictures stay read-only (`contenteditable=false`); table cells are editable
 * text, but the table structure (rows, columns, merges) is not changed here.
 */
import {
  bodyParagraphHtml,
  cellParagraphHtml,
  flatStep,
  listParagraphLength,
  paragraphNumber,
  renderCellContents,
  type CellStep,
  type FlowSourceDocument,
} from './hwpFlow'

export interface FlowEditDocument extends FlowSourceDocument {
  applyParaFormat(sec: number, para: number, propsJson: string): string
  applyParaFormatInCell(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    propsJson: string,
  ): string
  applyParaFormatInCellByPath(sec: number, para: number, path: string, propsJson: string): string
  ensureDefaultBullet(bulletChar: string): number
  ensureDefaultNumbering(): number
  insertTextInCell(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    offset: number,
    text: string,
  ): string
  deleteTextInCell(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    offset: number,
    count: number,
  ): string
  splitParagraphInCell(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    offset: number,
  ): string
  mergeParagraphInCell(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
  ): string
  applyCharFormatInCell(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    start: number,
    end: number,
    propsJson: string,
  ): string
  getCellCharPropertiesAt(
    sec: number,
    para: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    offset: number,
  ): string
  insertText(sec: number, para: number, offset: number, text: string): string
  deleteText(sec: number, para: number, offset: number, count: number): string
  splitParagraph(sec: number, para: number, offset: number): string
  mergeParagraph(sec: number, para: number): string
  getTextRange(sec: number, para: number, offset: number, count: number): string
  applyCharFormat(sec: number, para: number, start: number, end: number, propsJson: string): string
  getCharPropertiesAt(sec: number, para: number, offset: number): string
  insertTextInCellByPath(
    sec: number,
    para: number,
    path: string,
    offset: number,
    text: string,
  ): string
  deleteTextInCellByPath(
    sec: number,
    para: number,
    path: string,
    offset: number,
    count: number,
  ): string
  getTextInCellByPath(
    sec: number,
    para: number,
    path: string,
    offset: number,
    count: number,
  ): string
  splitParagraphInCellByPath(sec: number, para: number, path: string, offset: number): string
  mergeParagraphInCellByPath(sec: number, para: number, path: string): string
  applyCharFormatInCellByPath(
    sec: number,
    para: number,
    path: string,
    start: number,
    end: number,
    propsJson: string,
  ): string
  getCellCharPropertiesAtByPath(sec: number, para: number, path: string, offset: number): string
}

/** Where a text block lives in the engine. `path` is null for body paragraphs. */
export interface BlockAddress {
  readonly sec: number
  readonly para: number
  readonly path: readonly CellStep[] | null
}

export interface FlowPosition extends BlockAddress {
  readonly offset: number
}

export type FlowCharToggle = 'bold' | 'italic' | 'underline' | 'strikethrough'
export type FlowParagraphAction =
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'lineSpacingWider'
  | 'lineSpacingNarrower'
  | 'bulletList'
  | 'numberedList'
export type FlowFormatAction = FlowCharToggle | 'fontBigger' | 'fontSmaller' | FlowParagraphAction

const PARAGRAPH_ACTIONS: ReadonlySet<string> = new Set<FlowParagraphAction>([
  'alignLeft',
  'alignCenter',
  'alignRight',
  'alignJustify',
  'lineSpacingWider',
  'lineSpacingNarrower',
  'bulletList',
  'numberedList',
])

/** Line spacing steps in percent, as the page editor's wider/narrower commands. */
const LINE_SPACING_STEP = 10
const LINE_SPACING_MIN = 50
const LINE_SPACING_MAX = 500
/** Bullet for a new bulleted list; the document's own bullets keep their characters. */
const FALLBACK_LIST_BULLET = String.fromCharCode(0x2022)

/** Font size steps in the engine's unit (1/100 pt). */
const FONT_STEP = 100
const FONT_MIN = 600
const FONT_MAX = 7200

type UndoEntry =
  | { kind: 'text'; at: BlockAddress; offset: number; removed: string; inserted: string }
  | { kind: 'split'; at: BlockAddress; offset: number }
  | { kind: 'merge'; at: BlockAddress; joinOffset: number }
  | { kind: 'format'; at: BlockAddress; start: number; end: number; before: string; after: string }
  | { kind: 'para'; at: BlockAddress; before: string; after: string }

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

/** Visible text of a block element, as the engine counts it. */
export function paragraphText(el: Element): string {
  return (el.textContent ?? '').replace(/\u00a0/g, ' ')
}

export function blockAddress(el: Element): BlockAddress | null {
  const sec = Number(el.getAttribute('data-sec'))
  const para = Number(el.getAttribute('data-para'))
  if (!Number.isInteger(sec) || !Number.isInteger(para)) return null
  const raw = el.getAttribute('data-path')
  if (!raw) return { sec, para, path: null }
  try {
    return { sec, para, path: JSON.parse(raw) as CellStep[] }
  } catch {
    return null
  }
}

/** Same block, `delta` paragraphs further along (within the body or within the cell). */
export function neighbour(at: BlockAddress, delta: number): BlockAddress {
  if (!at.path) return { ...at, para: at.para + delta }
  const last = at.path[at.path.length - 1]
  return {
    ...at,
    path: [...at.path.slice(0, -1), { ...last, cellParaIndex: (last.cellParaIndex ?? 0) + delta }],
  }
}

export function sameAddress(a: BlockAddress, b: BlockAddress): boolean {
  return a.sec === b.sec && a.para === b.para && JSON.stringify(a.path) === JSON.stringify(b.path)
}

/** Body paragraphs share one container; cell paragraphs share their cell. */
export function sameContainer(a: BlockAddress, b: BlockAddress): boolean {
  if (a.sec !== b.sec) return false
  if (!a.path || !b.path) return !a.path && !b.path
  return a.para === b.para && JSON.stringify(cellOf(a.path)) === JSON.stringify(cellOf(b.path))
}

function cellOf(path: readonly CellStep[]): CellStep[] {
  const last = path[path.length - 1]
  return [...path.slice(0, -1), { controlIndex: last.controlIndex, cellIndex: last.cellIndex }]
}

function paraIndex(at: BlockAddress): number {
  return at.path ? (at.path[at.path.length - 1].cellParaIndex ?? 0) : at.para
}

/** Shifts `data-para` of every body-level flow element in `sec` from `fromPara` on by `delta`. */
export function renumberParagraphs(root: ParentNode, sec: number, fromPara: number, delta: number) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-sec][data-para]')) {
    const s = Number(el.getAttribute('data-sec'))
    const p = Number(el.getAttribute('data-para'))
    if (s === sec && p >= fromPara) el.setAttribute('data-para', String(p + delta))
  }
}

const NBSP = String.fromCharCode(0xa0)

/**
 * HTML collapses spaces at the start and end of a block and runs of spaces, so
 * after a block is redrawn from the engine a just-typed trailing space would
 * vanish under the caret and the next character would land before it. Spaces
 * that would collapse become no-break spaces; `paragraphText` reads them back
 * as spaces, so the engine text is unchanged.
 */
export function keepSpacesVisible(root: Element): void {
  const blocks = root.matches('.flow-p') ? [root] : [...root.querySelectorAll('.flow-p')]
  for (const block of blocks) {
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
    nodes.forEach((node, i) => {
      let text = node.data.replace(/ {2,}/g, (run) => NBSP.repeat(run.length))
      if (i === 0) text = text.replace(/^ /, NBSP)
      if (i === nodes.length - 1) text = text.replace(/ $/, NBSP)
      if (text !== node.data) node.data = text
    })
  }
}

/** Character offset of a DOM point inside a block element. */
export function offsetInParagraph(pEl: Element, node: Node, nodeOffset: number): number {
  const range = pEl.ownerDocument.createRange()
  range.setStart(pEl, 0)
  range.setEnd(node, nodeOffset)
  return range.toString().length
}

/** Puts a collapsed caret at a character offset of a block element. */
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
  else sel.collapse(pEl.querySelector('p') ?? pEl, 0)
}

// ---------- engine access per block ----------

/**
 * Engine calls for one text block. Body paragraphs use the body calls; one-step
 * paths (body-level table cells, text boxes, captions) the flat cell calls, the
 * only ones that reach table captions and split text boxes and captions; deeper
 * paths the path calls.
 */
function blockOps(doc: FlowEditDocument) {
  type Target =
    | { kind: 'body' }
    | { kind: 'flat'; ctrl: number; cell: number; cellPara: number }
    | { kind: 'path'; json: string }
  const target = (at: BlockAddress): Target => {
    if (!at.path) return { kind: 'body' }
    const flat = flatStep(at.path)
    return flat ? { kind: 'flat', ...flat } : { kind: 'path', json: JSON.stringify(at.path) }
  }
  const range = (at: BlockAddress, offset: number, count: number): string => {
    const t = target(at)
    if (t.kind === 'body') return doc.getTextRange(at.sec, at.para, offset, count)
    if (t.kind === 'flat') {
      return doc.getTextInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara, offset, count)
    }
    return doc.getTextInCellByPath(at.sec, at.para, t.json, offset, count)
  }
  return {
    length(at: BlockAddress): number {
      return at.path
        ? listParagraphLength(doc, at.sec, at.para, at.path)
        : doc.getParagraphLength(at.sec, at.para)
    },
    text(at: BlockAddress): string {
      const len = this.length(at)
      return len === 0 ? '' : range(at, 0, len)
    },
    slice(at: BlockAddress, offset: number, count: number): string {
      return count <= 0 ? '' : range(at, offset, count)
    },
    insert(at: BlockAddress, offset: number, text: string) {
      const t = target(at)
      if (t.kind === 'body') doc.insertText(at.sec, at.para, offset, text)
      else if (t.kind === 'flat') {
        doc.insertTextInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara, offset, text)
      } else doc.insertTextInCellByPath(at.sec, at.para, t.json, offset, text)
    },
    remove(at: BlockAddress, offset: number, count: number) {
      const t = target(at)
      if (t.kind === 'body') doc.deleteText(at.sec, at.para, offset, count)
      else if (t.kind === 'flat') {
        doc.deleteTextInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara, offset, count)
      } else doc.deleteTextInCellByPath(at.sec, at.para, t.json, offset, count)
    },
    split(at: BlockAddress, offset: number) {
      const t = target(at)
      if (t.kind === 'body') doc.splitParagraph(at.sec, at.para, offset)
      else if (t.kind === 'flat') {
        doc.splitParagraphInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara, offset)
      } else doc.splitParagraphInCellByPath(at.sec, at.para, t.json, offset)
    },
    /** Joins `at` into the block before it. */
    merge(at: BlockAddress) {
      const t = target(at)
      if (t.kind === 'body') doc.mergeParagraph(at.sec, at.para)
      else if (t.kind === 'flat') {
        doc.mergeParagraphInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara)
      } else doc.mergeParagraphInCellByPath(at.sec, at.para, t.json)
    },
    format(at: BlockAddress, start: number, end: number, json: string) {
      const t = target(at)
      if (t.kind === 'body') doc.applyCharFormat(at.sec, at.para, start, end, json)
      else if (t.kind === 'flat') {
        doc.applyCharFormatInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara, start, end, json)
      } else doc.applyCharFormatInCellByPath(at.sec, at.para, t.json, start, end, json)
    },
    props(at: BlockAddress, offset: number): Record<string, unknown> {
      const t = target(at)
      const raw =
        t.kind === 'body'
          ? doc.getCharPropertiesAt(at.sec, at.para, offset)
          : t.kind === 'flat'
            ? doc.getCellCharPropertiesAt(at.sec, at.para, t.ctrl, t.cell, t.cellPara, offset)
            : doc.getCellCharPropertiesAtByPath(at.sec, at.para, t.json, offset)
      return JSON.parse(raw) as Record<string, unknown>
    },
    paraProps(at: BlockAddress): Record<string, unknown> {
      const t = target(at)
      const raw =
        t.kind === 'body'
          ? doc.getParaPropertiesAt(at.sec, at.para)
          : t.kind === 'flat'
            ? doc.getCellParaPropertiesAt(at.sec, at.para, t.ctrl, t.cell, t.cellPara)
            : doc.getCellParaPropertiesAtByPath(at.sec, at.para, t.json)
      return JSON.parse(raw) as Record<string, unknown>
    },
    paraFormat(at: BlockAddress, json: string) {
      const t = target(at)
      if (t.kind === 'body') doc.applyParaFormat(at.sec, at.para, json)
      else if (t.kind === 'flat') {
        doc.applyParaFormatInCell(at.sec, at.para, t.ctrl, t.cell, t.cellPara, json)
      } else doc.applyParaFormatInCellByPath(at.sec, at.para, t.json, json)
    },
    html(at: BlockAddress): string {
      const inner = at.path
        ? cellParagraphHtml(doc, at.sec, at.para, at.path)
        : bodyParagraphHtml(doc, at.sec, at.para)
      return inner || '<p><br></p>'
    },
  }
}

// ---------- the editor ----------

export function createFlowEditor({ doc, frameDocument, onChange }: FlowEditorOptions): FlowEditor {
  const body = frameDocument.body
  const ops = blockOps(doc)
  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []
  let composing = false
  let editable = false

  const blockEl = (at: BlockAddress): HTMLElement | null => {
    for (const el of body.querySelectorAll<HTMLElement>(
      `.flow-p[data-sec="${at.sec}"][data-para="${at.para}"]`,
    )) {
      const addr = blockAddress(el)
      if (addr && sameAddress(addr, at)) return el
    }
    return null
  }

  const redraw = (at: BlockAddress): HTMLElement | null => {
    const el = blockEl(at)
    if (el) {
      el.innerHTML = ops.html(at)
      keepSpacesVisible(el)
    }
    return el
  }

  /** Redraws the whole cell holding `at` (its paragraphs renumber after a split or join). */
  const redrawCell = (at: BlockAddress) => {
    if (!at.path) return
    const cell = cellOf(at.path)
    const json = JSON.stringify(cell)
    for (const td of body.querySelectorAll<HTMLElement>('[data-cell-path]')) {
      if (
        td.getAttribute('data-cell-path') === json &&
        Number(td.getAttribute('data-sec')) === at.sec &&
        Number(td.getAttribute('data-para')) === at.para
      ) {
        td.innerHTML = renderCellContents(doc, at.sec, at.para, cell)
        markObjectsReadOnly(td)
        keepSpacesVisible(td)
        return
      }
    }
  }

  const markObjectsReadOnly = (root: ParentNode) => {
    for (const img of root.querySelectorAll<HTMLElement>('img')) img.contentEditable = 'false'
  }

  const newBodyBlock = (at: BlockAddress): HTMLElement => {
    const el = frameDocument.createElement('div')
    el.className = 'flow-p'
    el.setAttribute('data-sec', String(at.sec))
    el.setAttribute('data-para', String(at.para))
    el.innerHTML = ops.html(at)
    keepSpacesVisible(el)
    return el
  }

  const locate = (node: Node | null, nodeOffset: number) => {
    if (!node) return null
    const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const el = start?.closest('.flow-p') ?? null
    if (!el) return null
    const addr = blockAddress(el)
    if (!addr) return null
    return { el: el as HTMLElement, at: addr, offset: offsetInParagraph(el, node, nodeOffset) }
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

  // --- engine operations ---

  const applyText = (at: BlockAddress, offset: number, removed: string, inserted: string) => {
    if (removed) ops.remove(at, offset, removed.length)
    if (inserted) ops.insert(at, offset, inserted)
  }

  /** Automatic numbers after an added or removed paragraph shift: ask the engine again. */
  const refreshNumbers = () => {
    for (const p of body.querySelectorAll<HTMLElement>('.flow-p p[data-number]')) {
      const block = p.closest('.flow-p')
      const at = block ? blockAddress(block) : null
      if (!at) continue
      const text = paragraphNumber(doc, at.sec, at.para, at.path)
      if (text) p.setAttribute('data-marker', text)
      else p.removeAttribute('data-marker')
    }
  }

  const doSplit = (at: BlockAddress, offset: number) => {
    ops.split(at, offset)
    if (at.path) {
      redrawCell(at)
    } else {
      renumberParagraphs(body, at.sec, at.para + 1, 1)
      const current = redraw(at)
      current?.after(newBodyBlock(neighbour(at, 1)))
    }
    refreshNumbers()
  }

  /** Joins `at` into the block before it; returns the offset where they meet. */
  const doMerge = (at: BlockAddress): number => {
    const prev = neighbour(at, -1)
    const joinOffset = ops.length(prev)
    ops.merge(at)
    if (at.path) {
      redrawCell(at)
    } else {
      blockEl(at)?.remove()
      renumberParagraphs(body, at.sec, at.para + 1, -1)
      redraw(prev)
    }
    refreshNumbers()
    return joinOffset
  }

  const record = (entry: UndoEntry) => {
    undoStack.push(entry)
    redoStack.length = 0
    onChange()
  }

  /** Reconciles one block's on-screen text with the engine after typing. */
  const reconcile = (el: HTMLElement) => {
    const at = blockAddress(el)
    if (!at) return
    const before = ops.text(at)
    const after = paragraphText(el)
    if (before === after) return
    const sel = frameDocument.getSelection()
    const caretOffset =
      sel && sel.rangeCount > 0 ? (locate(sel.focusNode, sel.focusOffset)?.offset ?? null) : null
    const diff = textDiff(before, after)
    applyText(at, diff.offset, diff.removed, diff.inserted)
    record({ kind: 'text', at, ...diff })
    // redraw so new text takes the engine's formatting, then put the caret back
    const fresh = redraw(at)
    if (fresh && caretOffset !== null) placeCaret(fresh, caretOffset)
  }

  /** Before an intercepted edit: make sure the block on screen matches the engine. */
  const inSync = (el: HTMLElement): boolean => {
    const at = blockAddress(el)
    if (!at) return false
    if (paragraphText(el) === ops.text(at)) return true
    reconcile(el)
    return paragraphText(el) === ops.text(at)
  }

  type Located = NonNullable<ReturnType<typeof locate>>

  const deleteSelection = (start: Located, end: Located): FlowPosition | null => {
    if (sameAddress(start.at, end.at)) {
      const removed = ops.slice(start.at, start.offset, end.offset - start.offset)
      applyText(start.at, start.offset, removed, '')
      record({ kind: 'text', at: start.at, offset: start.offset, removed, inserted: '' })
      redraw(start.at)
      return { ...start.at, offset: start.offset }
    }
    if (!sameContainer(start.at, end.at)) return null
    const first = paraIndex(start.at)
    const last = paraIndex(end.at)
    for (let i = first + 1; i <= last; i += 1) {
      if (!blockEl(neighbour(start.at, i - first))) return null // an object-only block in between
    }
    const head = ops.text(start.at).slice(start.offset)
    applyText(start.at, start.offset, head, '')
    record({ kind: 'text', at: start.at, offset: start.offset, removed: head, inserted: '' })
    const tail = ops.text(end.at).slice(0, end.offset)
    applyText(end.at, 0, tail, '')
    record({ kind: 'text', at: end.at, offset: 0, removed: tail, inserted: '' })
    const next = neighbour(start.at, 1)
    for (let i = first + 1; i < last; i += 1) {
      const middle = ops.text(next)
      applyText(next, 0, middle, '')
      record({ kind: 'text', at: next, offset: 0, removed: middle, inserted: '' })
      record({ kind: 'merge', at: next, joinOffset: doMerge(next) })
    }
    record({ kind: 'merge', at: next, joinOffset: doMerge(next) })
    return { ...start.at, offset: start.offset }
  }

  const insertPlain = (pos: FlowPosition, text: string): FlowPosition => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    let at: BlockAddress = pos
    let offset = pos.offset
    lines.forEach((line, i) => {
      if (i > 0) {
        doSplit(at, offset)
        record({ kind: 'split', at, offset })
        at = neighbour(at, 1)
        offset = 0
      }
      if (line) {
        applyText(at, offset, '', line)
        record({ kind: 'text', at, offset, removed: '', inserted: line })
        offset += line.length
      }
    })
    redraw(at)
    return { ...at, offset }
  }

  const caretTo = (pos: FlowPosition | null) => {
    if (!pos) return
    const el = blockEl(pos)
    if (el) placeCaret(el, pos.offset)
  }

  // --- events ---

  /**
   * Cancels an edit the engine refused (for example Enter in a text box inside a
   * table, which only the path calls reach and they split table cells only) and
   * shows the engine's text again.
   */
  const onBeforeInput = (event: Event) => {
    try {
      handleBeforeInput(event as InputEvent)
    } catch {
      event.preventDefault()
      const info = selectionInfo()
      if (!info) return
      if (info.start.at.path) redrawCell(info.start.at)
      else redraw(info.start.at)
    }
  }

  const handleBeforeInput = (e: InputEvent) => {
    if (!editable || composing || e.isComposing) return
    const type = e.inputType

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
    const info = selectionInfo()
    if (!info) {
      e.preventDefault() // outside text blocks (e.g. a picture): read-only
      return
    }
    if (!inSync(info.start.el) || !inSync(info.end.el)) {
      e.preventDefault()
      return
    }
    const { start, end } = info
    const across = !sameAddress(start.at, end.at)

    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      e.preventDefault()
      const at = info.collapsed
        ? { ...start.at, offset: start.offset }
        : deleteSelection(start, end)
      if (!at) return
      doSplit(at, at.offset)
      record({ kind: 'split', at, offset: at.offset })
      caretTo({ ...neighbour(at, 1), offset: 0 })
      return
    }
    if (
      type === 'insertFromPaste' ||
      type === 'insertFromDrop' ||
      type === 'insertReplacementText'
    ) {
      e.preventDefault()
      const text = e.dataTransfer?.getData('text/plain') ?? e.data ?? ''
      const at = info.collapsed
        ? { ...start.at, offset: start.offset }
        : deleteSelection(start, end)
      if (!at || !text) {
        caretTo(at)
        return
      }
      caretTo(insertPlain(at, text))
      return
    }
    if (type === 'deleteContentBackward' && info.collapsed && start.offset === 0) {
      e.preventDefault()
      const prev = neighbour(start.at, -1)
      if (paraIndex(start.at) === 0 || !blockEl(prev)) return // nothing to join with here
      const joinOffset = doMerge(start.at)
      record({ kind: 'merge', at: start.at, joinOffset })
      caretTo({ ...prev, offset: joinOffset })
      return
    }
    if (
      type === 'deleteContentForward' &&
      info.collapsed &&
      start.offset === ops.length(start.at)
    ) {
      e.preventDefault()
      const next = neighbour(start.at, 1)
      if (!blockEl(next)) return
      const joinOffset = doMerge(next)
      record({ kind: 'merge', at: next, joinOffset })
      caretTo({ ...start.at, offset: joinOffset })
      return
    }
    if (across) {
      e.preventDefault()
      const at = deleteSelection(start, end)
      if (at && type === 'insertText' && e.data) caretTo(insertPlain(at, e.data))
      else caretTo(at)
      return
    }
    // everything else inside one block (typing, deleting a character or a
    // selection): let the browser change the block, then reconcile on input
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
        applyText(entry.at, entry.offset, removed, inserted)
        redraw(entry.at)
        caretTo({ ...entry.at, offset: entry.offset + inserted.length })
        break
      }
      case 'split':
        if (reverse) {
          doMerge(neighbour(entry.at, 1))
          caretTo({ ...entry.at, offset: entry.offset })
        } else {
          doSplit(entry.at, entry.offset)
          caretTo({ ...neighbour(entry.at, 1), offset: 0 })
        }
        break
      case 'merge': {
        const prev = neighbour(entry.at, -1)
        if (reverse) {
          doSplit(prev, entry.joinOffset)
          caretTo({ ...entry.at, offset: 0 })
        } else {
          doMerge(entry.at)
          caretTo({ ...prev, offset: entry.joinOffset })
        }
        break
      }
      case 'format':
        ops.format(entry.at, entry.start, entry.end, reverse ? entry.before : entry.after)
        redraw(entry.at)
        break
      case 'para':
        ops.paraFormat(entry.at, reverse ? entry.before : entry.after)
        redraw(entry.at)
        refreshNumbers()
        break
    }
  }

  /** Puts the selection back over the same text after its blocks were redrawn. */
  const restoreSelection = (info: NonNullable<ReturnType<typeof selectionInfo>>) => {
    const sel = frameDocument.getSelection()
    const a = blockEl(info.start.at)
    const b = blockEl(info.end.at)
    if (!sel || !a || !b) return
    placeCaret(a, info.start.offset)
    const anchor = sel.anchorNode
    const anchorOffset = sel.anchorOffset
    placeCaret(b, info.end.offset)
    const focus = sel.focusNode
    const focusOffset = sel.focusOffset
    if (anchor && focus) sel.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
  }

  /** The paragraph formats a paragraph action touches, as the engine reports them. */
  const paraSnapshot = (props: Record<string, unknown>) => ({
    alignment: props.alignment,
    lineSpacing: props.lineSpacing,
    headType: props.headType,
    numberingId: props.numberingId,
    paraLevel: props.paraLevel,
  })

  /**
   * Alignment, line spacing and lists for every block the selection (or caret)
   * touches. Lists toggle as one: if the first block already has that list, all
   * blocks drop it; otherwise all get it.
   */
  const runParagraph = (
    action: FlowParagraphAction,
    info: NonNullable<ReturnType<typeof selectionInfo>>,
  ) => {
    const blocks = [...body.querySelectorAll<HTMLElement>('.flow-p')]
    const from = blocks.indexOf(info.start.el)
    const to = blocks.indexOf(info.end.el)
    if (from < 0 || to < from) return
    const targets = blocks
      .slice(from, to + 1)
      .map((el) => blockAddress(el))
      .filter((at): at is BlockAddress => at !== null)
    if (targets.length === 0) return
    const listHead =
      action === 'bulletList' ? 'Bullet' : action === 'numberedList' ? 'Number' : null
    const listOff = listHead !== null && ops.paraProps(targets[0]).headType === listHead
    const listId =
      listHead === 'Bullet'
        ? doc.ensureDefaultBullet(FALLBACK_LIST_BULLET)
        : listHead === 'Number'
          ? doc.ensureDefaultNumbering()
          : 0
    for (const at of targets) {
      const current = ops.paraProps(at)
      let change: Record<string, unknown>
      if (listHead) {
        change = listOff
          ? { headType: 'None' }
          : { headType: listHead, numberingId: listId, paraLevel: current.paraLevel ?? 0 }
      } else if (action === 'lineSpacingWider' || action === 'lineSpacingNarrower') {
        // only percent spacing has a meaningful step
        if (current.lineSpacingType && current.lineSpacingType !== 'Percent') continue
        const spacing = typeof current.lineSpacing === 'number' ? current.lineSpacing : 160
        const step = action === 'lineSpacingWider' ? LINE_SPACING_STEP : -LINE_SPACING_STEP
        change = {
          lineSpacing: Math.round(
            Math.min(LINE_SPACING_MAX, Math.max(LINE_SPACING_MIN, spacing + step)),
          ),
        }
      } else {
        const alignment = { alignLeft: 'left', alignCenter: 'center', alignRight: 'right' }[
          action as 'alignLeft' | 'alignCenter' | 'alignRight'
        ]
        change = { alignment: alignment ?? 'justify' }
      }
      const before = JSON.stringify(paraSnapshot(current))
      ops.paraFormat(at, JSON.stringify(change))
      const after = JSON.stringify(paraSnapshot(ops.paraProps(at)))
      if (before === after) continue
      record({ kind: 'para', at, before, after })
      redraw(at)
    }
    refreshNumbers()
    restoreSelection(info)
  }

  const editor: FlowEditor = {
    setEditable(next) {
      editable = next
      body.contentEditable = next ? 'true' : 'false'
      body.setAttribute('spellcheck', 'false')
      markObjectsReadOnly(body)
      if (next) keepSpacesVisible(body)
    },
    runFormat(action) {
      const info = selectionInfo()
      if (info && PARAGRAPH_ACTIONS.has(action)) {
        runParagraph(action as FlowParagraphAction, info)
        return
      }
      if (!info || info.collapsed) return
      const blocks = [...body.querySelectorAll<HTMLElement>('.flow-p')]
      const from = blocks.indexOf(info.start.el)
      const to = blocks.indexOf(info.end.el)
      if (from < 0 || to < from) return
      for (let i = from; i <= to; i += 1) {
        const at = blockAddress(blocks[i])
        if (!at) continue
        const s = i === from ? info.start.offset : 0
        const e = i === to ? info.end.offset : ops.length(at)
        if (e <= s) continue
        const current = ops.props(at, s)
        let props: Record<string, unknown>
        let previous: Record<string, unknown>
        if (action === 'fontBigger' || action === 'fontSmaller') {
          const size = typeof current.fontSize === 'number' ? current.fontSize : 1000
          const step = action === 'fontBigger' ? FONT_STEP : -FONT_STEP
          props = { fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, size + step)) }
          previous = { fontSize: size }
        } else {
          props = { [action]: current[action] !== true }
          previous = { [action]: current[action] === true }
        }
        const after = JSON.stringify(props)
        const before = JSON.stringify(previous)
        ops.format(at, s, e, after)
        record({ kind: 'format', at, start: s, end: e, before, after })
        redraw(at)
      }
      restoreSelection(info)
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
      return info ? { ...info.start.at, offset: info.start.offset } : null
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
