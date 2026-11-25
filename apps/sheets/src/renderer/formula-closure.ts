/// Closure-mode analysis for streamed workbooks: given every formula cell,
/// compute the set of cells the Univer engine needs (formulas plus their
/// referenced precedents) so a large, formula-light workbook can recalculate
/// live without a full preload.

import {
  FORMULA_REFERENCE_PATTERN,
  qualifierMatches,
} from '@genoffice/xlsx-gateway/gateway/xlsx-structure'
import { swapPosition, toSwapSpans } from './edit-journal'

export interface ClosureSheetInput {
  readonly id: string
  readonly name: string
  readonly rowCount: number
  readonly columnCount: number
  readonly formulas: readonly { row: number; column: number; formula: string }[]
}

export type ClosureResult =
  | {
      readonly ok: true
      /// Per sheet id: every closure cell (formulas and precedents).
      readonly cellsBySheet: Map<string, Set<number>>
      readonly formulaCount: number
      readonly totalCells: number
    }
  | { readonly ok: false; readonly reason: string }

const MAX_COLUMNS = 16_384

export function cellKey(row: number, column: number): number {
  return row * MAX_COLUMNS + column
}

export function keyRow(key: number): number {
  return Math.floor(key / MAX_COLUMNS)
}

export function keyColumn(key: number): number {
  return key % MAX_COLUMNS
}

interface ParsedToken {
  readonly startRow: number | null
  readonly endRow: number | null
  readonly startColumn: number | null
  readonly endColumn: number | null
}

function lettersToColumn(letters: string): number {
  let column = 0
  for (const character of letters) {
    column = column * 26 + character.charCodeAt(0) - 64
  }
  return column - 1
}

/// Null bounds mean "whole axis" (A:A or 1:5 references), clamped to the
/// target sheet's used range by the caller.
function parseReferenceToken(token: string): ParsedToken | null {
  const wholeColumn = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/.exec(token)
  if (wholeColumn) {
    const start = lettersToColumn(wholeColumn[1] ?? 'A')
    const end = lettersToColumn(wholeColumn[2] ?? 'A')
    return {
      startRow: null,
      endRow: null,
      startColumn: Math.min(start, end),
      endColumn: Math.max(start, end),
    }
  }
  const wholeRow = /^\$?([0-9]+):\$?([0-9]+)$/.exec(token)
  if (wholeRow) {
    const start = Number(wholeRow[1]) - 1
    const end = Number(wholeRow[2]) - 1
    return {
      startRow: Math.min(start, end),
      endRow: Math.max(start, end),
      startColumn: null,
      endColumn: null,
    }
  }
  const cells = token.split(':').map((part) => /^\$?([A-Z]{1,3})\$?([0-9]+)$/.exec(part))
  if (cells.some((cell) => cell === null)) return null
  const rows = cells.map((cell) => Number(cell?.[2]) - 1)
  const columns = cells.map((cell) => lettersToColumn(cell?.[1] ?? 'A'))
  return {
    startRow: Math.min(...rows),
    endRow: Math.max(...rows),
    startColumn: Math.min(...columns),
    endColumn: Math.max(...columns),
  }
}

interface FormulaReference {
  readonly qualifier: string | undefined
  readonly token: ParsedToken
}

export function parseFormulaReferences(formula: string): FormulaReference[] {
  const references: FormulaReference[] = []
  const segments = formula.split('"')
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? '').matchAll(FORMULA_REFERENCE_PATTERN)) {
      const token = parseReferenceToken(match[3] ?? '')
      if (token) references.push({ qualifier: match[2], token })
    }
  }
  return references
}

const EXTERNAL_WORKBOOK_PATTERN = /\[(?:\d+|[^[\]]*\.xl\w*)\]/i

const EXCEL_ERROR_LITERAL_PATTERN =
  /#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/gi

const STRUCTURED_TABLE_REF_PATTERN =
  /(?<![\p{L}\p{N}_.$'!])([\p{L}_][\p{L}\p{N}_.]*)?(\[(?:[^\][]|\[[^\][]*\])*\])/gu

function skipQuotedSpan(formula: string, start: number): number {
  const quote = formula[start]
  let i = start + 1
  while (i < formula.length) {
    if (formula[i] === quote) {
      if (formula[i + 1] === quote) {
        i += 2
        continue
      }
      return i + 1
    }
    i += 1
  }
  return formula.length
}

function skipBracketSpan(formula: string, start: number): number {
  let depth = 0
  let i = start
  while (i < formula.length) {
    const ch = formula[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return formula.length
}

interface BoundParamScope {
  readonly start: number
  readonly end: number
  readonly names: ReadonlySet<string>
}

/// Find the matching `)` for an opening `(` at `openParen` and split top-level
/// comma-separated arguments inside it.
function splitCallArgs(
  formula: string,
  openParen: number,
): { closeParen: number; args: string[] } | null {
  const args: string[] = []
  let depth = 1
  let argStart = openParen + 1
  let i = openParen + 1
  while (i < formula.length) {
    const ch = formula[i]!
    if (ch === '"' || ch === "'") {
      i = skipQuotedSpan(formula, i)
      continue
    }
    if (ch === '[') {
      i = skipBracketSpan(formula, i)
      continue
    }
    if (ch === '(' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        args.push(formula.slice(argStart, i))
        return { closeParen: i, args }
      }
    } else if (ch === ',' && depth === 1) {
      args.push(formula.slice(argStart, i))
      argStart = i + 1
    }
    i += 1
  }
  return null
}

const SINGLE_PARAM_PATTERN = /^(?:_xlpm\.)?([\p{L}_][\p{L}\p{N}_.]*)$/iu

/// Collect scoped local parameter names declared by LET and LAMBDA calls.
function boundParameterScopes(formula: string): BoundParamScope[] {
  if (!/(?:^|[^\p{L}\p{N}_.])(?:_xlfn\.)?(?:LET|LAMBDA)\s*\(/iu.test(formula)) return []
  const scopes: BoundParamScope[] = []
  let i = 0
  while (i < formula.length) {
    const ch = formula[i]!
    if (ch === '"' || ch === "'") {
      i = skipQuotedSpan(formula, i)
      continue
    }
    if (ch === '[') {
      i = skipBracketSpan(formula, i)
      continue
    }
    if (/[\p{L}_]/u.test(ch)) {
      const start = i
      i += 1
      while (i < formula.length && /[\p{L}\p{N}_.]/u.test(formula[i]!)) i += 1
      const prev = start === 0 ? '' : (formula[start - 1] ?? '')
      if (/[\p{L}\p{N}_.$'!]/u.test(prev)) continue
      const token = formula
        .slice(start, i)
        .toUpperCase()
        .replace(/^_XLFN\./, '')
      if (token === 'LET' || token === 'LAMBDA') {
        let after = i
        while (after < formula.length && /\s/.test(formula[after]!)) after += 1
        if (formula[after] === '(') {
          const parsed = splitCallArgs(formula, after)
          if (parsed && parsed.args.length >= 2) {
            const names = new Set<string>()
            const step = token === 'LET' ? 2 : 1
            for (let idx = 0; idx < parsed.args.length - 1; idx += step) {
              const paramMatch = SINGLE_PARAM_PATTERN.exec(parsed.args[idx]!.trim())
              if (paramMatch?.[1]) names.add(paramMatch[1].toLowerCase())
            }
            if (names.size > 0) {
              scopes.push({ start: after, end: parsed.closeParen, names })
            }
          }
          // Step past `(` so nested LET/LAMBDA calls inside arguments are also collected.
          i = after + 1
          continue
        }
      }
      continue
    }
    i += 1
  }
  return scopes
}

function isBoundAt(scopes: readonly BoundParamScope[], offset: number, lowerName: string): boolean {
  for (const scope of scopes) {
    if (offset >= scope.start && offset <= scope.end && scope.names.has(lowerName)) return true
  }
  return false
}

function stripStructuredRefs(
  segment: string,
  resolvedTables?: { has(name: string): boolean },
): { text: string; unresolvedTable: boolean } {
  if (!segment.includes('[')) return { text: segment, unresolvedTable: false }
  let unresolvedTable = false
  const text = segment.replace(
    STRUCTURED_TABLE_REF_PATTERN,
    (full, tableName: string | undefined, bracketBody: string) => {
      // Univer's TableReferenceObject resolves explicit `TableName[...]` forms
      // (`Table[Col]`, `Table[[#This Row],[Col]]`, etc.), not bare `[@Col]` or
      // `@` shorthand (`Table[@Col]`). Pad with spaces matching `full.length`
      // so downstream `isBoundAt` offsets for LET/LAMBDA scopes never drift.
      if (tableName && !bracketBody.includes('@') && resolvedTables?.has(tableName.toLowerCase())) {
        return ' '.repeat(full.length)
      }
      unresolvedTable = true
      return full
    },
  )
  return { text, unresolvedTable }
}

/// Identifiers in an unquoted formula segment that are neither references,
/// function calls, error literals nor TRUE/FALSE: the defined names it uses.
function namesInSegment(
  segment: string,
  segmentOffset = 0,
  scopes: readonly BoundParamScope[] = [],
): string[] {
  // Strip references (and their qualifiers) and error literals so they don't register.
  const withoutRefs = segment
    .replace(
      FORMULA_REFERENCE_PATTERN,
      (full, lead: string) => lead + ' '.repeat(full.length - lead.length),
    )
    .replace(EXCEL_ERROR_LITERAL_PATTERN, (full) => ' '.repeat(full.length))
  const names: string[] = []
  for (const match of withoutRefs.matchAll(/[\p{L}_][\p{L}\p{N}_.]*/gu)) {
    const before = match.index === 0 ? '' : (withoutRefs[match.index - 1] ?? '')
    if (/[\p{L}\p{N}_.$'!]/u.test(before)) continue
    const rawName = match[0]
    const name = rawName.replace(/^_xlpm\./i, '')
    if (name === 'TRUE' || name === 'FALSE') continue
    const rest = withoutRefs.slice(match.index + rawName.length)
    if (/^\s*\(/.test(rest)) continue
    if (isBoundAt(scopes, segmentOffset + match.index, name.toLowerCase())) continue
    names.push(name)
  }
  return names
}

/// True when the formula uses an identifier that is not a function call —
/// a defined name or an external reference the closure cannot resolve.
/// Names in `resolvedNames` (lowercase) and tables in `resolvedTables`
/// (lowercase) count as resolved.
export function containsUnresolvedNames(
  formula: string,
  resolvedNames?: { has(name: string): boolean },
  resolvedTables?: { has(name: string): boolean },
): boolean {
  const scopes = boundParameterScopes(formula)
  const segments = formula.split('"')
  let offset = 0
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ''
    if (index % 2 === 0) {
      // [n]Sheet!ref / '[n]Sheet name'!ref / 'C:\dir\[Book.xlsx]Sheet'!ref is
      // an external-workbook reference: the reference pattern would swallow it
      // as an ordinary sheet reference, but the closure can never resolve
      // another workbook.
      if (EXTERNAL_WORKBOOK_PATTERN.test(segment)) return true
      const { text, unresolvedTable } = stripStructuredRefs(segment, resolvedTables)
      if (unresolvedTable) return true
      for (const name of namesInSegment(text, offset, scopes)) {
        if (!resolvedNames?.has(name.toLowerCase())) return true
      }
    }
    offset += segment.length + 1
  }
  return false
}

/// The defined names the formula uses, lowercased.
export function usedDefinedNames(formula: string): string[] {
  const scopes = boundParameterScopes(formula)
  const segments = formula.split('"')
  const names: string[] = []
  let offset = 0
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ''
    if (index % 2 === 0) {
      for (const name of namesInSegment(segment, offset, scopes)) names.push(name.toLowerCase())
    }
    offset += segment.length + 1
  }
  return names
}

export interface DefinedNameInput {
  readonly name: string
  readonly formula: string
  /// Set for sheet-scoped names.
  readonly sheetIndex?: number | undefined
}

/// True when a reference in the formula is relative in any part (B1, $B1,
/// C:C). Excel resolves a name's relative reference against the cell that
/// uses the name; the engine pins it to the definition instead.
function hasRelativeReference(formula: string): boolean {
  const segments = formula.split('"')
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? '').matchAll(FORMULA_REFERENCE_PATTERN)) {
      const parts = (match[3] ?? '').split(':')
      if (parts.some((part) => !/^(?:\$[A-Z]{1,3})?(?:\$[0-9]+)?$/.test(part))) return true
    }
  }
  return false
}

/// INDIRECT's text may be an R1C1 address relative to the using cell
/// (`"rc[-1]"`), which the engine evaluates to 0, in plain cells too. The form
/// is only known at run time, so a name calling INDIRECT keeps the cache it
/// kept before names were recalculated. ROW(), COLUMN() and SHEET() without
/// an argument already resolve against the using cell.
const INDIRECT_CALL = /(?:^|[^\p{L}\p{N}_.])INDIRECT\s*\(/iu

function callsIndirect(formula: string): boolean {
  const segments = formula.split('"')
  for (let index = 0; index < segments.length; index += 2) {
    if (INDIRECT_CALL.test(segments[index] ?? '')) return true
  }
  return false
}

function hasErrorLiteral(formula: string): boolean {
  const segments = formula.split('"')
  for (let index = 0; index < segments.length; index += 2) {
    EXCEL_ERROR_LITERAL_PATTERN.lastIndex = 0
    if (EXCEL_ERROR_LITERAL_PATTERN.test(segments[index] ?? '')) return true
  }
  return false
}

/// Defined names whose formulas the engine recalculates the way Excel does,
/// lowercased and mapped to their bodies: a single workbook-scoped
/// definition the engine accepted, with absolute references only, no
/// INDIRECT call, and no names outside this set. Names defined at
/// more than one scope stay out (the engine keys names by text alone and
/// ignores the sheet-scope precedence), as do names in a reference cycle.
/// The functions a body calls are checked per using formula, where the
/// engine's function registry is known (see formulaKeepsCache).
export function recalculableDefinedNames(
  definedNames: readonly DefinedNameInput[],
  rejected: ReadonlySet<string>,
): Map<string, string> {
  const byName = new Map<string, DefinedNameInput[]>()
  for (const defined of definedNames) {
    const key = defined.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), defined])
  }
  const pending = new Map<string, string>()
  for (const [key, list] of byName) {
    const only = list.length === 1 ? list[0] : undefined
    if (!only || only.sheetIndex !== undefined || rejected.has(only.name)) continue
    if (
      hasRelativeReference(only.formula) ||
      callsIndirect(only.formula) ||
      hasErrorLiteral(only.formula)
    )
      continue
    pending.set(key, only.formula)
  }
  // Accept names bottom-up: a name joins once every name its body uses has.
  const accepted = new Map<string, string>()
  for (let grew = true; grew;) {
    grew = false
    for (const [key, formula] of pending) {
      if (containsUnresolvedNames(formula, accepted)) continue
      accepted.set(key, formula)
      pending.delete(key)
      grew = true
    }
  }
  return accepted
}

export function computeFormulaClosure(
  sheets: readonly ClosureSheetInput[],
  maxCells: number,
): ClosureResult {
  const byName = new Map(sheets.map((sheet) => [sheet.name.toLowerCase(), sheet]))
  const cellsBySheet = new Map<string, Set<number>>()
  let totalCells = 0
  let formulaCount = 0
  const add = (sheetId: string, key: number): boolean => {
    let cells = cellsBySheet.get(sheetId)
    if (!cells) {
      cells = new Set()
      cellsBySheet.set(sheetId, cells)
    }
    if (!cells.has(key)) {
      cells.add(key)
      totalCells += 1
    }
    return totalCells <= maxCells
  }

  for (const sheet of sheets) {
    for (const cell of sheet.formulas) {
      formulaCount += 1
      if (!add(sheet.id, cellKey(cell.row, cell.column))) {
        return { ok: false, reason: `closure exceeds ${maxCells} cells` }
      }
    }
  }
  for (const sheet of sheets) {
    for (const cell of sheet.formulas) {
      if (containsUnresolvedNames(cell.formula)) {
        return { ok: false, reason: 'formula uses a defined name or external reference' }
      }
      for (const reference of parseFormulaReferences(cell.formula)) {
        const target =
          reference.qualifier === undefined
            ? sheet
            : (sheets.find((candidate) =>
                qualifierMatches(reference.qualifier ?? '', candidate.name),
              ) ?? byName.get(unquote(reference.qualifier).toLowerCase()))
        if (!target) {
          return {
            ok: false,
            reason: `formula references an unknown sheet (${reference.qualifier ?? ''})`,
          }
        }
        const startRow = Math.max(reference.token.startRow ?? 0, 0)
        const endRow = Math.min(reference.token.endRow ?? target.rowCount - 1, target.rowCount - 1)
        const startColumn = Math.max(reference.token.startColumn ?? 0, 0)
        const endColumn = Math.min(
          reference.token.endColumn ?? target.columnCount - 1,
          target.columnCount - 1,
        )
        if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > maxCells) {
          return { ok: false, reason: `closure exceeds ${maxCells} cells` }
        }
        for (let row = startRow; row <= endRow; row += 1) {
          for (let column = startColumn; column <= endColumn; column += 1) {
            if (!add(target.id, cellKey(row, column))) {
              return { ok: false, reason: `closure exceeds ${maxCells} cells` }
            }
          }
        }
      }
    }
  }
  return { ok: true, cellsBySheet, formulaCount, totalCells }
}

function unquote(qualifier: string): string {
  return qualifier.startsWith("'") ? qualifier.slice(1, -1).replaceAll("''", "'") : qualifier
}

export interface ClosureRange {
  readonly startRow: number
  readonly endRow: number
  readonly startColumn: number
  readonly endColumn: number
}

/// Groups closure cells into fetchable row bands, each within the per-read
/// cell budget. Bands merge nearby rows (gap ≤ 32) sharing column bounds.
export function closureFetchRanges(
  cells: ReadonlySet<number>,
  maxCellsPerRange = 18_000,
): ClosureRange[] {
  const columnsByRow = new Map<number, { min: number; max: number }>()
  for (const key of cells) {
    const row = keyRow(key)
    const column = keyColumn(key)
    const bounds = columnsByRow.get(row)
    if (!bounds) columnsByRow.set(row, { min: column, max: column })
    else {
      bounds.min = Math.min(bounds.min, column)
      bounds.max = Math.max(bounds.max, column)
    }
  }
  const rows = [...columnsByRow.keys()].sort((left, right) => left - right)
  const ranges: ClosureRange[] = []
  let band: { startRow: number; endRow: number; minCol: number; maxCol: number } | null = null
  const flush = (): void => {
    if (!band) return
    ranges.push({
      startRow: band.startRow,
      endRow: band.endRow,
      startColumn: band.minCol,
      endColumn: band.maxCol,
    })
    band = null
  }
  for (const row of rows) {
    const bounds = columnsByRow.get(row)
    if (!bounds) continue
    if (band) {
      const minCol = Math.min(band.minCol, bounds.min)
      const maxCol = Math.max(band.maxCol, bounds.max)
      const area = (row - band.startRow + 1) * (maxCol - minCol + 1)
      if (row - band.endRow <= 32 && area <= maxCellsPerRange) {
        band.endRow = row
        band.minCol = minCol
        band.maxCol = maxCol
        continue
      }
      flush()
    }
    band = { startRow: row, endRow: row, minCol: bounds.min, maxCol: bounds.max }
  }
  flush()
  return ranges
}

/// Read bands over formula cells for the sidecar recalc fallback: nearest
/// the viewport first, within the per-request cell budget. Bands past the
/// budget wait for a later run.
export function recalcReadRanges(
  keys: ReadonlySet<number>,
  viewportStartRow: number,
  budget: number,
): ClosureRange[] {
  const bands = closureFetchRanges(keys).sort(
    (left, right) =>
      Math.abs(left.startRow - viewportStartRow) - Math.abs(right.startRow - viewportStartRow),
  )
  const ranges: ClosureRange[] = []
  let used = 0
  for (const band of bands) {
    const area = (band.endRow - band.startRow + 1) * (band.endColumn - band.startColumn + 1)
    if (used + area > budget) continue
    used += area
    ranges.push(band)
    if (ranges.length >= 200) break
  }
  return ranges
}

/// Shifts a screen-space pinned-cell map through one journaled row/column
/// operation (mirrors the edit journal's own entry shifting).
export function shiftPinnedCells<T>(
  entries: ReadonlyMap<string, T>,
  op: { kind: string; index: number; count: number; before?: number },
): Map<string, T> {
  const axis = op.kind === 'insert-cols' || op.kind === 'remove-cols' ? 'column' : 'row'
  const removing = op.kind === 'remove-rows' || op.kind === 'remove-cols'
  const swap =
    op.kind === 'move-rows' && op.before !== undefined
      ? toSwapSpans({ index: op.index, count: op.count, before: op.before })
      : null
  const shifted = new Map<string, T>()
  for (const [key, value] of entries) {
    const [rowText, columnText] = key.split(':')
    const row = Number(rowText)
    const column = Number(columnText)
    const position = axis === 'row' ? row : column
    let moved: number | null
    if (swap) {
      moved = swapPosition(position, swap)
    } else if (removing) {
      if (position >= op.index && position < op.index + op.count) moved = null
      else moved = position >= op.index + op.count ? position - op.count : position
    } else {
      moved = position >= op.index ? position + op.count : position
    }
    if (moved === null) continue
    const next = axis === 'row' ? `${moved}:${column}` : `${row}:${moved}`
    shifted.set(next, value)
  }
  return shifted
}
