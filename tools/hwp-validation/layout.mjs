// Adapted from gusdhks-wq/openoffice, edb6f0af (Apache-2.0); see README.md.
// Compare resolved values, allowing only geometric coordinates to drift.
const coordinates = new Set(['x', 'y', 'w', 'h', 'width', 'height', 'charX'])
const localIds = new Set(['charShapeId', 'paraShapeId'])

export function layout(doc, maxPages = 200) {
  const count = doc.pageCount()
  if (!Number.isInteger(count) || count < 1 || count > maxPages)
    throw Error('DOCUMENT_PAGE_BUDGET_EXCEEDED')
  return Array.from({ length: count }, (_, page) => ({
    text: JSON.parse(doc.getPageTextLayout(page)),
    controls: JSON.parse(doc.getPageControlLayout(page)),
  }))
}

export function compareLayout(a, b, tolerance = 0.5) {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5)
    throw Error('INVALID_COORDINATE_TOLERANCE')
  let differences = 0
  const kinds = new Set()
  const fail = (kind) => {
    differences++
    kinds.add(kind)
    return false
  }
  function compare(left, right, key = '') {
    if (typeof left === 'number' && typeof right === 'number') {
      if (!Number.isFinite(left) || !Number.isFinite(right)) return fail('nonfinite')
      if (coordinates.has(key)) return Math.abs(left - right) <= tolerance || fail('geometry')
      return left === right || fail('value')
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
        return fail('structure')
      let same = true
      for (let index = 0; index < left.length; index++)
        if (!compare(left[index], right[index], key)) same = false
      return same
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const keys = (value) =>
        Object.keys(value)
          .filter((name) => !localIds.has(name))
          .sort()
      const leftKeys = keys(left)
      const rightKeys = keys(right)
      if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) return fail('structure')
      let same = true
      for (const name of leftKeys) if (!compare(left[name], right[name], name)) same = false
      return same
    }
    return left === right || fail('value')
  }
  return { equal: compare(a, b), differences, kinds: [...kinds].sort() }
}

export const layoutEqual = (a, b, tolerance = 0.5) => compareLayout(a, b, tolerance).equal
