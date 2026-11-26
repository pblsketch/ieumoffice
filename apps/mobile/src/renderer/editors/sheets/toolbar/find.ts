/**
 * Find and replace over the open workbook, for the phone's find sheet. The
 * desktop finds through Univer's find-replace plugin (a desktop UI the phone
 * does not register) wrapped by lazy-find.ts for streamed workbooks; the
 * phone runs the same two halves without that plugin:
 *
 * - cells the grid holds (the loaded window, or every cell once the whole
 *   workbook is in) are matched on the grid's own cells;
 * - the rest of the file is searched by the engine (`findWorkbookCells`,
 *   through the desktop's sidecar-find.ts), with this session's edits laid
 *   over it (lazy-find.ts `journalShadowKeys` / `collectJournalMatches`).
 *
 * The match test, the engine query, the replacement and the way a hit is
 * shown (load its rows, scroll, select) are the desktop's (lazy-find.ts).
 * Replacing writes onto the cell, so the edit journal records it.
 */
import type { ICellData, IRange, Nullable } from '@univerjs/core'
import {
  findSheetCellsInFile,
  MAX_FIND_MATCHES,
  sidecarFindAvailable,
} from '../../../../../../sheets/src/renderer/sidecar-find'
import type {
  LazyWorkbookState,
  UniverRuntime,
} from '../../../../../../sheets/src/renderer/univer-state'
import { pcLazyFind, pcUniverSyncFind, type PcFindQuery } from './pcToolbarModules'

type LazyRef = { current: LazyWorkbookState | null }

export interface FindOptions {
  readonly text: string
  readonly matchCase: boolean
  readonly entireCell: boolean
  readonly workbook: boolean
  readonly formulas: boolean
}

export interface FindHit {
  readonly sheetId: string
  readonly row: number
  readonly column: number
  /** The text the match was made on (value text, or the formula when looking in formulas). */
  readonly matchedText: string | null
  readonly isFormula: boolean
  /** The cell's scalar before a replacement (keeps numbers numeric). */
  readonly rawValue: string | number | boolean | null | undefined
}

export interface FindResult {
  readonly hits: readonly FindHit[]
  /** Stopped at the desktop's match cap. */
  readonly capped: boolean
}

/** The desktop dialog's query for these options (Univer's `IFindQuery`). */
export function findQuery(options: FindOptions): PcFindQuery {
  return {
    findString: options.text,
    caseSensitive: options.matchCase,
    matchesTheWholeCell: options.entireCell,
    findBy: options.formulas ? 'formula' : 'value',
    findScope: options.workbook ? 'unit' : 'subunit',
    findDirection: 'row',
    replaceRevealed: false,
  }
}

/** What Univer's find matches a grid cell on: its plain value (rich text by its text). */
function cellText(cell: Nullable<ICellData>): string | null {
  if (!cell) return null
  const body = cell.p?.body?.dataStream
  // A document body ends with its paragraph and section marks.
  if (typeof body === 'string') return body.replace(/\r?\n$/, '')
  return pcLazyFind.scalarToText(cell.v)
}

function cellFormula(cell: Nullable<ICellData>): string | undefined {
  return typeof cell?.f === 'string' && cell.f.length > 0 ? cell.f : undefined
}

function hitOf(
  sheetId: string,
  row: number,
  column: number,
  value: string | number | boolean | null | undefined,
  valueText: string | null,
  formula: string | undefined,
  byFormula: boolean,
): FindHit {
  const isFormula = formula !== undefined
  return {
    sheetId,
    row,
    column,
    matchedText: (byFormula && isFormula ? formula : valueText) ?? null,
    isFormula,
    rawValue: isFormula ? undefined : value,
  }
}

export async function findInWorkbook(
  runtime: UniverRuntime,
  lazyWorkbookRef: LazyRef,
  options: FindOptions,
  alive: () => boolean = () => true,
): Promise<FindResult> {
  const query = findQuery(options)
  const test = pcLazyFind.buildLazyCellTest(query)
  const workbook = runtime.univerAPI.getActiveWorkbook()
  if (!test || !workbook) return { hits: [], capped: false }
  const state = lazyWorkbookRef.current
  const streamed = state !== null && !state.flags.preloadComplete
  const byFormula = query.findBy === 'formula'
  const activeId = workbook.getActiveSheet()?.getSheetId()
  const sheets = workbook
    .getSheets()
    .filter((sheet) => options.workbook || sheet.getSheetId() === activeId)
  const hits: FindHit[] = []
  let capped = false
  for (const sheet of sheets) {
    if (!alive()) break
    const sheetId = sheet.getSheetId()
    const found = new Map<string, FindHit>()
    const add = (hit: FindHit) => {
      const key = `${hit.row}:${hit.column}`
      if (!found.has(key)) found.set(key, hit)
    }
    // The grid's own cells (inside the loaded window while streamed).
    sheet
      .getSheet()
      .getCellMatrix()
      .forValue((row, column, cell) => {
        if (streamed && state && !pcLazyFind.coveredByWindow(state, sheetId, row, column)) return
        const valueText = cellText(cell)
        const formula = cellFormula(cell)
        if (!test({ value: valueText, formula })) return
        add(hitOf(sheetId, row, column, cell?.v ?? null, valueText, formula, byFormula))
      })
    if (streamed && state) {
      // This session's edits outside the window, then the file's cells they do not shadow.
      for (const cell of pcLazyFind.collectJournalMatches(state, sheetId, test)) {
        add(
          hitOf(
            sheetId,
            cell.row,
            cell.column,
            cell.value,
            pcLazyFind.scalarToText(cell.value),
            cell.formula,
            byFormula,
          ),
        )
      }
      if (sidecarFindAvailable()) {
        const shadowed = pcLazyFind.journalShadowKeys(state, sheetId)
        const outcome = await findSheetCellsInFile(state, sheetId, pcLazyFind.sidecarQuery(query), {
          alive,
          maxMatches: Math.max(0, MAX_FIND_MATCHES - hits.length - found.size),
          onPage: (page) => {
            let kept = 0
            for (const hit of page) {
              if (pcLazyFind.coveredByWindow(state, sheetId, hit.row, hit.column)) continue
              if (shadowed.has(`${hit.row}:${hit.column}`)) continue
              add(
                hitOf(
                  sheetId,
                  hit.row,
                  hit.column,
                  hit.value,
                  hit.valueText,
                  hit.formula,
                  byFormula,
                ),
              )
              kept += 1
            }
            return kept
          },
        })
        capped ||= outcome.capped
      }
    }
    hits.push(...[...found.values()].sort((a, b) => a.row - b.row || a.column - b.column))
    if (hits.length >= MAX_FIND_MATCHES) {
      capped = true
      break
    }
  }
  return { hits: hits.slice(0, MAX_FIND_MATCHES), capped }
}

/** lazy-find.ts `focusExtra`: activate the sheet, load the rows, scroll to the cell and select it. */
export function revealHit(
  runtime: UniverRuntime,
  lazyWorkbookRef: LazyRef,
  hit: FindHit,
  setMessage: (message: string) => void,
): void {
  try {
    const workbook = runtime.univerAPI.getActiveWorkbook()
    const worksheet = workbook?.getSheetBySheetId(hit.sheetId)
    if (!workbook || !worksheet) return
    if (worksheet.getSheetId() !== workbook.getActiveSheet()?.getSheetId()) {
      workbook.setActiveSheet(worksheet)
    }
    const range: IRange = {
      startRow: hit.row,
      endRow: hit.row,
      startColumn: hit.column,
      endColumn: hit.column,
    }
    if (lazyWorkbookRef.current) {
      void pcUniverSyncFind.ensureLazyRangeLoaded(
        runtime,
        lazyWorkbookRef,
        worksheet,
        range,
        setMessage,
      )
    }
    worksheet.scrollToCell(hit.row, hit.column)
    worksheet.getRange(hit.row, hit.column, 1, 1).activate()
  } catch {
    // The workbook closed mid-jump.
  }
}

/**
 * lazy-find.ts `replaceAllOccurrences` (not exported there): every
 * occurrence, with the query's case sensitivity, like Excel's Replace All.
 */
function replaceAllOccurrences(text: string, query: PcFindQuery, replaceString: string): string {
  const raw = query.findString ?? ''
  const needle = (query.caseSensitive ? raw : raw.toLowerCase()).trim()
  if (!needle) return text
  const haystack = query.caseSensitive ? text : text.toLowerCase()
  let result = ''
  let cursor = 0
  for (;;) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) {
      result += text.slice(cursor)
      break
    }
    result += text.slice(cursor, index) + replaceString
    cursor = index + needle.length
  }
  return result
}

/**
 * Whether a hit can be replaced (lazy-find.ts `makeCellMatch`): formula
 * cells only while looking in formulas, plain cells when they hold a value.
 */
export function replaceable(hit: FindHit, options: FindOptions): boolean {
  if (hit.isFormula) return options.formulas
  return hit.rawValue !== null && hit.rawValue !== undefined
}

/** lazy-find.ts `writeExtraReplacement`: writes the replacement onto the cell. */
export function replaceHit(
  runtime: UniverRuntime,
  hit: FindHit,
  options: FindOptions,
  replaceString: string,
): boolean {
  if (!replaceable(hit, options)) return false
  try {
    const worksheet = runtime.univerAPI.getActiveWorkbook()?.getSheetBySheetId(hit.sheetId)
    if (!worksheet) return false
    const query = findQuery(options)
    const replaced = replaceAllOccurrences(hit.matchedText ?? '', query, replaceString)
    const target = worksheet.getRange(hit.row, hit.column, 1, 1)
    if (hit.isFormula) target.setValues([[{ f: replaced }]])
    else target.setValues([[{ v: pcLazyFind.coerceReplaceValue(hit.rawValue, replaced) }]])
    return true
  } catch {
    return false
  }
}
