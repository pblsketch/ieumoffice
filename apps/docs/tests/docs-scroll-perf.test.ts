import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { tableModelToPmNode } from '../src/renderer/editor/convert'
import {
  redactDocRange,
  redactTextBetween,
  type RedactableNode,
} from '../src/renderer/ai/redact-view'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { NavPane } from '../src/renderer/components/NavPane'

const roots: Root[] = []
const editors: Editor[] = []

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  for (const e of editors.splice(0)) e.destroy()
  document.body.innerHTML = ''
})

function makeEditor(content: Record<string, unknown>): Editor {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = new Editor({
    element: host,
    extensions: editorExtensions,
    content,
  })
  editors.push(editor)
  return editor
}

describe('redactDocRange', () => {
  it('matches redactTextBetween(doc.toJSON()) across normal, empty, table, and redacted ranges', () => {
    const table = tableModelToPmNode({
      rows: [
        [{ paras: ['cell A'] }, { paras: ['cell B'] }],
        [{ paras: ['cell C'] }, { paras: ['cell D'] }],
      ],
      colWidthsPct: [50, 50],
    })
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'docParagraph', content: [{ type: 'text', text: 'First paragraph text' }] },
        { type: 'docParagraph' },
        {
          type: 'docParagraph',
          content: [
            { type: 'text', text: 'Call ' },
            {
              type: 'text',
              text: '010-1234-5678',
              marks: [{ type: 'redaction', attrs: { label: 'phone' } }],
            },
            { type: 'text', text: ' anytime' },
          ],
        },
        table,
        { type: 'docParagraph', content: [{ type: 'text', text: 'Trailing paragraph' }] },
      ],
    })
    const doc = editor.state.doc
    const fullJson = doc.toJSON() as RedactableNode
    const size = doc.content.size

    const ranges: Array<[number, number]> = [
      [0, 0],
      [1, 6],
      [1, size],
      [0, size],
      [10, 42], // crosses empty paragraph and partially overlaps redacted phone
      [25, 35], // inside redacted span
      [20, size - 5], // crosses redacted span + table + trailing para
    ]
    for (const sep of ['\n', ' ']) {
      for (const [from, to] of ranges) {
        const expected = redactTextBetween(fullJson, from, to, sep)
        const actual = redactDocRange(doc, from, to, sep)
        expect(actual).toBe(expected)
        expect(actual).not.toContain('010-1234-5678')
      }
    }
  })

  it('serialises only the selected top-level blocks instead of the entire document', () => {
    const editor = makeEditor({
      type: 'doc',
      content: Array.from({ length: 40 }, (_, i) => ({
        type: 'docParagraph',
        content: [{ type: 'text', text: `Paragraph number ${i}` }],
      })),
    })
    const doc = editor.state.doc
    const spies = Array.from({ length: doc.childCount }, (_, i) => vi.spyOn(doc.child(i), 'toJSON'))

    // Select inside block 20 only
    let offset = 0
    for (let i = 0; i < 20; i++) offset += doc.child(i).nodeSize
    const text = redactDocRange(doc, offset + 1, offset + 10, '\n')
    expect(text).toBe('Paragraph')

    const calledIndices = spies
      .map((s, i) => (s.mock.calls.length > 0 ? i : -1))
      .filter((i) => i >= 0)
    expect(calledIndices).toEqual([20])
  })
})

describe('AiPanel memoization', () => {
  it('is wrapped in React.memo', () => {
    expect((AiPanel as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })
})

describe('NavPane scroll-page subscription', () => {
  it('subscribes to current-page updates only while the Pages tab is active', () => {
    const prevRo = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    try {
      localStorage.removeItem('aidocs.navPrefs')
      const editor = makeEditor({
        type: 'doc',
        content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'Body' }] }],
      })
      const listeners = new Set<(page: number) => void>()
      const subscribeCurrentPage = vi.fn((fn: (page: number) => void) => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      })

      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      roots.push(root)

      act(() => {
        root.render(
          createElement(NavPane, {
            editor,
            doc: editor.state.doc,
            zoom: 1,
            pageInfo: { current: 1, total: 5 },
            subscribeCurrentPage,
            onClose: () => {},
          }),
        )
      })

      // Default tab is 'headings': must not subscribe to scroll-page updates
      expect(subscribeCurrentPage).not.toHaveBeenCalled()
      expect(listeners.size).toBe(0)

      // Switch to 'pages' tab: subscribes
      const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.nav-tab'))
      act(() => tabs[1].click())
      expect(subscribeCurrentPage).toHaveBeenCalledTimes(1)
      expect(listeners.size).toBe(1)

      // Switch back to 'headings' tab: unsubscribes
      act(() => tabs[0].click())
      expect(listeners.size).toBe(0)
    } finally {
      globalThis.ResizeObserver = prevRo
    }
  })
})

describe('project-panel.css :has() scoping', () => {
  it('never uses an unscoped universal :has() selector that slows down large editor DOM mutations', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../packages/ui/src/project-panel.css'),
      'utf8',
    )
    const lines = css.split(/\r?\n/)
    const unscoped = lines.filter((line) => /^\s*:has\(/.test(line))
    expect(unscoped).toEqual([])
  })
})
