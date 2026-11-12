/**
 * "Find sensitive info" in the spreadsheet editor. Rules only, on this PC:
 * the shared finder (`@genoffice/agent-core/sensitive-detect`) reads every
 * cell of every sheet in reading order, each value cell with its column's
 * header. Nothing is hidden until the person confirms a candidate.
 *
 * - A column whose header names people (an "이름" / "Name" column) is offered
 *   as one column mark below its header, labelled with the kind name only.
 * - Other finds are offered cell by cell; confirming them makes one cell-range
 *   mark per kind, labelled with the kind name only (the model's per-value
 *   numbers are added when it reads, see `view.ts`).
 * - Sheet names, chart titles and cell notes cannot be hidden: they are
 *   listed, counted, and their confirm button is off.
 * - Cells already hidden are never offered.
 *
 * The whole workbook is read, never a sample; large sheets are read from the
 * file in row bands with the session's edits laid over them, and the finder
 * yields between bands so the screen keeps responding.
 */
import { detectSensitive, isNameColumnHeader } from '@genoffice/agent-core/sensitive-detect'
import { sensitiveKindName, type SensitiveKind } from '@genoffice/agent-core/sensitive-kinds'
import { columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import { sensitiveContextOf, type SensitiveCandidateRow } from '@genoffice/ui'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'
import type { WorkbookReadContext } from '../ai/workbook-readers'
import { chunkRowsFor } from '../merge-workbooks'
import { fileToScreen } from '../view-transform'
import { columnHideStart } from './actions'
import { HIDING_MAX_ROW, markAt, readHidingMarks, type HidingArea } from './marks'

export interface FindCell {
  readonly row: number
  readonly column: number
  readonly text: string
}

export interface FindSheet {
  readonly id: string
  readonly name: string
  /** the sheet's non-empty cells, in any order */
  readonly cells: readonly FindCell[]
}

export interface FindInput {
  readonly sheets: readonly FindSheet[]
  readonly notes: readonly { sheetId: string; row: number; column: number; text: string }[]
  readonly chartTitles: readonly { sheetId: string; title: string }[]
  /** whether a cell is already hidden */
  readonly hidden: (sheetId: string, row: number, column: number) => boolean
}

export interface SheetCandidate {
  readonly row: SensitiveCandidateRow
  readonly kind: SensitiveKind
  /** what the exclusion memory hashes for this candidate */
  readonly value: string
  /** what confirming hides; empty when the spot cannot be hidden */
  readonly areas: readonly HidingArea[]
  /** a whole-column mark (one mark of its own) */
  readonly column: boolean
}

interface CellSpot {
  readonly sheetId: string
  readonly row: number
  readonly column: number
}

/** The candidates of a workbook, in sheet and reading order. */
export function findSheetCandidates(input: FindInput, lang: string): SheetCandidate[] {
  const out: SheetCandidate[] = []
  const sheetName = (id: string): string =>
    input.sheets.find((sheet) => sheet.id === id)?.name ?? id
  for (const sheet of input.sheets) {
    const byColumn = new Map<number, FindCell[]>()
    for (const cell of sheet.cells) {
      const list = byColumn.get(cell.column) ?? []
      list.push(cell)
      byColumn.set(cell.column, list)
    }
    /** per column: the header row and its text, when the column has a header */
    const headers = new Map<number, { row: number; text: string }>()
    const nameColumns = new Set<number>()
    for (const [column, cells] of byColumn) {
      cells.sort((a, b) => a.row - b.row)
      const top: (CellScalar | undefined)[] = []
      for (const cell of cells) {
        if (cell.row >= 200) break
        top[cell.row] = cell.text
      }
      const start = columnHideStart(Array.from({ length: 200 }, (_, row) => top[row]))
      if (start === 0) continue
      const header = { row: start - 1, text: String(top[start - 1] ?? '') }
      headers.set(column, header)
      const values = cells.filter((cell) => cell.row > header.row)
      if (!isNameColumnHeader(header.text)) continue
      nameColumns.add(column)
      const shown = values.filter((cell) => !input.hidden(sheet.id, cell.row, column))
      if (shown.length === 0) continue
      const area: HidingArea = {
        sheetId: sheet.id,
        startRow: start,
        endRow: HIDING_MAX_ROW,
        startColumn: column,
        endColumn: column,
      }
      const label = sensitiveKindName('name', lang)
      out.push({
        kind: 'name',
        value: `column\u0000${sheet.name}\u0000${columnLabel(column)}\u0000${header.text}`,
        areas: [area],
        column: true,
        row: {
          id: `col:${sheet.id}:${column}`,
          kind: 'name',
          value: shown[0]?.text ?? header.text,
          after: shown.length > 1 ? ` (+${shown.length - 1})` : '',
          location: `${sheet.name}!${columnLabel(column)}${start + 1}:${columnLabel(column)}`,
          label,
          hideable: true,
        },
      })
    }
    const pieces = [...sheet.cells]
      .filter(
        (cell) =>
          !nameColumns.has(cell.column) || cell.row <= (headers.get(cell.column)?.row ?? -1),
      )
      .filter((cell) => !input.hidden(sheet.id, cell.row, cell.column))
      .sort((a, b) => a.row - b.row || a.column - b.column)
      .map((cell) => {
        const header = headers.get(cell.column)
        return {
          text: cell.text,
          location: { sheetId: sheet.id, row: cell.row, column: cell.column } as CellSpot,
          ...(header && cell.row > header.row ? { header: header.text } : {}),
        }
      })
    const texts = new Map(
      pieces.map((piece) => [`${piece.location.row}:${piece.location.column}`, piece.text]),
    )
    for (const found of detectSensitive<CellSpot>(pieces)) {
      const spot = found.location
      const text = texts.get(`${spot.row}:${spot.column}`) ?? found.value
      const context = sensitiveContextOf(text, found.start, found.end)
      out.push({
        kind: found.kind,
        value: found.value,
        column: false,
        areas: [
          {
            sheetId: spot.sheetId,
            startRow: spot.row,
            endRow: spot.row,
            startColumn: spot.column,
            endColumn: spot.column,
          },
        ],
        row: {
          id: `cell:${spot.sheetId}:${spot.row}:${spot.column}:${found.start}`,
          kind: found.kind,
          value: found.value,
          before: context.before,
          after: context.after,
          location: `${sheet.name}!${columnLabel(spot.column)}${spot.row + 1}`,
          label: sensitiveKindName(found.kind, lang),
          hideable: true,
        },
      })
    }
  }
  // the spots no mark can cover: listed and counted, never hidden from here
  const unhideable = (
    reason: 'sheet-name' | 'chart-title' | 'cell-note',
    pieces: { text: string; location: string; id: string }[],
  ): void => {
    for (const found of detectSensitive(pieces)) {
      const piece = pieces.find((candidate) => candidate.location === found.location)
      const context = sensitiveContextOf(piece?.text ?? found.value, found.start, found.end)
      out.push({
        kind: found.kind,
        value: found.value,
        column: false,
        areas: [],
        row: {
          id: `${reason}:${piece?.id ?? found.location}:${found.start}`,
          kind: found.kind,
          value: found.value,
          before: context.before,
          after: context.after,
          location: found.location,
          label: sensitiveKindName(found.kind, lang),
          hideable: false,
          reason,
        },
      })
    }
  }
  unhideable(
    'sheet-name',
    input.sheets.map((sheet) => ({ text: sheet.name, location: sheet.name, id: sheet.id })),
  )
  unhideable(
    'chart-title',
    input.chartTitles.map((chart, index) => ({
      text: chart.title,
      location: sheetName(chart.sheetId),
      id: `${chart.sheetId}:${index}`,
    })),
  )
  unhideable(
    'cell-note',
    input.notes.map((note) => ({
      text: note.text,
      location: `${sheetName(note.sheetId)}!${columnLabel(note.column)}${note.row + 1}`,
      id: `${note.sheetId}:${note.row}:${note.column}`,
    })),
  )
  return out
}

function cellText(value: CellScalar | undefined): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

const yieldToScreen = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Read every non-empty cell of a lazily opened file sheet, session edits laid over it. */
async function lazySheetCells(ctx: WorkbookReadContext, sheetId: string): Promise<FindCell[]> {
  const state = ctx.lazyWorkbookRef.current
  if (!state) return []
  const meta = state.file.sheets.find((sheet) => sheet.id === sheetId)
  const cells = new Map<string, FindCell>()
  if (meta) {
    const ops = state.editJournal.structuralOps.get(sheetId) ?? []
    const columns = Math.max(1, meta.columnCount)
    const step = chunkRowsFor(columns)
    for (let startRow = 0; startRow < meta.rowCount; startRow += step) {
      const endRow = Math.min(meta.rowCount - 1, startRow + step - 1)
      const range = { startRow, endRow, startColumn: 0, endColumn: columns - 1 }
      const deadline = Date.now() + 120_000
      let result = await window.desktopApi.readWorkbookRange({
        sessionId: state.file.sessionId,
        sheetId,
        range,
      })
      while (
        !result.indexingComplete &&
        (result.indexedThroughRow === null || result.indexedThroughRow < endRow)
      ) {
        if (Date.now() > deadline) throw new Error('The workbook is still being read.')
        await new Promise((resolve) => setTimeout(resolve, 400))
        result = await window.desktopApi.readWorkbookRange({
          sessionId: state.file.sessionId,
          sheetId,
          range,
        })
      }
      for (const cell of result.cells) {
        const text = cellText(cell.value)
        if (!text) continue
        const row = fileToScreen(ops, 'row', cell.row)
        const column = fileToScreen(ops, 'column', cell.column)
        if (row === null || column === null) continue
        cells.set(`${row}:${column}`, { row, column, text })
      }
      await yieldToScreen()
    }
  } else {
    // a sheet added this session lives in the grid only
    const sheet = ctx.univerRef.current?.univerAPI.getActiveWorkbook()?.getSheetBySheetId(sheetId)
    const lastRow = sheet?.getLastRow() ?? -1
    const lastColumn = sheet?.getLastColumn() ?? -1
    if (sheet && lastRow >= 0 && lastColumn >= 0) {
      const values = sheet.getRange(0, 0, lastRow + 1, lastColumn + 1).getValues()
      values.forEach((rowValues, row) =>
        rowValues.forEach((value, column) => {
          const text = cellText(value as CellScalar)
          if (text) cells.set(`${row}:${column}`, { row, column, text })
        }),
      )
    }
  }
  for (const entry of state.editJournal.cells.get(sheetId)?.values() ?? []) {
    if (!entry.hasValue) continue
    const key = `${entry.row}:${entry.column}`
    const text = cellText(entry.value)
    if (text) cells.set(key, { row: entry.row, column: entry.column, text })
    else cells.delete(key)
  }
  return [...cells.values()]
}

/** Everything the finder reads, gathered from the open workbook. */
export async function gatherFindInput(ctx: WorkbookReadContext): Promise<FindInput> {
  const runtime = ctx.univerRef.current
  const workbook = runtime?.univerAPI.getActiveWorkbook()
  const state = ctx.lazyWorkbookRef.current
  const marks = readHidingMarks(runtime, state)
  const markList = marks.ok ? marks.marks : []
  const sheets: FindSheet[] = []
  const notes: FindInput['notes'][number][] = []
  for (const sheet of workbook?.getSheets() ?? []) {
    const id = sheet.getSheetId()
    let cells: FindCell[]
    if (state) {
      cells = await lazySheetCells(ctx, id)
    } else {
      const snapshot = ctx.adapterRef.current.getSnapshot().sheets.find((entry) => entry.id === id)
      cells = Object.entries(snapshot?.cells ?? {}).flatMap(([address, cell]) => {
        const m = /^([A-Z]+)(\d+)$/.exec(address)
        const text = cellText(cell.value)
        if (!m || !text) return []
        let column = 0
        for (const ch of m[1] ?? '') column = column * 26 + (ch.charCodeAt(0) - 64)
        return [{ row: Number(m[2]) - 1, column: column - 1, text }]
      })
    }
    sheets.push({ id, name: sheet.getSheetName(), cells })
    try {
      for (const note of sheet.getNotes()) {
        notes.push({ sheetId: id, row: note.row, column: note.col, text: note.note })
      }
    } catch {
      // notes unavailable on this sheet
    }
  }
  const chartTitles = state
    ? [...state.file.visuals, ...state.editJournal.visualAdds]
        .filter((visual) => visual.kind === 'chart' && visual.chart?.title)
        .map((visual) => ({ sheetId: visual.sheetId, title: visual.chart?.title ?? '' }))
    : []
  return {
    sheets,
    notes,
    chartTitles,
    // a workbook whose marks cannot be read offers everything; hiding twice is harmless
    hidden: (sheetId, row, column) => markAt(markList, sheetId, row, column) !== undefined,
  }
}
