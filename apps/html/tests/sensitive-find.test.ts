/**
 * "Find sensitive info" in the HTML editor: the source read as the model reads
 * it (text nodes and attribute values, in source order; a table cell under its
 * column's first cell), the candidates the shared finder returns, and a
 * confirm through the source pane's own command (`redactMarkPlan`), applied
 * later spots first so earlier offsets hold.
 */
import { describe, expect, it } from 'vitest'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { compileOps } from '../src/renderer/document/ops'
import { applyPatches } from '../src/renderer/document/patch'
import { redactMarkPlan } from '../src/renderer/document/redact-edit'
import { buildProjection, collectWithheld } from '../src/renderer/ai/redact'
import {
  hideSourceSpots,
  sourceLineCol,
  sourcePieces,
  type SourceSpotLocation,
} from '../src/renderer/ai/sensitive-source'
import { findSensitive } from '../src/renderer/ai/sensitive-find'

const PAGE = [
  '<html><body>',
  '<p>연락처 010-1234-5678 로 주세요.</p>',
  '<a href="mailto:hong@example.com">메일</a>',
  '<table><tr><th>성명</th><th>학번</th></tr>',
  '<tr><td>김민수</td><td>20231234</td></tr></table>',
  '</body></html>',
].join('\n')

async function find(source: string, isExcluded?: (kind: string) => boolean) {
  const { pieces, existingMarks } = sourcePieces(source, buildParseMap(source, 1))
  return findSensitive<SourceSpotLocation>({
    pieces,
    existingMarks,
    lang: 'ko',
    locationText: (loc) => {
      const { line, col } = sourceLineCol(source, loc.from)
      return `${line}:${col}`
    },
    ...(isExcluded ? { isExcluded } : {}),
  })
}

/** the App's hide: plan against the current text, then land its ops or patches */
function hider(state: { text: string }) {
  return (from: number, to: number, label: string): boolean => {
    const map = buildParseMap(state.text, 1)
    const plan = redactMarkPlan(state.text, map, from, to, label)
    if (!plan) return false
    if (plan.ops.length > 0) {
      const compiled = compileOps(state.text, map, plan.ops)
      if (compiled.errors.length > 0) return false
      state.text = applyPatches(state.text, compiled.patches)
    } else {
      state.text = applyPatches(state.text, plan.patches)
    }
    return true
  }
}

describe('finding', () => {
  it('reads text and attribute values in source order, cells under their column header', async () => {
    const found = await find(PAGE)
    const rows = found.rows.map((r) => [r.kind, r.value, r.hideable])
    expect(rows).toContainEqual(['phone', '010-1234-5678', true])
    expect(rows).toContainEqual(['email', 'hong@example.com', true])
    expect(rows).toContainEqual(['name', '김민수', true])
    const phone = found.rows.find((r) => r.kind === 'phone')!
    expect(phone.label).toBe('전화-01')
    expect(phone.location).toBe('2:4')
  })

  it('a page with nothing sensitive yields nothing', async () => {
    expect((await find('<p>그냥 글</p>')).rows).toEqual([])
  })

  it('drops excluded values', async () => {
    const found = await find(PAGE, (kind) => kind === 'email')
    expect(found.rows.map((r) => r.kind)).not.toContain('email')
  })
})

describe('hiding', () => {
  it('withholds every confirmed spot, and the model sees only the labels', async () => {
    const found = await find(PAGE)
    const state = { text: PAGE }
    const spots = [...found.spots.values()]
    expect(hideSourceSpots(spots, () => state.text, hider(state))).toBe(spots.length)
    const map = buildParseMap(state.text, 1)
    const labels = collectWithheld(state.text, map).map((s) => s.label)
    for (const spot of spots) expect(labels).toContain(spot.label)
    const model = buildProjection(state.text, map).view
    for (const spot of spots) {
      expect(model).not.toContain(spot.value)
      expect(model).toContain(`{{${spot.label}}}`)
    }
    // the words stay in the file
    expect(state.text).toContain('010-1234-5678')
    // and are not offered again
    expect((await find(state.text)).rows).toEqual([])
  })

  it('numbers after the labels the page already has', async () => {
    const first = await find(PAGE)
    const phone = [...first.spots.values()].find((s) => s.kind === 'phone')!
    const state = { text: PAGE }
    hideSourceSpots([phone], () => state.text, hider(state))
    state.text = state.text.replace('</body>', '<p>다른 번호 010-2222-3333</p></body>')
    const next = await find(state.text)
    expect(next.rows.filter((r) => r.kind === 'phone').map((r) => r.label)).toEqual(['전화-02'])
  })

  it('skips a spot whose characters moved', async () => {
    const found = await find(PAGE)
    const phone = [...found.spots.values()].find((s) => s.kind === 'phone')!
    const state = { text: PAGE.replace('<p>연락처', '<p>앞에 더한 글 연락처') }
    expect(hideSourceSpots([phone], () => state.text, hider(state))).toBe(0)
  })
})
