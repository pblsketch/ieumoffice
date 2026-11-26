import { describe, expect, it } from 'vitest'
import {
  compileRemove,
  decodeTextNode,
  diffAsPatch,
  findSelectedEntry,
  mapOffsetThroughPatches,
  planTextEdit,
  textEditOps,
  type HtmlSelection,
} from '../src/renderer/editors/html/htmlElementEdit'
import { mapDocument } from '../src/renderer/editors/html/htmlPreview'
import { compileOps } from '../../html/src/renderer/document/ops'
import type { ParseMap } from '../../html/src/renderer/document/parse-map'
import { applyPatches, type Patch } from '../../html/src/renderer/document/patch'

const SOURCE = [
  '<!DOCTYPE html>',
  '<html lang="ko">',
  '<head><meta charset="UTF-8"><title>보고서 &amp; 계획</title></head>',
  '<body>',
  '  <h1 class="t">제목 &lt;초안&gt;</h1>',
  '  <p>앞 <b>굵게</b> 뒤 &amp; 끝<!-- 메모 --></p>',
  '  <div class="pic"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></div>',
  '  <p id="empty"></p>',
  '  <script>var a = 1 < 2</script>',
  '  <ul><li>하나</li><li>둘</li></ul>',
  '</body>',
  '</html>',
  '',
].join('\n')

function entry(map: ParseMap, tag: string, nth = 0) {
  const found = map.elements.filter((e) => e.tag === tag)[nth]
  expect(found, `<${tag}> #${nth}`).toBeDefined()
  return found!
}

/** The patches leave everything before the first and after the last patch as it was. */
function expectOnlyRangeChanged(before: string, after: string, patches: readonly Patch[]) {
  const from = Math.min(...patches.map((p) => p.from))
  const to = Math.max(...patches.map((p) => p.to))
  expect(after.slice(0, from)).toBe(before.slice(0, from))
  expect(after.slice(after.length - (before.length - to))).toBe(before.slice(to))
}

describe('edit text: what an element offers', () => {
  const map = mapDocument(SOURCE, 0, null)

  it('offers one decoded field for an element with text only (set_text)', () => {
    const h1 = entry(map, 'h1')
    expect(planTextEdit(SOURCE, map, h1.sid)).toEqual({
      kind: 'text',
      sid: h1.sid,
      value: '제목 <초안>',
    })
    // an empty element gets one empty field
    const empty = entry(map, 'p', 1)
    expect(planTextEdit(SOURCE, map, empty.sid)).toEqual({
      kind: 'text',
      sid: empty.sid,
      value: '',
    })
  })

  it('offers one field per direct text run that is not blank for mixed content (set_text_node)', () => {
    const p = entry(map, 'p')
    const plan = planTextEdit(SOURCE, map, p.sid)
    expect(plan).toEqual({
      kind: 'nodes',
      sid: p.sid,
      parts: [
        { index: 0, value: '앞 ' },
        { index: 1, value: ' 뒤 & 끝' },
      ],
    })
    // only child elements: nothing to edit here
    const ul = entry(map, 'ul')
    expect(planTextEdit(SOURCE, map, ul.sid)).toEqual({ kind: 'source', sid: ul.sid })

    // layout whitespace between child elements is no field, but the index still counts it
    const small = '<div>\n  <span>a</span>\n  끝 &amp; 꼬리\n</div>'
    const smallMap = mapDocument(small, 0, null)
    const div = entry(smallMap, 'div')
    expect(planTextEdit(small, smallMap, div.sid)).toEqual({
      kind: 'nodes',
      sid: div.sid,
      parts: [{ index: 1, value: '\n  끝 & 꼬리\n' }],
    })
  })

  it('sends an element without text, a void element and raw text to the source', () => {
    for (const tag of ['div', 'img', 'script', 'body', 'html'] as const) {
      const e = entry(map, tag)
      expect(planTextEdit(SOURCE, map, e.sid)?.kind, tag).toBe('source')
    }
    expect(planTextEdit(SOURCE, map, 99_999)).toBeNull()
  })

  it('never offers a text run whose source location stretches over tags', () => {
    // the parser locates the text after </body> across the </body> and </html> tags
    const tail = '<html><body><p>a</p></body>\n</html>끝\n'
    const tailMap = mapDocument(tail, 0, null)
    const body = entry(tailMap, 'body')
    const stretched = body.textNodes.map(([f, t]) => tail.slice(f, t))
    expect(stretched.some((raw) => raw.includes('</html>'))).toBe(true)
    expect(planTextEdit(tail, tailMap, body.sid)).toEqual({ kind: 'source', sid: body.sid })
  })

  it('decodes character references the way the parser does, and keeps markup characters as text', () => {
    expect(decodeTextNode('a &amp; b &lt;c&gt; &nbsp;x &#x1F600; &copy', 'p')).toBe(
      'a & b <c>  x \u{1F600} ©',
    )
    expect(decodeTextNode('x < y', 'p')).toBe('x < y')
    expect(decodeTextNode('보고서 &amp; 계획', 'title')).toBe('보고서 & 계획')
  })
})

describe('edits compile to one patch set and leave the rest of the source as it was', () => {
  const map = mapDocument(SOURCE, 0, null)

  it('set_text: one patch over the content, escaped, the rest byte for byte', () => {
    const h1 = entry(map, 'h1')
    const plan = planTextEdit(SOURCE, map, h1.sid)!
    const ops = textEditOps(plan, ['새 제목 <끝> & 더'])
    expect(ops).toEqual([{ op: 'set_text', sid: h1.sid, text: '새 제목 <끝> & 더' }])
    const { patches, errors } = compileOps(SOURCE, map, ops)
    expect(errors).toEqual([])
    expect(patches).toHaveLength(1)
    const after = applyPatches(SOURCE, patches)
    expect(after).toBe(
      SOURCE.replace(
        '<h1 class="t">제목 &lt;초안&gt;</h1>',
        '<h1 class="t">새 제목 &lt;끝&gt; &amp; 더</h1>',
      ),
    )
    expectOnlyRangeChanged(SOURCE, after, patches)
  })

  it('an unchanged field makes no op', () => {
    const h1 = entry(map, 'h1')
    expect(textEditOps(planTextEdit(SOURCE, map, h1.sid)!, ['제목 <초안>'])).toEqual([])
  })

  it('set_text_node: only the changed runs, the child element and the comment stay', () => {
    const p = entry(map, 'p')
    const plan = planTextEdit(SOURCE, map, p.sid)!
    const ops = textEditOps(plan, ['앞 ', ' 뒤 & 마지막'])
    expect(ops).toEqual([{ op: 'set_text_node', sid: p.sid, index: 1, text: ' 뒤 & 마지막' }])
    const { patches, errors } = compileOps(SOURCE, map, ops)
    expect(errors).toEqual([])
    expect(patches).toHaveLength(1)
    const after = applyPatches(SOURCE, patches)
    expect(after).toContain('<p>앞 <b>굵게</b> 뒤 &amp; 마지막<!-- 메모 --></p>')
    expectOnlyRangeChanged(SOURCE, after, patches)

    // both runs changed: still one set of patches compiled against one version
    const both = compileOps(SOURCE, map, textEditOps(plan, ['처음 ', ' 다음']))
    expect(both.errors).toEqual([])
    expect(both.patches).toHaveLength(2)
    const twice = applyPatches(SOURCE, both.patches)
    expect(twice).toContain('<p>처음 <b>굵게</b> 다음<!-- 메모 --></p>')
    expectOnlyRangeChanged(SOURCE, twice, both.patches)
  })

  it('remove: one patch, an element alone on its line goes with its line', () => {
    const h1 = entry(map, 'h1')
    const result = compileRemove(SOURCE, map, h1.sid)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compiled.errors).toEqual([])
    expect(result.compiled.patches).toHaveLength(1)
    const after = applyPatches(SOURCE, result.compiled.patches)
    expect(after).toBe(SOURCE.replace('  <h1 class="t">제목 &lt;초안&gt;</h1>\n', ''))
    expectOnlyRangeChanged(SOURCE, after, result.compiled.patches)

    // inside a line: only the element
    const li = entry(map, 'li', 1)
    const inline = compileRemove(SOURCE, map, li.sid)
    expect(inline.ok && applyPatches(SOURCE, inline.compiled.patches)).toBe(
      SOURCE.replace('<li>둘</li>', ''),
    )
  })

  it('refuses to remove html, head and body', () => {
    for (const tag of ['html', 'head', 'body'] as const) {
      expect(compileRemove(SOURCE, map, entry(map, tag).sid)).toEqual({
        ok: false,
        reason: 'structural',
      })
    }
    expect(compileRemove(SOURCE, map, 99_999)).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('the selection across source changes', () => {
  const map = mapDocument(SOURCE, 0, null)
  const select = (tag: string, nth = 0): HtmlSelection => {
    const e = entry(map, tag, nth)
    return { start: e.startTag[0], tag: e.tag, sid: e.sid }
  }

  it('follows an edit of the element itself and of text before it', () => {
    const last = select('p', 1)
    const h1 = entry(map, 'h1')
    const { patches } = compileOps(SOURCE, map, [
      { op: 'set_text', sid: h1.sid, text: '긴 새 제목' },
    ])
    const after = applyPatches(SOURCE, patches)
    const start = mapOffsetThroughPatches(last.start, patches)
    expect(start).not.toBeNull()
    const found = findSelectedEntry(mapDocument(after, 1, map), { ...last, start: start! })
    expect(found?.tag).toBe('p')
    expect(after.slice(found!.startTag[0], found!.startTag[1])).toBe('<p id="empty">')

    // the edited element itself: its start tag is before the patch
    const self = select('h1')
    expect(mapOffsetThroughPatches(self.start, patches)).toBe(self.start)
  })

  it('is gone when the element is removed', () => {
    const h1 = select('h1')
    const result = compileRemove(SOURCE, map, h1.sid!)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mapOffsetThroughPatches(h1.start, result.compiled.patches)).toBeNull()
    // a removed element whose start is the patch start is gone as well
    const li = select('li', 1)
    const inline = compileRemove(SOURCE, map, li.sid!)
    expect(inline.ok && mapOffsetThroughPatches(li.start, inline.compiled.patches)).toBeNull()
  })

  it('moves right with an insertion at its start, and follows undo through the text diff', () => {
    expect(mapOffsetThroughPatches(10, [{ from: 10, to: 10, text: 'abc' }])).toBe(13)
    expect(mapOffsetThroughPatches(10, [{ from: 2, to: 5, text: '' }])).toBe(7)
    expect(mapOffsetThroughPatches(10, [{ from: 12, to: 20, text: 'x' }])).toBe(10)

    const before = '<p>a</p><p>b</p>'
    const after = '<p>aaa</p><p>b</p>'
    const patch = diffAsPatch(before, after)
    expect(applyPatches(before, [patch])).toBe(after)
    expect(mapOffsetThroughPatches(8, [patch])).toBe(10)
    expect(diffAsPatch('same', 'same')).toEqual({ from: 4, to: 4, text: '' })
  })

  it('finds nothing when another element starts there now', () => {
    const p = select('p')
    expect(findSelectedEntry(map, { ...p, tag: 'div' })).toBeNull()
    expect(findSelectedEntry(map, { ...p, start: p.start + 1 })).toBeNull()
    expect(findSelectedEntry(map, p)?.sid).toBe(p.sid)
  })
})
