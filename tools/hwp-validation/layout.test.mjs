// Expanded from the upstream validation branch; see README.md for attribution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareLayout, layoutEqual } from './layout.mjs'

test('compares resolved formatting while ignoring serializer-local style IDs', () => {
  assert.equal(
    layoutEqual({ charShapeId: 1, fontFamily: 'A' }, { charShapeId: 99, fontFamily: 'A' }),
    true,
  )
  assert.equal(
    layoutEqual({ paraShapeId: 1, fontFamily: 'A' }, { paraShapeId: 99, fontFamily: 'B' }),
    false,
  )
})
test('bounds position and character advances, including array entries', () => {
  assert.equal(layoutEqual({ x: 10, charX: [0, 5] }, { x: 10.5, charX: [0, 5.5] }), true)
  assert.equal(layoutEqual({ x: 10 }, { x: 10.501 }), false)
  assert.equal(layoutEqual({ charX: [0, 5] }, { charX: [0, 5.501] }), false)
  assert.equal(layoutEqual({ x: 10 }, { x: 10.01 }, 0), false)
})
test('does not conceal font-size or tracking changes behind pixel tolerance', () => {
  assert.equal(layoutEqual({ fontSize: 12 }, { fontSize: 12.1 }), false)
  assert.equal(layoutEqual({ letterSpacing: 0 }, { letterSpacing: 0.1 }), false)
  assert.equal(layoutEqual({ color: '#000000' }, { color: '#010101' }), false)
})
test('requires exact indices, parent links and merged-cell spans', () => {
  for (const key of ['row', 'rowSpan', 'colSpan', 'inTable', 'pageIndex'])
    assert.equal(layoutEqual({ [key]: 1 }, { [key]: 1.1 }), false)
})
test('rejects missing objects, added properties, and changed content', () => {
  assert.equal(layoutEqual([{ x: 1 }], []), false)
  assert.equal(layoutEqual({ x: 1 }, { x: 1, y: 2 }), false)
  assert.equal(layoutEqual({ text: 'a', bold: false }, { text: 'b', bold: false }), false)
  assert.equal(layoutEqual({ text: 'a', bold: false }, { text: 'a', bold: true }), false)
})
test('rejects nonfinite numbers even in non-coordinate fields', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(layoutEqual({ x: value }, { x: value }), false)
    assert.equal(layoutEqual({ row: value }, { row: value }), false)
  }
})
test('validates tolerance and reports reasons without copying private content', () => {
  for (const value of [NaN, Infinity, -1, 0.501]) assert.throws(() => compareLayout({}, {}, value))
  const compared = compareLayout({ text: 'private input', x: 1 }, { text: 'private edit', x: 3 })
  assert.equal(compared.equal, false)
  assert.equal(compared.differences, 2)
  assert.deepEqual(compared.kinds, ['geometry', 'value'])
  assert.equal(JSON.stringify(compared).includes('private'), false)
})
