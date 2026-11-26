// The spreadsheet keyboard bar (design system 5.4, 5.6): buttons keep the
// cell editor's focus (pointerdown preventDefault), wait for an open Korean
// composition before acting, Σ types =SUM() with the caret inside, a number
// cell opens on the numeric keyboard and [123] switches it, and the bar is a
// labelled toolbar with 48 px keys.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core'
import { createCompositionTracker } from '../src/renderer/editors/sheets/grid/composition'
import { FormulaKeyboardBar } from '../src/renderer/editors/sheets/grid/FormulaKeyboardBar'
import type { MobileGrid } from '../src/renderer/editors/sheets/grid/mobileGrid'

interface FakeCell {
  v?: unknown
  f?: string
}

function fakeGrid(cell: FakeCell, editorText = '') {
  const endEditingAsync = vi.fn(async () => true)
  const grid = {
    runtime: {
      univer: {
        __getInjector: () => ({
          get: () => ({
            getEditLocation: () => ({ sheetId: 's1', row: 0, column: 0 }),
            getEditor: () => ({
              getDocumentData: () => ({ body: { dataStream: `${editorText}\r\n` } }),
            }),
          }),
        }),
      },
      univerAPI: {
        getActiveWorkbook: () => ({
          endEditingAsync,
          getSheetBySheetId: () => ({ getRange: () => ({ getCellData: () => cell }) }),
        }),
      },
    },
  } as unknown as MobileGrid
  return { grid, endEditingAsync }
}

let root: Root | null = null
let host: HTMLElement | null = null
let editorInput: HTMLElement
const typed: string[] = []
const arrows: number[] = []

beforeEach(() => {
  typed.length = 0
  arrows.length = 0
  editorInput = document.createElement('div')
  editorInput.id = `__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}`
  editorInput.contentEditable = 'true'
  editorInput.tabIndex = 0
  editorInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') arrows.push(typed.length)
  })
  document.body.appendChild(editorInput)
  editorInput.focus()
  document.execCommand = vi.fn((_command: string, _ui?: boolean, value?: string) => {
    typed.push(String(value))
    return true
  }) as typeof document.execCommand
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  editorInput.remove()
})

function render(grid: MobileGrid, composition = createCompositionTracker(document)) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<FormulaKeyboardBar grid={grid} lang="ko" composition={composition} />))
  return { bar: host.querySelector('[data-testid="sheets-keyboard-bar"]')!, composition }
}

const button = (id: string) =>
  host!.querySelector<HTMLButtonElement>(`[data-testid="sheets-key-${id}"]`)!

function press(target: HTMLElement): boolean {
  const pointerdown = new Event('pointerdown', { bubbles: true, cancelable: true })
  const notCancelled = target.dispatchEvent(pointerdown)
  act(() => target.click())
  return notCancelled
}

describe('the keyboard bar', () => {
  it('is a labelled toolbar with the formula keys, [123], cancel and confirm', () => {
    const { bar } = render(fakeGrid({ v: 'text' }).grid)
    expect(bar.getAttribute('role')).toBe('toolbar')
    expect(bar.getAttribute('aria-label')).toBe('수식 입력 도구')
    const faces = [...bar.querySelectorAll('button')].map((key) => key.textContent)
    expect(faces).toEqual(['=', 'Σ', '( )', ',', ':', '$', '123', '취소', '확인'])
  })

  it('keeps the editor focused: every button cancels pointerdown', () => {
    render(fakeGrid({}).grid)
    for (const id of [
      'equals',
      'sum',
      'parens',
      'comma',
      'colon',
      'dollar',
      'numeric',
      'cancel',
      'confirm',
    ]) {
      expect(press(button(id)), id).toBe(false)
    }
    expect(document.activeElement).toBe(editorInput)
  })

  it('Σ types =SUM() and steps the caret back inside the brackets', () => {
    render(fakeGrid({}).grid)
    press(button('sum'))
    expect(typed).toEqual(['=SUM()'])
    expect(arrows).toEqual([1])
  })

  it('Σ in a formula already started types SUM() only', () => {
    render(fakeGrid({}, '=A1+').grid)
    press(button('sum'))
    expect(typed).toEqual(['SUM()'])
  })

  it('waits for an open Korean composition before typing or confirming', async () => {
    const { grid, endEditingAsync } = fakeGrid({})
    render(grid)
    editorInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    press(button('colon'))
    press(button('confirm'))
    expect(typed).toEqual([])
    expect(endEditingAsync).not.toHaveBeenCalled()
    editorInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '가' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(typed).toEqual([':'])
    expect(endEditingAsync).toHaveBeenCalledWith(true)
  })

  it('cancel ends editing without keeping the text', () => {
    const { grid, endEditingAsync } = fakeGrid({})
    render(grid)
    press(button('cancel'))
    expect(endEditingAsync).toHaveBeenCalledWith(false)
  })

  it('a number cell opens on the numeric keyboard; [123] switches back and forth', () => {
    render(fakeGrid({ v: 1200 }).grid)
    expect(editorInput.getAttribute('inputmode')).toBe('decimal')
    expect(button('numeric').getAttribute('aria-pressed')).toBe('true')
    press(button('numeric'))
    expect(editorInput.hasAttribute('inputmode')).toBe(false)
    expect(button('numeric').getAttribute('aria-pressed')).toBe('false')
    press(button('numeric'))
    expect(editorInput.getAttribute('inputmode')).toBe('decimal')
  })

  it('a text or formula cell opens on the full keyboard, and leaving clears the keypad', () => {
    render(fakeGrid({ v: 3, f: '=1+2' }).grid)
    expect(editorInput.hasAttribute('inputmode')).toBe(false)
    expect(button('numeric').getAttribute('aria-pressed')).toBe('false')
    press(button('numeric'))
    expect(editorInput.getAttribute('inputmode')).toBe('decimal')
    act(() => root!.unmount())
    root = null
    expect(editorInput.hasAttribute('inputmode')).toBe(false)
  })
})
