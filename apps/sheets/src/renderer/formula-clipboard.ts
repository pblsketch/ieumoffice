/**
 * Excel & Google Sheets formula clipboard interoperability + cached/streamed
 * formula copy & autofill support.
 *
 * 1. Copy out: attaches HTML-escaped `x:fmla` (A1, Excel), `data-sheets-formula`
 *    (R1C1, Google Sheets), and `data-ieum-origin` (`row,col`, cross-tab shift)
 *    to copied `<td>` cells. Also populates `f` in Univer's internal copy
 *    fragment for cache-only / streamed formula cells whose raw matrix omits `f`.
 * 2. Paste in: parses `x:fmla`, `data-sheets-formula` (R1C1 → A1 at target),
 *    and `data-ieum-origin` (relative A1 shift) from external or cross-tab HTML
 *    and writes live formulas in the same undo transaction as Univer's paste.
 * 3. AutoFill: lets Univer's AutoFillController see harvested formula text on
 *    cache-only / streamed cells so drag-fill / Ctrl+D / Ctrl+R shift formulas
 *    instead of filling static series numbers.
 */
import {
  IUniverInstanceService,
  ObjectMatrix,
  UniverInstanceType,
  type ICellData,
  type Nullable,
  type Workbook,
  type Worksheet,
} from '@univerjs/core'
import { FormulaDataModel } from '@univerjs/engine-formula'
import {
  AutoFillController,
  SetRangeValuesMutation,
  SetRangeValuesUndoMutationFactory,
  type ISetRangeValuesMutationParams,
} from '@univerjs/sheets'
import {
  ISheetClipboardService,
  PREDEFINED_HOOK_NAME_COPY,
  PREDEFINED_HOOK_NAME_PASTE,
  type ISheetClipboardHook,
  type ISheetDiscreteRangeLocation,
} from '@univerjs/sheets-ui'

import { columnIndex, columnLabel } from '@genoffice/xlsx-gateway/domain/cell-address'
import { offsetFormulaRefs } from '@genoffice/xlsx-gateway/domain/formula-shift'
import { MAX_GRID_COLUMNS, MAX_GRID_ROWS } from '@genoffice/xlsx-gateway/shared/grid-bounds'
import { indexedFormulaText } from './formula-view'
import { sharedFormulaResolverFor } from './shared-formula-journal'
import { formulaKeepsCache } from './univer-sync'
import type { LazyWorkbookState, UniverRuntime } from './univer-state'

export interface ExternalFormulaCell {
  readonly formula: string
  readonly format: 'a1' | 'r1c1'
  readonly originRow?: number
  readonly originCol?: number
}

export interface ExternalHtmlFormulas {
  readonly rows: number
  readonly cols: number
  readonly cells: ReadonlyMap<string, ExternalFormulaCell>
}

/// Escape characters that would break an HTML attribute emitted by Univer's
/// USMToHtmlService (which interpolates ` ${key}="${val}"` verbatim).
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
}

export function decodeHtmlEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (full, dec, hex, named) => {
    if (dec !== undefined) {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : full
    }
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : full
    }
    switch (named) {
      case 'amp':
        return '&'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'nbsp':
        return '\u00a0'
      default:
        return full
    }
  })
}

/// Strip OOXML storage prefixes (`_xlfn._xlws.`, `_xlfn.`, `_xlws.`, `_xlpm.`)
/// outside string literals and single-quoted sheet names.
export function stripClipboardFormulaMarkers(formula: string): string {
  if (!/_xl(?:fn|ws|pm)\./i.test(formula)) {
    return formula
  }
  let out = ''
  let i = 0
  const len = formula.length
  while (i < len) {
    const ch = formula[i]!
    if (ch === '"' || ch === "'") {
      const quote = ch
      const start = i
      i += 1
      while (i < len) {
        if (formula[i] === quote) {
          if (formula[i + 1] === quote) {
            i += 2
            continue
          }
          i += 1
          break
        }
        i += 1
      }
      out += formula.slice(start, i)
      continue
    }
    if (ch === '[') {
      let depth = 0
      const start = i
      while (i < len) {
        if (formula[i] === '[') depth += 1
        else if (formula[i] === ']') {
          depth -= 1
          if (depth === 0) {
            i += 1
            break
          }
        }
        i += 1
      }
      out += formula.slice(start, i)
      continue
    }
    if (/[\p{L}_]/u.test(ch)) {
      const start = i
      i += 1
      while (i < len && /[\p{L}\p{N}_.\\$]/u.test(formula[i]!)) i += 1
      const token = formula.slice(start, i)
      const prev = start === 0 ? '' : (formula[start - 1] ?? '')
      if (/[\p{L}\p{N}_.$']/u.test(prev)) {
        out += token
        continue
      }
      const pmMatch = /^_xlpm\.(.+)$/i.exec(token)
      if (pmMatch) {
        out += pmMatch[1]
        continue
      }
      const fnMatch = /^(?:_xlfn\._xlws\.|_xlfn\.|_xlws\.)(.+)$/i.exec(token)
      if (fnMatch) {
        let after = i
        while (after < len && /\s/.test(formula[after]!)) after += 1
        if (formula[after] === '(') {
          out += fnMatch[1]
          continue
        }
      }
      out += token
      continue
    }
    out += ch
    i += 1
  }
  return out
}

// Protect string literals and bracketed structured references during reference rewrites.
const SKIP_LITERAL_OR_STRUCTURED_RE =
  /((?:"(?:[^"]|"")*")|(?:(?<=[\p{L}\p{N}_.])\[(?:[^\][]|\[[^\][]*\])*\]))/u

// Same guard for R1C1 formulas, without swallowing R[-1]/C[0] numeric bracket offsets.
const SKIP_LITERAL_OR_STRUCTURED_R1C1_RE =
  /((?:"(?:[^"]|"")*")|(?:(?<=[\p{L}\p{N}_.])\[(?!-?\d+\])(?:[^\][]|\[[^\][]*\])*\]))/u

const A1_REF_RE =
  /(?<![\p{L}\p{N}_.$!])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7}))?(?![\p{L}\p{N}_.(])/gu

const A1_COL_SPAN_RE =
  /(?<![\p{L}\p{N}_.$!:])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\p{L}\p{N}_.($!:])/gu

const A1_ROW_SPAN_RE =
  /(?<![\p{L}\p{N}_.$!:])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?(\$?)([0-9]{1,7}):(\$?)([0-9]{1,7})(?![\p{L}\p{N}_.($!:])/gu

function formatR1C1Axis(prefix: 'R' | 'C', abs: string, index: number, base: number): string {
  if (abs === '$') return `${prefix}${index + 1}`
  const delta = index - base
  return delta === 0 ? prefix : `${prefix}[${delta}]`
}

/// Convert an A1 formula (located at 0-based `baseRow`, `baseCol`) into R1C1
/// notation suitable for Google Sheets' `data-sheets-formula` attribute.
export function a1FormulaToR1C1(formula: string, baseRow: number, baseCol: number): string {
  const segments = formula.split(SKIP_LITERAL_OR_STRUCTURED_RE)
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      let out = segment.replace(
        A1_REF_RE,
        (
          match,
          quoted: string | undefined,
          bare: string | undefined,
          aAbsC: string,
          aCol: string,
          aAbsR: string,
          aRow: string,
          bAbsC: string | undefined,
          bCol: string | undefined,
          bAbsR: string | undefined,
          bRow: string | undefined,
        ) => {
          const c1 = columnIndex(aCol)
          const r1 = Number(aRow) - 1
          if (c1 < 0 || c1 >= MAX_GRID_COLUMNS || r1 < 0 || r1 >= MAX_GRID_ROWS) return match
          const prefix =
            quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
          const first = `${formatR1C1Axis('R', aAbsR, r1, baseRow)}${formatR1C1Axis('C', aAbsC, c1, baseCol)}`
          if (bCol === undefined || bRow === undefined) return `${prefix}${first}`
          const c2 = columnIndex(bCol)
          const r2 = Number(bRow) - 1
          if (c2 < 0 || c2 >= MAX_GRID_COLUMNS || r2 < 0 || r2 >= MAX_GRID_ROWS) return match
          const second = `${formatR1C1Axis('R', bAbsR ?? '', r2, baseRow)}${formatR1C1Axis('C', bAbsC ?? '', c2, baseCol)}`
          return `${prefix}${first}:${second}`
        },
      )
      out = out.replace(
        A1_COL_SPAN_RE,
        (
          match,
          quoted: string | undefined,
          bare: string | undefined,
          aAbs: string,
          aCol: string,
          bAbs: string,
          bCol: string,
        ) => {
          const c1 = columnIndex(aCol)
          const c2 = columnIndex(bCol)
          if (c1 < 0 || c1 >= MAX_GRID_COLUMNS || c2 < 0 || c2 >= MAX_GRID_COLUMNS) return match
          const prefix =
            quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
          return `${prefix}${formatR1C1Axis('C', aAbs, c1, baseCol)}:${formatR1C1Axis('C', bAbs, c2, baseCol)}`
        },
      )
      out = out.replace(
        A1_ROW_SPAN_RE,
        (
          match,
          quoted: string | undefined,
          bare: string | undefined,
          aAbs: string,
          aRow: string,
          bAbs: string,
          bRow: string,
        ) => {
          const r1 = Number(aRow) - 1
          const r2 = Number(bRow) - 1
          if (r1 < 0 || r1 >= MAX_GRID_ROWS || r2 < 0 || r2 >= MAX_GRID_ROWS) return match
          const prefix =
            quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
          return `${prefix}${formatR1C1Axis('R', aAbs, r1, baseRow)}:${formatR1C1Axis('R', bAbs, r2, baseRow)}`
        },
      )
      return out
    })
    .join('')
}

const R1C1_CELL_RE =
  /(?<![\p{L}\p{N}_.$!])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?R(?:\[(-?\d+)\]|(\d+))?C(?:\[(-?\d+)\]|(\d+))?(?::R(?:\[(-?\d+)\]|(\d+))?C(?:\[(-?\d+)\]|(\d+))?)?(?![\p{L}\p{N}_.(])/gu

const R1C1_ROW_SPAN_RE =
  /(?<![\p{L}\p{N}_.$!:])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?R(?:\[(-?\d+)\]|(\d+))?:R(?:\[(-?\d+)\]|(\d+))?(?![\p{L}\p{N}_.($!:])/gu

const R1C1_COL_SPAN_RE =
  /(?<![\p{L}\p{N}_.$!:])(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?C(?:\[(-?\d+)\]|(\d+))?:C(?:\[(-?\d+)\]|(\d+))?(?![\p{L}\p{N}_.($!:])/gu

function resolveR1C1Coord(
  relStr: string | undefined,
  absStr: string | undefined,
  target: number,
  max: number,
): { abs: boolean; index: number } | null {
  if (absStr !== undefined) {
    const idx = Number(absStr) - 1
    if (idx < 0 || idx >= max) return null
    return { abs: true, index: idx }
  }
  const delta = relStr !== undefined ? Number(relStr) : 0
  const idx = target + delta
  if (idx < 0 || idx >= max) return null
  return { abs: false, index: idx }
}

function formatA1Point(
  row: { abs: boolean; index: number },
  col: { abs: boolean; index: number },
): string {
  return `${col.abs ? '$' : ''}${columnLabel(col.index)}${row.abs ? '$' : ''}${row.index + 1}`
}

/// Convert an R1C1 formula (e.g. Google Sheets `data-sheets-formula`) into an
/// A1 formula anchored at 0-based `targetRow`, `targetCol`.
export function r1c1FormulaToA1(formula: string, targetRow: number, targetCol: number): string {
  const segments = formula.split(SKIP_LITERAL_OR_STRUCTURED_R1C1_RE)
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      let out = segment.replace(
        R1C1_CELL_RE,
        (
          _match,
          quoted: string | undefined,
          bare: string | undefined,
          r1Rel: string | undefined,
          r1Abs: string | undefined,
          c1Rel: string | undefined,
          c1Abs: string | undefined,
          r2Rel: string | undefined,
          r2Abs: string | undefined,
          c2Rel: string | undefined,
          c2Abs: string | undefined,
        ) => {
          const prefix =
            quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
          const hasSecond = _match.includes(':')
          const r1 = resolveR1C1Coord(r1Rel, r1Abs, targetRow, MAX_GRID_ROWS)
          const c1 = resolveR1C1Coord(c1Rel, c1Abs, targetCol, MAX_GRID_COLUMNS)
          if (!r1 || !c1) return `${prefix}#REF!`
          const first = formatA1Point(r1, c1)
          if (!hasSecond) return `${prefix}${first}`
          const r2 = resolveR1C1Coord(r2Rel, r2Abs, targetRow, MAX_GRID_ROWS)
          const c2 = resolveR1C1Coord(c2Rel, c2Abs, targetCol, MAX_GRID_COLUMNS)
          if (!r2 || !c2) return `${prefix}#REF!`
          return `${prefix}${first}:${formatA1Point(r2, c2)}`
        },
      )
      out = out.replace(
        R1C1_ROW_SPAN_RE,
        (
          _match,
          quoted: string | undefined,
          bare: string | undefined,
          r1Rel: string | undefined,
          r1Abs: string | undefined,
          r2Rel: string | undefined,
          r2Abs: string | undefined,
        ) => {
          const prefix =
            quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
          const r1 = resolveR1C1Coord(r1Rel, r1Abs, targetRow, MAX_GRID_ROWS)
          const r2 = resolveR1C1Coord(r2Rel, r2Abs, targetRow, MAX_GRID_ROWS)
          if (!r1 || !r2) return `${prefix}#REF!`
          return `${prefix}${r1.abs ? '$' : ''}${r1.index + 1}:${r2.abs ? '$' : ''}${r2.index + 1}`
        },
      )
      out = out.replace(
        R1C1_COL_SPAN_RE,
        (
          _match,
          quoted: string | undefined,
          bare: string | undefined,
          c1Rel: string | undefined,
          c1Abs: string | undefined,
          c2Rel: string | undefined,
          c2Abs: string | undefined,
        ) => {
          const prefix =
            quoted !== undefined ? `'${quoted}'!` : bare !== undefined ? `${bare}!` : ''
          const c1 = resolveR1C1Coord(c1Rel, c1Abs, targetCol, MAX_GRID_COLUMNS)
          const c2 = resolveR1C1Coord(c2Rel, c2Abs, targetCol, MAX_GRID_COLUMNS)
          if (!c1 || !c2) return `${prefix}#REF!`
          return `${prefix}${c1.abs ? '$' : ''}${columnLabel(c1.index)}:${c2.abs ? '$' : ''}${columnLabel(c2.index)}`
        },
      )
      return out
    })
    .join('')
}

function parseTagAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s=/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrText)) !== null) {
    const name = m[1]!.toLowerCase()
    const raw = m[2] ?? m[3] ?? m[4] ?? ''
    attrs[name] = decodeHtmlEntities(raw)
  }
  return attrs
}

function parseOrigin(raw: string | undefined): { row: number; col: number } | null {
  if (!raw) return null
  const m = /^(\d+),(\d+)$/.exec(raw.trim())
  if (!m) return null
  return { row: Number(m[1]), col: Number(m[2]) }
}

/// Extract formula metadata from the first HTML `<table>` on the clipboard
/// (Excel `x:fmla`, Google Sheets `data-sheets-formula`, or cross-tab
/// `data-ieum-origin`), matching HtmlToUSMService's rowspan/colspan grid.
export function extractExternalHtmlFormulas(html: string): ExternalHtmlFormulas | null {
  if (!/(?:x:fmla|data-sheets-formula)\s*=/i.test(html)) return null
  // Strip comments, <style>, and <script> blocks so stray tags inside them are ignored.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')

  const tagRe = /<(\/?)(table|tr|td|th)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
  let tableDepth = 0
  let finishedFirstTable = false
  let rowIndex = -1
  let colCursor = 0
  let maxCols = 0
  const occupied = new Set<string>()
  const cells = new Map<string, ExternalFormulaCell>()

  let match: RegExpExecArray | null
  while ((match = tagRe.exec(cleaned)) !== null) {
    const isClose = match[1] === '/'
    const tag = match[2]!.toLowerCase()
    if (tag === 'table') {
      if (!isClose) {
        if (finishedFirstTable) break
        tableDepth += 1
      } else if (tableDepth > 0) {
        tableDepth -= 1
        if (tableDepth === 0) finishedFirstTable = true
      }
      continue
    }
    if (tableDepth !== 1) continue
    if (tag === 'tr') {
      if (!isClose) {
        rowIndex += 1
        colCursor = 0
      }
      continue
    }
    if ((tag === 'td' || tag === 'th') && !isClose && rowIndex >= 0) {
      while (occupied.has(`${rowIndex}:${colCursor}`)) colCursor += 1
      const attrs = parseTagAttributes(match[3] ?? '')
      const rowSpan = Math.max(1, Number.parseInt(attrs.rowspan ?? '1', 10) || 1)
      const colSpan = Math.max(1, Number.parseInt(attrs.colspan ?? '1', 10) || 1)
      for (let dr = 0; dr < rowSpan; dr += 1) {
        for (let dc = 0; dc < colSpan; dc += 1) {
          occupied.add(`${rowIndex + dr}:${colCursor + dc}`)
        }
      }
      const xFmla = attrs['x:fmla']?.trim()
      const sheetsFmla = attrs['data-sheets-formula']?.trim()
      const origin = parseOrigin(attrs['data-ieum-origin'])
      if (origin && xFmla && xFmla.startsWith('=')) {
        cells.set(`${rowIndex}:${colCursor}`, {
          formula: xFmla,
          format: 'a1',
          originRow: origin.row,
          originCol: origin.col,
        })
      } else if (sheetsFmla && sheetsFmla.startsWith('=')) {
        cells.set(`${rowIndex}:${colCursor}`, {
          formula: sheetsFmla,
          format: 'r1c1',
        })
      } else if (xFmla && xFmla.startsWith('=')) {
        cells.set(`${rowIndex}:${colCursor}`, {
          formula: xFmla,
          format: 'a1',
        })
      }
      colCursor += colSpan
      if (colCursor > maxCols) maxCols = colCursor
    }
  }

  if (cells.size === 0 || rowIndex < 0 || maxCols === 0) return null
  return { rows: rowIndex + 1, cols: maxCols, cells }
}

/// True when an A1 formula without source-origin metadata is safe to install
/// verbatim on normal Ctrl+V: no relative references (which would silently point
/// to the wrong cells when pasted off-origin) and no sheet qualifiers missing
/// from `availableSheetNames`.
export function isOriginlessA1SafeForDefaultPaste(
  formula: string,
  availableSheetNames?: ReadonlySet<string>,
): boolean {
  const segments = formula.split(SKIP_LITERAL_OR_STRUCTURED_RE)
  for (let index = 0; index < segments.length; index += 2) {
    const segment = segments[index] ?? ''
    for (const match of segment.matchAll(A1_REF_RE)) {
      const [, quoted, bare, aAbsC, , aAbsR, , bAbsC, bCol, bAbsR] = match
      if (aAbsC !== '$' || aAbsR !== '$') return false
      if (bCol !== undefined && (bAbsC !== '$' || bAbsR !== '$')) return false
      const sheetName = quoted !== undefined ? quoted.replaceAll("''", "'") : bare
      if (sheetName && availableSheetNames && !availableSheetNames.has(sheetName.toLowerCase())) {
        return false
      }
    }
    for (const match of segment.matchAll(A1_COL_SPAN_RE)) {
      const [, quoted, bare, aAbs, , bAbs] = match
      if (aAbs !== '$' || bAbs !== '$') return false
      const sheetName = quoted !== undefined ? quoted.replaceAll("''", "'") : bare
      if (sheetName && availableSheetNames && !availableSheetNames.has(sheetName.toLowerCase())) {
        return false
      }
    }
    for (const match of segment.matchAll(A1_ROW_SPAN_RE)) {
      const [, quoted, bare, aAbs, , bAbs] = match
      if (aAbs !== '$' || bAbs !== '$') return false
      const sheetName = quoted !== undefined ? quoted.replaceAll("''", "'") : bare
      if (sheetName && availableSheetNames && !availableSheetNames.has(sheetName.toLowerCase())) {
        return false
      }
    }
  }
  return true
}

export interface ResolveExternalFormulaOptions {
  /// When true (Paste Special -> Formulas), keep origin-less Excel A1 formulas
  /// even if they contain relative references; on default Ctrl+V, fall back to
  /// pasted values when relative refs cannot be shifted safely.
  readonly allowOriginlessRelative?: boolean | undefined
  /// Lowercased sheet names present in the destination workbook.
  readonly availableSheetNames?: ReadonlySet<string> | undefined
}

/// Resolve an extracted external formula cell for a target paste coordinate.
export function resolveExternalFormulaAt(
  parsed: ExternalHtmlFormulas,
  relRow: number,
  relCol: number,
  toRow: number,
  toCol: number,
  tileAnchorRow: number,
  tileAnchorCol: number,
  options?: ResolveExternalFormulaOptions,
): string | null {
  const srcRow = relRow % parsed.rows
  const srcCol = relCol % parsed.cols
  const entry = parsed.cells.get(`${srcRow}:${srcCol}`)
  if (!entry) return null
  const clean = stripClipboardFormulaMarkers(entry.formula)
  if (entry.originRow !== undefined && entry.originCol !== undefined) {
    return offsetFormulaRefs(clean, toRow - entry.originRow, toCol - entry.originCol)
  }
  if (entry.format === 'r1c1') {
    return r1c1FormulaToA1(clean, toRow, toCol)
  }
  // Plain Excel `x:fmla` (A1) carries no source cell coordinates in HTML:
  // on default Ctrl+V, only install when safe (constants / absolute refs on
  // existing sheets) so off-origin pastes never silently reference wrong cells.
  if (
    !options?.allowOriginlessRelative &&
    !isOriginlessA1SafeForDefaultPaste(clean, options?.availableSheetNames)
  ) {
    return null
  }
  const tileRowDelta = toRow - tileAnchorRow
  const tileColDelta = toCol - tileAnchorCol
  if (tileRowDelta !== 0 || tileColDelta !== 0) {
    return offsetFormulaRefs(clean, tileRowDelta, tileColDelta)
  }
  return clean
}

/// Resolve any cell's formula string: raw `f`, shared-formula `si`, or
/// harvested `indexedFormulaText` (cache-only / streamed workbooks).
export function resolveSheetFormulaAt(
  runtime: UniverRuntime,
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null },
  unitId: string,
  subUnitId: string,
  worksheet: Worksheet,
  row: number,
  col: number,
): string | null {
  const raw = worksheet.getCellRaw(row, col)
  if (typeof raw?.f === 'string' && raw.f.startsWith('=')) return raw.f
  if (typeof raw?.si === 'string' && raw.si.length > 0) {
    const formulaDataModel = runtime.univer.__getInjector().get(FormulaDataModel)
    const fromModel = formulaDataModel.getFormulaStringByCell(row, col, subUnitId, unitId)
    if (typeof fromModel === 'string' && fromModel.startsWith('=')) return fromModel
    const resolved = sharedFormulaResolverFor(runtime, subUnitId)(row, col, raw.si)
    if (typeof resolved === 'string' && resolved.startsWith('=')) return resolved
  }
  const indexed = indexedFormulaText(lazyWorkbookRef.current, subUnitId, row, col)
  if (typeof indexed === 'string' && indexed.startsWith('=')) return indexed
  return null
}

const SKIP_FORMULA_PASTE_TYPES = new Set<string>([
  PREDEFINED_HOOK_NAME_PASTE.SPECIAL_PASTE_VALUE,
  PREDEFINED_HOOK_NAME_PASTE.SPECIAL_PASTE_FORMAT,
  PREDEFINED_HOOK_NAME_PASTE.SPECIAL_PASTE_COL_WIDTH,
])

interface ClipboardServiceInternals {
  _pasteExternal: (html: string, pasteType: string) => Promise<boolean>
  _generateCopyContent: (
    unitId: string,
    subUnitId: string,
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
    hooks: ISheetClipboardHook[],
    copyHookType?: string,
  ) => {
    copyId: string
    plain: string
    html: string
    matrixFragment: ObjectMatrix<ICellData>
    discreteRange: { rows: number[]; cols: number[] }
  } | null
}

interface AutoFillControllerInternals {
  _getCopyData: (
    location: {
      unitId: string
      subUnitId: string
      source: { rows: number[]; cols: number[] }
    },
    direction: unknown,
  ) => unknown
}

export function installFormulaClipboard(
  runtime: UniverRuntime,
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null },
): { dispose(): void } {
  const injector = runtime.univer.__getInjector()
  const clipboardService = injector.get(ISheetClipboardService)
  const instanceService = injector.get(IUniverInstanceService)

  let copyUnitId: string | null = null
  let copySubUnitId: string | null = null
  let copyWorksheet: Worksheet | null = null
  let pendingExternal: ExternalHtmlFormulas | null = null

  const hook: ISheetClipboardHook = {
    id: 'ieum.formula-clipboard',
    // Runs after default paste (0) and FormulaClipboardController (10) so our
    // external formula mutations overlay displayed values in the same undo step.
    priority: 20,
    onBeforeCopy(unitId, subUnitId) {
      copyUnitId = unitId
      copySubUnitId = subUnitId
      const workbook = instanceService.getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET)
      copyWorksheet = workbook?.getSheetBySheetId(subUnitId) ?? null
    },
    onCopyCellStyle(row, col) {
      if (!copyUnitId || !copySubUnitId || !copyWorksheet) return {}
      const formula = resolveSheetFormulaAt(
        runtime,
        lazyWorkbookRef,
        copyUnitId,
        copySubUnitId,
        copyWorksheet,
        row,
        col,
      )
      if (!formula) return {}
      const r1c1 = a1FormulaToR1C1(formula, row, col)
      return {
        'x:fmla': escapeHtmlAttr(formula),
        'data-sheets-formula': escapeHtmlAttr(r1c1),
        'data-ieum-origin': `${row},${col}`,
      }
    },
    onAfterCopy() {
      copyUnitId = null
      copySubUnitId = null
      copyWorksheet = null
    },
    onPasteCells(
      pasteFrom: Nullable<ISheetDiscreteRangeLocation>,
      pasteTo: ISheetDiscreteRangeLocation,
      data: ObjectMatrix<ICellData>,
      payload,
    ) {
      if (pasteFrom || !pendingExternal) return { undos: [], redos: [] }
      if (payload?.pasteType && SKIP_FORMULA_PASTE_TYPES.has(payload.pasteType)) {
        return { undos: [], redos: [] }
      }
      const external = pendingExternal
      const unitId = pasteTo.unitId
      const subUnitId = pasteTo.subUnitId
      const { rows, cols } = pasteTo.range
      if (!unitId || !subUnitId || rows.length === 0 || cols.length === 0) {
        return { undos: [], redos: [] }
      }

      const workbook = instanceService.getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET)
      const availableSheetNames = workbook
        ? new Set(workbook.getSheets().map((sheet) => sheet.getName().toLowerCase()))
        : undefined
      const allowOriginlessRelative =
        payload?.pasteType === PREDEFINED_HOOK_NAME_PASTE.SPECIAL_PASTE_FORMULA

      const valueMatrix = new ObjectMatrix<ICellData>()
      data.forValue((relRow, relCol) => {
        const toRow = rows[relRow]
        const toCol = cols[relCol]
        if (toRow === undefined || toCol === undefined) return
        const srcRow = relRow % external.rows
        const srcCol = relCol % external.cols
        const tileAnchorRow = rows[srcRow] ?? toRow
        const tileAnchorCol = cols[srcCol] ?? toCol
        const formula = resolveExternalFormulaAt(
          external,
          relRow,
          relCol,
          toRow,
          toCol,
          tileAnchorRow,
          tileAnchorCol,
          { allowOriginlessRelative, availableSheetNames },
        )
        if (!formula) return
        valueMatrix.setValue(toRow, toCol, {
          f: formula,
          v: null,
          si: null,
          p: null,
        })
      })

      if (!valueMatrix.hasValue()) return { undos: [], redos: [] }
      const setValuesMutation: ISetRangeValuesMutationParams = {
        unitId,
        subUnitId,
        cellValue: valueMatrix.getData(),
      }
      const undoParams = injector.invoke((accessor) =>
        SetRangeValuesUndoMutationFactory(accessor, setValuesMutation),
      )
      return {
        redos: [{ id: SetRangeValuesMutation.id, params: setValuesMutation }],
        undos: [{ id: SetRangeValuesMutation.id, params: undoParams }],
      }
    },
  }

  const hookDisposable = clipboardService.addClipboardHook(hook)

  // Patch _pasteExternal to capture external HTML formula attributes, and
  // _generateCopyContent to include harvested formulas on streamed cells.
  const serviceInternals = clipboardService as unknown as Partial<ClipboardServiceInternals>
  const originalPasteExternal =
    typeof serviceInternals._pasteExternal === 'function'
      ? serviceInternals._pasteExternal.bind(clipboardService)
      : null
  const originalGenerateCopyContent =
    typeof serviceInternals._generateCopyContent === 'function'
      ? serviceInternals._generateCopyContent.bind(clipboardService)
      : null

  if (originalPasteExternal) {
    serviceInternals._pasteExternal = async function (html: string, pasteType: string) {
      pendingExternal = extractExternalHtmlFormulas(html)
      try {
        return await originalPasteExternal(html, pasteType)
      } finally {
        pendingExternal = null
      }
    }
  }

  if (originalGenerateCopyContent) {
    serviceInternals._generateCopyContent = function (
      unitId,
      subUnitId,
      range,
      hooks,
      copyHookType = PREDEFINED_HOOK_NAME_COPY.DEFAULT_COPY,
    ) {
      const result = originalGenerateCopyContent(unitId, subUnitId, range, hooks, copyHookType)
      const state = lazyWorkbookRef.current
      if (!result || !state) return result
      const { rows, cols } = result.discreteRange
      const isFormulaOnly = copyHookType === PREDEFINED_HOOK_NAME_COPY.SPECIAL_COPY_FORMULA_ONLY
      let patchedFormulaOnly = false
      for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
        const row = rows[rIdx]!
        for (let cIdx = 0; cIdx < cols.length; cIdx += 1) {
          const col = cols[cIdx]!
          const existing = result.matrixFragment.getValue(rIdx, cIdx)
          if (existing?.f || existing?.si) continue
          const indexed = indexedFormulaText(state, subUnitId, row, col)
          if (!indexed || !indexed.startsWith('=')) continue
          // Deliberately cache-only formulas (unsupported functions, external
          // workbooks, unresolved names) must stay values on normal copy so
          // pasting them doesn't turn a cached value into #NAME? / #REF!.
          if (!isFormulaOnly && formulaKeepsCache(indexed)) continue
          result.matrixFragment.setValue(rIdx, cIdx, {
            ...(existing ?? {}),
            f: indexed,
          })
          if (isFormulaOnly) patchedFormulaOnly = true
        }
      }
      if (patchedFormulaOnly) {
        const lines: string[] = []
        for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
          const fields: string[] = []
          for (let cIdx = 0; cIdx < cols.length; cIdx += 1) {
            const cell = result.matrixFragment.getValue(rIdx, cIdx)
            fields.push(typeof cell?.f === 'string' ? cell.f : '')
          }
          lines.push(fields.join('\t'))
        }
        result.plain = lines.join('\n')
      }
      return result
    }
  }

  // Wrap AutoFillController._getCopyData so drag-fill / Ctrl+D / Ctrl+R see
  // harvested formulas on streamed cells and shift them properly.
  let unwrapAutoFill: (() => void) | null = null
  try {
    const autoFillController = injector.get(
      AutoFillController,
    ) as unknown as Partial<AutoFillControllerInternals>
    if (typeof autoFillController?._getCopyData === 'function') {
      const originalGetCopyData = autoFillController._getCopyData.bind(autoFillController)
      autoFillController._getCopyData = function (location, direction) {
        const state = lazyWorkbookRef.current
        if (!state) return originalGetCopyData(location, direction)
        const workbook = instanceService.getUnit<Workbook>(
          location.unitId,
          UniverInstanceType.UNIVER_SHEET,
        )
        const worksheet = workbook?.getSheetBySheetId(location.subUnitId)
        if (!worksheet) return originalGetCopyData(location, direction)
        const realMatrix = worksheet.getCellMatrix()
        let needsProxy = false
        for (const row of location.source.rows) {
          for (const col of location.source.cols) {
            const raw = realMatrix.getValue(row, col)
            if (raw?.f || raw?.si) continue
            const indexed = indexedFormulaText(state, location.subUnitId, row, col)
            if (indexed && indexed.startsWith('=') && !formulaKeepsCache(indexed)) {
              needsProxy = true
              break
            }
          }
          if (needsProxy) break
        }
        if (!needsProxy) return originalGetCopyData(location, direction)

        const originalGetCellMatrix = worksheet.getCellMatrix.bind(worksheet)
        const proxyMatrix = new Proxy(realMatrix, {
          get(target, prop, receiver) {
            if (prop === 'getValue') {
              return (r: number, c: number) => {
                const cell = target.getValue(r, c)
                if (cell?.f || cell?.si) return cell
                const indexed = indexedFormulaText(state, location.subUnitId, r, c)
                if (indexed && indexed.startsWith('=') && !formulaKeepsCache(indexed)) {
                  return { ...(cell ?? {}), f: indexed }
                }
                return cell
              }
            }
            const value = Reflect.get(target, prop, receiver)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        ;(worksheet as unknown as { getCellMatrix: () => typeof realMatrix }).getCellMatrix = () =>
          proxyMatrix
        try {
          return originalGetCopyData(location, direction)
        } finally {
          ;(worksheet as unknown as { getCellMatrix: () => typeof realMatrix }).getCellMatrix =
            originalGetCellMatrix
        }
      }
      unwrapAutoFill = () => {
        autoFillController._getCopyData = originalGetCopyData
      }
    }
  } catch {
    // AutoFillController may be absent in minimal headless runtimes.
  }

  return {
    dispose() {
      hookDisposable.dispose()
      if (originalPasteExternal) serviceInternals._pasteExternal = originalPasteExternal
      if (originalGenerateCopyContent) {
        serviceInternals._generateCopyContent = originalGenerateCopyContent
      }
      unwrapAutoFill?.()
    },
  }
}
