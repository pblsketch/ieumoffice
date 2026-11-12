import type { ExistingMark } from '@genoffice/agent-core/sensitive-labels'
import type { ParseMap, ElementEntry } from '../document/parse-map'
import { MARK_ATTR, collectWithheld } from './redact'
import type { SensitivePiece, SensitiveSpot } from './sensitive-find'

/**
 * The page side of "find sensitive info". The model reads this editor's
 * source, so the finder does too: every text node and every attribute value,
 * in source order, as the raw characters of the file (offsets map straight
 * back to the source pane). A cell below a table's first row carries the
 * first row's cell in its column as `header`. Spans already withheld by any of
 * the three marks are not offered again; a confirm hides a spot with the
 * source pane's own command (`redactMarkPlan`).
 */

export interface SourceSpotLocation {
  /** where the piece starts in the source */
  from: number
}

/** values that hold no reader's text: the marks themselves and styling */
const SKIPPED_ATTRS = new Set(['style', 'class', 'id'])
const SKIPPED_TEXT = new Set(['style'])

const ATTR_RE = /\s([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/dg

interface AttrValue {
  name: string
  from: number
  to: number
}

function attrValues(source: string, e: ElementEntry): AttrValue[] {
  const tag = source.slice(e.startTag[0], e.startTag[1])
  const out: AttrValue[] = []
  for (const m of tag.matchAll(ATTR_RE)) {
    const group = m[2] !== undefined ? 2 : m[3] !== undefined ? 3 : 4
    const at = m.indices?.[group]
    if (!at || at[0] === at[1]) continue
    out.push({ name: m[1]!.toLowerCase(), from: e.startTag[0] + at[0], to: e.startTag[0] + at[1] })
  }
  return out
}

/** The text a cell shows: its own and its descendants' text nodes, in order. */
function textOf(source: string, map: ParseMap, cell: ElementEntry): string {
  const within = map.elements.filter(
    (e) => e.range[0] >= cell.range[0] && e.range[1] <= cell.range[1],
  )
  return within
    .flatMap((e) => e.textNodes)
    .sort((a, b) => a[0] - b[0])
    .map(([f, t]) => source.slice(f, t))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** For every td/th below a table's first row: the first row's cell text in its column. */
function cellHeaders(source: string, map: ParseMap): Map<number, string> {
  const headers = new Map<number, string>()
  const parentOf = (e: ElementEntry) =>
    e.parentSid === null ? null : (map.bySid.get(e.parentSid) ?? null)
  const tableOf = (row: ElementEntry): ElementEntry | null => {
    for (let p = parentOf(row); p; p = parentOf(p)) if (p.tag === 'table') return p
    return null
  }
  const rowsByTable = new Map<number, ElementEntry[]>()
  for (const e of map.elements) {
    if (e.tag !== 'tr') continue
    const table = tableOf(e)
    if (!table) continue
    const rows = rowsByTable.get(table.sid) ?? []
    rows.push(e)
    rowsByTable.set(table.sid, rows)
  }
  const cellsOf = (row: ElementEntry) =>
    map.elements.filter((e) => e.parentSid === row.sid && (e.tag === 'td' || e.tag === 'th'))
  for (const rows of rowsByTable.values()) {
    rows.sort((a, b) => a.range[0] - b.range[0])
    const head = cellsOf(rows[0]!).map((c) => textOf(source, map, c))
    for (const row of rows.slice(1)) {
      cellsOf(row).forEach((cell, col) => {
        const text = head[col]
        if (text) headers.set(cell.sid, text)
      })
    }
  }
  return headers
}

export function sourcePieces(
  source: string,
  map: ParseMap,
): { pieces: SensitivePiece<SourceSpotLocation>[]; existingMarks: ExistingMark[] } {
  const withheld = collectWithheld(source, map)
  const existingMarks: ExistingMark[] = withheld
    .filter((s) => s.rawTo > s.rawFrom)
    .map((s) => ({ label: s.label, value: source.slice(s.rawFrom, s.rawTo) }))
  const headers = cellHeaders(source, map)
  const headerOf = (e: ElementEntry): string | undefined => {
    for (
      let p: ElementEntry | null = e;
      p;
      p = p.parentSid === null ? null : (map.bySid.get(p.parentSid) ?? null)
    ) {
      if (p.tag === 'td' || p.tag === 'th') return headers.get(p.sid)
      if (p.tag === 'table') return undefined
    }
    return undefined
  }
  const raw: Array<{ from: number; to: number; header?: string }> = []
  for (const e of map.elements) {
    for (const a of attrValues(source, e)) {
      if (a.name.startsWith(MARK_ATTR) || SKIPPED_ATTRS.has(a.name)) continue
      raw.push({ from: a.from, to: a.to })
    }
    if (SKIPPED_TEXT.has(e.tag)) continue
    const header = headerOf(e)
    for (const [from, to] of e.textNodes) {
      if (to > from) raw.push({ from, to, ...(header ? { header } : {}) })
    }
  }
  raw.sort((a, b) => a.from - b.from)
  const pieces = raw.map(({ from, to, header }) => ({
    text: source.slice(from, to),
    location: { from },
    ...(header ? { header } : {}),
    hidden: withheld
      .filter((s) => s.rawFrom < to && from < s.rawTo)
      .map(
        (s) => [Math.max(0, s.rawFrom - from), Math.min(to, s.rawTo) - from] as [number, number],
      ),
  }))
  return { pieces, existingMarks }
}

/** "Ln 3, Col 7" for a spot, through the editor's own words. */
export function sourceLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1
  let start = 0
  for (let i = source.indexOf('\n'); i !== -1 && i < offset; i = source.indexOf('\n', i + 1)) {
    line += 1
    start = i + 1
  }
  return { line, col: offset - start + 1 }
}

/**
 * Hide the spots, later ones first, each through `hide` (the source pane's
 * command). An edit that lands before a spot not yet hidden moves it by the
 * edit's length; a spot whose characters are not where they are expected is
 * skipped. Returns how many were hidden.
 */
export function hideSourceSpots(
  spots: readonly SensitiveSpot<SourceSpotLocation>[],
  getText: () => string,
  hide: (from: number, to: number, label: string) => boolean,
): number {
  const todo = spots
    .filter((s) => s.hideable)
    .map((s) => ({ from: s.location.from + s.start, to: s.location.from + s.end, spot: s }))
    .sort((a, b) => b.from - a.from)
  let done = 0
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i]!
    const before = getText()
    if (before.slice(item.from, item.to) !== item.spot.value) continue
    if (!hide(item.from, item.to, item.spot.label)) continue
    done += 1
    const after = getText()
    const delta = after.length - before.length
    if (delta === 0) continue
    let at = 0
    while (at < before.length && before[at] === after[at]) at++
    for (const rest of todo.slice(i + 1)) {
      if (rest.from >= at) {
        rest.from += delta
        rest.to += delta
      }
    }
  }
  return done
}
