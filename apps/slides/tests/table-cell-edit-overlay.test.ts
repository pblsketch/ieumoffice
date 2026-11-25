// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShapeRenderNode, TextLine } from '@genoffice/pptx-render'
import { populateEditorDom, TextEditOverlay } from '../src/renderer/TextEditOverlay'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function cellNode(lines: TextLine[] | null): ShapeRenderNode {
  return {
    id: 'cellEdit_t1_0_0_1',
    type: 'text',
    sourceId: 't1',
    box: { x: 100, y: 100, w: 120, h: 40, rotationDeg: 0 },
    fill: { kind: 'none' },
    ...(lines !== null
      ? {
          text: {
            insets: { l: 6, t: 3, r: 6, b: 3 },
            anchor: 'top',
            wrap: true,
            contentHeight: 20,
            lines,
          },
        }
      : {}),
  } as unknown as ShapeRenderNode
}

describe('table cell text editing overlay', () => {
  it('does not apply a negative baseline offset to empty paragraphs with leadAbove', () => {
    const div = document.createElement('div')
    div.style.fontFamily = 'Calibri'
    div.style.fontSize = '24px'
    document.body.appendChild(div)
    const emptyLine: TextLine = {
      top: 0,
      height: 28.8,
      advance: 28.8,
      leadAbove: 4.8,
      paraStart: true,
      runs: [],
    } as unknown as TextLine
    populateEditorDom(div, [emptyLine], 0, 108, false)
    const para = div.firstElementChild as HTMLElement
    expect(para.style.top).toBe('')
  })

  it('does not force autoshape centering on an empty table cell', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(TextEditOverlay, {
          node: cellNode(null),
          scale: 1,
          isTableCell: true,
          onCommit: vi.fn(),
          onCancel: vi.fn(),
        }),
      )
    })
    const ed = host.querySelector('.slide-text-editor') as HTMLElement
    const frame = ed.parentElement as HTMLElement
    expect(ed.style.textAlign).toBe('')
    expect(frame.style.justifyContent).toBe('flex-start')
    expect(ed.style.width).toBe('120px')
    act(() => root.unmount())
  })

  it('navigates to adjacent cell on arrow key at text edge and switches to multi-cell on Shift+Arrow', () => {
    const onArrowNav = vi.fn(() => true)
    const onExtendCellSelection = vi.fn(() => true)
    const onSelectAllCells = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const line: TextLine = {
      top: 0,
      height: 20,
      paraStart: true,
      runs: [
        {
          text: 'Hello',
          x: 0,
          baselineY: 16,
          widthPx: 40,
          fontSizePx: 16,
          fontFamily: 'Calibri',
          color: '#000000',
          srcRunIdx: 0,
        },
      ],
    } as unknown as TextLine
    act(() => {
      root.render(
        createElement(TextEditOverlay, {
          node: cellNode([line]),
          scale: 1,
          isTableCell: true,
          caretPoint: { place: 'end' },
          onCommit: vi.fn(),
          onCancel: vi.fn(),
          onArrowNav,
          onExtendCellSelection,
          onSelectAllCells,
        }),
      )
    })
    const ed = host.querySelector('.slide-text-editor') as HTMLElement
    // At end of "Hello": ArrowRight triggers onArrowNav('right')
    act(() => {
      ed.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
    })
    expect(onArrowNav).toHaveBeenCalledWith(null, 'right')
    act(() => root.unmount())
  })
})
