import { describe, expect, it } from 'vitest'
import {
  isSpacePanKey,
  whiteboardHistoryShortcut,
  whiteboardToolShortcut,
  type WhiteboardKeyEvent,
} from '../src/renderer/canvas/shortcuts'

function keyEvent(overrides: Partial<WhiteboardKeyEvent> = {}): WhiteboardKeyEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  }
}

describe('whiteboardToolShortcut', () => {
  it('matches all single-key tool shortcuts on English layouts', () => {
    expect(whiteboardToolShortcut(keyEvent({ key: 'v', code: 'KeyV' }))).toBe('select')
    expect(whiteboardToolShortcut(keyEvent({ key: 'n', code: 'KeyN' }))).toBe('sticky')
    expect(whiteboardToolShortcut(keyEvent({ key: 't', code: 'KeyT' }))).toBe('text')
    expect(whiteboardToolShortcut(keyEvent({ key: 'r', code: 'KeyR' }))).toBe('shape')
    expect(whiteboardToolShortcut(keyEvent({ key: 'l', code: 'KeyL' }))).toBe('connector')
    expect(whiteboardToolShortcut(keyEvent({ key: 'p', code: 'KeyP' }))).toBe('pen')
    expect(whiteboardToolShortcut(keyEvent({ key: 'h', code: 'KeyH' }))).toBe('highlighter')
    expect(whiteboardToolShortcut(keyEvent({ key: 'e', code: 'KeyE' }))).toBe('eraser')
  })

  it('matches all tool shortcuts on Korean IME (macOS Jamo and Windows Process + code)', () => {
    // macOS Korean 2-beolsik
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅍ', code: 'KeyV' }))).toBe('select')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅜ', code: 'KeyN' }))).toBe('sticky')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅅ', code: 'KeyT' }))).toBe('text')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㄱ', code: 'KeyR' }))).toBe('shape')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅣ', code: 'KeyL' }))).toBe('connector')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅔ', code: 'KeyP' }))).toBe('pen')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅗ', code: 'KeyH' }))).toBe('highlighter')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㄷ', code: 'KeyE' }))).toBe('eraser')

    // Windows Chromium Korean IME on non-editable stage
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyV' }))).toBe('select')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyN' }))).toBe('sticky')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyT' }))).toBe('text')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyR' }))).toBe('shape')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyL' }))).toBe('connector')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyP' }))).toBe('pen')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyH' }))).toBe('highlighter')
    expect(whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyE' }))).toBe('eraser')

    // Synthetic Jamo-only events without code
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㅍ' }))).toBe('select')
    expect(whiteboardToolShortcut(keyEvent({ key: 'ㄷ' }))).toBe('eraser')
  })

  it('ignores tool shortcuts when modifier keys are held or IME is composing', () => {
    expect(whiteboardToolShortcut(keyEvent({ key: 'v', code: 'KeyV', ctrlKey: true }))).toBeNull()
    expect(whiteboardToolShortcut(keyEvent({ key: 'v', code: 'KeyV', metaKey: true }))).toBeNull()
    expect(whiteboardToolShortcut(keyEvent({ key: 'v', code: 'KeyV', altKey: true }))).toBeNull()
    expect(
      whiteboardToolShortcut(keyEvent({ key: 'Process', code: 'KeyV', isComposing: true })),
    ).toBeNull()
  })
})

describe('whiteboardHistoryShortcut', () => {
  it('resolves Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y on English and Korean layouts', () => {
    expect(whiteboardHistoryShortcut(keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBe(
      'undo',
    )
    expect(whiteboardHistoryShortcut(keyEvent({ key: 'ㅋ', code: 'KeyZ', ctrlKey: true }))).toBe(
      'undo',
    )
    expect(
      whiteboardHistoryShortcut(keyEvent({ key: 'Process', code: 'KeyZ', ctrlKey: true })),
    ).toBe('undo')
    expect(
      whiteboardHistoryShortcut(
        keyEvent({ key: 'ㅋ', code: 'KeyZ', metaKey: true, shiftKey: true }),
      ),
    ).toBe('redo')
    expect(whiteboardHistoryShortcut(keyEvent({ key: 'ㅛ', code: 'KeyY', ctrlKey: true }))).toBe(
      'redo',
    )
    expect(
      whiteboardHistoryShortcut(keyEvent({ key: 'Process', code: 'KeyY', ctrlKey: true })),
    ).toBe('redo')
  })

  it('rejects missing modifiers, AltGr, or Ctrl+Shift+Y', () => {
    expect(whiteboardHistoryShortcut(keyEvent({ key: 'z', code: 'KeyZ' }))).toBeNull()
    expect(
      whiteboardHistoryShortcut(keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true })),
    ).toBeNull()
    expect(
      whiteboardHistoryShortcut(
        keyEvent({ key: 'y', code: 'KeyY', ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull()
  })
})

describe('isSpacePanKey', () => {
  it('recognises plain Space by code or key regardless of IME state', () => {
    expect(isSpacePanKey(keyEvent({ key: ' ', code: 'Space' }))).toBe(true)
    expect(isSpacePanKey(keyEvent({ key: 'Process', code: 'Space' }))).toBe(true)
    expect(isSpacePanKey(keyEvent({ key: ' ', code: '' }))).toBe(true)
  })

  it('ignores Space with modifiers and non-Space keys', () => {
    expect(isSpacePanKey(keyEvent({ key: ' ', code: 'Space', ctrlKey: true }))).toBe(false)
    expect(isSpacePanKey(keyEvent({ key: ' ', code: 'Space', metaKey: true }))).toBe(false)
    expect(isSpacePanKey(keyEvent({ key: ' ', code: 'Space', altKey: true }))).toBe(false)
    expect(isSpacePanKey(keyEvent({ key: 'v', code: 'KeyV' }))).toBe(false)
  })
})
