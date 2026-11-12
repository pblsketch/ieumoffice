import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { NoteInfo } from '@genoffice/docx-engine'
import type { PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { acceptAllRevisions, rejectAllRevisions } from '../src/renderer/editor/revisions'
import { modelViewOfRange } from '../src/renderer/ai/protocol'
import { beginModelRun } from '../src/renderer/ai/keep-tokens'
import type { AiNotesAccess, NoteKind } from '../src/renderer/ai/note-ops'
import { executeTool, markDocSeen, type AiCommentsAccess } from '../src/renderer/ai/tools'

const NUM_IDS = { bullet: null, ordered: null }
const TRACK = { author: 'AI Assistant' }
const PICTURE = 'data:image/png;base64,iVBORw0KGgo='

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

const text = (value: string, marks?: PmNode['marks']): PmNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const para = (...content: PmNode[]): PmNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content,
})
const noteRef = (id: string, num = 1): PmNode => ({
  type: 'docNoteRef',
  attrs: { kind: 'footnote', id, num },
})
const picture = (): PmNode => ({
  type: 'docInlineImage',
  attrs: { dataUrl: PICTURE, widthPx: 14, heightPx: 14 },
})
const comment = (ids: string) => [{ type: 'comment', attrs: { ids } }]

/** a block that carries one of each kind of object, around plain words */
function rich(): PmNode {
  return para(
    text('Plans for '),
    text('the launch', [{ type: 'bold' }]),
    text(' week'),
    noteRef('1'),
    text(' with the '),
    text('deadline', [{ type: 'docTextStyle', attrs: { color: 'C00000' } }]),
    text(' and '),
    text('budget', comment('c7')),
    text(' '),
    picture(),
    text(' on the '),
    text('wiki', [{ type: 'link', attrs: { href: 'https://example.com/wiki' } }]),
    text(' page.'),
  )
}

function open(blocks: PmNode[], extensions = editorExtensions): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions,
    content: { type: 'doc', content: blocks },
  })
  editors.push(editor)
  markDocSeen(editor)
  beginModelRun(editor)
  return editor
}

function fakeNotes(ids: string[]): AiNotesAccess & { removed: string[] } {
  const live = new Set(ids)
  const removed: string[] = []
  return {
    removed,
    list: (kind: NoteKind) =>
      kind === 'footnote' ? [...live].map((id) => ({ id, text: `note ${id}` }) as NoteInfo) : [],
    add: () => 'x',
    remove: (_kind: NoteKind, id: string) => {
      removed.push(id)
      return live.delete(id)
    },
    replace: () => true,
  }
}

function fakeComments(): AiCommentsAccess & { remove: ReturnType<typeof vi.fn> } {
  return {
    list: () => [],
    reply: () => false,
    resolve: () => false,
    remove: vi.fn(() => true),
  }
}

function run(
  editor: Editor,
  name: string,
  input: Record<string, unknown>,
  opts: { track?: typeof TRACK; notes?: AiNotesAccess; comments?: AiCommentsAccess } = {},
) {
  const out = executeTool(
    editor,
    { id: 't', name, input },
    NUM_IDS,
    opts.track,
    undefined,
    undefined,
    opts.comments,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.notes,
  )
  if (out instanceof Promise) throw new Error(`${name} should be sync`)
  return { isError: out.isError === true, output: String(out.output) }
}

const read = (editor: Editor, start: number, end = start): string =>
  run(editor, 'read_blocks', { startBlockIndex: start, endBlockIndex: end }).output

const replace = (
  editor: Editor,
  start: number,
  html: string,
  extra: Record<string, unknown> = {},
) => run(editor, 'replace_blocks', { startBlockIndex: start, endBlockIndex: start, html, ...extra })

const idOf = (html: string, what: string): string =>
  new RegExp(`<keep id="(k[0-9a-z]{7})" what="${what}"`).exec(html)?.[1] ?? ''
const spanIdOn = (html: string, words: string): string =>
  new RegExp(`<span id="(k[0-9a-z]{7})">(?:<[^>]+>)*${words}`).exec(html)?.[1] ?? ''

/** what a reader of the live document finds, outside pending deletions */
function objects(editor: Editor) {
  const found = { notes: [] as string[], pictures: 0, comments: [] as string[], links: 0 }
  editor.state.doc.descendants((node, _pos, parent) => {
    if (parent === editor.state.doc && node.attrs.blockRevision?.kind === 'del') return false
    if (node.marks.some((m) => m.type.name === 'del')) return
    if (node.type.name === 'docNoteRef') found.notes.push(String(node.attrs.id))
    if (node.type.name === 'docInlineImage') found.pictures++
    for (const mark of node.marks) {
      if (mark.type.name === 'comment' && node.isText) found.comments.push(String(mark.attrs.ids))
      if (mark.type.name === 'link') found.links++
    }
  })
  return found
}

describe('every inline node and mark has a place in the model view', () => {
  it('no inline node type prints as nothing', () => {
    const editor = open([para(text('x'))])
    const inline = Object.values(editor.schema.nodes).filter(
      (type) => type.isInline && !type.isText && type.name !== 'hardBreak',
    )
    expect(inline.length).toBeGreaterThan(3)
    for (const type of inline) {
      const node = type.createAndFill()
      expect(node, type.name).not.toBeNull()
      const json = para(text('a '), node!.toJSON() as PmNode, text(' b'))
      const probe = open([json])
      const html = modelViewOfRange(probe, 0, 0).html
      expect(html, type.name).toMatch(/<p>a <(keep id="k[0-9a-z]{7}"|formula>)/)
    }
  })

  it('no mark type disappears from the text it is on', () => {
    const editor = open([para(text('x'))])
    // ins is the AI's own tracked-change marker: the tracked path owns it and
    // a rewrite never restores someone else's insertion mark
    const byDesign = new Set(['ins'])
    const attrsFor: Record<string, Record<string, unknown>> = {
      docTextStyle: { color: 'C00000' },
      redaction: { label: 'secret' },
    }
    const plain = modelViewOfRange(open([para(text('plain words here '), text('x'))]), 0, 0).html
    for (const type of Object.values(editor.schema.marks)) {
      if (byDesign.has(type.name)) continue
      const mark = { type: type.name, attrs: attrsFor[type.name] }
      const probe = open([para(text('plain words here '), text('x', [mark]))])
      expect(modelViewOfRange(probe, 0, 0).html, type.name).not.toBe(plain)
    }
  })

  it('an inline node type the editor gains later is kept through a rewrite', async () => {
    const Future = Node.create({
      name: 'futureAtom',
      inline: true,
      group: 'inline',
      atom: true,
      parseHTML: () => [{ tag: 'span[data-future]' }],
      renderHTML: () => ['span', { 'data-future': '' }],
    })
    const editor = open(
      [para(text('One '), { type: 'futureAtom' }, text(' two.'))],
      [...editorExtensions, Future],
    )
    const html = read(editor, 0)
    expect(html).toMatch(/<keep id="k[0-9a-z]{7}" what="futureAtom"\/>/)
    const out = replace(editor, 0, html.replace('two', 'three'))
    expect(out.isError, out.output).toBe(false)
    let kept = 0
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'futureAtom') kept++
    })
    expect(kept).toBe(1)
    expect(editor.state.doc.textContent).toBe('One  three.')
  })
})

describe('keep ids', () => {
  it('stay the same when the note is renumbered and the block moves down', () => {
    const editor = open([para(text('Second'), noteRef('2'), text('.'))])
    const before = idOf(read(editor, 0), 'footnote 1')
    expect(before).not.toBe('')
    const tr = editor.state.tr.insert(
      0,
      editor.schema.nodeFromJSON(para(text('First'), noteRef('1'), text('.'))),
    )
    const ref = tr.doc.child(0).nodeSize + 1 + 'Second'.length
    tr.setNodeMarkup(ref, undefined, { kind: 'footnote', id: '2', num: 2 })
    editor.view.dispatch(tr)
    const after = read(editor, 1)
    expect(after).toContain('what="footnote 2"')
    expect(idOf(after, 'footnote 2')).toBe(before)
  })
})

describe('a rewrite has to account for every object', () => {
  it('reports what it kept', () => {
    const editor = open([rich()])
    const out = replace(editor, 0, read(editor, 0).replace('Plans', 'Plan'))
    expect(out.isError, out.output).toBe(false)
    expect(out.output).toContain(
      'Kept: 1 footnote mark, 2 spans (1 comment), 1 picture, 1 link. Dropped: none.',
    )
    expect(objects(editor)).toEqual({ notes: ['1'], pictures: 1, comments: ['c7'], links: 1 })
  })

  it('refuses a rewrite of formatted blocks it has not read, and hands over their HTML', () => {
    const editor = open([rich()])
    const out = replace(editor, 0, '<p>Plans for the launch week.</p>')
    expect(out.isError).toBe(true)
    expect(out.output).toContain('read_blocks 0-0')
    expect(out.output).toContain('<keep id="k')
    expect(objects(editor)).toEqual({ notes: ['1'], pictures: 1, comments: ['c7'], links: 1 })
    // the refusal is the read: a retry from that HTML goes through
    const html = out.output.slice(out.output.indexOf('<p>'))
    expect(replace(editor, 0, html.replace('week', 'month')).isError).toBe(false)
  })

  it('lets a plain block through without a read', () => {
    const editor = open([para(text('Only plain words.'))])
    const out = replace(editor, 0, '<p>Still plain words.</p>')
    expect(out.isError, out.output).toBe(false)
    expect(out.output).not.toContain('Kept:')
  })

  it('names a missing, a duplicated and an invented token in one refusal', () => {
    const editor = open([rich()])
    const html = read(editor, 0)
    const note = idOf(html, 'footnote 1')
    const pictureTag = /<keep id="k[0-9a-z]{7}" what="picture"\/>/.exec(html)![0]
    const broken = html
      .replace(/<keep id="k[0-9a-z]{7}" what="footnote 1"\/>/, '')
      .replace(pictureTag, `${pictureTag}${pictureTag}`)
      .replace(' page.', ' <keep id="kzzzzzzz" what="picture"/> page.')
    const before = editor.state.doc
    const out = replace(editor, 0, broken)
    expect(out.isError).toBe(true)
    expect(out.output).toContain(`missing: <keep id="${note}" what="footnote 1"/>`)
    expect(out.output).toContain('written 1 time(s) too often')
    expect(out.output).toContain('"kzzzzzzz" is not an object of blocks 0-0')
    expect(editor.state.doc.eq(before)).toBe(true)
  })

  it('names the block an id from outside the range belongs to', () => {
    const editor = open([para(text('A')), para(text('B'), noteRef('1'), text('.'))])
    const note = idOf(read(editor, 1), 'footnote 1')
    const out = replace(editor, 0, `<p>A<keep id="${note}" what="footnote 1"/></p>`)
    expect(out.isError).toBe(true)
    expect(out.output).toContain(`"${note}" belongs to block 1, outside blocks 0-0`)
  })

  it('refuses a token placed between blocks, and one both kept and dropped', () => {
    const editor = open([rich()])
    const html = read(editor, 0)
    const noteTag = /<keep id="k[0-9a-z]{7}" what="footnote 1"\/>/.exec(html)![0]
    const between = replace(editor, 0, `${html.replace(noteTag, '')}${noteTag}`)
    expect(between.isError).toBe(true)
    expect(between.output).toContain('placed between blocks')
    const red = spanIdOn(html, 'deadline')
    const both = replace(editor, 0, html, { drop: [red] })
    expect(both.isError).toBe(true)
    expect(both.output).toContain('both written and listed in drop')
  })

  it('refuses a drop list that names nothing in the range, or names a mark twice too often', () => {
    const editor = open([rich()])
    const html = read(editor, 0)
    const note = idOf(html, 'footnote 1')
    expect(replace(editor, 0, html, { drop: 'all' }).output).toContain('drop must be an array')
    expect(replace(editor, 0, html, { drop: ['kaaaaaaa'] }).output).toContain('"kaaaaaaa"')
    const twice = replace(editor, 0, html.replace(/<keep[^>]*footnote 1"\/>/, ''), {
      drop: [note, note],
    })
    expect(twice.output).toContain('listed in drop more often than it occurs')
  })

  it('refuses a comment spread over two paragraphs', () => {
    const editor = open([rich()])
    const html = read(editor, 0)
    const span = spanIdOn(html, 'budget')
    const split = html.replace('</p>', `</p><p>More on the <span id="${span}">budget</span>.</p>`)
    const out = replace(editor, 0, split)
    expect(out.isError).toBe(true)
    expect(out.output).toContain('comment c7 would cover 2 paragraphs')
  })
})

describe('dropping objects on request', () => {
  it('removes the note and the comment thread whose last anchor went', () => {
    const editor = open([rich()])
    const notes = fakeNotes(['1'])
    const comments = fakeComments()
    const html = read(editor, 0)
    const note = idOf(html, 'footnote 1')
    const budget = spanIdOn(html, 'budget')
    const rewritten = html
      .replace(/<keep id="k[0-9a-z]{7}" what="footnote 1"\/>/, '')
      .replace(`<span id="${budget}">budget</span>`, 'money')
    const out = run(
      editor,
      'replace_blocks',
      { startBlockIndex: 0, endBlockIndex: 0, html: rewritten, drop: [note, budget] },
      { notes, comments },
    )
    expect(out.isError, out.output).toBe(false)
    expect(out.output).toContain('Dropped: 1 footnote mark, 1 span (1 comment).')
    expect(objects(editor).notes).toEqual([])
    expect(notes.removed).toEqual(['1'])
    expect(comments.remove).toHaveBeenCalledWith('c7')
  })

  it('leaves a note another reference still points at', () => {
    const editor = open([rich(), para(text('Again'), noteRef('1'), text('.'))])
    const notes = fakeNotes(['1'])
    const html = read(editor, 0)
    const note = idOf(html, 'footnote 1')
    const out = run(
      editor,
      'replace_blocks',
      {
        startBlockIndex: 0,
        endBlockIndex: 0,
        html: html.replace(/<keep[^>]*footnote 1"\/>/, ''),
        drop: [note],
      },
      { notes },
    )
    expect(out.isError, out.output).toBe(false)
    expect(notes.removed).toEqual([])
  })
})

describe('tracked rewrites keep every note mark and picture exactly once', () => {
  function trackedRewrite() {
    const editor = open([rich()])
    const out = run(
      editor,
      'replace_blocks',
      { startBlockIndex: 0, endBlockIndex: 0, html: read(editor, 0).replace('Plans', 'Plan') },
      { track: TRACK },
    )
    expect(out.isError, out.output).toBe(false)
    return editor
  }

  const everywhere = (editor: Editor) => {
    const found = { notes: 0, pictures: 0 }
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'docNoteRef') found.notes++
      if (n.type.name === 'docInlineImage') found.pictures++
    })
    return found
  }

  it('while pending, once in the whole document and never under a revision mark', () => {
    const editor = trackedRewrite()
    expect(everywhere(editor)).toEqual({ notes: 1, pictures: 1 })
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'docNoteRef' || n.type.name === 'docInlineImage')
        expect(n.marks.map((m) => m.type.name)).not.toContain('ins')
    })
  })

  it('after accepting all', () => {
    const editor = trackedRewrite()
    acceptAllRevisions(editor)
    expect(everywhere(editor)).toEqual({ notes: 1, pictures: 1 })
    expect(editor.state.doc.textContent).toContain('Plan for')
  })

  it('after rejecting all', () => {
    const editor = trackedRewrite()
    rejectAllRevisions(editor)
    expect(everywhere(editor)).toEqual({ notes: 1, pictures: 1 })
    expect(editor.state.doc.textContent).toContain('Plans for')
  })

  it('for a tracked replace_selection too', () => {
    const editor = open([rich()])
    const body = editor.state.doc.child(0).textContent
    const from = 1 + body.indexOf('launch')
    // textContent skips the note mark, which sits just before ' with'
    const to = 2 + body.indexOf(' with')
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    )
    const html = read(editor, 0)
    const note = /<keep id="k[0-9a-z]{7}" what="footnote 1"\/>/.exec(html)![0]
    const out = run(
      editor,
      'replace_selection',
      { html: `<strong>launch</strong> days${note}` },
      {
        track: TRACK,
      },
    )
    expect(out.isError, out.output).toBe(false)
    expect(everywhere(editor)).toEqual({ notes: 1, pictures: 1 })
    acceptAllRevisions(editor)
    expect(everywhere(editor)).toEqual({ notes: 1, pictures: 1 })
    expect(editor.state.doc.textContent).toContain('the launch days with')
  })
})
