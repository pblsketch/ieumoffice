// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureWhiteboardEngineSync } from '@genoffice/whiteboard-engine/node'
import { WhiteboardEditor } from '../src/renderer/components/WhiteboardEditor'
import { WhiteboardSession } from '../src/renderer/document/session'
import { LocaleProvider } from '../src/renderer/i18n/locale'

// React 19 requires IS_REACT_ACT_ENVIRONMENT for act() in jsdom tests.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('WhiteboardEditor Korean shortcuts and Space-hold hand pan', () => {
  let host: HTMLDivElement
  let root: Root
  let session: WhiteboardSession

  beforeEach(() => {
    ensureWhiteboardEngineSync()
    ;(window as unknown as { whiteboardApi?: unknown }).whiteboardApi = {
      core: {
        onLanguageChanged: () => () => {},
      },
    }
    session = WhiteboardSession.createBlank('Test Board')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(
        <LocaleProvider initial="ko">
          <WhiteboardEditor
            session={session}
            saveStatus="idle"
            autoSave={false}
            onToggleAutoSave={vi.fn()}
            onExport={vi.fn()}
            onPrint={vi.fn()}
            onQuickPrint={vi.fn()}
            exportModalFormat={null}
            onCloseExportModal={vi.fn()}
            onOpenExportModal={vi.fn()}
            presenting={false}
            onSetPresenting={vi.fn()}
            onToast={vi.fn()}
          />
        </LocaleProvider>,
      )
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    session.dispose()
  })

  function pressedToolLabels(): string[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-toolbar .wb-tool-btn'))
      .filter((btn) => btn.getAttribute('aria-pressed') === 'true')
      .map((btn) => btn.getAttribute('aria-label') ?? '')
  }

  it('switches tools and runs undo/redo with Korean IME key events', () => {
    // Pen via macOS Korean Jamo 'ㅔ' + KeyP
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ㅔ', code: 'KeyP', cancelable: true }),
      )
    })
    expect(pressedToolLabels()).toEqual(['펜'])

    // Sticky note via Windows Chromium Korean IME 'Process' + KeyN
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Process', code: 'KeyN', cancelable: true }),
      )
    })
    expect(pressedToolLabels()).toEqual(['포스트잇'])

    // Highlighter via 'ㅗ' + KeyH
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ㅗ', code: 'KeyH', cancelable: true }),
      )
    })
    expect(pressedToolLabels()).toEqual(['형광펜'])

    // Back to select via 'ㅍ' + KeyV
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ㅍ', code: 'KeyV', cancelable: true }),
      )
    })
    expect(pressedToolLabels()).toEqual(['선택'])

    // Add an object, then undo/redo using Korean layout Ctrl+Z ('ㅋ') and Ctrl+Y ('Process' + KeyY)
    act(() => {
      session.addObject({ kind: 'sticky', x: 50, y: 50, width: 160, height: 160 })
    })
    expect(session.getDocument().objects).toHaveLength(1)

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ㅋ', code: 'KeyZ', ctrlKey: true, cancelable: true }),
      )
    })
    expect(session.getDocument().objects).toHaveLength(0)

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Process',
          code: 'KeyY',
          ctrlKey: true,
          cancelable: true,
        }),
      )
    })
    expect(session.getDocument().objects).toHaveLength(1)
  })

  it('activates hand-pan cursor on Space hold, pans on drag, and restores tool on release/blur', () => {
    // Pick shape tool first to ensure Space-pan overrides active tool and restores it afterwards.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', cancelable: true }),
      )
    })
    expect(pressedToolLabels()).toEqual(['도형'])

    const svg = host.querySelector<SVGSVGElement>('.wb-stage-svg')!
    const transformGroup = svg.querySelector<SVGGElement>('g[transform]')!
    expect(svg.classList.contains('wb-space-pan')).toBe(false)
    expect(svg.style.cursor).toBe('crosshair')

    // Hold Space -> grab cursor, no shape added on drag
    const spaceDown = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(spaceDown)
    })
    expect(spaceDown.defaultPrevented).toBe(true)
    expect(svg.classList.contains('wb-space-pan')).toBe(true)
    expect(svg.style.cursor).toBe('grab')

    const initialTransform = transformGroup.getAttribute('transform')
    expect(initialTransform).toBe('translate(96, 48) scale(1)')

    // Pointer down + move + up pans the canvas instead of placing a shape
    act(() => {
      svg.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 150 }),
      )
    })
    expect(svg.classList.contains('wb-panning')).toBe(true)
    expect(svg.style.cursor).toBe('grabbing')

    act(() => {
      svg.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 260, clientY: 190 }),
      )
    })
    expect(transformGroup.getAttribute('transform')).toBe('translate(156, 88) scale(1)')
    expect(session.getDocument().objects).toHaveLength(0)

    act(() => {
      svg.dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 260, clientY: 190 }),
      )
    })
    expect(svg.classList.contains('wb-panning')).toBe(false)
    expect(svg.classList.contains('wb-space-pan')).toBe(true)

    // Release Space -> restores original tool cursor
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }))
    })
    expect(svg.classList.contains('wb-space-pan')).toBe(false)
    expect(svg.style.cursor).toBe('crosshair')
    expect(pressedToolLabels()).toEqual(['도형'])

    // Window blur releases held Space so cursor never gets stuck
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true }),
      )
    })
    expect(svg.classList.contains('wb-space-pan')).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(svg.classList.contains('wb-space-pan')).toBe(false)
  })
})
