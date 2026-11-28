import type { TableRenderNode } from '@genoffice/pptx-render'
import { describe, expect, it } from 'vitest'
import {
  adjacentTableCell,
  buildPatchedCellParagraphs,
  cellsToTsv,
  expandTableCellRange,
  isOnTableBorder,
  makeTableCellSelection,
  parseTsvGrid,
  selectAllTableCells,
  tableMergeRangePlan,
  tableSelectionBounds,
} from '../src/renderer/table-selection'

function makeGridTable(): TableRenderNode {
  // 3x3 regular table, each cell 100x40
  const cells = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cells.push({
        x: c * 100,
        y: r * 40,
        w: 100,
        h: 40,
        row: r,
        col: c,
        fill: { kind: 'solid', color: '#ffffff' },
        text: {
          insets: { l: 4, t: 2, r: 4, b: 2 },
          anchor: 'top',
          wrap: true,
          contentHeight: 20,
          lines: [
            {
              top: 0,
              height: 20,
              paraStart: true,
              align: 'left',
              runs: [
                {
                  text: `R${r}C${c}`,
                  x: 0,
                  baselineY: 16,
                  widthPx: 30,
                  fontSizePx: 16,
                  fontFamily: 'Calibri',
                  color: '#000000',
                  srcRunIdx: 0,
                },
              ],
            },
          ],
        },
      })
    }
  }
  return {
    type: 'table',
    sourceId: 't1',
    id: 'node_t1',
    box: { x: 100, y: 50, w: 300, h: 120, rotationDeg: 0 },
    cells,
    gridX: [0, 100, 200, 300],
    gridY: [0, 40, 80, 120],
  } as unknown as TableRenderNode
}

function makeMergedTable(): TableRenderNode {
  // 2x3 table where (0,0) spans cols 0..1 (gridSpan=2)
  return {
    type: 'table',
    sourceId: 't2',
    id: 'node_t2',
    box: { x: 0, y: 0, w: 300, h: 80, rotationDeg: 0 },
    cells: [
      { x: 0, y: 0, w: 200, h: 40, row: 0, col: 0, gridSpan: 2, rowSpan: 1 },
      { x: 200, y: 0, w: 100, h: 40, row: 0, col: 2, gridSpan: 1, rowSpan: 1 },
      { x: 0, y: 40, w: 100, h: 40, row: 1, col: 0, gridSpan: 1, rowSpan: 1 },
      { x: 100, y: 40, w: 100, h: 40, row: 1, col: 1, gridSpan: 1, rowSpan: 1 },
      { x: 200, y: 40, w: 100, h: 40, row: 1, col: 2, gridSpan: 1, rowSpan: 1 },
    ],
    gridX: [0, 100, 200, 300],
    gridY: [0, 40, 80],
  } as unknown as TableRenderNode
}

describe('table multi-cell selection & navigation', () => {
  it('expands a rectangular selection across anchor and focus in either direction', () => {
    const tbl = makeGridTable()
    const fwd = expandTableCellRange(tbl, { row: 0, col: 0 }, { row: 1, col: 2 })
    const rev = expandTableCellRange(tbl, { row: 1, col: 2 }, { row: 0, col: 0 })
    expect(fwd).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ])
    expect(rev).toEqual(fwd)
    expect(tableSelectionBounds(tbl, fwd)).toEqual({ x: 0, y: 0, w: 300, h: 80 })
  })

  it('expands to fixpoint when a merged cell intersects the selection rectangle', () => {
    const tbl = makeMergedTable()
    // Dragging from (1,1) up to (0,0) must also pull in (1,0) so the selection stays rectangular
    const cells = expandTableCellRange(tbl, { row: 1, col: 1 }, { row: 0, col: 0 })
    expect(cells).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ])
  })

  it('selects all cells of the table', () => {
    const tbl = makeGridTable()
    const all = selectAllTableCells(tbl)
    expect(all?.cells).toHaveLength(9)
    expect(all?.anchor).toEqual({ row: 0, col: 0 })
    expect(all?.focus).toEqual({ row: 2, col: 2 })
  })

  it('navigates visually to adjacent cells including merged cells and stops at borders', () => {
    const tbl = makeGridTable()
    expect(adjacentTableCell(tbl, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 1 })
    expect(adjacentTableCell(tbl, { row: 1, col: 1 }, 'down')).toEqual({ row: 2, col: 1 })
    expect(adjacentTableCell(tbl, { row: 1, col: 1 }, 'left')).toEqual({ row: 1, col: 0 })
    expect(adjacentTableCell(tbl, { row: 1, col: 1 }, 'right')).toEqual({ row: 1, col: 2 })
    expect(adjacentTableCell(tbl, { row: 0, col: 0 }, 'up')).toBeNull()
    expect(adjacentTableCell(tbl, { row: 0, col: 0 }, 'left')).toBeNull()

    const merged = makeMergedTable()
    expect(adjacentTableCell(merged, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 0 })
    expect(adjacentTableCell(merged, { row: 0, col: 0 }, 'right')).toEqual({ row: 0, col: 2 })
  })

  it('distinguishes table border grip from cell interior', () => {
    expect(isOnTableBorder({ w: 300, h: 120 }, { x: 2, y: 60 }, 6)).toBe(true)
    expect(isOnTableBorder({ w: 300, h: 120 }, { x: 150, y: 118 }, 6)).toBe(true)
    expect(isOnTableBorder({ w: 300, h: 120 }, { x: 50, y: 20 }, 6)).toBe(false)
  })

  it('plans single-row and single-column range merges and rejects 2D blocks', () => {
    const tbl = makeGridTable()
    expect(
      tableMergeRangePlan(tbl, [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 2 },
      ]),
    ).toEqual({ kind: 'merge-right', anchor: { row: 0, col: 0 }, steps: 2 })
    expect(
      tableMergeRangePlan(tbl, [
        { row: 0, col: 1 },
        { row: 1, col: 1 },
      ]),
    ).toEqual({ kind: 'merge-down', anchor: { row: 0, col: 1 }, steps: 1 })
    expect(
      tableMergeRangePlan(tbl, [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 0 },
        { row: 1, col: 1 },
      ]),
    ).toBeNull()
  })

  it('serializes and parses TSV grids for multi-cell copy/paste', () => {
    const tbl = makeGridTable()
    const sel = makeTableCellSelection(tbl, { row: 0, col: 0 }, { row: 1, col: 1 })
    const tsv = cellsToTsv(tbl, sel.cells)
    expect(tsv).toBe('R0C0\tR0C1\nR1C0\tR1C1')
    expect(parseTsvGrid(`${tsv}\n`)).toEqual([
      ['R0C0', 'R0C1'],
      ['R1C0', 'R1C1'],
    ])
    expect(parseTsvGrid('"line1\nline2"\t"a""b"\r\nc\td\r\n')).toEqual([
      ['line1\nline2', 'a"b'],
      ['c', 'd'],
    ])
  })

  it('builds patched cell paragraphs preserving srcPara/srcRun while applying formatting and clear', () => {
    const tbl = makeGridTable()
    const cell = tbl.cells[0]!
    const bolded = buildPatchedCellParagraphs(cell, 1, { bold: true, align: 'center' })
    expect(bolded).toEqual([
      {
        srcPara: 0,
        align: 'center',
        runs: [{ text: 'R0C0', srcRun: 0, bold: true }],
      },
    ])
    const cleared = buildPatchedCellParagraphs(cell, 1, { clearText: true })
    expect(cleared).toEqual([{ srcPara: 0, runs: [{ text: '' }] }])
    const upper = buildPatchedCellParagraphs(cell, 1, { caseMode: 'lower' })
    expect(upper?.[0]?.runs[0]?.text).toBe('r0c0')
  })
})
