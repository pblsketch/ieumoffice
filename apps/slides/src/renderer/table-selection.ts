/**
 * Pure table cell selection, navigation, formatting, clipboard TSV, and merge helpers.
 */
import type { TableRenderNode, TextLine } from '@genoffice/pptx-render'
import {
  applyFontSizeStep,
  DEFAULT_FONT_SIZE_PT,
  type FontSizeStep,
} from '@genoffice/pptx-ops/font-size'
import type { EditParagraph, EditRun } from '../shared/ipc'
import { changeCase, type CaseMode } from './text-case'

type TableRenderCell = TableRenderNode['cells'][number]

export interface CellCoord {
  row: number
  col: number
}

export interface TableCellSelection {
  sourceId: string
  anchor: CellCoord
  focus: CellCoord
  /** Expanded rectangular set of cells covering anchor..focus, sorted row-major. */
  cells: CellCoord[]
}

export type CellNavDir = 'up' | 'down' | 'left' | 'right'

const EPS = 0.5

export function sameCell(
  a: CellCoord | null | undefined,
  b: CellCoord | null | undefined,
): boolean {
  return !!a && !!b && a.row === b.row && a.col === b.col
}

export function isCellSelected(
  sel: TableCellSelection | null | undefined,
  sourceId: string,
  row: number,
  col: number,
): boolean {
  if (!sel || sel.sourceId !== sourceId) return false
  return sel.cells.some((c) => c.row === row && c.col === col)
}

function sortCells(cells: CellCoord[]): CellCoord[] {
  return [...cells].sort((a, b) => a.row - b.row || a.col - b.col)
}

/**
 * Expand a rectangular selection from anchor to focus in visual table space.
 * Any merged cell intersecting the rectangle expands the bounds until fixpoint,
 * matching PowerPoint's rectangular table cell selection semantics.
 */
export function expandTableCellRange(
  table: Pick<TableRenderNode, 'cells'>,
  anchor: CellCoord,
  focus: CellCoord,
): CellCoord[] {
  const a = table.cells.find((c) => c.row === anchor.row && c.col === anchor.col)
  const b = table.cells.find((c) => c.row === focus.row && c.col === focus.col)
  if (!a || !b) {
    if (a) return [{ row: a.row, col: a.col }]
    if (b) return [{ row: b.row, col: b.col }]
    return []
  }
  let x0 = Math.min(a.x, b.x)
  let y0 = Math.min(a.y, b.y)
  let x1 = Math.max(a.x + a.w, b.x + b.w)
  let y1 = Math.max(a.y + a.h, b.y + b.h)

  let grew = true
  while (grew) {
    grew = false
    for (const c of table.cells) {
      const overlaps =
        c.x < x1 - EPS && c.x + c.w > x0 + EPS && c.y < y1 - EPS && c.y + c.h > y0 + EPS
      if (!overlaps) continue
      if (c.x < x0 - EPS) {
        x0 = c.x
        grew = true
      }
      if (c.y < y0 - EPS) {
        y0 = c.y
        grew = true
      }
      if (c.x + c.w > x1 + EPS) {
        x1 = c.x + c.w
        grew = true
      }
      if (c.y + c.h > y1 + EPS) {
        y1 = c.y + c.h
        grew = true
      }
    }
  }

  const hits = table.cells
    .filter((c) => c.x < x1 - EPS && c.x + c.w > x0 + EPS && c.y < y1 - EPS && c.y + c.h > y0 + EPS)
    .map((c) => ({ row: c.row, col: c.col }))
  return sortCells(hits)
}

export function makeTableCellSelection(
  table: Pick<TableRenderNode, 'sourceId' | 'cells'>,
  anchor: CellCoord,
  focus: CellCoord,
): TableCellSelection {
  return {
    sourceId: table.sourceId,
    anchor,
    focus,
    cells: expandTableCellRange(table, anchor, focus),
  }
}

export function selectAllTableCells(
  table: Pick<TableRenderNode, 'sourceId' | 'cells'>,
): TableCellSelection | null {
  if (!table.cells.length) return null
  const cells = sortCells(table.cells.map((c) => ({ row: c.row, col: c.col })))
  return {
    sourceId: table.sourceId,
    anchor: cells[0]!,
    focus: cells[cells.length - 1]!,
    cells,
  }
}

/**
 * Find the visually adjacent cell in the given direction (respects merged cells and RTL layout).
 */
export function adjacentTableCell(
  table: Pick<TableRenderNode, 'cells'>,
  from: CellCoord,
  dir: CellNavDir,
): CellCoord | null {
  const cur = table.cells.find((c) => c.row === from.row && c.col === from.col)
  if (!cur) return null
  const cx = cur.x + cur.w / 2
  const cy = cur.y + cur.h / 2

  let best: TableRenderCell | null = null
  let bestPrimary = Infinity
  let bestSecondary = Infinity

  for (const c of table.cells) {
    if (c.row === cur.row && c.col === cur.col) continue
    let primary: number
    let secondary: number
    if (dir === 'right') {
      if (c.x < cur.x + cur.w - 1) continue
      const ov = Math.min(c.y + c.h, cur.y + cur.h) - Math.max(c.y, cur.y)
      if (ov <= EPS) continue
      primary = c.x - (cur.x + cur.w)
      secondary = Math.abs(c.y + c.h / 2 - cy)
    } else if (dir === 'left') {
      if (c.x + c.w > cur.x + 1) continue
      const ov = Math.min(c.y + c.h, cur.y + cur.h) - Math.max(c.y, cur.y)
      if (ov <= EPS) continue
      primary = cur.x - (c.x + c.w)
      secondary = Math.abs(c.y + c.h / 2 - cy)
    } else if (dir === 'down') {
      if (c.y < cur.y + cur.h - 1) continue
      const ov = Math.min(c.x + c.w, cur.x + cur.w) - Math.max(c.x, cur.x)
      if (ov <= EPS) continue
      primary = c.y - (cur.y + cur.h)
      secondary = Math.abs(c.x + c.w / 2 - cx)
    } else {
      if (c.y + c.h > cur.y + 1) continue
      const ov = Math.min(c.x + c.w, cur.x + cur.w) - Math.max(c.x, cur.x)
      if (ov <= EPS) continue
      primary = cur.y - (c.y + c.h)
      secondary = Math.abs(c.x + c.w / 2 - cx)
    }
    if (
      primary < bestPrimary - EPS ||
      (Math.abs(primary - bestPrimary) <= EPS && secondary < bestSecondary)
    ) {
      best = c
      bestPrimary = primary
      bestSecondary = secondary
    }
  }
  return best ? { row: best.row, col: best.col } : null
}

/**
 * Whether a table-local point falls on the outer border drag band rather than inside cells.
 * Clicking/dragging the border selects/moves the whole table; inside cells edits text or selects cells.
 */
export function isOnTableBorder(
  box: { w: number; h: number },
  local: { x: number; y: number },
  edgePx: number,
): boolean {
  const ex = Math.min(edgePx, box.w / 6)
  const ey = Math.min(edgePx, box.h / 6)
  return local.x < ex || local.y < ey || local.x > box.w - ex || local.y > box.h - ey
}

/**
 * Bounding box of selected cells in table-local coordinates, for drawing a selection outline.
 */
export function tableSelectionBounds(
  table: Pick<TableRenderNode, 'cells'>,
  cells: readonly CellCoord[],
): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const coord of cells) {
    const c = table.cells.find((x) => x.row === coord.row && x.col === coord.col)
    if (!c) continue
    x0 = Math.min(x0, c.x)
    y0 = Math.min(y0, c.y)
    x1 = Math.max(x1, c.x + c.w)
    y1 = Math.max(y1, c.y + c.h)
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Check whether the selected cells can be merged with the existing merge-right / merge-down ops
 * (single-row contiguous horizontal span or single-column contiguous vertical span).
 */
export function tableMergeRangePlan(
  table: Pick<TableRenderNode, 'cells'>,
  cells: readonly CellCoord[],
): { kind: 'merge-right' | 'merge-down'; anchor: CellCoord; steps: number } | null {
  if (cells.length < 2) return null
  const resolved = sortCells([...cells])
    .map((coord) => table.cells.find((c) => c.row === coord.row && c.col === coord.col))
    .filter((c): c is TableRenderCell => !!c)
  if (resolved.length !== cells.length) return null

  const first = resolved[0]!
  const allSameRow = resolved.every((c) => c.row === first.row && (c.rowSpan ?? 1) === 1)
  if (allSameRow) {
    // First cell may already have gridSpan >= 1; each subsequent cell must be plain and contiguous
    let expectedCol = first.col + (first.gridSpan ?? 1)
    for (let i = 1; i < resolved.length; i++) {
      const c = resolved[i]!
      if (c.col !== expectedCol || (c.gridSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1) return null
      expectedCol += 1
    }
    return {
      kind: 'merge-right',
      anchor: { row: first.row, col: first.col },
      steps: resolved.length - 1,
    }
  }

  const allSameCol = resolved.every((c) => c.col === first.col && (c.gridSpan ?? 1) === 1)
  if (allSameCol) {
    let expectedRow = first.row + (first.rowSpan ?? 1)
    for (let i = 1; i < resolved.length; i++) {
      const c = resolved[i]!
      if (c.row !== expectedRow || (c.gridSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1) return null
      expectedRow += 1
    }
    return {
      kind: 'merge-down',
      anchor: { row: first.row, col: first.col },
      steps: resolved.length - 1,
    }
  }

  return null
}

// ── Cell text extraction & multi-cell formatting patch ───────────────────

function groupParagraphLines(lines: TextLine[]): TextLine[][] {
  const paras: TextLine[][] = []
  for (const line of lines) {
    if (line.paraStart === false && paras.length) paras[paras.length - 1]!.push(line)
    else paras.push([line])
  }
  return paras
}

interface CellSeg {
  srcRun?: number
  text: string
  br?: boolean
  fontSizePt?: number
}

function cellParaSegs(lines: TextLine[], norm: number): CellSeg[] {
  const segs: CellSeg[] = []
  lines.forEach((line, li) => {
    if (li > 0 && lines[li - 1]!.trailingSpace) {
      const restored = lines[li - 1]!.trailingText ?? ' '
      const prev = segs[segs.length - 1]
      if (prev && !prev.br) prev.text += restored
    }
    const logical = [...line.runs].sort(
      (a, b) =>
        (a.logicalOrder ?? Number.MAX_SAFE_INTEGER) - (b.logicalOrder ?? Number.MAX_SAFE_INTEGER),
    )
    for (const run of logical) {
      if (run.isBullet || run.text === '') continue
      const prev = segs[segs.length - 1]
      const pt = Math.round((((run.fontSizePx / norm) * 72) / 96) * 2) / 2
      if (prev && !prev.br && prev.srcRun != null && prev.srcRun === run.srcRunIdx) {
        prev.text += run.text
      } else {
        segs.push({ srcRun: run.srcRunIdx, text: run.text, fontSizePt: pt })
      }
    }
    if (line.softBreakAfter != null) {
      segs.push({ srcRun: line.softBreakAfter, text: '\n', br: true })
    }
  })
  return segs
}

export interface CellParagraphPatch {
  fontFamily?: string
  fontSizePt?: number
  fontSizeStep?: FontSizeStep
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  highlight?: string | null
  letterSpacingPt?: number
  align?: 'left' | 'center' | 'right' | 'justify'
  bullet?: 'char' | 'number' | 'blip' | 'none'
  bulletChar?: string
  bulletFont?: string
  numType?: string
  startAt?: number
  bulletImage?: { base64: string; ext: string }
  lineSpacingPct?: number
  spaceBeforePt?: number
  spaceAfterPt?: number
  rtl?: boolean
  caseMode?: CaseMode
  clearText?: boolean
}

/**
 * Rebuild a cell's EditParagraph[] preserving srcPara/srcRun while applying the requested patch.
 * Returns null if the cell has nothing to change (e.g. caseMode on an empty cell).
 */
export function buildPatchedCellParagraphs(
  cell: { text?: TableRenderCell['text'] },
  scale: number,
  patch: CellParagraphPatch,
): EditParagraph[] | null {
  if (patch.clearText) {
    return [{ runs: [{ text: '' }], srcPara: 0 }]
  }
  const lines = cell.text?.lines ?? []
  const norm = scale * (cell.text?.fontScale ?? 1) || 1
  if (!lines.length) {
    // Empty cell: only paragraph-level or run-level formatting creates a styled empty paragraph
    if (patch.caseMode) return null
    const run: EditRun = {
      text: '',
      ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
      ...(patch.fontSizePt !== undefined ? { fontSize: patch.fontSizePt } : {}),
      ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
      ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
      ...(patch.underline !== undefined ? { underline: patch.underline } : {}),
      ...(patch.strike !== undefined ? { strike: patch.strike } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.highlight !== undefined ? { highlight: patch.highlight } : {}),
      ...(patch.letterSpacingPt !== undefined ? { letterSpacing: patch.letterSpacingPt } : {}),
    }
    return [
      {
        runs: [run],
        srcPara: 0,
        ...(patch.align !== undefined ? { align: patch.align } : {}),
        ...(patch.bullet !== undefined ? { bullet: patch.bullet } : {}),
        ...(patch.bulletChar !== undefined ? { bulletChar: patch.bulletChar } : {}),
        ...(patch.bulletFont !== undefined ? { bulletFont: patch.bulletFont } : {}),
        ...(patch.numType !== undefined ? { numType: patch.numType } : {}),
        ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
        ...(patch.bulletImage !== undefined ? { bulletImage: patch.bulletImage } : {}),
        ...(patch.lineSpacingPct !== undefined ? { lineSpacingPct: patch.lineSpacingPct } : {}),
        ...(patch.spaceBeforePt !== undefined ? { spaceBeforePt: patch.spaceBeforePt } : {}),
        ...(patch.spaceAfterPt !== undefined ? { spaceAfterPt: patch.spaceAfterPt } : {}),
        ...(patch.rtl !== undefined ? { rtl: patch.rtl } : {}),
      },
    ]
  }

  let caseChanged = false
  const paras = groupParagraphLines(lines).map((group, pi): EditParagraph => {
    const segs = cellParaSegs(group, norm)
    let transformed: string | null = null
    if (patch.caseMode) {
      const joined = segs.map((s) => s.text).join('')
      transformed = changeCase(joined, patch.caseMode)
      if (transformed !== joined) caseChanged = true
    }
    let at = 0
    const runs: EditRun[] = segs.map((s) => {
      const text = transformed != null ? transformed.slice(at, at + s.text.length) : s.text
      at += s.text.length
      if (s.br) {
        return { text: '\n', ...(s.srcRun != null ? { srcRun: s.srcRun } : {}) }
      }
      const nextSize =
        patch.fontSizePt !== undefined
          ? patch.fontSizePt
          : patch.fontSizeStep
            ? applyFontSizeStep(s.fontSizePt ?? DEFAULT_FONT_SIZE_PT, patch.fontSizeStep)
            : undefined
      return {
        text,
        ...(s.srcRun != null ? { srcRun: s.srcRun } : {}),
        ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
        ...(nextSize !== undefined ? { fontSize: nextSize } : {}),
        ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
        ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
        ...(patch.underline !== undefined ? { underline: patch.underline } : {}),
        ...(patch.strike !== undefined ? { strike: patch.strike } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.highlight !== undefined ? { highlight: patch.highlight } : {}),
        ...(patch.letterSpacingPt !== undefined ? { letterSpacing: patch.letterSpacingPt } : {}),
      }
    })
    return {
      runs: runs.length
        ? runs
        : [
            {
              text: '',
              ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
              ...(patch.fontSizePt !== undefined ? { fontSize: patch.fontSizePt } : {}),
              ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
              ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
              ...(patch.underline !== undefined ? { underline: patch.underline } : {}),
              ...(patch.strike !== undefined ? { strike: patch.strike } : {}),
              ...(patch.color !== undefined ? { color: patch.color } : {}),
              ...(patch.highlight !== undefined ? { highlight: patch.highlight } : {}),
              ...(patch.letterSpacingPt !== undefined
                ? { letterSpacing: patch.letterSpacingPt }
                : {}),
            },
          ],
      srcPara: pi,
      ...(patch.align !== undefined ? { align: patch.align } : {}),
      ...(patch.bullet !== undefined ? { bullet: patch.bullet } : {}),
      ...(patch.bulletChar !== undefined ? { bulletChar: patch.bulletChar } : {}),
      ...(patch.bulletFont !== undefined ? { bulletFont: patch.bulletFont } : {}),
      ...(patch.numType !== undefined ? { numType: patch.numType } : {}),
      ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
      ...(patch.bulletImage !== undefined ? { bulletImage: patch.bulletImage } : {}),
      ...(patch.lineSpacingPct !== undefined ? { lineSpacingPct: patch.lineSpacingPct } : {}),
      ...(patch.spaceBeforePt !== undefined ? { spaceBeforePt: patch.spaceBeforePt } : {}),
      ...(patch.spaceAfterPt !== undefined ? { spaceAfterPt: patch.spaceAfterPt } : {}),
      ...(patch.rtl !== undefined ? { rtl: patch.rtl } : {}),
    }
  })

  if (patch.caseMode && !caseChanged) return null
  return paras
}

/** Plain text content of one rendered cell (paragraphs joined by newlines). */
export function cellPlainText(cell: { text?: TableRenderCell['text'] }): string {
  const lines = cell.text?.lines
  if (!lines?.length) return ''
  return groupParagraphLines(lines)
    .map((group) =>
      cellParaSegs(group, 1)
        .map((s) => s.text)
        .join(''),
    )
    .join('\n')
}

/** Serialize selected table cells to TSV (Excel/PowerPoint clipboard compatible). */
export function cellsToTsv(
  table: Pick<TableRenderNode, 'cells'>,
  cells: readonly CellCoord[],
): string {
  if (!cells.length) return ''
  const byRow = new Map<number, TableRenderCell[]>()
  for (const coord of cells) {
    const c = table.cells.find((x) => x.row === coord.row && x.col === coord.col)
    if (!c) continue
    const list = byRow.get(c.row) ?? []
    list.push(c)
    byRow.set(c.row, list)
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b)
  return rows
    .map((r) =>
      (byRow.get(r) ?? [])
        .sort((a, b) => a.col - b.col)
        .map((c) => {
          const text = cellPlainText(c)
          return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
        })
        .join('\t'),
    )
    .join('\n')
}

/** Parse TSV/plain clipboard text into a 2D grid of cell strings (handles quoted newlines). */
export function parseTsvGrid(raw: string): string[][] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Strip one trailing newline added by spreadsheets/editors
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (trimmed[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === '\t') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  row.push(field)
  rows.push(row)
  return rows
}

/**
 * Determine whether a collapsed caret in a contentEditable cell editor is at the edge
 * where pressing the given arrow key should navigate to the adjacent table cell.
 */
export function isCaretAtEditorEdge(editor: HTMLElement, dir: CellNavDir): boolean {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return false

  // Empty editor is at every edge
  if (!editor.textContent) return true

  if (dir === 'left' || dir === 'right') {
    const probe = document.createRange()
    if (dir === 'left') {
      probe.setStart(editor, 0)
      probe.setEnd(range.startContainer, range.startOffset)
    } else {
      probe.setStart(range.endContainer, range.endOffset)
      probe.setEnd(editor, editor.childNodes.length)
    }
    return probe.toString().length === 0
  }

  // Up/Down: compare caret vertical rect against all laid-out text/block rects inside editor
  const caretRects = range.getClientRects()
  const caretRect =
    caretRects[0] ??
    (range.startContainer instanceof HTMLElement
      ? range.startContainer.getBoundingClientRect()
      : range.startContainer.parentElement?.getBoundingClientRect())
  if (!caretRect || (caretRect.width === 0 && caretRect.height === 0)) {
    // Fallback when layout metrics are unavailable (e.g. jsdom): check block position
    const blocks = Array.from(editor.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.tagName === 'DIV',
    )
    if (blocks.length <= 1) return true
    let cur: Node | null = range.startContainer
    while (cur && cur.parentNode !== editor) cur = cur.parentNode
    const idx = blocks.indexOf(cur as HTMLElement)
    return dir === 'up' ? idx <= 0 : idx < 0 || idx >= blocks.length - 1
  }

  const all = document.createRange()
  all.selectNodeContents(editor)
  const lineRects = Array.from(all.getClientRects()).filter((r) => r.height > 0)
  if (!lineRects.length) return true
  const minTop = Math.min(...lineRects.map((r) => r.top))
  const maxBottom = Math.max(...lineRects.map((r) => r.bottom))
  const tol = Math.max(2, caretRect.height * 0.35)
  return dir === 'up' ? caretRect.top <= minTop + tol : caretRect.bottom >= maxBottom - tol
}
